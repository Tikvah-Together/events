import { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  documentId,
  getDoc,
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
  ChevronDown,
} from "lucide-react";

export default function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [eventName, setEventName] = useState("");
  const [roundTime, setRoundTime] = useState(7);
  const [loading, setLoading] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [filters, setFilters] = useState({
    hashgafa: "all",
    minAgeMan: "",
    maxAgeMan: "",
    minAgeWoman: "",
    maxAgeWoman: "",
    gender: "all", // Advanced
    ethnicity: "all", // Advanced
    maritalStatus: "all", // Advanced
    isKohen: "all", // Advanced
    shomerShabbat: "all", // Advanced
    shomerKashrut: "all", // Advanced
    dressStyle: "all", // Advanced
  });

  const getHashgafaGroup = (user) => {
    const { gender, hairCovering, wantsCoveredHead, dressStyle } = user;

    // Group 1: Expected
    if (
      (gender === "woman" &&
        dressStyle === "skirtsOnly" &&
        hairCovering === "willCoverHair") ||
      (gender === "man" && wantsCoveredHead === "yes")
    ) {
      return {
        label: "Expected",
        color: "bg-purple-100 text-purple-700",
        border: "border-purple-200",
      };
    }

    // Group 2: No Hair-Covering Expected
    if (
      (gender === "woman" &&
        dressStyle === "skirtsPants" &&
        hairCovering === "notPlanning") ||
      (gender === "man" && wantsCoveredHead === "no")
    ) {
      return {
        label: "None",
        color: "bg-blue-100 text-blue-700",
        border: "border-blue-200",
      };
    }

    // Group 3: Flexible
    return {
      label: "Flexible",
      color: "bg-green-100 text-green-700",
      border: "border-green-200",
    };
  };

const filteredAttendees = attendees.filter(a => {
  const hashgafa = getHashgafaGroup(a);

  // 1. Hashgafa (Main)
  if (filters.hashgafa !== "all" && hashgafa.label !== filters.hashgafa) return false;

  // 2. Gender-specific Ages (Main)
  if (a.gender === "man") {
    if (filters.minAgeMan && a.age < parseInt(filters.minAgeMan)) return false;
    if (filters.maxAgeMan && a.age > parseInt(filters.maxAgeMan)) return false;
  } else if (a.gender === "woman") {
    if (filters.minAgeWoman && a.age < parseInt(filters.minAgeWoman)) return false;
    if (filters.maxAgeWoman && a.age > parseInt(filters.maxAgeWoman)) return false;
  }

  // 3. Advanced Filters
  if (filters.gender !== "all" && a.gender !== filters.gender) return false;
  if (filters.ethnicity !== "all" && a.ethnicity !== filters.ethnicity) return false;
  if (filters.maritalStatus !== "all" && a.maritalStatus !== filters.maritalStatus) return false;
  if (filters.dressStyle !== "all" && a.dressStyle !== filters.dressStyle) return false;

  // Boolean logic for Shomer Shabbat/Kashrut/Kohen
  const checkBool = (filterVal, userVal) => {
    if (filterVal === "all") return true;
    const isTrue = userVal === "yes" || userVal === true;
    return filterVal === "yes" ? isTrue : !isTrue;
  };

  if (!checkBool(filters.isKohen, a.isKohen)) return false;
  if (!checkBool(filters.shomerShabbat, a.isShomerShabbat)) return false;
  if (!checkBool(filters.shomerKashrut, a.isShomerKashrut)) return false;

  return true;
});

  const toggleStatus = async (id, currentStatus) => {
    try {
      const eventRef = doc(db, "events", id);
      const newStatus = !currentStatus;

      // 1. Update Firestore
      await updateDoc(eventRef, { active: newStatus });
      if (newStatus) {
        // If activating, launch the event
        launchEvent();
      } else {
        // If deactivating, set all attendees to not checked in
        setAttendeesNotCheckedIn(id);
      }

      // 2. Update the Main Detail View immediately
      setSelectedEvent((prev) => ({ ...prev, active: newStatus }));

      // 3. Update the Sidebar List immediately so the green dot appears/disappears
      setEvents((prevEvents) =>
        prevEvents.map((ev) =>
          ev.id === id ? { ...ev, active: newStatus } : ev,
        ),
      );
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const setAttendeesNotCheckedIn = async (id) => {
    const attQuery = query(
      collection(db, "registrations"),
      where("eventId", "==", id),
    );
    const attSnap = await getDocs(attQuery);
    const resetPromises = attSnap.docs.map((doc) =>
      updateDoc(doc.ref, { checkedIn: false, tableNumber: null }),
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
      updateDoc(doc(db, "registrations", w.id), { tableNumber: i + 1 }),
    );
    const menUpdates = men.map((m, i) =>
      updateDoc(doc(db, "registrations", m.id), { tableNumber: i + 1 }),
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

  const toggleCheckIn = async (attendeeId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      const regRef = doc(db, "registrations", attendeeId);

      // 1. Fetch current state to find gender
      const attQuery = query(
        collection(db, "registrations"),
        where("eventId", "==", selectedEvent.id),
      );
      const attSnap = await getDocs(attQuery);
      const allRegs = attSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const person = allRegs.find((a) => a.id === attendeeId);
      if (!person) return;

      const gender = person.gender;
      const prefix = gender === "woman" ? "G" : "B";

      if (!newStatus) {
        // --- UNCHECKING: STATIC REMOVAL ---
        // We ONLY clear this specific person.
        // This creates a "hole" (e.g., G1, gap, G3) so G3 doesn't have to move.
        await updateDoc(regRef, {
          checkedIn: false,
          tableNumber: null,
        });
        return;
      }

      // --- CHECKING IN: FILL GAPS (FIRST FIT) ---
      // 1. Find all numbers currently occupied by this gender
      const takenNumbers = allRegs
        .filter((a) => a.gender === gender && a.checkedIn && a.tableNumber)
        .map((a) => parseInt(a.tableNumber.replace(prefix, "")))
        .sort((a, b) => a - b);

      // 2. Find the lowest available number (starts at 1)
      let assignedNumber = 1;
      for (let i = 0; i < takenNumbers.length; i++) {
        if (takenNumbers[i] === assignedNumber) {
          assignedNumber++;
        } else if (takenNumbers[i] > assignedNumber) {
          // We found a gap! Use this number.
          break;
        }
      }

      // 3. Assign the permanent table number to the new arrival
      await updateDoc(regRef, {
        checkedIn: true,
        tableNumber: `${prefix}${assignedNumber}`,
      });
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

  // 2. Fetch attendees when an event is selected (Updated for Users DB)
  useEffect(() => {
    if (!selectedEvent) return;

    const q = query(
      collection(db, "registrations"),
      where("eventId", "==", selectedEvent.id),
    );

    const unsubscribe = onSnapshot(q, async (snap) => {
      const registrationDocs = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      if (registrationDocs.length === 0) {
        setAttendees([]);
        return;
      }

      // Get all unique userIds from the registrations
      const userIds = registrationDocs.map((reg) => reg.userId).filter(Boolean);

      if (userIds.length > 0) {
        // Fetch user profiles from the 'users' collection
        const usersQuery = query(
          collection(db, "users"),
          where(documentId(), "in", userIds),
        );
        const userSnap = await getDocs(usersQuery);
        const userMap = {};
        userSnap.forEach((doc) => {
          userMap[doc.id] = doc.data();
        });

        // Merge Registration data with User profile data
        const mergedData = registrationDocs.map((reg) => ({
          ...reg,
          ...(userMap[reg.userId] || {}), // Spread user profile data into the attendee object
        }));

        setAttendees(mergedData);
      } else {
        setAttendees(registrationDocs);
      }
    });

    return () => unsubscribe();
  }, [selectedEvent]);

  useEffect(() => {
    const cleanupOldEvents = async () => {
      const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

      // We only want to delete events that have a scheduledAt date
      const q = query(
        collection(db, "events"),
        where("scheduledAt", "<", seventyTwoHoursAgo),
      );
      const snapshot = await getDocs(q);

      snapshot.forEach(async (eventDoc) => {
        // Delete registrations first (optional but recommended for data hygiene)
        const regQ = query(
          collection(db, "registrations"),
          where("eventId", "==", eventDoc.id),
        );
        const regSnap = await getDocs(regQ);
        regSnap.forEach(
          async (r) => await deleteDoc(doc(db, "registrations", r.id)),
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

  const updateAttendeeField = async (attendee, field, newValue) => {
    try {
      const registrationFields = ["checkedIn", "tableNumber", "isConfirmed"];
      const isRegistrationField = registrationFields.includes(field);

      const collectionName = isRegistrationField ? "registrations" : "users";
      const docId = isRegistrationField ? attendee.id : attendee.userId;

      if (!docId) return;

      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, { [field]: newValue });

      setAttendees((prev) =>
        prev.map((a) =>
          (isRegistrationField ? a.id === docId : a.userId === docId)
            ? { ...a, [field]: newValue }
            : a,
        ),
      );
    } catch (err) {
      console.error(`Error updating ${field}:`, err);
      alert("Failed to update. Please check your connection.");
    }
  };

  const deleteEvent = async (id) => {
    if (
      window.confirm(
        "Are you sure? This will delete all registration data for this event.",
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
        } w-full md:w-auto bg-white border-r border-slate-200 p-6 flex-col h-full`}
      >
        <h2 className="text-xl font-bold text-blue-900 mb-6">
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
      <div className="flex-1 p-4 overflow-auto">
        {selectedEvent ? (
          <div className="w-full max-w-7xl mx-auto">
            <button
              onClick={() => setSelectedEvent(null)}
              className="md:hidden mb-4 text-blue-600 font-bold flex items-center gap-2"
            >
              ← Back to Events
            </button>
            {/* HEADER SECTION */}
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-6 mb-10 pb-6 border-b border-slate-200">
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

            {/* FILTER SYSTEM */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
              <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">
                    Hashgafa Group
                  </label>
                  <select
                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50"
                    value={filters.hashgafa}
                    onChange={(e) =>
                      setFilters({ ...filters, hashgafa: e.target.value })
                    }
                  >
                    <option value="all">All Groups</option>
                    <option value="Expected">
                      Hair-Covering Expected (Purple)
                    </option>
                    <option value="Flexible">Flexible (Green)</option>
                    <option value="None">
                      No Hair-Covering Expected (Blue)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-blue-600 uppercase mb-2 block">
                    Men's Age Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                      value={filters.minAgeMan}
                      onChange={(e) =>
                        setFilters({ ...filters, minAgeMan: e.target.value })
                      }
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                      value={filters.maxAgeMan}
                      onChange={(e) =>
                        setFilters({ ...filters, maxAgeMan: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-pink-600 uppercase block">
                      Women's Age Range
                    </label>
                    <button
                      onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                      className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline"
                    >
                      {isAdvancedOpen ? "Close Advanced" : "Advanced Filters"}
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                      value={filters.minAgeWoman}
                      onChange={(e) =>
                        setFilters({ ...filters, minAgeWoman: e.target.value })
                      }
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                      value={filters.maxAgeWoman}
                      onChange={(e) =>
                        setFilters({ ...filters, maxAgeWoman: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* ADVANCED FILTERS (Collapsible) */}
              {isAdvancedOpen && (
                <div className="px-6 pb-6 pt-2 border-t border-slate-100 bg-slate-50/50 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                  {/* Gender */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      Gender
                    </label>
                    <select
                      className="w-full p-2 border rounded text-xs"
                      value={filters.gender}
                      onChange={(e) =>
                        setFilters({ ...filters, gender: e.target.value })
                      }
                    >
                      <option value="all">All</option>
                      <option value="man">Men</option>
                      <option value="woman">Women</option>
                    </select>
                  </div>

                  {/* Ethnicity */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      Ethnicity
                    </label>
                    <select
                      className="w-full p-2 border rounded text-xs"
                      value={filters.ethnicity}
                      onChange={(e) =>
                        setFilters({ ...filters, ethnicity: e.target.value })
                      }
                    >
                      <option value="all">Any</option>
                      <option value="Syrian / Egyptian / Lebanese">
                        S/E/L
                      </option>
                      <option value="Other Sephardic">Other Sephardic</option>
                      <option value="Ashkenaz">Ashkenaz</option>
                    </select>
                  </div>

                  {/* Marital */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      Marital
                    </label>
                    <select
                      className="w-full p-2 border rounded text-xs"
                      value={filters.maritalStatus}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          maritalStatus: e.target.value,
                        })
                      }
                    >
                      <option value="all">Any</option>
                      <option value="Single">Single</option>
                      <option value="Divorced">Divorced</option>
                    </select>
                  </div>

                  {/* Boolean Filters (Shabbat, Kashrut, Kohen) */}
                  {["isKohen", "shomerShabbat", "shomerKashrut"].map((key) => (
                    <div key={key}>
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                        {key.replace("is", "").replace("shomer", "Shomer ")}
                      </label>
                      <select
                        className="w-full p-2 border rounded text-xs"
                        value={filters[key]}
                        onChange={(e) =>
                          setFilters({ ...filters, [key]: e.target.value })
                        }
                      >
                        <option value="all">Any</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  ))}

                  {/* Dress Style */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      Dress Style
                    </label>
                    <select
                      className="w-full p-2 border rounded text-xs"
                      value={filters.dressStyle}
                      onChange={(e) =>
                        setFilters({ ...filters, dressStyle: e.target.value })
                      }
                    >
                      <option value="all">Any</option>
                      <option value="skirtsOnly">Skirts Only</option>
                      <option value="skirtsPants">Skirts + Pants</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* TABLE SECTION */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[1800px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="px-6 py-4 sticky left-0 bg-slate-50 z-20">
                        Name / Age
                      </th>
                      <th className="px-6 py-4">Hashgafa</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Gender</th>
                      <th className="px-6 py-4">Table Number</th>
                      <th className="px-6 py-4">Ethnicity</th>
                      <th className="px-6 py-4">Other Background</th>
                      <th className="px-6 py-4">Marital Status</th>
                      <th className="px-6 py-4">Kohen</th>
                      <th className="px-6 py-4">Shomer Shabbat</th>
                      <th className="px-6 py-4">Shomer Kashrut</th>
                      <th className="px-6 py-4">Wants covered head (Male)</th>
                      <th className="px-6 py-4">
                        Wants to cover head (Female)
                      </th>
                      <th className="px-6 py-4">Dress Style (Female)</th>
                      <th className="px-6 py-4">Anything else</th>
                      <th className="px-6 py-4 text-right sticky right-0 bg-slate-50">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAttendees.map((a) => {
                      const hashgafa = getHashgafaGroup(a);
                      return (
                        <tr
                          key={a.id}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          {/* Permanent Name Column */}
                          <td className="px-6 py-4 sticky left-0 bg-white z-10 border-r border-slate-100">
                            <p className="font-bold text-slate-900">
                              {a.firstName} {a.lastName}
                            </p>
                            <p className="text-xs text-slate-400">
                              {a.age}y • {a.gender}
                            </p>
                          </td>

                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-1 rounded-md text-[10px] font-bold border ${hashgafa.color} ${hashgafa.border}`}
                            >
                              {hashgafa.label.toUpperCase()}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <button
                              onClick={() => toggleCheckIn(a.id, a.checkedIn)}
                              className={`flex items-center gap-2 px-3 py-1 rounded-full font-black text-[10px] ${
                                a.checkedIn
                                  ? "bg-green-100 text-green-700"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {a.checkedIn ? "CHECKED IN" : "PENDING"}
                            </button>
                          </td>

                          {/* Gender */}
                          <td className="px-6 py-4">
                            <select
                              value={a.gender}
                              onChange={(e) =>
                                updateAttendeeField(a, "gender", e.target.value)
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

                          {/* Table Number */}
                          <td className="px-6 py-4 text-slate-800 font-mono">
                            {a.tableNumber || "-"}
                          </td>

                          {/* Ethnicity */}
                          <td className="px-6 py-4 text-slate-500">
                            <select
                              className="bg-transparent outline-none"
                              value={a.ethnicity}
                              onChange={(e) =>
                                updateAttendeeField(
                                  a,
                                  "ethnicity",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="Syrian / Egyptian / Lebanese">
                                Syrian / Egyptian / Lebanese
                              </option>
                              <option value="Other Sephardic">
                                Other Sephardic
                              </option>
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
                                  a,
                                  "otherSpecify",
                                  e.target.value,
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
                                  a,
                                  "maritalStatus",
                                  e.target.value,
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
                              checked={
                                a.isKohen === "yes" || a.isKohen === true
                              }
                              onChange={(e) =>
                                updateAttendeeField(
                                  a,
                                  "isKohen",
                                  e.target.checked ? "yes" : "no",
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
                                  a,
                                  "isShomerShabbat",
                                  e.target.checked ? "yes" : "no",
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
                                  a,
                                  "isShomerKashrut",
                                  e.target.checked ? "yes" : "no",
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
                                  a,
                                  "wantsCoveredHead",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="N/A">Not applicable</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
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
                                  a,
                                  "hairCovering",
                                  e.target.value,
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
                                  a,
                                  "dressStyle",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="N/A">Not applicable</option>
                              <option value="skirtsOnly">Skirts only</option>
                              <option value="skirtsPants">
                                Skirts + pants
                              </option>
                            </select>
                          </td>

                          {/* Open to Marital (Array Edit) */}
                          <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                            <textarea
                              className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                              defaultValue={a.anythingElse}
                              onBlur={(e) =>
                                updateAttendeeField(
                                  a,
                                  "anythingElse",
                                  e.target.value.map((s) => s.trim()),
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
                      );
                    })}
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
