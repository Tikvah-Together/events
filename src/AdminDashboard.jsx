import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  where,
} from "firebase/firestore";
import { Plus, Trash2, Users, Calendar, Play, Square } from "lucide-react";

export default function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [eventName, setEventName] = useState("");
  const [roundTime, setRoundTime] = useState(7);
  const [loading, setLoading] = useState(false);

const toggleStatus = async (id, currentStatus) => {
    try {
      const eventRef = doc(db, "events", id);
      const newStatus = !currentStatus;

      // 1. Update Firestore
      await updateDoc(eventRef, { active: newStatus });
      launchEvent();

      // 2. Update the Main Detail View immediately
      setSelectedEvent((prev) => ({ ...prev, active: newStatus }));

      // 3. Update the Sidebar List immediately so the green dot appears/disappears
      setEvents((prevEvents) =>
        prevEvents.map((ev) =>
          ev.id === id ? { ...ev, active: newStatus } : ev
        )
      );
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const launchEvent = async () => {
    const men = attendees.filter((a) => a.gender === "man" && a.checkedIn);
    const women = attendees.filter((a) => a.gender === "woman" && a.checkedIn);

    if (men.length === 0 || women.length === 0) {
      return alert("You need checked-in men and women to start!");
    }

    // 1. Auto-Assign Tables
    const womenUpdates = women.map((w, i) =>
      updateDoc(doc(db, "registrations", w.id), { tableNumber: i + 1 })
    );
    const menUpdates = men.map((m, i) =>
      updateDoc(doc(db, "registrations", m.id), { tableNumber: i + 1 })
    );

    await Promise.all([...womenUpdates, ...menUpdates]);

    // 2. Launch with a Start Timestamp
    const eventRef = doc(db, "events", selectedEvent.id);
    await updateDoc(eventRef, {
      active: true,
      startTime: new Date(), // This is the "Big Bang" for the timer
      totalTables: women.length,
    });
  };

  const assignInitialTables = async () => {
    const men = attendees.filter((a) => a.gender === "man");
    const women = attendees.filter((a) => a.gender === "woman");

    // Assign Women to fixed tables 1 through N
    const womenUpdates = women.map((w, i) =>
      updateDoc(doc(db, "registrations", w.id), { tableNumber: i + 1 })
    );

    // Assign Men to starting tables 1 through N
    const menUpdates = men.map((m, i) =>
      updateDoc(doc(db, "registrations", m.id), { tableNumber: i + 1 })
    );

    await Promise.all([...womenUpdates, ...menUpdates]);
    alert("Tables Assigned! Men and Women are now matched for Round 1.");
  };

  const nextRound = async () => {
    const next = (selectedEvent.currentRound || 1) + 1;
    await updateDoc(doc(db, "events", selectedEvent.id), {
      currentRound: next,
      isTransitioning: true, // Trigger the "Move" screen on iPads
    });

    // Auto-stop the transition after 60 seconds
    setTimeout(async () => {
      await updateDoc(doc(db, "events", selectedEvent.id), {
        isTransitioning: false,
      });
    }, 60000);
  };

  const toggleTransition = async () => {
    await updateDoc(doc(db, "events", selectedEvent.id), {
      isTransitioning: !selectedEvent.isTransitioning,
    });
  };

  const toggleCheckIn = async (attendeeId, currentStatus) => {
    try {
      const attRef = doc(db, "registrations", attendeeId);
      await updateDoc(attRef, { checkedIn: !currentStatus });
      // Real-time listener handles the UI update
    } catch (err) {
      console.error("Error updating check-in:", err);
    }
  };

  const deleteAttendee = async (attendeeId, name) => {
    if (window.confirm(`Remove ${name} from this event?`)) {
      try {
        await deleteDoc(doc(db, "registrations", attendeeId));
      } catch (err) {
        console.error("Error deleting attendee:", err);
      }
    }
  };

  const updateAttendeeGender = async (attendeeId, newGender) => {
    try {
      const attRef = doc(db, "registrations", attendeeId);
      await updateDoc(attRef, { gender: newGender });
    } catch (err) {
      console.error("Error updating gender:", err);
    }
  };

  const copyRegistrationLink = (eventId) => {
    // window.location.origin will use http://localhost:3000 or your production URL automatically
    const registrationUrl = `${window.location.origin}/register?eventId=${eventId}`;

    navigator.clipboard.writeText(registrationUrl);
    alert("Link copied to clipboard!");
  };

  // 1. Fetch all events in real-time
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch attendees when an event is selected
  useEffect(() => {
    if (!selectedEvent) return;
    const q = query(
      collection(db, "registrations"),
      where("eventId", "==", selectedEvent.id)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [selectedEvent]);

  const createEvent = async () => {
    if (!eventName) return alert("Enter a name!");
    setLoading(true);
    try {
      await addDoc(collection(db, "events"), {
        name: eventName,
        roundTime: parseInt(roundTime),
        active: false,
        currentRound: 1,
        createdAt: new Date(),
      });
      setEventName("");
      alert("Event Created!");
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const deleteEvent = async (id) => {
    if (
      window.confirm(
        "Are you sure? This will delete all registration data for this event."
      )
    ) {
      await deleteDoc(doc(db, "events", id));
      setSelectedEvent(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* SIDEBAR: Event List */}
      <div className="w-80 bg-white border-r border-slate-200 p-6 flex flex-col">
        <h2 className="text-xl font-bold text-blue-900 mb-6 tracking-tight">
          Events Management
        </h2>

        <div className="space-y-4 mb-8">
          <input
            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-900 outline-none"
            placeholder="New Event Name..."
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              Minutes per round:
            </span>
            <input
              type="number"
              className="w-16 p-2 border border-slate-200 rounded text-sm outline-none"
              value={roundTime}
              onChange={(e) => setRoundTime(e.target.value)}
            />
          </div>
          <button
            onClick={createEvent}
            className="w-full bg-blue-900 text-white py-2 rounded font-semibold flex items-center justify-center gap-2 hover:bg-blue-800 transition shadow-sm"
          >
            <Plus size={18} /> Create Event
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            History
          </p>
          {events.map((ev) => (
            <div
              key={ev.id}
              onClick={() => setSelectedEvent(ev)}
              className={`p-3 rounded-lg cursor-pointer transition-all border ${
                selectedEvent?.id === ev.id
                  ? "bg-blue-50 border-blue-200"
                  : "bg-white border-transparent hover:bg-slate-50"
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="font-semibold text-slate-800 text-sm truncate">
                  {ev.name}
                </span>
                {ev.active && (
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mt-1"></span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {ev.roundTime} minutes per round
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT: Event Details */}
      <div className="flex-1 p-10 overflow-y-auto">
        {selectedEvent ? (
          <div className="max-w-4xl mx-auto">
            {/* HEADER SECTION */}
            <div className="flex justify-between items-start mb-10 pb-6 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-4xl font-bold text-slate-900">
                    {selectedEvent.name}
                  </h1>
                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase transition-colors duration-300 ${
                      selectedEvent.active
                        ? "bg-green-500 text-white animate-pulse"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {selectedEvent.active ? "LIVE" : "DRAFT"}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 group">
                  <div
                    onClick={() => copyRegistrationLink(selectedEvent.id)}
                    className="flex items-center gap-2 px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 cursor-pointer hover:bg-blue-100 transition-all shadow-sm"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Registration Link:
                    </span>
                    <code className="text-xs font-mono">
                      {window.location.origin}/register?eventId=
                      {selectedEvent.id}
                    </code>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="lucide lucide-copy"
                    >
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                  </div>
                  <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity italic">
                    Click to copy URL
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Round Time: {selectedEvent.roundTime} minutes
                </p>
                <p className="text-slate-400 text-sm mt-2 font-mono">
                  ID: {selectedEvent.id}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() =>
                    toggleStatus(selectedEvent.id, selectedEvent.active)
                  }
                  className={`px-6 py-2 rounded-md font-bold flex items-center gap-2 transition-all duration-200 shadow-sm border ${
                    selectedEvent.active
                      ? "bg-white text-orange-600 border-orange-200 hover:bg-orange-50"
                      : "bg-blue-900 text-white border-blue-900 hover:bg-blue-800"
                  }`}
                >
                  {selectedEvent.active ? (
                    <>
                      <Square size={16} fill="currentColor" /> Stop Event
                    </>
                  ) : (
                    <>
                      <Play size={16} fill="currentColor" /> Launch Event
                    </>
                  )}
                </button>

                <button
                  onClick={() => deleteEvent(selectedEvent.id)}
                  className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                  title="Delete Event"
                >
                  <Trash2 size={22} />
                </button>
              </div>
            </div>

            {/* STATS CARDS */}
            <div className="grid grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                <p className="text-3xl font-bold text-slate-800">
                  {attendees.length}
                </p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Registered
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                <div className="text-blue-900 font-bold text-3xl">
                  {attendees.filter((a) => a.gender === "man").length}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Men
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                <div className="text-pink-600 font-bold text-3xl">
                  {attendees.filter((a) => a.gender === "woman").length}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Women
                </p>
              </div>
            </div>

            {/* TABLE SECTION */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Name / Age</th>
                    <th className="px-6 py-4">Gender</th>
                    <th className="px-6 py-4">Religious / Subgroup</th>
                    <th className="px-6 py-4">Ethnicity</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendees.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-slate-50 transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleCheckIn(a.id, a.checkedIn)}
                          className={`flex items-center gap-2 px-3 py-1 rounded-full font-black text-[10px] transition-all ${
                            a.checkedIn
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          }`}
                        >
                          {a.checkedIn ? (
                            <CheckCircle size={12} />
                          ) : (
                            <div className="w-3 h-3 border-2 border-slate-300 rounded-full" />
                          )}
                          {a.checkedIn ? "CHECKED IN" : "PENDING"}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{a.name}</p>
                        <p className="text-xs text-slate-400">
                          {a.age} years old
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={a.gender}
                          onChange={(e) =>
                            updateAttendeeGender(a.id, e.target.value)
                          }
                          className={`bg-transparent font-semibold focus:outline-none cursor-pointer ${
                            a.gender === "woman"
                              ? "text-pink-600"
                              : "text-blue-600"
                          }`}
                        >
                          <option value="man">Man</option>
                          <option value="woman">Woman</option>
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-700">
                          {a.religiousLevel}
                        </p>
                        <p className="text-xs text-slate-400">{a.subGroup}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {a.ethnicity}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteAttendee(a.id, a.name)}
                          className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-red-500 transition-all"
                        >
                          <UserMinus size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attendees.length === 0 && (
                <div className="p-20 text-center text-slate-400 italic">
                  No registrations yet.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-300">
            <Calendar size={80} strokeWidth={1} className="mb-4 opacity-20" />
            <p className="text-lg font-medium">Select an event to manage</p>
          </div>
        )}
      </div>
    </div>
  );
}
