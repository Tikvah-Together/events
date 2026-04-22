import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
} from "firebase/firestore";

const RsvpPage = () => {
  const [step, setStep] = useState("loading");
  const [registrationId, setRegistrationId] = useState(null); // We need the Doc ID to update it later
  const [attendee, setAttendee] = useState(null); // Data from 'users' collection
  const [eventData, setEventData] = useState(null); // Data from 'events' collection
  const [errorMsg, setErrorMsg] = useState("");

  // Get params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get("userId");
  const eventId = urlParams.get("eventId");
  const action = urlParams.get("action"); // For handling cancellation

  useEffect(() => {
    const fetchAllData = async () => {
      if (!userId || !eventId) {
        setErrorMsg("Invalid invitation link.");
        setStep("error");
        return;
      }

      try {
        // 1. Find the registration entry where userId and eventId match
        const regQuery = query(
          collection(db, "registrations"),
          where("userId", "==", userId),
          where("eventId", "==", eventId),
        );
        const regSnap = await getDocs(regQuery);

        if (regSnap.empty) {
          setErrorMsg("No registration found for this event.");
          setStep("error");
          return;
        }

        // Get the registration doc (assuming only one exists per user per event)
        const regDoc = regSnap.docs[0];
        const regData = regDoc.data();
        setRegistrationId(regDoc.id);

        // 2. Fetch User and Event details in parallel using the IDs
        const [userSnap, eventSnap] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDoc(doc(db, "events", eventId)),
        ]);

        if (userSnap.exists() && eventSnap.exists()) {
          setAttendee(userSnap.data());
          setEventData(eventSnap.data());

          // Check if they already responded (using status from the registration doc)
          if ((regData.status === "confirmed" && action !== "cancel") || regData.status === "declined") {
            setStep("success");
          } else {
            setStep("decision");
          }
        } else {
          setErrorMsg("User or Event details not found.");
          setStep("error");
        }
      } catch (err) {
        console.error("Fetch Error:", err);
        setErrorMsg("An error occurred while loading your invitation.");
        setStep("error");
      }
    };

    fetchAllData();
  }, [userId, eventId]);

  const handleResponse = async (newStatus) => {
    setStep("loading");
    try {
      // 1. Update the 'registrations' document using the ID we found earlier
      await updateDoc(doc(db, "registrations", registrationId), {
        status: newStatus
      });

      // 2. Trigger the Confirmation Email if they accepted
      if (newStatus === "confirmed") {
        await addDoc(collection(db, "email"), {
          to: attendee.email,
          message: {
            subject: "SY SmartMatch - Your Spot is Confirmed",
            html: `
              <div style="font-family: sans-serif; color: #334155;">
                <p>Hi ${attendee.firstName},</p>
                <p>Your spot for SY SmartMatch event is confirmed! We're excited to have you join.</p>
                <p><strong>Event details:</strong></p>
                <p><strong>Date:</strong> ${eventData.scheduledAt?.toDate().toLocaleDateString()}</p>
                <p><strong>Time:</strong> ${eventData.scheduledAt?.toDate().toLocaleTimeString()}</p>
                <p><strong>Location:</strong> ${eventData.fullAddress}</p>
                <p>Upon arrival, please check in at the front desk or scan the QR code on site.</p>
                <p>You'll receive your starting table number and be guided where to sit.</p>
                <p>Please bring your phone fully charged, as it will be used during the event.</p>
                <p>Paper forms will also be available as an alternative.</p>

                <p>To ensure the best experience, we recommend arriving on time, as late arrival will result in missing some of your curated dates.</p>

                <p>We look forward to seeing you there.</p>

                <p>If anything changes and you're no longer able to attend, please let us know here: <a href="${window.location + '?action=cancel'}" target="_blank" rel="noopener noreferrer">Cancel Registration</a></p>
                <br>
                <p>Best,
                <br>
                SY SmartMatch Team</p>
              </div>
            `,
          },
        });
      }

      setStep("success");
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to save response.");
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
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
              attendee.status === "confirmed"
                ? "bg-green-100 text-green-600"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {attendee.status === "confirmed"
              ? "You’re confirmed!"
              : "Response Received"}
          </h1>
          <p className="text-slate-500">
            Thank you, {attendee.firstName}. Your status is now:{" "}
            <strong>{attendee.status}</strong>.
          </p>
          {attendee.status === "confirmed" && (
            <p className="text-slate-500 mt-4">
              We've sent you an email with full details. If you would like to cancel your registration, please click <a href={window.location + "?action=cancel"} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">here</a>.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Event Invitation
        </h2>
        <p className="text-slate-500 mb-8">
          Hi {attendee?.firstName}, would you like to attend?
        </p>

        <div className="space-y-4">
          <button
            onClick={() => handleResponse("confirmed")}
            className="w-full bg-blue-900 text-white font-bold py-4 rounded-xl hover:bg-blue-800 transition-colors shadow-lg"
          >
            Yes, confirm my spot!
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
