// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB9pTTJApbqOAwQ7vwAgK7nMZVWAElpwIc",
  authDomain: "voting-10a21.firebaseapp.com",
  projectId: "voting-10a21",
  storageBucket: "voting-10a21.firebasestorage.app",
  messagingSenderId: "851898047005",
  appId: "1:851898047005:web:0f7e1197ba1b8713c484f4",
  measurementId: "G-Q531CJ5S36"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Firestore database for storing votes. Long-polling auto-detection is
// forced on so the realtime stream also works inside cross-site iframes
// (division-site embeds) where WebChannel streaming can be blocked.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Analytics is only available in browser environments that support it
export let analytics = null;
isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
});
