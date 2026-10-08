/* ==========================================================================
   NAV.JS
   ========================================================================== */

function watchBusinessConfig() {
  db.collection("businessConfig").doc("main").onSnapshot((doc) => {
    const name = doc.exists ? doc.data().companyName : "Misty Code";
    applyLogo(name || "Misty Code");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  watchBusinessConfig();
});
