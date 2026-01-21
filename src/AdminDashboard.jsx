import { useState, useEffect } from "react";
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
import {
  Plus,
  Trash2,
  Calendar,
  Play,
  Square,
  UserMinus,
  CheckCircle,
} from "lucide-react";

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
      if (newStatus) {
        // delete all non-checked-in attendees when activating
        await deleteAttendeesNotCheckedIn(id);
        // If activating, launch the event
        launchEvent();
      } else {
        // If deactivating, set all attendees to not checked in
        // await setAttendeesNotCheckedIn(id);
      }

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

  const deleteAttendeesNotCheckedIn = async (id) => {
    const attQuery = query(
      collection(db, "registrations"),
      where("eventId", "==", id),
      where("checkedIn", "==", false)
    );
    const attSnap = await getDocs(attQuery);
    const deletePromises = attSnap.docs.map((doc) => deleteDoc(doc.ref));
    await Promise.all(deletePromises);
  };

  const setAttendeesNotCheckedIn = async (id) => {
    const attQuery = query(
      collection(db, "registrations"),
      where("eventId", "==", id)
    );
    const attSnap = await getDocs(attQuery);
    const resetPromises = attSnap.docs.map((doc) =>
      updateDoc(doc.ref, { checkedIn: false, tableNumber: null })
    );
    await Promise.all(resetPromises);
  };

  const launchEvent = async () => {
    const men = attendees.filter((a) => a.gender === "man" && a.checkedIn);
    const women = attendees.filter((a) => a.gender === "woman" && a.checkedIn);

    if (men.length === 0 || women.length === 0) {
      alert("You need checked-in men and women to start!");
      toggleStatus(selectedEvent.id, true); // Revert the event to inactive
      return;
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

  useEffect(() => {
    const cleanupOldEvents = async () => {
      const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

      // We only want to delete events that have a scheduledAt date
      const q = query(
        collection(db, "events"),
        where("scheduledAt", "<", seventyTwoHoursAgo)
      );
      const snapshot = await getDocs(q);

      snapshot.forEach(async (eventDoc) => {
        // Delete registrations first (optional but recommended for data hygiene)
        const regQ = query(
          collection(db, "registrations"),
          where("eventId", "==", eventDoc.id)
        );
        const regSnap = await getDocs(regQ);
        regSnap.forEach(
          async (r) => await deleteDoc(doc(db, "registrations", r.id))
        );

        // Delete the event itself
        await deleteDoc(doc(db, "events", eventDoc.id));
        console.log(`Auto-deleted expired event: ${eventDoc.id}`);
      });
    };

    if (events.length > 0) {
      cleanupOldEvents();
    }
  }, [events]);

  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");

  const createEvent = async () => {
    if (!eventName || !eventDate || !eventTime)
      return alert("Please fill in all event details!");
    setLoading(true);
    try {
      // Combine date and time strings into a single Date object
      const scheduledDateTime = new Date(`${eventDate}T${eventTime}`);

      await addDoc(collection(db, "events"), {
        name: eventName,
        roundTime: parseInt(roundTime),
        active: false,
        currentRound: 1,
        createdAt: new Date(),
        scheduledAt: scheduledDateTime, // This is what we use for the 72h check
      });

      setEventName("");
      setEventDate("");
      setEventTime("");
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const updateAttendeeField = async (attendeeId, field, newValue) => {
    try {
      const attRef = doc(db, "registrations", attendeeId);
      await updateDoc(attRef, { [field]: newValue });
    } catch (err) {
      console.error(`Error updating ${field}:`, err);
    }
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
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden">
      {/* SIDEBAR: Event List */}
      <div
        className={`${
          selectedEvent ? "hidden md:flex" : "flex"
        } w-full md:w-80 bg-white border-r border-slate-200 p-6 flex-col h-full`}
      >
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

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Event Date & Time
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 p-2 border border-slate-200 rounded text-xs outline-none"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <input
                type="time"
                className="w-24 p-2 border border-slate-200 rounded text-xs outline-none"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              Minute(s) per round:
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
                {ev.roundTime} minute(s) per round
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT: Event Details */}
      <div className="flex-1 p-4 md:p-10 overflow-auto">
        {selectedEvent ? (
          <div className="max-w-4xl mx-auto">
            <button
              onClick={() => setSelectedEvent(null)}
              className="md:hidden mb-4 text-blue-600 font-bold flex items-center gap-2"
            >
              ← Back to Events
            </button>
            {/* HEADER SECTION */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-6 mb-10 pb-6 border-b border-slate-200">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-4xl font-bold text-slate-900">
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
                <div className="mt-3 flex flex-wrap md:flex-nowrap items-center gap-2 w-full md:w-auto group">
                  <div
                    onClick={() => copyRegistrationLink(selectedEvent.id)}
                    className="flex items-center gap-2 px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 cursor-pointer hover:bg-blue-100 transition-all shadow-sm"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Registration Link:
                    </span>
                    <code className="text-[10px] md:text-xs font-mono break-all md:break-normal">
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
                  Round Time: {selectedEvent.roundTime} minute(s)
                </p>
                <p className="text-slate-400 text-sm mt-2 font-mono">
                  ID: {selectedEvent.id}
                </p>
                <p className="text-slate-400 text-sm mt-2 font-mono">
                  Event Date & Time:{" "}
                  {selectedEvent.scheduledAt
                    ? selectedEvent.scheduledAt.toDate().toLocaleString()
                    : "Not scheduled"}
                </p>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto border-t md:border-none pt-4 md:pt-0">
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Wrap this div for horizontal scrolling */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[1600px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="px-6 py-4 sticky left-0 bg-slate-50 z-10">
                        Status
                      </th>
                      <th className="px-6 py-4 sticky left-[120px] bg-slate-50 z-10">
                        Name / Age
                      </th>
                      <th className="px-6 py-4">Gender</th>
                      <th className="px-6 py-4">Ethnicity</th>
                      <th className="px-6 py-4">
                        Other Background
                      </th>
                      <th className="px-6 py-4">Marital Status</th>
                      <th className="px-6 py-4">Kohen</th>
                      <th className="px-6 py-4">Open to Ethnicities</th>
                      <th className="px-6 py-4">Open to Marry</th>
                      <th className="px-6 py-4">Shomer Shabbat</th>
                      <th className="px-6 py-4">Shomer Kashrut</th>
                      <th className="px-6 py-4">Wants covered head (Male)</th>
                      <th className="px-6 py-4">Wants to cover head (Female)</th>
                      <th className="px-6 py-4">Dress Style (Female)</th>
                      <th className="px-6 py-4">Anything else</th>
                      <th className="px-6 py-4 text-right sticky right-0 bg-slate-50">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendees.map((a) => (
                      <tr
                        key={a.id}
                        className="hover:bg-slate-50 transition-colors group"
                      >
                        {/* Status */}
                        <td className="px-6 py-4 sticky left-0 bg-white group-hover:bg-slate-50">
                          <button
                            onClick={() => toggleCheckIn(a.id, a.checkedIn)}
                            className={`flex items-center gap-2 px-3 py-1 rounded-full font-black text-[10px] ${
                              a.checkedIn
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-400"
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

                        {/* Name */}
                        <td className="px-6 py-4 sticky left-[120px] bg-white group-hover:bg-slate-50 border-r border-slate-100">
                          <p className="font-bold text-slate-900 truncate max-w-[150px]">
                            {a.firstName} {a.lastName}
                          </p>
                          <p className="text-xs text-slate-400">{a.age}y</p>
                        </td>

                        {/* Gender */}
                        <td className="px-6 py-4">
                          <select
                            value={a.gender}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "gender",
                                e.target.value
                              )
                            }
                            className={`bg-transparent font-semibold outline-none ${
                              a.gender === "woman"
                                ? "text-pink-600"
                                : "text-blue-600"
                            }`}
                          >
                            <option value="man">Man</option>
                            <option value="woman">Woman</option>
                          </select>
                        </td>

                        {/* Ethnicity */}
                        <td className="px-6 py-4 text-slate-500">
                          <select
                            className="bg-transparent outline-none"
                            value={a.ethnicity}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "ethnicity",
                                e.target.value
                              )
                            }
                          >
                            <option value="Syrian / Egyptian / Lebanese">Syrian / Egyptian / Lebanese</option>
                            <option value="Other Sephardic">Other Sephardic</option>
                            <option value="Ashkenaz">Ashkenaz</option>
                            <option value="Other">Other</option>
                          </select>
                        </td>

                        {/* Other background */}
                        <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                          <textarea
                            className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                            defaultValue={a.otherSpecify}
                            onBlur={(e) =>
                              updateAttendeeField(
                                a.id,
                                "otherSpecify",
                                e.target.value
                              )
                            }
                          />
                        </td>

                        {/* Marital Status */}
                        <td className="px-6 py-4 text-slate-500">
                          <select
                            className="bg-transparent outline-none"
                            value={a.maritalStatus}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "maritalStatus",
                                e.target.value
                              )
                            }
                          >
                            <option value="Single">Single</option>
                            <option value="Divorced">Divorced</option>
                            <option value="Widowed">Widowed</option>
                          </select>
                        </td>

                        {/* Kohen */}
                        <td className="px-6 py-4 text-slate-500 text-center">
                          <input
                            type="checkbox"
                            checked={a.isKohen === "yes" || a.isKohen === true}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "isKohen",
                                e.target.checked ? "yes" : "no"
                              )
                            }
                          />
                        </td>

                        {/* Open to Ethnicities (Array Edit) */}
                        <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                          <textarea
                            className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                            defaultValue={a.openToEthnicities?.join(", ")}
                            onBlur={(e) =>
                              updateAttendeeField(
                                a.id,
                                "openToEthnicities",
                                e.target.value.split(",").map((s) => s.trim())
                              )
                            }
                          />
                        </td>

                        {/* Open to Marital (Array Edit) */}
                        <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                          <textarea
                            className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                            defaultValue={a.openToMaritalStatus?.join(", ")}
                            onBlur={(e) =>
                              updateAttendeeField(
                                a.id,
                                "openToMaritalStatus",
                                e.target.value.split(",").map((s) => s.trim())
                              )
                            }
                          />
                        </td>

                        {/* Shomer Shabbat */}
                        <td className="px-6 py-4 text-slate-500 text-center">
                          <input
                            type="checkbox"
                            checked={
                              a.isShomerShabbat === "yes" ||
                              a.isShomerShabbat === true
                            }
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "isShomerShabbat",
                                e.target.checked ? "yes" : "no"
                              )
                            }
                          />
                        </td>

                        {/* Shomer Kashrut */}
                        <td className="px-6 py-4 text-slate-500 text-center">
                          <input
                            type="checkbox"
                            checked={
                              a.isShomerKashrut === "yes" ||
                              a.isShomerKashrut === true
                            }
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "isShomerKashrut",
                                e.target.checked ? "yes" : "no"
                              )
                            }
                          />
                        </td>

                        {/* Wants Girl to cover her hair */}  
                        <td className="px-6 py-4 text-slate-500">
                          <select
                            className="bg-transparent outline-none"
                            value={a.wantsCoveredHead}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "wantsCoveredHead",
                                e.target.value
                              )
                            }
                          >
                            <option value="N/A">Not applicable</option>
                            <option value="yes">
                              Yes
                            </option>
                            <option value="no">
                              No
                            </option>
                            <option value="noPreference">
                              No preference
                            </option>
                          </select>
                        </td>

                        {/* Girl to cover her hair */}
                        <td className="px-6 py-4 text-slate-500">
                          <select
                            className="bg-transparent outline-none"
                            value={a.hairCovering}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "hairCovering",
                                e.target.value
                              )
                            }
                          >
                            <option value="N/A">Not applicable</option>
                            <option value="willCoverHair">
                              Will cover hair
                            </option>
                            <option value="openFlexible">
                              Open / Flexible
                            </option>
                            <option value="notPlanning">
                              Not planning to cover hair
                            </option>
                          </select>
                        </td>

                        {/* Dress Style */}
                        <td className="px-6 py-4 text-slate-500">
                          <select
                            className="bg-transparent outline-none"
                            value={a.dressStyle}
                            onChange={(e) =>
                              updateAttendeeField(
                                a.id,
                                "dressStyle",
                                e.target.value
                              )
                            }
                          >
                            <option value="N/A">Not applicable</option>
                            <option value="skirtsOnly">Skirts only</option>
                            <option value="skirtsPants">Skirts + pants</option>
                          </select>
                        </td>

                        {/* Open to Marital (Array Edit) */}
                        <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                          <textarea
                            className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                            defaultValue={a.anythingElse}
                            onBlur={(e) =>
                              updateAttendeeField(
                                a.id,
                                "anythingElse",
                                e.target.value.map((s) => s.trim())
                              )
                            }
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right sticky right-0 bg-white group-hover:bg-slate-50">
                          <button
                            onClick={() => deleteAttendee(a.id, a.name)}
                            className="p-2 text-slate-300 hover:text-red-500 transition-all"
                          >
                            <UserMinus size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
