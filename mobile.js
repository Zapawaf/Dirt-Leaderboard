/* mobile.js — Locations drawer + centered handle (mobile only) */

const mq = window.matchMedia("(max-width: 900px)");

function el(id){ return document.getElementById(id); }

function setAria(expanded){
  const handle = el("sidebarHandle");
  if (handle) handle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function openSidebar(){
  document.body.classList.add("sidebar-open");
  setAria(true);
}
function closeSidebar(){
  document.body.classList.remove("sidebar-open");
  setAria(false);
}
function toggleSidebar(){
  if (document.body.classList.contains("sidebar-open")) closeSidebar();
  else openSidebar();
}

function install(){
  const handle = el("sidebarHandle");
  const overlay = el("mobileOverlay");
  const locations = el("locationsPanel");

  // If mobileOverlay is shipped with the HTML [hidden] attribute,
  // it will never show because of the global [hidden]{display:none !important}
  if (overlay) overlay.hidden = false;

  if (handle) handle.addEventListener("click", toggleSidebar);
  if (overlay) overlay.addEventListener("click", closeSidebar);

  if (locations){
    locations.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a) closeSidebar();
    });
  }

  // Start closed on mobile
  if (mq.matches) closeSidebar();
  else closeSidebar();
}

// Ensure listeners are attached even if this script loads in <head> before the DOM exists.
if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", install, { once: true });
} else {
  install();
}

mq.addEventListener("change", () => closeSidebar());
