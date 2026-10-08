/* ==========================================================================
   FIREBASE-CONFIG.JS
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyD1jKOvDVrVYBKsPRghhar5I4ZcePy4URo",
  authDomain: "mistybest2-fb5de.firebaseapp.com",
  projectId: "mistybest2-fb5de",
  storageBucket: "mistybest2-fb5de.firebasestorage.app",
  messagingSenderId: "831243856850",
  appId: "1:831243856850:web:0def1bc91cc76e1d8d760b"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Offline persistence: multiple tabs open, persistence enabled in another tab only.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser.");
  }
});

const FIXED_EMAILS = {
  seller: "seller@mistycode.local",
  manager: "manager@mistycode.local",
};
