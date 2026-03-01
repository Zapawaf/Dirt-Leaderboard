// Dirt Leaderboard — API-backed (Cloudflare Access + Pages Functions + Supabase)
//
// Requires these endpoints (already in your functions/ folder):
// - GET  /api/whoami  -> { username }
// - GET  /api/runs    -> [runs...] (server adds canDelete)
// - POST /api/runs    -> inserts a run
// - DELETE /api/runs/:id -> deletes if owned by user
//
// Data files (static):
// - /data/tracks.json
// - /data/cars.json

const $ = (id) => document.getElementById(id);

function cacheBust(url) {
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isLocal ? `${url}?v=${Date.now()}` : url;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getParam(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function fillSelect(sel, items) {
  if (!sel) return;
  sel.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    sel.appendChild(opt);
  }
}

function parseTimeToMs(s) {
  if (!s) return null;
  let raw = String(s).trim().replace(",", ".");

  // Digits-only: 0345123 -> 03:45.123
  if (/^[0-9]+$/.test(raw) && raw.length >= 4) {
    raw = raw.padStart(4, "0");
    const msPart = raw.slice(-3);
    const secPart = raw.slice(-5, -3);
    const minPart = raw.slice(0, -5) || "0";
    const m = parseInt(minPart, 10);
    const sec = parseInt(secPart, 10);
    const ms = parseInt(msPart, 10);
    return (m * 60 + sec) * 1000 + ms;
  }

  // mm:ss(.mmm)
  const mmss = raw.match(/^([0-9]+):([0-5]?[0-9])(\.[0-9]{1,3})?$/);
  if (mmss) {
    const m = parseInt(mmss[1], 10);
    const sec = parseInt(mmss[2], 10);
    const frac = mmss[3] ? mmss[3].slice(1) : "0";
    const ms = parseInt(frac.padEnd(3, "0").slice(0, 3), 10);
    return (m * 60 + sec) * 1000 + ms;
  }

  // ss(.mmm)
  const ss = raw.match(/^([0-9]+)(\.[0-9]{1,3})?$/);
  if (ss) {
    const sec = parseInt(ss[1], 10);
    const frac = ss[2] ? ss[2].slice(1) : "0";
    const ms = parseInt(frac.padEnd(3, "0").slice(0, 3), 10);
    return sec * 1000 + ms;
  }

  return null;
}

function msToDisplay(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const frac = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// --------- Auth/JSON safety (prevents "<!doctype" JSON crash) ----------
function showBanner(msg) {
  let el = $("error-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "error-banner";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;top:12px;left:12px;right:12px;padding:10px 12px;border:1px solid #ffcc00;background:#1b1b1b;color:#ffcc00;z-index:9999;border-radius:8px;font-family:system-ui;";
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  // Cloudflare Access login/deny is HTML
  if (
    contentType.includes("text/html") ||
    text.trim().startsWith("<!doctype") ||
    text.trim().startsWith("<html")
  ) {
    const err = new Error("AUTH_HTML");
    err.status = res.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error("BAD_JSON");
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function loadJsonFile(path) {
  const res = await fetch(cacheBust(path), { cache: "no-store" });
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);

  // If Access ever wraps static (rare), detect it
  if (
    contentType.includes("text/html") ||
    text.trim().startsWith("<!doctype") ||
    text.trim().startsWith("<html")
  ) {
    throw new Error("Authentication required (Access returned HTML instead of JSON).");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON returned for ${path}`);
  }
}

// -------------------- App State --------------------
let TRACKS = null;
let CARS = null;

let CURRENT_USERNAME = null;
let RUNS = []; // latest fetched runs from /api/runs

function normalizeRun(r) {
  // DB fields are snake_case; keep consistent internally for display
  return {
    id: r.id,
    created_at: r.created_at,
    owner_name: r.owner_name ?? "",
    owner_id: r.owner_id, // not displayed
    location: r.location ?? "",
    direction: r.direction ?? "",
    stage: r.stage ?? "",
    discipline: r.discipline ?? "",
    vehicle_class: r.vehicle_class ?? "",
    vehicle: r.vehicle ?? "",
    time_ms: Number(r.time_ms),
    time_text: msToDisplay(Number(r.time_ms)),
    canDelete: !!r.canDelete,
  };
}

async function refreshWhoAmI() {
  try {
    const who = await fetchJson("/api/whoami");
    CURRENT_USERNAME = who?.username || null;

    // If index.html has a playerName input, fill it and lock it
    const playerName = $("playerName");
    if (playerName) {
      playerName.value = CURRENT_USERNAME || "";
      playerName.readOnly = true;
      playerName.placeholder = CURRENT_USERNAME ? "" : "Not logged in";
    }

    // Optional: show "Logged in as X" if you have an element
    const whoEl = $("whoami");
    if (whoEl) whoEl.textContent = CURRENT_USERNAME ? `Logged in as: ${CURRENT_USERNAME}` : "";
  } catch (err) {
    if (err.message === "AUTH_HTML" || err.status === 401) {
      showBanner("Not authenticated. Complete Cloudflare Access login, then refresh.");
      return;
    }
    showBanner(`whoami failed: ${err.message || err}`);
  }
}

async function refreshRuns() {
  try {
    const data = await fetchJson("/api/runs");
    RUNS = Array.isArray(data) ? data.map(normalizeRun) : [];
  } catch (err) {
    if (err.message === "AUTH_HTML" || err.status === 401) {
      showBanner("Not authenticated. Complete Cloudflare Access login, then refresh.");
      return;
    }
    showBanner(`Failed to load runs: ${err.message || err}`);
  }
}

// -------------------- Sidebar --------------------
function buildSidebar() {
  const wrap = $("navLocations");
  const search = $("navSearch");
  if (!wrap || !TRACKS) return;

  const allLocations = Object.keys(TRACKS).sort((a, b) => a.localeCompare(b));
  const currentLoc = getParam("loc");

  function render() {
    const q = (search?.value || "").trim().toLowerCase();
    const visible = q ? allLocations.filter((l) => l.toLowerCase().includes(q)) : allLocations;

    wrap.innerHTML = "";
    for (const loc of visible) {
      const a = document.createElement("a");
      a.className = "quickLocBtn" + (currentLoc && loc === currentLoc ? " active" : "");
      a.href = `./location.html?loc=${encodeURIComponent(loc)}`;
      a.textContent = loc;
      wrap.appendChild(a);
    }
  }

  search?.addEventListener("input", render);
  render();
}

// -------------------- Index page (submit + recent) --------------------
function setupSubmitUI() {
  const playerName = $("playerName");
  if (!playerName) return; // not on home/index

  const discipline = $("discipline");
  const locationSel = $("location");
  const directionSel = $("direction");
  const stageSel = $("stage");
  const classSel = $("vehicleClass");
  const vehicleSel = $("vehicle");
  const timeText = $("timeText");
  const msg = $("msg");

  const locations = Object.keys(TRACKS).sort((a, b) => a.localeCompare(b));
  fillSelect(locationSel, locations);

  function refreshDirections() {
    const loc = locationSel.value;
    const dirs = loc ? Object.keys(TRACKS[loc] || {}) : [];
    fillSelect(directionSel, dirs);
  }

  function refreshStages() {
    const loc = locationSel.value;
    const dir = directionSel.value;
    const stages = loc && dir ? TRACKS[loc]?.[dir] || [] : [];
    fillSelect(stageSel, stages.map((s) => s.stage));
  }

  function refreshClasses() {
    const disc = discipline.value;
    const classes = Object.keys(CARS[disc] || {}).sort((a, b) => a.localeCompare(b));
    fillSelect(classSel, classes);
  }

  function refreshVehicles() {
    const disc = discipline.value;
    const cls = classSel.value;
    const cars = cls ? CARS[disc]?.[cls] || [] : [];
    fillSelect(vehicleSel, cars);
  }

  locationSel.addEventListener("change", () => {
    refreshDirections();
    refreshStages();
  });
  directionSel.addEventListener("change", () => refreshStages());
  discipline.addEventListener("change", () => {
    refreshClasses();
    refreshVehicles();
  });
  classSel.addEventListener("change", () => refreshVehicles());

  refreshDirections();
  refreshStages();
  refreshClasses();
  refreshVehicles();

  $("resetForm")?.addEventListener("click", () => {
    timeText.value = "";
    msg.textContent = "";
  });

  $("submitRun")?.addEventListener("click", async () => {
    msg.textContent = "";

    if (!CURRENT_USERNAME) {
      msg.textContent = "Not logged in. Complete Cloudflare Access login and refresh.";
      return;
    }

    const loc = locationSel.value;
    const dir = directionSel.value;
    const stage = stageSel.value;
    const disc = discipline.value;
    const vcls = classSel.value;
    const veh = vehicleSel.value;

    if (!loc || !dir || !stage) {
      msg.textContent = "Pick location + direction + stage.";
      return;
    }

    const ms = parseTimeToMs(timeText.value);
    if (ms === null) {
      msg.textContent = "Enter a valid time like 03:45.123";
      return;
    }

    try {
      // Server will attach owner_id + owner_name
      await fetchJson("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: loc,
          direction: dir,
          stage: stage,
          discipline: disc,
          vehicle_class: vcls,
          vehicle: veh,
          time_ms: ms,
        }),
      });

      msg.textContent = "Run submitted ✔";
      timeText.value = "";

      await refreshRuns();
      renderRecent();
    } catch (err) {
      if (err.message === "AUTH_HTML" || err.status === 401) {
        msg.textContent = "Not authenticated. Complete Access login and refresh.";
        return;
      }
      msg.textContent = `Submit failed: ${err.message || err}`;
    }
  });

  // Old local-only buttons: disable (if present)
  $("exportRuns")?.addEventListener("click", () => {
    msg.textContent = "Export is disabled in online mode.";
  });
  $("importRuns")?.addEventListener("click", () => {
    msg.textContent = "Import is disabled in online mode.";
  });
  $("wipeRuns")?.addEventListener("click", () => {
    msg.textContent = "Wipe is disabled in online mode.";
  });
}

function renderRecent() {
  const table = $("recentTable");
  if (!table) return;
  const tbody = table.querySelector("tbody");

  const runs = RUNS.slice();
  runs.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  const top = runs.slice(0, 10);
  tbody.innerHTML = top
    .map((r) => {
      return `<tr>
        <td>${escapeHtml(fmtWhen(r.created_at))}</td>
        <td>${escapeHtml(r.owner_name || "")}</td>
        <td><strong>${escapeHtml(r.time_text)}</strong></td>
        <td>${escapeHtml(r.location || "")}</td>
        <td>${escapeHtml(r.stage || "")}</td>
        <td>${escapeHtml(r.direction || "")}</td>
        <td>${escapeHtml(r.discipline || "")}</td>
        <td>${escapeHtml(r.vehicle_class || "")}</td>
        <td>${escapeHtml(r.vehicle || "")}</td>
        <td><a class="btn secondary" href="./location.html?loc=${encodeURIComponent(r.location || "")}">Go</a></td>
      </tr>`;
    })
    .join("");
}

// -------------------- Location leaderboard --------------------
function bestPerPlayer(runs) {
  const map = new Map();
  for (const r of runs) {
    const key = (r.owner_name || "").trim().toLowerCase();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || r.time_ms < prev.time_ms) map.set(key, r);
  }
  return Array.from(map.values());
}

function setChipActive(activeId) {
  ["dirAny", "dirForward", "dirReverse"].forEach((id) => {
    $(id)?.classList.toggle("active", id === activeId);
  });
}

function setupLocationUI() {
  const title = $("locTitle");
  const stagePick = $("stagePick");
  if (!title || !stagePick) return;

  const locParam = getParam("loc");
  const loc = locParam && TRACKS[locParam] ? locParam : Object.keys(TRACKS)[0];

  title.textContent = loc;

  // stage dropdown (All Stages)
  const allStages = [];
  for (const dir of Object.keys(TRACKS[loc] || {})) {
    for (const s of TRACKS[loc][dir] || []) allStages.push(s.stage);
  }
  fillSelect(stagePick, ["Any", ...uniq(allStages).sort((a, b) => a.localeCompare(b))]);

  // filters
  window.__dirFilter = "Any";
  setChipActive("dirAny");

  $("dirAny")?.addEventListener("click", () => {
    window.__dirFilter = "Any";
    setChipActive("dirAny");
    renderLocationLeaderboard();
  });
  $("dirForward")?.addEventListener("click", () => {
    window.__dirFilter = "Forward";
    setChipActive("dirForward");
    renderLocationLeaderboard();
  });
  $("dirReverse")?.addEventListener("click", () => {
    window.__dirFilter = "Reverse";
    setChipActive("dirReverse");
    renderLocationLeaderboard();
  });

  stagePick.addEventListener("change", () => renderLocationLeaderboard());
  $("lbMode")?.addEventListener("change", () => renderLocationLeaderboard());

  $("lbClear")?.addEventListener("click", () => {
    window.__dirFilter = "Any";
    setChipActive("dirAny");
    stagePick.value = "Any";
    $("lbMode").value = "overall";
    renderLocationLeaderboard();
  });

  renderLocationLeaderboard();
}

async function deleteRun(id) {
  await fetchJson(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

function renderLocationLeaderboard() {
  const table = $("lbTable");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const loc = getParam("loc");
  if (!loc) {
    tbody.innerHTML = "";
    return;
  }

  const mode = $("lbMode") ? $("lbMode").value : "overall";
  const stage = $("stagePick") ? $("stagePick").value : "Any";
  const direction = window.__dirFilter || "Any";

  let runs = RUNS.filter((r) => r.location === loc);

  if (direction !== "Any") runs = runs.filter((r) => r.direction === direction);
  if (stage !== "Any") runs = runs.filter((r) => r.stage === stage);

  runs.sort((a, b) => a.time_ms - b.time_ms);
  if (mode === "bestPerPlayer") {
    runs = bestPerPlayer(runs).sort((a, b) => a.time_ms - b.time_ms);
  }

  const top = runs.slice(0, 10);

  tbody.innerHTML = top
    .map((r, idx) => {
      const delCell = r.canDelete
        ? `<button class="btn danger" data-del="${escapeHtml(r.id)}">X</button>`
        : ``;

      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(r.owner_name || "")}</td>
        <td><strong>${escapeHtml(r.time_text)}</strong></td>
        <td>${escapeHtml(r.stage || "")}</td>
        <td>${escapeHtml(r.direction || "")}</td>
        <td>${escapeHtml(r.discipline || "")}</td>
        <td>${escapeHtml(r.vehicle_class || "")}</td>
        <td>${escapeHtml(r.vehicle || "")}</td>
        <td>${escapeHtml(fmtWhen(r.created_at))}</td>
        <td>${delCell}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!id) return;

      if (!confirm("Delete this run?")) return;

      try {
        await deleteRun(id);
        await refreshRuns();
        renderLocationLeaderboard();
      } catch (err) {
        if (err.message === "AUTH_HTML" || err.status === 401) {
          showBanner("Not authenticated. Complete Access login and refresh.");
          return;
        }
        showBanner(`Delete failed: ${err.message || err}`);
      }
    });
  });
}

// -------------------- Main --------------------
async function main() {
  TRACKS = await loadJsonFile("./data/tracks.json");
  CARS = await loadJsonFile("./data/cars.json");

  buildSidebar();

  // Authenticate + load shared runs
  await refreshWhoAmI();
  await refreshRuns();

  // Build UIs
  setupSubmitUI();
  renderRecent();
  setupLocationUI();
}

main().catch((err) => {
  console.error(err);
  const msg = $("msg");
  if (msg) msg.textContent = String(err.message || err);
  showBanner(String(err.message || err));
});