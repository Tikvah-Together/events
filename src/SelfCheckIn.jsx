import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

const RsvpPage = () => {
  const [step, setStep] = useState("loading"); // loading, decision, success, error
  const [attendee, setAttendee] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Get params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const regId = urlParams.get("regId");

  useEffect(() => {
    const fetchAttendee = async () => {
      if (!regId) {
        setErrorMsg("Invalid invitation link.");
        setStep("error");
        return;
      }

      try {
        const docRef = doc(db, "registrations", regId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          
          // If they already responded, jump to success to prevent double-entry
          if (data.status === "confirmed" || data.status === "declined") {
            setAttendee(data);
            setStep("success");
          } else {
            setAttendee(data);
            setStep("decision");
          }
        } else {
          setErrorMsg("Invitation not found.");
          setStep("error");
        }
      } catch (err) {
        console.error(err);
        setErrorMsg("Failed to load invitation.");
        setStep("error");
      }
    };

    fetchAttendee();
  }, [regId]);

  const handleResponse = async (status) => {
    setStep("loading");
    try {
      await updateDoc(doc(db, "registrations", regId), {
        status: status,
        respondedAt: new Date()
      });
      
      // Update local state to reflect the choice
      setAttendee(prev => ({ ...prev, status }));
      setStep("success");
    } catch (err) {
      console.error(err);
      setErrorMsg("Error saving your response. Please try again.");
      setStep("decision");
    }
  };

  if (step === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900"></div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">Oops!</h2>
          <p className="text-slate-500">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
            attendee.status === "confirmed" ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-600"
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {attendee.status === "confirmed" ? "See you there!" : "Response Received"}
          </h1>
          <p className="text-slate-500">
            Thank you, {attendee.firstName}. Your status is now: <strong>{attendee.status}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Event Invitation</h2>
        <p className="text-slate-500 mb-8">Hi {attendee?.firstName}, would you like to attend?</p>
        
        <div className="space-y-4">
          <button
            onClick={() => handleResponse("confirmed")}
            className="w-full bg-blue-900 text-white font-bold py-4 rounded-xl hover:bg-blue-800 transition-colors shadow-lg"
          >
            Yes, I'm coming!
          </button>
          
          <button
            onClick={() => handleResponse("declined")}
            className="w-full bg-white border border-slate-200 text-slate-500 font-bold py-4 rounded-xl hover:bg-slate-50 transition-colors"
          >
            No, I can't make it
          </button>
        </div>
      </div>
    </div>
  );
};

export default RsvpPage;