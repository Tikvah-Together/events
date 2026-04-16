import { useState, useEffect, act, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  documentId,
  serverTimestamp,
  setDoc,
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
  ChevronDown,
  Pause,
} from "lucide-react";

export default function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [eventName, setEventName] = useState("");
  const [roundTime, setRoundTime] = useState(7);
  const [loading, setLoading] = useState(false);
  const [allRegistrations, setAllRegistrations] = useState([]); // All registrations for history/duplicate checks
  const [registrations, setRegistrations] = useState([]);
  const [activeTab, setActiveTab] = useState("events"); // "events" or "master"
  const [masterUsers, setMasterUsers] = useState([]); // The full singles database
  const [selectedUserIds, setSelectedUserIds] = useState([]); // For checkboxes
  const [targetEventId, setTargetEventId] = useState(""); // For "Add to Event" dropdown
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const INITIAL_FILTERS = {
    search: "",
    hashgafa: "all",
    minAgeMan: "",
    maxAgeMan: "",
    minAgeWoman: "",
    maxAgeWoman: "",
    gender: "all",
    ethnicity: "all",
    maritalStatus: "all",
    isKohen: "all",
    shomerShabbat: "all",
    shomerKashrut: "all",
    dressStyle: "all",
    startDate: "",
    endDate: "",
    status: "all",
  };
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setIsAdvancedOpen(false); // Closes the advanced panel if it's open
    setSelectedUserIds([]); // Clears any bulk selections
  };

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

  const filteredMasterList = masterUsers.filter((a) => {
    const hashgafa = getHashgafaGroup(a);

    // 1. Hashgafa (Main)
    if (filters.hashgafa !== "all" && hashgafa.label !== filters.hashgafa)
      return false;

    // 2. Gender-specific Ages (Main)
    if (a.gender === "man") {
      if (filters.minAgeMan && a.age < parseInt(filters.minAgeMan))
        return false;
      if (filters.maxAgeMan && a.age > parseInt(filters.maxAgeMan))
        return false;
    } else if (a.gender === "woman") {
      if (filters.minAgeWoman && a.age < parseInt(filters.minAgeWoman))
        return false;
      if (filters.maxAgeWoman && a.age > parseInt(filters.maxAgeWoman))
        return false;
    }

    // 3. Advanced Filters
    if (filters.gender !== "all" && a.gender !== filters.gender) return false;
    if (filters.ethnicity !== "all" && a.ethnicity !== filters.ethnicity)
      return false;
    if (
      filters.maritalStatus !== "all" &&
      a.maritalStatus !== filters.maritalStatus
    )
      return false;
    if (filters.dressStyle !== "all" && a.dressStyle !== filters.dressStyle)
      return false;

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

  const filteredAttendees = attendees.filter((a) => {
    const hashgafa = getHashgafaGroup(a);

    // 1. Hashgafa (Main)
    if (filters.hashgafa !== "all" && hashgafa.label !== filters.hashgafa)
      return false;

    // 2. Gender-specific Ages (Main)
    if (a.gender === "man") {
      if (filters.minAgeMan && a.age < parseInt(filters.minAgeMan))
        return false;
      if (filters.maxAgeMan && a.age > parseInt(filters.maxAgeMan))
        return false;
    } else if (a.gender === "woman") {
      if (filters.minAgeWoman && a.age < parseInt(filters.minAgeWoman))
        return false;
      if (filters.maxAgeWoman && a.age > parseInt(filters.maxAgeWoman))
        return false;
    }

    // 3. Advanced Filters
    if (filters.gender !== "all" && a.gender !== filters.gender) return false;
    if (
      filters.ethnicity !== "all" &&
      !(
        a.ethnicity &&
        a.ethnicity.toLowerCase().includes(filters.ethnicity.toLowerCase())
      )
    )
      return false;
    if (
      filters.maritalStatus !== "all" &&
      a.maritalStatus !== filters.maritalStatus
    )
      return false;
    if (filters.dressStyle !== "all" && a.dressStyle !== filters.dressStyle)
      return false;

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
        //setAttendeesNotCheckedIn(id);
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
      updateDoc(doc.ref, {
        checkedIn: false,
        eventLabel: null,
        tableNumber: null,
      }),
    );
    await Promise.all(resetPromises);
  };

  const togglePause = async (currentEvent) => {
    // 1. Safety Check: Ensure the event object and its ID exist
    if (!currentEvent || !currentEvent.id) {
      console.error("No event ID found. Cannot toggle pause.");
      return;
    }

    const eventRef = doc(db, "events", currentEvent.id);
    const now = new Date();

    try {
      if (currentEvent.isPaused) {
        // --- RESUMING ---
        // Check if we have a valid pausedAt timestamp
        const pauseStart =
          currentEvent.pausedAt?.toDate?.() || currentEvent.pausedAt;

        if (!pauseStart) {
          console.error("Resume failed: No pause timestamp found.");
          return;
        }

        const pauseDurationMs = now.getTime() - new Date(pauseStart).getTime();
        const oldStartTime =
          currentEvent.startTime?.toDate?.() || currentEvent.startTime;
        const newStartTime = new Date(
          new Date(oldStartTime).getTime() + pauseDurationMs,
        );

        await updateDoc(eventRef, {
          isPaused: false,
          startTime: newStartTime,
          pausedAt: null,
        });
      } else {
        // --- PAUSING ---
        await updateDoc(eventRef, {
          isPaused: true,
          pausedAt: now,
        });
      }
    } catch (err) {
      console.error("Error toggling pause state:", err);
    }
  };

  const launchEvent = async () => {
    const men = attendees.filter((a) => a.gender === "man" && a.checkedIn);
    const women = attendees.filter((a) => a.gender === "woman" && a.checkedIn);

    if (men.length === 0 || women.length === 0) {
      alert("You need checked-in men and women to start!");
      toggleStatus(selectedEvent.id, true); // Revert the event to inactive
      return;
    }

    // Launch with a Start Timestamp
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

      // 1. Get FRESH Registration data
      const regSnap = await getDoc(regRef);
      if (!regSnap.exists()) return;
      const registration = regSnap.data();

      if (!newStatus) {
        await updateDoc(regRef, {
          checkedIn: false,
          eventLabel: null,
          tableNumber: null,
        });
        return;
      }

      // 2. Fetch User (Gender) and Event (Groups)
      const [userSnap, eventSnap] = await Promise.all([
        getDoc(doc(db, "users", registration.userId)),
        getDoc(doc(db, "events", registration.eventId)),
      ]);

      const userData = userSnap.data();
      const eventData = eventSnap.data();
      const eventGroups = eventData.eventGroups || [];

      // The name of the group (e.g., "Group 1")
      const participantGroupName = String(registration.groupId || "");
      const gender = userData?.gender;
      const prefix = gender === "woman" ? "G" : "B";

      // 3. Find the index by matching the NAME
      const groupIdx = eventGroups.findIndex(
        (g) => String(g.name) === participantGroupName,
      );

      // If name isn't found in the current event groups, default to "U"
      const groupSuffix =
        groupIdx >= 0 ? String.fromCharCode(65 + groupIdx) : "U";

      // 4. Fetch all registrations for this event
      const attSnap = await getDocs(
        query(
          collection(db, "registrations"),
          where("eventId", "==", registration.eventId),
        ),
      );
      const allRegs = attSnap.docs.map((d) => d.data());

      // 5. Filter for people of SAME gender AND SAME group name
      const takenNumbers = allRegs
        .filter(
          (a) =>
            a.checkedIn &&
            String(a.groupId) === participantGroupName &&
            a.eventLabel?.startsWith(prefix),
        )
        .map((a) => {
          // Extract number from "B1-A" -> "1"
          const beforeHyphen = a.eventLabel.split("-")[0]; // "B1"
          const numOnly = beforeHyphen.substring(1); // "1"
          return parseInt(numOnly);
        })
        .filter((num) => !isNaN(num))
        .sort((a, b) => a - b);

      // 6. Find lowest available number
      let assignedNumber = 1;
      for (let i = 0; i < takenNumbers.length; i++) {
        if (takenNumbers[i] === assignedNumber) assignedNumber++;
        else if (takenNumbers[i] > assignedNumber) break;
      }

      // 7. Update Database
      await updateDoc(regRef, {
        checkedIn: true,
        eventLabel: `${prefix}${assignedNumber}-${groupSuffix}`,
        tableNumber: `Table ${assignedNumber} - ${participantGroupName || "U"}`,
      });
    } catch (err) {
      console.error("Check-in error:", err);
    }
  };

  const sendInvite = async (attendeeId, name) => {
    //TODO - this should trigger an email via a Cloud Function in production, but for now we'll just update the status in Firestore
    if (window.confirm(`Send invite to ${name}?`)) {
      try {
        await updateDoc(doc(db, "registrations", attendeeId), {
          status: "invited",
        });
      } catch (err) {
        console.error("Error sending invite:", err);
      }
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

  const deleteUserFromMaster = async (userId, name) => {
    if (
      window.confirm(
        `Permanently delete ${name} from the Master List? This cannot be undone.`,
      )
    ) {
      try {
        await deleteDoc(doc(db, "users", userId));
      } catch (err) {
        console.error("Error deleting user:", err);
      }
    }
  };

  const copyRegistrationLink = (eventId) => {
    // window.location.origin will use http://localhost:3000 or your production URL automatically
    const registrationUrl = `${window.location.origin}/register?eventId=${eventId}`;

    navigator.clipboard.writeText(registrationUrl);
    alert("Link copied to clipboard!");
  };

  const addUsersToEvent = async () => {
    if (!targetEventId || selectedUserIds.length === 0) return;

    // 1. FILTER: Remove anyone who is already in 'allRegistrations' for this event
    const trulyNewIds = selectedUserIds.filter(
      (userId) =>
        !allRegistrations.some(
          (reg) => reg.userId === userId && reg.eventId === targetEventId,
        ),
    );

    if (trulyNewIds.length === 0) {
      alert("All selected users are already in this event.");
      setSelectedUserIds([]);
      return;
    }

    const targetEvent = events.find((e) => e.id === targetEventId);
    setLoading(true);

    try {
      const promises = trulyNewIds.map(async (userId) => {
        return addDoc(collection(db, "registrations"), {
          userId,
          eventId: targetEventId,
          eventName: targetEvent?.name || "Unknown Event",
          groupId: "Group 1", // Default group
          confirmationStatus: "pending invite",
          checkedIn: false,
        });
      });

      await Promise.all(promises);
      setSelectedUserIds([]);
      alert(`Added ${trulyNewIds.length} users to ${targetEvent?.name}`);
    } catch (err) {
      console.error(err);
      alert("Error adding users.");
    }
    setLoading(false);
  };

  useEffect(() => {
    const hasMaleAge = filters.minAgeMan || filters.maxAgeMan;
    const hasFemaleAge = filters.minAgeWoman || filters.maxAgeWoman;

    setFilters((prev) => {
      // Rule 1: Both ranges have values -> Default to "all"
      if (hasMaleAge && hasFemaleAge) {
        if (prev.gender === "all") return prev; // Avoid unnecessary re-renders
        return { ...prev, gender: "all" };
      }

      // Rule 2: Only Male range has values -> Default to "man"
      if (hasMaleAge && !hasFemaleAge) {
        if (prev.gender === "man") return prev;
        return { ...prev, gender: "man" };
      }

      // Rule 3: Only Female range has values -> Default to "woman"
      if (hasMaleAge && !hasFemaleAge) {
        if (prev.gender === "woman") return prev;
        return { ...prev, gender: "woman" };
      }

      return prev;
    });
  }, [
    filters.minAgeMan,
    filters.maxAgeMan,
    filters.minAgeWoman,
    filters.maxAgeWoman,
  ]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "registrations"), (snap) => {
      setAllRegistrations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Fetch all users for the Master List
    const unsubscribe = onSnapshot(collection(db, "users"), (snap) => {
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMasterUsers(users);
    });
    return () => unsubscribe();
  }, []);

  // Helper to get a user's event history
  const getUserHistory = (userId) => {
    const userRegs = allRegistrations.filter((r) => r.userId === userId);
    const eventNames = userRegs
      .map((r) => {
        const event = events.find((e) => e.id === r.eventId);
        return event ? event.name : null;
      })
      .filter(Boolean);
    return eventNames;
  };

  const getUserAttendedHistory = (userId) => {
    const userRegs = allRegistrations.filter(
      (r) => r.userId === userId && r.status === "attended",
    );
    const eventNames = userRegs
      .map((r) => {
        const event = events.find((e) => e.id === r.eventId);
        return event ? event.name : null;
      })
      .filter(Boolean);
    return eventNames;
  };

  // 1. Fetch all events in real-time
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // If we currently have an event selected, find its NEWEST version from the fresh data
      setSelectedEvent((currentSelected) => {
        if (!currentSelected) return null;
        return (
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .find((e) => e.id === currentSelected.id) || null
        );
      });
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
      // const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
      // // We only want to delete events that have a scheduledAt date
      // const q = query(
      //   collection(db, "events"),
      //   where("scheduledAt", "<", seventyTwoHoursAgo),
      // );
      // const snapshot = await getDocs(q);
      // snapshot.forEach(async (eventDoc) => {
      //   // Delete registrations first (optional but recommended for data hygiene)
      //   const regQ = query(
      //     collection(db, "registrations"),
      //     where("eventId", "==", eventDoc.id),
      //   );
      //   const regSnap = await getDocs(regQ);
      //   regSnap.forEach(
      //     async (r) => await deleteDoc(doc(db, "registrations", r.id)),
      //   );
      //   // Delete the event itself
      //   await deleteDoc(doc(db, "events", eventDoc.id));
      //   console.log(`Auto-deleted expired event: ${eventDoc.id}`);
      // });
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
        eventGroups: [{ name: "Group 1" }],
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
      const registrationFields = [
        "checkedIn",
        "groupId",
        "tableNumber",
        "eventLabel",
        "isConfirmed",
      ];
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

  const stats = useMemo(() => {
    const getListStats = (list) => {
      // Simplified since data is always man/woman
      const boys = list.filter((u) => u.gender?.toLowerCase() === "man").length;
      const girls = list.filter(
        (u) => u.gender?.toLowerCase() === "woman",
      ).length;

      const total = boys + girls;
      const ratio =
        total > 0
          ? {
              b: Math.round((boys / total) * 100),
              g: Math.round((girls / total) * 100),
            }
          : { b: 0, g: 0 };

      return { boys, girls, total, ratio };
    };

    // Overall stats for the current tab
    const currentList =
      activeTab === "master" ? filteredMasterList : filteredAttendees;
    const overall = getListStats(currentList);

    // Stats per group (for the Events tab)
    const groupStats = {};
    if (activeTab === "events") {
      filteredAttendees.forEach((u) => {
        const gId = u.groupId || "Unassigned";
        if (!groupStats[gId]) groupStats[gId] = [];
        groupStats[gId].push(u);
      });
      Object.keys(groupStats).forEach((key) => {
        groupStats[key] = getListStats(groupStats[key]);
      });
    }

    return { overall, groupStats };
  }, [filteredMasterList, filteredAttendees, activeTab]);

  return (
    <div className="flex flex-col bg-slate-50">
      {/* TAB NAVIGATION */}
      <div className="flex bg-white border-b border-slate-200 px-6 shrink-0">
        <button
          onClick={() => setActiveTab("events")}
          className={`px-6 py-4 font-bold text-sm ${activeTab === "events" ? "border-b-2 border-blue-900 text-blue-900" : "text-slate-400"}`}
        >
          Events Management
        </button>
        <button
          onClick={() => setActiveTab("master")}
          className={`px-6 py-4 font-bold text-sm ${activeTab === "master" ? "border-b-2 border-blue-900 text-blue-900" : "text-slate-400"}`}
        >
          Master Singles List
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden">
          {/* SIDEBAR: Event List */}
          {activeTab === "events" && (
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
          )}

          {/* MAIN CONTENT: Event Details */}
          <div className="flex-1 p-4 overflow-auto">
            {selectedEvent || activeTab === "master" ? (
              <div className="w-full mx-auto">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="md:hidden mb-4 text-blue-600 font-bold flex items-center gap-2"
                >
                  ← Back to Events
                </button>
                {/* HEADER SECTION */}
                {activeTab === "events" && (
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
                            <rect
                              width="14"
                              height="14"
                              x="8"
                              y="8"
                              rx="2"
                              ry="2"
                            />
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

                    <div className="flex flex-col gap-4 bg-slate-100 p-5 rounded-xl border border-slate-200 mb-8">
                      {/* Header & Add Input Row */}
                      <div className="flex items-end justify-between gap-10">
                        <div className="flex flex-col flex-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            Event Configuration
                          </span>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Enter group name (e.g. Young Professionals)"
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              className="flex-1 p-2 text-sm border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                              onClick={async () => {
                                if (!newGroupName.trim()) {
                                  alert("Please enter a group name first.");
                                  return;
                                }
                                try {
                                  const existingGroups =
                                    selectedEvent.eventGroups || [];
                                  const newGroup = {
                                    name: newGroupName.trim(),
                                  };

                                  const updatedGroups = [
                                    ...existingGroups,
                                    newGroup,
                                  ];

                                  await updateDoc(
                                    doc(db, "events", selectedEvent.id),
                                    {
                                      eventGroups: updatedGroups,
                                    },
                                  );

                                  setNewGroupName(""); // Clear the input after success
                                  alert(`"${newGroup.name}" created.`);
                                } catch (error) {
                                  alert("Error adding group.");
                                }
                              }}
                              className="flex items-center gap-2 text-xs bg-blue-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-800 transition-all shadow-sm h-10"
                            >
                              <Plus size={14} />
                              Add Group
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Active Groups Display */}
                      <div className="flex flex-wrap gap-3 mt-2 border-t border-slate-200 pt-4">
                        <span className="w-full text-[10px] font-bold text-slate-400 uppercase">
                          Existing Groups:
                        </span>

                        {/* We look up the event directly from the main 'events' state to ensure it's the live version */}
                        {(
                          events.find((e) => e.id === selectedEvent?.id)
                            ?.eventGroups || []
                        ).length === 0 && (
                          <span className="text-xs italic text-slate-400">
                            No groups created yet.
                          </span>
                        )}

                        {(
                          events.find((e) => e.id === selectedEvent?.id)
                            ?.eventGroups || []
                        ).map((group, idx) => (
                          <div
                            key={group.name}
                            className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm hover:border-blue-300 transition-colors"
                          >
                            <input
                              className="text-xs font-bold w-32 outline-none text-slate-700"
                              value={group.name}
                              onChange={async (e) => {
                                const liveEvent = events.find(
                                  (ev) => ev.id === selectedEvent.id,
                                );
                                const updatedGroups = [
                                  ...liveEvent.eventGroups,
                                ];
                                updatedGroups[idx].name = e.target.value;

                                await updateDoc(
                                  doc(db, "events", selectedEvent.id),
                                  {
                                    eventGroups: updatedGroups,
                                  },
                                );
                              }}
                            />
                            <button
                              onClick={async () => {
                                if (window.confirm(`Delete "${group.name}"?`)) {
                                  const liveEvent = events.find(
                                    (ev) => ev.id === selectedEvent.id,
                                  );
                                  const updatedGroups =
                                    liveEvent.eventGroups.filter(
                                      (_, i) => i !== idx,
                                    );

                                  await updateDoc(
                                    doc(db, "events", selectedEvent.id),
                                    {
                                      eventGroups: updatedGroups,
                                    },
                                  );
                                }
                              }}
                              className="text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
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
                        onClick={() =>
                          togglePause(selectedEvent, selectedEvent.isPaused)
                        }
                        className={`px-6 py-2 rounded-md font-bold flex items-center gap-2 transition-all duration-200 shadow-sm border
                         ${
                           selectedEvent.isPaused
                             ? "bg-green-600 text-white border-green-600 hover:bg-green-700"
                             : "bg-slate-200 text-slate-600 border-slate-200 hover:bg-slate-300"
                         }`}
                        disabled={!selectedEvent.active}
                      >
                        {selectedEvent.isPaused ? (
                          <>
                            {" "}
                            <Play size={16} fill="currentColor" /> Resume{" "}
                          </>
                        ) : (
                          <>
                            {" "}
                            <Pause size={16} fill="currentColor" /> Pause{" "}
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
                )}

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
                            setFilters({
                              ...filters,
                              minAgeMan: e.target.value,
                              gender: "man", // Auto-set gender
                            })
                          }
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.maxAgeMan}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              maxAgeMan: e.target.value,
                              gender: "man", // Auto-set gender
                            })
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-end mb-2">
                        {/* 1. The Label stays on the left */}
                        <label className="text-[10px] font-bold text-pink-600 uppercase block">
                          Women's Age Range
                        </label>

                        {/* 2. Group the buttons together so they move as one unit to the right */}
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                            className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline"
                          >
                            {isAdvancedOpen
                              ? "Hide Filters"
                              : "Advanced Filters"}
                            <ChevronDown
                              size={14}
                              className={`transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`}
                            />
                          </button>

                          <button
                            onClick={resetFilters}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                            Clear All Filters
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.minAgeWoman}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              minAgeWoman: e.target.value,
                              gender: "woman", // Auto-set gender
                            })
                          }
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.maxAgeWoman}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              maxAgeWoman: e.target.value,
                              gender: "woman", // Auto-set gender
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        Signup Date Range
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          className="p-2 border border-slate-200 rounded text-xs outline-none"
                          value={filters.startDate}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              startDate: e.target.value,
                            })
                          }
                        />
                        <span className="text-slate-400">-</span>
                        <input
                          type="date"
                          className="p-2 border border-slate-200 rounded text-xs outline-none"
                          value={filters.endDate}
                          onChange={(e) =>
                            setFilters({ ...filters, endDate: e.target.value })
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

                      {/* Ethnicity Filter */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Ethnicity
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.ethnicity}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              ethnicity: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any</option>
                          <optgroup label="Sephardic">
                            <option value="Syrian">Syrian</option>
                            <option value="Egyptian">Egyptian</option>
                            <option value="Lebanese">Lebanese</option>
                            <option value="Persian">Persian</option>
                            <option value="Moroccan">Moroccan</option>
                            <option value="Israeli">Israeli</option>
                            <option value="Other Sephardic">
                              Other Sephardic
                            </option>
                          </optgroup>
                          <option value="Ashkenaz">Ashkenaz</option>
                          <option value="Other">Other</option>
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
                      {["isKohen", "shomerShabbat", "shomerKashrut"].map(
                        (key) => (
                          <div key={key}>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                              {key
                                .replace("is", "")
                                .replace("shomer", "Shomer ")}
                            </label>
                            <select
                              className="w-full p-2 border rounded text-xs"
                              value={filters[key]}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  [key]: e.target.value,
                                })
                              }
                            >
                              <option value="all">Any</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </div>
                        ),
                      )}

                      {/* Dress Style */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Dress Style
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.dressStyle}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              dressStyle: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any</option>
                          <option value="skirtsOnly">Skirts Only</option>
                          <option value="skirtsPants">Skirts + Pants</option>
                        </select>
                      </div>

                      {/* Confirmation Status */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Confimation Status
                        </label>
                        <select
                          className="w-full p-2 border border-blue-200 rounded text-xs bg-white"
                          value={filters.status}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              status: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any Status</option>
                          <option value="attended">Attended</option>
                          <option value="pending invite">Pending Invite</option>
                          <option value="invited">Invited</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="declined">Declined</option>
                          <option value="waitlist">Waitlist</option>
                          <option value="no response">No Response</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {activeTab === "master" && (
                    <div className="bg-blue-500 text-white p-4 rounded flex items-center justify-between">
                      <span className="font-bold">
                        {selectedUserIds.length} user(s) selected
                      </span>
                      <div className="flex gap-4 items-center">
                        <select
                          className="text-black text-sm p-1.5 rounded border border-slate-300"
                          value={targetEventId}
                          onChange={(e) => {
                            setTargetEventId(e.target.value);
                            setSelectedUserIds([]);
                          }}
                        >
                          <option value="">Select Target Event...</option>
                          {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                              {ev.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={addUsersToEvent}
                          className="bg-green-500 hover:bg-green-600 px-4 py-1.5 rounded font-bold text-sm transition"
                        >
                          Add to Event
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* STATISTICS SUMMARY BAR */}
                <div className="flex flex-wrap gap-4 mb-4">
                  {/* OVERALL TOTALS */}
                  <div className="bg-white px-6 py-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-6">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {activeTab === "master" ? "Total List" : "Event Total"}
                    </span>
                    <div className="flex gap-4 text-sm font-bold">
                      <span className="text-blue-600">
                        Boys: {stats.overall.boys}
                      </span>
                      <span className="text-pink-600">
                        Girls: {stats.overall.girls}
                      </span>
                      <span className="text-slate-600">
                        Ratio: {stats.overall.ratio.b}% /{" "}
                        {stats.overall.ratio.g}%
                      </span>
                    </div>
                  </div>

                  {/* GROUP BREAKDOWN (Only shows on Events tab) */}
                  {activeTab === "events" &&
                    Object.entries(stats.groupStats).map(
                      ([groupId, groupData]) => (
                        <div
                          key={groupId}
                          className="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 flex items-center gap-4"
                        >
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            Group {groupId}
                          </span>
                          <div className="flex gap-3 text-xs font-bold">
                            <span className="text-blue-600">
                              B: {groupData.boys}
                            </span>
                            <span className="text-pink-600">
                              G: {groupData.girls}
                            </span>
                            <span className="text-slate-400">
                              {groupData.ratio.b}% / {groupData.ratio.g}%
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                </div>

                {/* TABLE SECTION */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-450">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                        <tr>
                          {activeTab === "master" && (
                            <th className="px-6 py-4">
                              Select all&nbsp;
                              <input
                                type="checkbox"
                                disabled={
                                  filteredMasterList.length === 0 ||
                                  !targetEventId
                                } // Disable if no users visible or no event selected
                                checked={
                                  filteredMasterList.length > 0 &&
                                  filteredMasterList
                                    .filter(
                                      (u) =>
                                        !allRegistrations.some(
                                          (r) =>
                                            r.userId === u.id &&
                                            r.eventId === targetEventId,
                                        ),
                                    )
                                    .every((u) =>
                                      selectedUserIds.includes(u.id),
                                    )
                                }
                                onChange={(e) => {
                                  // Only select people who ARE NOT already in the event
                                  const eligibleIds = filteredMasterList
                                    .filter(
                                      (u) =>
                                        !allRegistrations.some(
                                          (r) =>
                                            r.userId === u.id &&
                                            r.eventId === targetEventId,
                                        ),
                                    )
                                    .map((u) => u.id);

                                  if (e.target.checked) {
                                    setSelectedUserIds((prev) => [
                                      ...new Set([...prev, ...eligibleIds]),
                                    ]);
                                  } else {
                                    setSelectedUserIds((prev) =>
                                      prev.filter(
                                        (id) => !eligibleIds.includes(id),
                                      ),
                                    );
                                  }
                                }}
                              />
                            </th>
                          )}
                          <th className="px-6 py-4 sticky left-0 bg-slate-50 z-20">
                            Name / Age
                          </th>
                          <th className="px-6 py-4">Hashgafa</th>
                          {activeTab === "master" && (
                            <th className="px-6 py-4">Signup Date</th>
                          )}
                          {activeTab === "master" && (
                            <th className="px-6 py-4">Event Registration</th>
                          )}
                          {activeTab === "master" && (
                            <th className="px-6 py-4">Event History</th>
                          )}
                          {activeTab === "events" && (
                            <th className="px-6 py-4">Confirmation Status</th>
                          )}
                          {activeTab === "events" && (
                            <th className="px-6 py-4">Check-In</th>
                          )}
                          {activeTab === "events" && (
                            <th className="px-6 py-4">Group Assignment</th>
                          )}
                          <th className="px-6 py-4">Gender</th>
                          {activeTab === "events" && (
                            <th className="px-6 py-4">Event Label</th>
                          )}
                          {activeTab === "events" && (
                            <th className="px-6 py-4">Table Number</th>
                          )}
                          <th className="px-6 py-4">Ethnicity</th>
                          <th className="px-6 py-4">Other Background</th>
                          <th className="px-6 py-4">Marital Status</th>
                          <th className="px-6 py-4">Kohen</th>
                          <th className="px-6 py-4">Shomer Shabbat</th>
                          <th className="px-6 py-4">Shomer Kashrut</th>
                          <th className="px-6 py-4">
                            Wants covered head (Male)
                          </th>
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
                        {(() => {
                          // Determine which list we are actually using
                          const listToDisplay = (
                            activeTab === "master"
                              ? filteredMasterList
                              : filteredAttendees
                          ).filter((user) => {
                            if (
                              activeTab === "events" &&
                              filters.status !== "all"
                            ) {
                              if (user.status !== filters.status) return false;
                            }
                            if (!filters.startDate && !filters.endDate)
                              return true;

                            // Convert Firestore timestamp to JS Date
                            const signupDate = user.createdAt?.toDate
                              ? user.createdAt.toDate()
                              : new Date(user.createdAt);
                            const start = filters.startDate
                              ? new Date(filters.startDate)
                              : null;
                            const end = filters.endDate
                              ? new Date(filters.endDate)
                              : null;

                            if (start && signupDate < start) return false;
                            if (end) {
                              // Set end date to 23:59:59 to include the entire day
                              const adjustedEnd = new Date(end);
                              adjustedEnd.setHours(23, 59, 59);
                              if (signupDate > adjustedEnd) return false;
                            }
                          });

                          // Apply multi-level sorting (Group -> Gender -> Age)
                          const sortedList = [...listToDisplay].sort((a, b) => {
                            // 1. Sort by Group ID First
                            const groupA = (
                              a.groupId || "Unassigned"
                            ).toString();
                            const groupB = (
                              b.groupId || "Unassigned"
                            ).toString();

                            if (groupA !== groupB) {
                              return groupA.localeCompare(groupB, undefined, {
                                numeric: true,
                                sensitivity: "base",
                              });
                            }

                            // 2. Sort by Gender (Male/Boys first within the group)
                            const genderA = (a.gender || "").toLowerCase();
                            const genderB = (b.gender || "").toLowerCase();

                            if (genderA !== genderB) {
                              const isAMale =
                                genderA === "male" ||
                                genderA === "man" ||
                                genderA === "boy";
                              const isBMale =
                                genderB === "male" ||
                                genderB === "man" ||
                                genderB === "boy";

                              if (isAMale && !isBMale) return -1;
                              if (!isAMale && isBMale) return 1;
                            }

                            // 3. Sort by Age (Youngest to Oldest within the gender block)
                            const ageA = parseInt(a.age) || 999;
                            const ageB = parseInt(b.age) || 999;

                            if (ageA !== ageB) {
                              return ageA - ageB;
                            }

                            // 4. Stable fallback to First Name
                            return (a.firstName || "").localeCompare(
                              b.firstName || "",
                            );
                          });

                          return sortedList.map((a, index) => {
                            const hashgafa = getHashgafaGroup(a);
                            const isAlreadyInEvent = allRegistrations.some(
                              (reg) =>
                                reg.userId === a.id &&
                                reg.eventId === targetEventId,
                            );

                            let isNewGroup = false;
                            if (activeTab === "events" && index > 0) {
                              // Compare against the previous item in the SORTED list, not filteredAttendees
                              isNewGroup =
                                a.groupId !== sortedList[index - 1].groupId;
                            }

                            return (
                              <tr
                                key={a.id}
                                className={`border-b transition-colors ${
                                  isNewGroup && activeTab === "events"
                                    ? "border-t-4 border-t-slate-300"
                                    : ""
                                } ${
                                  isAlreadyInEvent
                                    ? "bg-slate-200/70"
                                    : "hover:bg-blue-50"
                                }`}
                              >
                                {activeTab === "master" && (
                                  <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                      <input
                                        type="checkbox"
                                        checked={selectedUserIds.includes(a.id)}
                                        disabled={
                                          isAlreadyInEvent || !targetEventId
                                        } // Disable if already in OR no event selected
                                        className={`${isAlreadyInEvent ? "cursor-not-allowed" : "cursor-pointer"}`}
                                        onChange={() => {
                                          setSelectedUserIds((prev) =>
                                            prev.includes(a.id)
                                              ? prev.filter((id) => id !== a.id)
                                              : [...prev, a.id],
                                          );
                                        }}
                                      />
                                      {isAlreadyInEvent && (
                                        <span className="text-[9px] font-bold text-slate-400 uppercase leading-tight">
                                          Added
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                )}

                                {/* Permanent Name Column */}
                                <td
                                  className={`px-6 py-4 sticky left-0 z-10 border-r border-slate-100 ${isAlreadyInEvent ? "bg-slate-200/70" : "hover:bg-blue-50"}`}
                                >
                                  <p className="font-bold text-slate-900">
                                    {a.firstName} {a.lastName}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {a.age}y • {a.gender}
                                  </p>
                                </td>

                                {/* Hashgafa Group */}
                                <td className="px-6 py-4">
                                  <span
                                    className={`px-3 py-1 rounded-md text-[10px] font-bold border ${hashgafa.color} ${hashgafa.border}`}
                                  >
                                    {hashgafa.label.toUpperCase()}
                                  </span>
                                </td>

                                {/* Signup Date */}
                                {activeTab === "master" && (
                                  <td className="px-6 py-4 text-slate-500">
                                    {a.createdAt?.toDate().toLocaleString() ||
                                      "-"}
                                  </td>
                                )}

                                {/* Event Registration (Events this user has signed up for but not necessarily attended) */}
                                {activeTab === "master" && (
                                  <td className="px-6 py-4 text-slate-500 text-xs italic">
                                    {getUserHistory(a.id).join(", ") || "-"}
                                  </td>
                                )}

                                {/* Event History (Events this user has attended) */}
                                {activeTab === "master" && (
                                  <td className="px-6 py-4 text-slate-500 text-xs italic">
                                    {getUserAttendedHistory(a.id).join(", ") ||
                                      "-"}
                                  </td>
                                )}

                                {/* Confirmation Status, possible values are: Pending Invite, Invited, Confirmed, Declined, Waitlist, Attended, and No Response */}
                                {activeTab === "events" && (
                                  <td className="px-6 py-4">
                                    <select
                                      value={a.status}
                                      onChange={(e) =>
                                        updateAttendeeField(
                                          a,
                                          "status",
                                          e.target.value,
                                        )
                                      }
                                      className="text-xs font-bold text-blue-900"
                                    >
                                      <option value="pending invite">
                                        Pending Invite
                                      </option>
                                      <option value="waitlist">Waitlist</option>
                                      <option value="invited">Invited</option>
                                      <option value="confirmed">
                                        Confirmed
                                      </option>
                                      <option value="declined">Declined</option>
                                      <option value="attended">Attended</option>
                                      <option value="no response">
                                        No Response
                                      </option>
                                    </select>
                                    {a.status === "pending invite" && (
                                      <button
                                        onClick={() =>
                                          sendInvite(
                                            a.id,
                                            `${a.firstName} ${a.lastName}`,
                                          )
                                        }
                                        className="ml-2 text-xs text-blue-600 hover:underline"
                                      >
                                        Invite
                                      </button>
                                    )}
                                  </td>
                                )}

                                {/* Check-In */}
                                {activeTab === "events" && (
                                  <td className="px-6 py-4">
                                    <button
                                      onClick={() =>
                                        toggleCheckIn(a.id, a.checkedIn)
                                      }
                                      className={`flex items-center gap-2 px-3 py-1 rounded-full font-black text-[10px] ${
                                        a.checkedIn
                                          ? "bg-green-100 text-green-700"
                                          : "bg-yellow-100 text-yellow-800"
                                      }`}
                                    >
                                      {a.checkedIn ? "CHECKED IN" : "PENDING"}
                                    </button>
                                  </td>
                                )}

                                {/* Group Assignment */}
                                {activeTab === "events" && (
                                  <td className="px-6 py-4">
                                    <select
                                      /* 1. We look at the groupId stored on this registration */
                                      value={a.groupId || ""}
                                      /* 2. We pass only the ID, the field name, and the new value */
                                      onChange={(e) =>
                                        updateAttendeeField(
                                          a,
                                          "groupId",
                                          e.target.value,
                                        )
                                      }
                                      className="text-xs font-bold text-blue-900 bg-white border border-slate-200 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                      <option value="">Unassigned</option>
                                      {(selectedEvent?.eventGroups || []).map(
                                        (group) => (
                                          <option
                                            key={group.name}
                                            value={group.name}
                                          >
                                            {group.name}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </td>
                                )}

                                {/* Gender */}
                                <td className="px-6 py-4">
                                  <select
                                    value={a.gender}
                                    onChange={(e) =>
                                      updateAttendeeField(
                                        a,
                                        "gender",
                                        e.target.value,
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

                                {/* Event Label */}
                                {activeTab === "events" && (
                                  <td className="px-6 py-4 text-[11px]">
                                    <textarea
                                      className="bg-transparent border border-slate-100 rounded p-1 w-auto h-auto leading-tight outline-none focus:bg-white"
                                      value={a.eventLabel || ""}
                                      onChange={(e) =>
                                        updateAttendeeField(
                                          a,
                                          "eventLabel",
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </td>
                                )}

                                {/* Table Number & Group Name */}
                                {activeTab === "events" && (
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                      {/* Input for the Number (e.g., "1") */}
                                      Table
                                      <input
                                        type="text"
                                        placeholder="#"
                                        className="bg-transparent border border-slate-100 rounded p-1 w-12 text-[11px] outline-none focus:bg-white"
                                        value={(a.tableNumber || "")
                                          .split(" - ")[0]
                                          .replace("Table ", "")}
                                        onChange={(e) => {
                                          const groupName =
                                            (a.tableNumber || "").split(
                                              " - ",
                                            )[1] || "";
                                          const newNum = e.target.value;
                                          updateAttendeeField(
                                            a,
                                            "tableNumber",
                                            `Table ${newNum}${groupName ? ` - ${groupName}` : ""}`,
                                          );
                                        }}
                                      />
                                      <span className="text-slate-400 text-[10px]">
                                        -
                                      </span>
                                      {/* Input for the Group Name (e.g., "Group") */}
                                      <input
                                        type="text"
                                        placeholder="Group Name"
                                        className="bg-transparent border border-slate-100 rounded p-1 w-24 text-[11px] outline-none focus:bg-white"
                                        value={
                                          (a.tableNumber || "").split(
                                            " - ",
                                          )[1] || ""
                                        }
                                        onChange={(e) => {
                                          const tableNum =
                                            (a.tableNumber || "").split(
                                              " - ",
                                            )[0] || "Table ";
                                          const newGroupName = e.target.value;
                                          updateAttendeeField(
                                            a,
                                            "tableNumber",
                                            `${tableNum} - ${newGroupName}`,
                                          );
                                        }}
                                      />
                                    </div>
                                  </td>
                                )}

                                {/* Ethnicity Table Cell */}
                                <td className="px-6 py-4 text-xs text-slate-600">
                                  <input
                                    type="text"
                                    className="bg-transparent hover:bg-slate-100 border-none outline-none w-full min-w-25 focus:ring-1 focus:ring-blue-400 rounded p-1 transition-all"
                                    value={a.ethnicity || ""}
                                    onChange={(e) =>
                                      updateAttendeeField(
                                        a,
                                        "ethnicity",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </td>

                                {/* Other background */}
                                <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                                  <textarea
                                    className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                                    value={a.otherSpecify}
                                    onChange={(e) =>
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
                                    <option value="skirtsOnly">
                                      Skirts only
                                    </option>
                                    <option value="skirtsPants">
                                      Skirts + pants
                                    </option>
                                  </select>
                                </td>

                                {/* Anything Else */}
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
                                <td
                                  className={`px-6 py-4 text-right sticky right-0 ${isAlreadyInEvent ? "bg-slate-200/70" : "hover:bg-blue-50"}`}
                                >
                                  <button
                                    onClick={() =>
                                      activeTab === "master"
                                        ? deleteUserFromMaster(a.id, a.name)
                                        : deleteAttendee(
                                            a.id,
                                            a.firstName + " " + a.lastName,
                                          )
                                    }
                                    className="p-2 text-slate-300 hover:text-red-500 transition-all"
                                  >
                                    <UserMinus size={18} />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
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
              /* EMPTY STATE: Show this when no event is selected and NOT on master tab */
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-slate-200 text-center">
                  <p className="text-lg font-medium">
                    Select an event from the sidebar
                  </p>
                  <p className="text-sm">
                    Or click "Master Singles List" to see everyone.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
