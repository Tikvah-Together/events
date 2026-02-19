// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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
const analytics = getAnalytics(app);
export const db = getFirestore(app);