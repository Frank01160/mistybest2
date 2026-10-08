/* ==========================================================================
   CONNECTIVITY.JS
   ========================================================================== */

const OFFLINE_GRACE_MS = 20 * 60 * 1000;
let lastOnlineAt = Date.now();

function updateConnBadge() {
  const badge = document.getElementById("connBadge");
  const text = document.getElementById("connText");
  if (!badge || !text) return;
  if (navigator.onLine) {
    badge.className = "conn-badge conn-online";
    text.textContent = "Online";
  } else {
    badge.className = "conn-badge conn-offline";
    text.textContent = "Offline — changes will sync";
  }
}

function isOfflineLockedOut() {
  if (navigator.onLine) return false;
  return Date.now() - lastOnlineAt > OFFLINE_GRACE_MS;
}

function getOfflineDurationMs() {
  if (navigator.onLine) return 0;
  return Date.now() - lastOnlineAt;
}

window.addEventListener("online", () => {
  lastOnlineAt = Date.now();
  updateConnBadge();
  window.dispatchEvent(new CustomEvent("mc:online"));
});
window.addEventListener("offline", () => {
  updateConnBadge();
  window.dispatchEvent(new CustomEvent("mc:offline"));
});
document.addEventListener("DOMContentLoaded", updateConnBadge);
