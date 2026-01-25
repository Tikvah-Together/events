import React, { useState, useEffect } from "react";
import { db } from "./firebase"; // Adjust path to your firebase config
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  updateDoc, 
  addDoc 
} from "firebase/firestore";

const SelfCheckIn = () => {
  const [step, setStep] = useState("input"); // input, loading, success, error
  const [idInput, setIdInput] = useState("");
  const [assignedTable, setAssignedTable] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Get eventId from URL (e.g., ?eventId=123)
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get("eventId");

  const handleCheckIn = async (e) => {
    e.preventDefault();
    if (!eventId) {
      setErrorMsg("Invalid Event Link. Please scan the QR code again.");
      return;
    }

    setStep("loading");
    setErrorMsg("");

    try {
      // 1. Fetch all attendees for this event
      const q = query(collection(db, "registrations"), where("eventId", "==", eventId));
      const querySnapshot = await getDocs(q);
      const allAttendees = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2. Find matching attendee (Phone or Email)
      const input = idInput.trim().toLowerCase();
      const attendee = allAttendees.find(a => 
        a.email?.toLowerCase() === input || 
        a.phone?.replace(/\D/g,'') === input.replace(/\D/g,'')
      );

      if (attendee.checkedIn) {
        setAssignedTable(attendee.tableNumber);
        setStep("success");
        return;
      }

      if (!attendee) {
        setStep("input");
        setErrorMsg("Registration not found. Please check your entry or see the host.");
        return;
      }

      if (attendee.checkedIn) {
        setAssignedTable(attendee.tableNumber);
        setStep("success");
        return;
      }

      // 3. Logic for Re-sequencing
      const gender = attendee.gender;
      const prefix = gender === "woman" ? "G" : "B";

      const sameGenderList = allAttendees
        .map(a => a.id === attendee.id ? { ...a, checkedIn: true } : a)
        .filter(a => a.gender === gender && a.checkedIn)
        .sort((a, b) => {
          const nameA = `${a.firstName || ""} ${a.lastName || ""}`.trim();
          const nameB = `${b.firstName || ""} ${b.lastName || ""}`.trim();
          return nameA.localeCompare(nameB);
        });

      const updates = [];
      let newTable = "";

      sameGenderList.forEach((person, index) => {
        const tableCode = `${prefix}${index + 1}`;
        if (person.id === attendee.id) newTable = tableCode;
        
        updates.push(updateDoc(doc(db, "registrations", person.id), { 
          checkedIn: true, 
          tableNumber: tableCode 
        }));
      });

      // 4. Trigger Auto-Email
      const personalLink = `https://events.tikvahtogether.org/checkin/${attendee.id}`;
      updates.push(addDoc(collection(db, "mail"), {
        to: attendee.email,
        message: {
          subject: "Check-in Confirmed!",
          html: `<h3>Hi ${attendee.firstName}!</h3>
                 <p>You are checked in for the event.</p>
                 <p><strong>Your Table: ${newTable}</strong></p>
                 <p><a href="${personalLink}">Click here to view your personal event portal.</a></p>`
        }
      }));

      await Promise.all(updates);
      setAssignedTable(newTable);
      setStep("success");

    } catch (err) {
      console.error(err);
      setStep("input");
      setErrorMsg("An error occurred. Please try again.");
    }
  };

  if (step === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900"></div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-green-100">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Checked In!</h1>
          <p className="text-slate-500 mb-8">Welcome to Tikvah Together</p>
          <div className="bg-blue-50 rounded-xl p-6 mb-6">
            <span className="text-sm uppercase tracking-widest text-blue-600 font-bold">Your Table</span>
            <div className="text-6xl font-black text-blue-900 mt-2">{assignedTable}</div>
          </div>
          <p className="text-sm text-slate-400">Check your email for your personal event link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Event Check-In</h2>
        <p className="text-slate-500 text-center mb-8">Enter your email or phone number to begin.</p>
        
        <form onSubmit={handleCheckIn} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Email or Phone Number"
              className="w-full px-4 py-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              required
            />
          </div>
          
          {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}
          
          <button
            type="submit"
            className="w-full bg-blue-900 text-white font-bold py-4 rounded-xl hover:bg-blue-800 transition-colors shadow-lg shadow-blue-900/20"
          >
            Check In
          </button>
        </form>
      </div>
    </div>
  );
};

export default SelfCheckIn;