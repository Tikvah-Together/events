// Import the functions you need from the SDKs you need
import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

const firebaseConfig = {
  apiKey: "AIzaSyC7djNLz_mxuQa1rSXa_Y0AXmvny7wnU7s",
  authDomain: "ttevents-81927.firebaseapp.com",
  projectId: "ttevents-81927",
  storageBucket: "ttevents-81927.firebasestorage.app",
  messagingSenderId: "353173342602",
  appId: "1:353173342602:web:13d0020cdff97ab649e073",
  measurementId: "G-XZD6XDYL34"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// getAnalytics throws in browsers without IndexedDB/cookies (some private modes, in-app browsers)
isSupported()
  .then((ok) => ok && getAnalytics(app))
  .catch(() => {});
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();