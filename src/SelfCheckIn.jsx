import React, { useState } from "react";
import { db } from "./firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  orderBy,
  limit,
} from "firebase/firestore";

const SelfCheckIn = () => {
  const [input, setInput] = useState("");
  const [step, setStep] = useState("input"); // input, loading, success, error
  const [firstName, setFirstName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [userId, setUserId] = useState("");
  const [eventId, setEventId] = useState("");

const handleCheckIn = async (e) => {
    e.preventDefault();
    setStep("loading");
    setErrorMsg("");

    try {
      // 1. Get the latest event
      const eventQuery = query(
        collection(db, "events"),
        orderBy("scheduledAt", "desc"),
        limit(1)
      );
      const eventSnap = await getDocs(eventQuery);
      if (eventSnap.empty) {
        setErrorMsg("No active events found.");
        setStep("input");
        return;
      }
      
      const eventDoc = eventSnap.docs[0];
      const currentEventId = eventDoc.id;
      setEventId(currentEventId); 
      const eventData = eventDoc.data();

      // 2. Find the user by Email or Phone
      const cleanInput = input.trim().toLowerCase();
      const userQuery = query(collection(db, "users"), where("email", "==", cleanInput));
      let userSnap = await getDocs(userQuery);
      console.log("User query results with email:", userSnap.size);

      if (userSnap.empty) {
        const phoneInput = input.replace(/\D/g, "");
        const phoneQuery = query(collection(db, "users"), where("phone", "==", phoneInput));
        userSnap = await getDocs(phoneQuery);
        console.log("User query results with phone:", userSnap.size);
      }

      if (userSnap.empty) {
        setErrorMsg("Registration not found. Please see the front desk.");
        setStep("input");
        return;
      }

      const userDoc = userSnap.docs[0];
      const currentUserId = userDoc.id;
      setUserId(currentUserId); 
      const userData = userDoc.data();

      // 3. Find the registration using the LOCAL variables, not the state!
      const regQuery = query(
        collection(db, "registrations"),
        where("userId", "==", currentUserId),
        where("eventId", "==", currentEventId)
      );
      const regSnap = await getDocs(regQuery);

      if (regSnap.empty) {
        console.warn(`User ${currentUserId} is not registered for event ${currentEventId}`);
        setErrorMsg("You are not registered for this specific event.");
        setStep("input");
        return;
      }

      setFirstName(userData.firstName || "Attendee");
      
      const regDoc = regSnap.docs[0];
      const regData = regDoc.data();
      const regRef = doc(db, "registrations", regDoc.id);

      if (regData.checkedIn) {
        setTableNumber(regData.tableNumber || 0);
        setStep("success");
        return;
      }

      // --- START AUTO-ASSIGN LOGIC (Mirroring Admin Dashboard) ---
      
      const eventGroups = eventData.eventGroups || [];
      const participantGroupName = String(regData.groupId || "");
      const gender = userData?.gender;
      const prefix = gender === "woman" ? "G" : "B";

      // Find the group suffix (A, B, C...)
      const groupIdx = eventGroups.findIndex((g) => String(g.name) === participantGroupName);
      const groupSuffix = groupIdx >= 0 ? String.fromCharCode(65 + groupIdx) : "U";

      // Fetch all check-ins to find the next number
      const allRegsSnap = await getDocs(
        query(collection(db, "registrations"), where("eventId", "==", currentEventId))
      );
      const allRegs = allRegsSnap.docs.map((d) => d.data());

      const takenNumbers = allRegs
        .filter(
          (a) =>
            a.checkedIn &&
            String(a.groupId) === participantGroupName &&
            a.eventLabel?.startsWith(prefix)
        )
        .map((a) => {
          const beforeHyphen = a.eventLabel.split("-")[0];
          return parseInt(beforeHyphen.substring(1));
        })
        .filter((num) => !isNaN(num))
        .sort((a, b) => a - b);

      let assignedNumber = 1;
      for (let i = 0; i < takenNumbers.length; i++) {
        if (takenNumbers[i] === assignedNumber) assignedNumber++;
        else if (takenNumbers[i] > assignedNumber) break;
      }

      const newEventLabel = `${prefix}${assignedNumber}-${groupSuffix}`;
      const newTableNumber = assignedNumber;

      // 4. Update Database with the assigned table info
      await updateDoc(regRef, {
        checkedIn: true,
        eventLabel: newEventLabel,
        tableNumber: newTableNumber,
      });

      setTableNumber(newTableNumber);
      setStep("success");
      
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred.");
      setStep("input");
    }
  };

  if (step === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900"></div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Hi {firstName}, Check-in Successful!</h1>
          <p className="text-slate-500 mb-8">Welcome to SY SmartMatch</p>
          
          <div className="bg-blue-50 rounded-xl p-6">
            <span className="text-xs uppercase tracking-widest text-blue-600 font-bold">Your Starting Table</span>
            <div className="text-6xl font-black text-blue-900 mt-2">{tableNumber}</div>
          </div>
          <div className="text-sm text-slate-500 mt-6">
            Please proceed to your assigned table. Once you arrive there, go <a href={`/event?eventId=${eventId}&userId=${userId}`} className="text-blue-900 font-bold underline">here</a> to start the event.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Event Check-In</h2>
        <p className="text-slate-500 text-center mb-8">Please enter your details to join the event.</p>
        
        <form onSubmit={handleCheckIn} className="space-y-4">
          <input
            type="text"
            placeholder="Email or Phone Number"
            className="w-full px-4 py-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-900 outline-none transition-all"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
          
          {errorMsg && <p className="text-red-500 text-sm text-center font-medium">{errorMsg}</p>}
          
          <button
            type="submit"
            className="w-full bg-[#1E3D34] text-white font-bold py-4 rounded-xl hover:bg-[#95B699] transition-colors shadow-lg shadow-blue-900/20"
          >
            Check In
          </button>
        </form>
      </div>
    </div>
  );
};

export default SelfCheckIn;