// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// OLD CONFIG FOR SUSPENDED EMAIL ACCOUNT
// const firebaseConfig = {
//   apiKey: "AIzaSyBzJYMByHuzCl652B53zYFOKCbOW1g_hBs",
//   authDomain: "tikvah-together-events.firebaseapp.com",
//   projectId: "tikvah-together-events",
//   storageBucket: "tikvah-together-events.firebasestorage.app",
//   messagingSenderId: "927848410736",
//   appId: "1:927848410736:web:555d18e0fd29c11c344eb5",
//   measurementId: "G-7S955HTP8P"
// };

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