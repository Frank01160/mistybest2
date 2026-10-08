/* ==========================================================================
   FIREBASE-CONFIG.JS
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAr1dy4xGnUrHQDU2PYY8qTTd4zkYHq8dE",
  authDomain: "mistybest1.firebaseapp.com",
  projectId: "mistybest1",
  storageBucket: "mistybest1.firebasestorage.app",
  messagingSenderId: "1001303023966",
  appId: "1:1001303023966:web:abd8d06599c7cf8515afcf",
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
