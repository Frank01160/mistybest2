/* ==========================================================================
   UTILS.JS — shared helpers used across every page
   ========================================================================== */

function roundKsh(amount) {
  return Math.floor(amount + 0.5);
}

function formatKsh(amount) {
  const rounded = roundKsh(amount);
  return "KSh " + rounded.toLocaleString("en-KE");
}

function minorToMajor(minorQty, minorPerMajor) {
  if (!minorPerMajor) return 0;
  return minorQty / minorPerMajor;
}

function majorToMinor(majorQty, minorPerMajor) {
  return majorQty * minorPerMajor;
}

function formatDoubleUnitStock(minorQty, product) {
  const majorQty = minorToMajor(minorQty, product.minorPerMajor);
  const majorWhole = Math.floor(majorQty);
  const remainderMinor = roundKsh(minorQty - majorWhole * product.minorPerMajor);
  let parts = [];
  if (majorWhole > 0) parts.push(`${majorWhole} ${pluralize(product.majorUnitName, majorWhole)}`);
  if (remainderMinor > 0 || parts.length === 0) parts.push(`${remainderMinor} ${product.minorUnitName}`);
  return parts.join(" ");
}

function pluralize(word, count) {
  if (count === 1) return word;
  if (/[sxz]$|[^aeiou]h$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

/* Fraction presets were used for major-unit selling in an earlier version;
   major units now sell in half-unit steps via a stepper (see pos.js), so
   this list isn't used anymore — left removed intentionally. */

async function getNextReceiptNumber() {
  const counterRef = db.collection("counters").doc("receiptNumber");
  const next = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const current = doc.exists ? doc.data().value : 0;
    const updated = current + 1;
    t.set(counterRef, { value: updated }, { merge: true });
    return updated;
  });
  return String(next).padStart(7, "0");
}

/* ----- Customer credit ---------------------------------------------------------- */
const CREDIT_DUE_DAYS = 7;

function addDaysDateStr(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return formatDateInput(d);
}

/* ----- Dates ------------------------------------------------------------------ */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
function formatDateTime(date) {
  return new Date(date).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function formatDateInput(date) {
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

/* ----- Toasts ------------------------------------------------------------------ */
function showToast(message, type = "info") {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 200ms ease";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

/* ----- Debounce ------------------------------------------------------------------ */
function debounce(fn, wait = 250) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

/* ----- HTML escaping ---------------------------------------------------------------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ----- CSV export ---------------------------------------------------------------- */
function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
