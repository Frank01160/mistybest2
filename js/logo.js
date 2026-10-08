/* ==========================================================================
   LOGO.JS — auto-generated wordmark
   ========================================================================== */

const STOPWORDS = new Set(["the", "and", "of", "a", "an", "&"]);

function getInitials(companyName) {
  if (!companyName || !companyName.trim()) return "MC";
  const words = companyName.trim().split(/\s+/).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "MC";
}

function applyLogo(companyName) {
  const initials = getInitials(companyName);
  document.querySelectorAll("#logoBadge, .logo-badge").forEach((el) => { el.textContent = initials; });
  document.querySelectorAll("#logoName, .logo-name").forEach((el) => { el.textContent = companyName || "Misty Code"; });
  document.title = document.title.replace(/^[^—]+/, (companyName || "Misty Code") + " ");
}

function loadAndApplyLogo() {
  db.collection("businessConfig").doc("main").get()
    .then((doc) => {
      const name = doc.exists ? doc.data().companyName : "Misty Code";
      applyLogo(name || "Misty Code");
    })
    .catch(() => { applyLogo("Misty Code"); });
}
