import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCKzAfNxx8FpShE_hz4Z-VUNAfA6ux7tsY",
  authDomain: "arc-tracker-c232e.firebaseapp.com",
  projectId: "arc-tracker-c232e",
  storageBucket: "arc-tracker-c232e.firebasestorage.app",
  messagingSenderId: "711558427902",
  appId: "1:711558427902:web:1d0771baefb4bff8cbe1af"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Lets Arc Tracker keep working offline and sync automatically once back online.
enableIndexedDbPersistence(db).catch(() => {
  // Multiple tabs open, or unsupported browser — app still works, just without offline caching.
});
