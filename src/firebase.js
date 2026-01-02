// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBzJYMByHuzCl652B53zYFOKCbOW1g_hBs",
  authDomain: "tikvah-together-events.firebaseapp.com",
  projectId: "tikvah-together-events",
  storageBucket: "tikvah-together-events.firebasestorage.app",
  messagingSenderId: "927848410736",
  appId: "1:927848410736:web:555d18e0fd29c11c344eb5",
  measurementId: "G-7S955HTP8P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getFirestore(app);