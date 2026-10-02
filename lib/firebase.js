// lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// We will replace these empty strings with your actual Firebase keys later!
const firebaseConfig = {
    apiKey: "AIzaSyDl7vTn-ienRgdOMdfoo_41iHCZprmeK74",
    authDomain: "mark-entry-app.firebaseapp.com",
    projectId: "mark-entry-app",
    storageBucket: "mark-entry-app.firebasestorage.app",
    messagingSenderId: "694213237468",
    appId: "1:694213237468:web:04efcc2b775c578bf97219",
    measurementId: "G-PW8XT4FL6E"
  };

// Initialize Firebase (this ensures we only initialize it once)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Export the Authentication and Database services so our pages can use them
export const auth = getAuth(app);
export const db = getFirestore(app);