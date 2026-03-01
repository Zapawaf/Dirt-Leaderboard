// Dirt Leaderboard — clean draft (localStorage)
// Pages:
// - index.html: submit + recent
// - location.html?loc=...: location leaderboard with Any/Forward/Reverse + optional stage

const LS_KEY = "dirt_leaderboard_runs_v0";
const $ = (id) => document.getElementById(id);

function cacheBust(url){
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return isLocal ? `${url}?v=${Date.now()}` : url;
}
async function loadJson(path){
  const res = await fetch(cacheBust(path), { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.json();
}
function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function parseTimeToMs(s){
  if(!s) return null;
  let raw = String(s).trim().replace(",", ".");

  // Digits-only: 0345123 -> 03:45.123
  if(/^[0-9]+$/.test(raw) && raw.length >= 4){
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
  if(mmss){
    const m = parseInt(mmss[1],10);
    const sec = parseInt(mmss[2],10);
    const frac = mmss[3] ? mmss[3].slice(1) : "0";
    const ms = parseInt(frac.padEnd(3,"0").slice(0,3),10);
    return (m*60 + sec)*1000 + ms;
  }

  // ss(.mmm)
  const ss = raw.match(/^([0-9]+)(\.[0-9]{1,3})?$/);
  if(ss){
    const sec = parseInt(ss[1],10);
    const frac = ss[2] ? ss[2].slice(1) : "0";
    const ms = parseInt(frac.padEnd(3,"0").slice(0,3),10);
    return sec*1000 + ms;
  }
  return null;
}

function msToDisplay(ms){
  if(typeof ms !== "number" || !isFinite(ms)) return "";
  const totalSec = Math.floor(ms/1000);
  const m = Math.floor(totalSec/60);
  const s = totalSec % 60;
  const frac = ms % 1000;
  return `${m}:${String(s).padStart(2,"0")}.${String(frac).padStart(3,"0")}`;
}

function nowIso(){ return new Date().toISOString(); }
function fmtWhen(iso){
  try{ return new Date(iso).toLocaleString(); }catch{ return iso; }
}
function randomId(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

function getRuns(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function setRuns(runs){ localStorage.setItem(LS_KEY, JSON.stringify(runs)); }
function addRun(run){ const runs = getRuns(); runs.push(run); setRuns(runs); }
function removeRunById(id){ setRuns(getRuns().filter(r => r.id !== id)); }

function uniq(arr){ return Array.from(new Set(arr)); }
function fillSelect(sel, items){
  if(!sel) return;
  sel.innerHTML = "";
  for(const it of items){
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    sel.appendChild(opt);
  }
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

let TRACKS = null;
let CARS = null;

function buildSidebar(){
  const wrap = $("navLocations");
  const search = $("navSearch");
  if(!wrap) return;

  const allLocations = Object.keys(TRACKS).sort((a,b)=>a.localeCompare(b));
  const currentLoc = getParam("loc");

  function render(){
    const q = (search?.value || "").trim().toLowerCase();
    const visible = q ? allLocations.filter(l => l.toLowerCase().includes(q)) : allLocations;

    wrap.innerHTML = "";
    for(const loc of visible){
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

function setupSubmitUI(){
  const playerName = $("playerName");
  if(!playerName) return; // not on home

  const discipline = $("discipline");
  const locationSel = $("location");
  const directionSel = $("direction");
  const stageSel = $("stage");
  const classSel = $("vehicleClass");
  const vehicleSel = $("vehicle");
  const timeText = $("timeText");
  const msg = $("msg");

  const locations = Object.keys(TRACKS).sort((a,b)=>a.localeCompare(b));
  fillSelect(locationSel, locations);

  function refreshDirections(){
    const loc = locationSel.value;
    const dirs = loc ? Object.keys(TRACKS[loc] || {}) : [];
    fillSelect(directionSel, dirs);
  }

  function refreshStages(){
    const loc = locationSel.value;
    const dir = directionSel.value;
    const stages = (loc && dir) ? (TRACKS[loc]?.[dir] || []) : [];
    fillSelect(stageSel, stages.map(s => s.stage));
  }

  function refreshClasses(){
    const disc = discipline.value;
    const classes = Object.keys(CARS[disc] || {}).sort((a,b)=>a.localeCompare(b));
    fillSelect(classSel, classes);
  }

  function refreshVehicles(){
    const disc = discipline.value;
    const cls = classSel.value;
    const cars = cls ? (CARS[disc]?.[cls] || []) : [];
    fillSelect(vehicleSel, cars);
  }

  locationSel.addEventListener("change", () => { refreshDirections(); refreshStages(); });
  directionSel.addEventListener("change", () => { refreshStages(); });
  discipline.addEventListener("change", () => { refreshClasses(); refreshVehicles(); });
  classSel.addEventListener("change", () => { refreshVehicles(); });

  refreshDirections();
  refreshStages();
  refreshClasses();
  refreshVehicles();

  $("resetForm")?.addEventListener("click", () => {
    playerName.value = "";
    timeText.value = "";
    msg.textContent = "";
  });

  $("submitRun")?.addEventListener("click", () => {
    msg.textContent = "";
    const name = playerName.value.trim();
    if(!name){ msg.textContent = "Name is required."; return; }

    const loc = locationSel.value;
    const dir = directionSel.value;
    const stage = stageSel.value;
    const disc = discipline.value;
    const vcls = classSel.value;
    const veh = vehicleSel.value;

    if(!loc || !dir || !stage){ msg.textContent = "Pick location + direction + stage."; return; }

    const ms = parseTimeToMs(timeText.value);
    if(ms === null){ msg.textContent = "Enter a valid time like 03:45.123"; return; }

    const run = {
      id: randomId(),
      created_at: nowIso(),
      player_name: name,
      location: loc,
      direction: dir,
      stage: stage,
      discipline: disc,
      vehicleClass: vcls,
      vehicle: veh,
      time_ms: ms,
      time_text: msToDisplay(ms),
    };
    addRun(run);
    msg.textContent = "Run saved locally ✔";
    timeText.value = "";
    renderRecent();
  });

  $("exportRuns")?.addEventListener("click", () => {
    const runs = getRuns();
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dirt_runs_export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  });

  $("importRuns")?.addEventListener("click", () => $("importFile")?.click());

  $("importFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const txt = await file.text();
      const arr = JSON.parse(txt);
      if(!Array.isArray(arr)) throw new Error("Not an array");
      const cleaned = arr.filter(r => r && typeof r === "object" && typeof r.time_ms === "number");
      setRuns(cleaned);
      msg.textContent = `Imported ${cleaned.length} runs ✔`;
      renderRecent();
    }catch(err){
      msg.textContent = `Import failed: ${err.message}`;
    }finally{
      e.target.value = "";
    }
  });

  $("wipeRuns")?.addEventListener("click", () => {
    if(confirm("Wipe ALL locally stored runs on this device/browser?")){
      setRuns([]);
      msg.textContent = "All local runs wiped.";
      renderRecent();
    }
  });
}

function renderRecent(){
  const table = $("recentTable");
  if(!table) return;
  const tbody = table.querySelector("tbody");
  const runs = getRuns().slice();

  runs.sort((a,b) => String(b.created_at||"").localeCompare(String(a.created_at||"")));
  const top = runs.slice(0,10);

  tbody.innerHTML = top.map(r => {
    return `<tr>
      <td>${escapeHtml(fmtWhen(r.created_at))}</td>
      <td>${escapeHtml(r.player_name || "")}</td>
      <td><strong>${escapeHtml(r.time_text || msToDisplay(r.time_ms))}</strong></td>
      <td>${escapeHtml(r.location || "")}</td>
      <td>${escapeHtml(r.stage || "")}</td>
      <td>${escapeHtml(r.direction || "")}</td>
      <td>${escapeHtml(r.discipline || "")}</td>
      <td>${escapeHtml(r.vehicleClass || "")}</td>
      <td>${escapeHtml(r.vehicle || "")}</td>
      <td><a class="btn secondary" href="./location.html?loc=${encodeURIComponent(r.location||"")}">Go</a></td>
    </tr>`;
  }).join("");
}

function bestPerPlayer(runs){
  const map = new Map();
  for(const r of runs){
    const key = (r.player_name || "").trim().toLowerCase();
    if(!key) continue;
    const prev = map.get(key);
    if(!prev || r.time_ms < prev.time_ms) map.set(key, r);
  }
  return Array.from(map.values());
}

function setChipActive(activeId){
  ["dirAny","dirForward","dirReverse"].forEach(id => {
    $(id)?.classList.toggle("active", id === activeId);
  });
}

function setupLocationUI(){
  const title = $("locTitle");
  const stagePick = $("stagePick");
  if(!title || !stagePick) return;

  const locParam = getParam("loc");
  const loc = (locParam && TRACKS[locParam]) ? locParam : Object.keys(TRACKS)[0];

  title.textContent = loc;

  // stage dropdown (All Stages)
  const allStages = [];
  for(const dir of Object.keys(TRACKS[loc] || {})){
    for(const s of (TRACKS[loc][dir] || [])) allStages.push(s.stage);
  }
  fillSelect(stagePick, ["Any", ...uniq(allStages).sort((a,b)=>a.localeCompare(b))]);

  // filters
  window.__dirFilter = "Any";
  setChipActive("dirAny");

  $("dirAny")?.addEventListener("click", () => { window.__dirFilter="Any"; setChipActive("dirAny"); renderLocationLeaderboard(); });
  $("dirForward")?.addEventListener("click", () => { window.__dirFilter="Forward"; setChipActive("dirForward"); renderLocationLeaderboard(); });
  $("dirReverse")?.addEventListener("click", () => { window.__dirFilter="Reverse"; setChipActive("dirReverse"); renderLocationLeaderboard(); });

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

function renderLocationLeaderboard(){
  const table = $("lbTable");
  if(!table) return;
  const tbody = table.querySelector("tbody");
  const loc = getParam("loc");
  if(!loc){ tbody.innerHTML = ""; return; }

  const mode = $("lbMode") ? $("lbMode").value : "overall";
  const stage = $("stagePick") ? $("stagePick").value : "Any";
  const direction = window.__dirFilter || "Any";

  let runs = getRuns().filter(r => r.location === loc);

  if(direction !== "Any") runs = runs.filter(r => r.direction === direction);
  if(stage !== "Any") runs = runs.filter(r => r.stage === stage);

  runs.sort((a,b)=>a.time_ms - b.time_ms);
  if(mode === "bestPerPlayer"){
    runs = bestPerPlayer(runs).sort((a,b)=>a.time_ms - b.time_ms);
  }

  const top = runs.slice(0,10);

  tbody.innerHTML = top.map((r, idx) => {
    return `<tr>
      <td>${idx+1}</td>
      <td>${escapeHtml(r.player_name || "")}</td>
      <td><strong>${escapeHtml(r.time_text || msToDisplay(r.time_ms))}</strong></td>
      <td>${escapeHtml(r.stage || "")}</td>
      <td>${escapeHtml(r.direction || "")}</td>
      <td>${escapeHtml(r.discipline || "")}</td>
      <td>${escapeHtml(r.vehicleClass || "")}</td>
      <td>${escapeHtml(r.vehicle || "")}</td>
      <td>${escapeHtml(fmtWhen(r.created_at))}</td>
      <td><button class="btn danger" data-del="${r.id}">X</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      if(confirm("Delete this run from local storage?")){
        removeRunById(id);
        renderLocationLeaderboard();
      }
    });
  });
}

async function main(){
  TRACKS = await loadJson("./data/tracks.json");
  CARS = await loadJson("./data/cars.json");

  buildSidebar();
  setupSubmitUI();
  renderRecent();
  setupLocationUI();
}

main().catch(err => {
  console.error(err);
  const msg = $("msg");
  if(msg) msg.textContent = String(err.message || err);
});
