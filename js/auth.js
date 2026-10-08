/* ==========================================================================
   AUTH.JS
   ========================================================================== */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of no interaction -> auto logout
let idleTimer = null;
let currentUserRole = null;
let currentUserName = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showToast("Signed out after being idle. Sign in again to continue.", "warning");
    auth.signOut().then(() => {
      window.location.href = pathToIndex();
    });
  }, IDLE_TIMEOUT_MS);
}

function startIdleWatch() {
  if (startIdleWatch._wired) return;
  startIdleWatch._wired = true;
  ["mousedown", "keydown", "touchstart", "scroll"].forEach((evt) => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

function pathToIndex() {
  return window.location.pathname.includes("/pages/") ? "../index.html" : "index.html";
}

function fetchUserRole(uid) {
  return db.collection("users").doc(uid).get().then((doc) => (doc.exists ? doc.data() : null));
}

function requireAuth(allowedRoles) {
  return new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      unsub();
      if (!user) {
        window.location.href = pathToIndex();
        return;
      }

      let profile = null;
      try {
        profile = await fetchUserRole(user.uid);
      } catch (err) {
        console.error("Role lookup failed:", err);
        await auth.signOut();
        sessionStorage.setItem("mc_login_error", "Couldn't check your account permissions (Firestore rules or connection issue). Please try signing in again.");
        window.location.href = pathToIndex();
        return;
      }

      if (!profile) {
        console.error(`No users/${user.uid} document found in Firestore.`);
        await auth.signOut();
        sessionStorage.setItem("mc_login_error", "Your account isn't set up yet — no role found in Firestore. Ask the manager to check the users collection.");
        window.location.href = pathToIndex();
        return;
      }

      if (!allowedRoles.includes(profile.role)) {
        console.error(`User role "${profile.role}" not permitted on this page (needs one of: ${allowedRoles.join(", ")}).`);
        await auth.signOut();
        sessionStorage.setItem("mc_login_error", "You don't have access to that page.");
        window.location.href = pathToIndex();
        return;
      }

      currentUserRole = profile.role;
      currentUserName = profile.displayName || (profile.role === "manager" ? "Main" : "Seller");

      const roleBadge = document.getElementById("roleBadge");
      const userName = document.getElementById("userName");
      if (roleBadge) {
        roleBadge.textContent = profile.role === "manager" ? "Manager" : "Seller";
        roleBadge.className = profile.role === "manager" ? "badge badge-manager" : "badge badge-seller";
      }
      if (userName) userName.textContent = currentUserName;

      document.querySelectorAll(".manager-only").forEach((el) => {
        el.classList.toggle("hidden", profile.role !== "manager");
      });

      startIdleWatch();
      loadAndApplyLogo();
      wireLogoutButton();

      resolve({ uid: user.uid, role: profile.role, displayName: currentUserName });
    });
  });
}

function wireLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "true";
  btn.addEventListener("click", () => {
    auth.signOut().then(() => {
      window.location.href = pathToIndex();
    });
  });
}
