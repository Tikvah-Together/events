import { useState, useEffect, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  orderBy,
  limit,
  arrayUnion,
} from "firebase/firestore";
import LiveRoundView from "./LiveRoundView";
import {
  Clock,
  Smartphone,
  Mail,
  ArrowRight,
  Loader2,
  ShieldCheck,
  ClipboardEdit,
} from "lucide-react";

export default function Gatekeeper() {
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [currentEvent, setCurrentEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  const [potentialMatches, setPotentialMatches] = useState([]);
  const [masterUsers, setMasterUsers] = useState([]);
  const [viewMode, setViewMode] = useState("user"); // 'user' or 'admin'

  // Admin Entry Modal State
  const [adminTargetUser, setAdminTargetUser] = useState(null);
  const [manualEntry, setManualEntry] = useState({
    partnerId: "",
    interest: "yes",
    optionalNotes: "",
    round: 1,
  });
  // Login State
  const [loginInput, setLoginInput] = useState("");
  const [error, setError] = useState("");

  // Fetch Master User List for verification
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "users"), (snap) => {
      setMasterUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  // 1. Auto-Select Latest Event
  useEffect(() => {
    const q = query(
      collection(db, "events"),
      orderBy("scheduledAt", "desc"),
      limit(1),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const latestEvent = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setSelectedEventId(latestEvent.id);
        setCurrentEvent(latestEvent);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch Attendees for the auto-selected event
  useEffect(() => {
    if (!selectedEventId) return;
    const q = query(
      collection(db, "registrations"),
      where("eventId", "==", selectedEventId),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.checkedIn); // make sure to only pull checked-in attendees
      setAttendees(docs);

      if (myProfile) {
        const updatedMe = masterUsers.find((u) => u.id === myProfile.userId);
        setMyProfile(updatedMe);
      }
    });
    return () => unsubscribe();
  }, [selectedEventId, myProfile?.id]);

  // 3. Login Logic
  const handleVerifyIdentity = async (e) => {
    e.preventDefault();
    setError("");

    const input = loginInput.trim().toLowerCase();
    const cleanPhone = input.replace(/\D/g, "");

    // 1. Find ALL profiles that match the contact info
    const allMatchingUsers = masterUsers.filter((u) => {
      const userPhone = u.phone?.replace(/\D/g, "") || "";
      const userEmail = u.email?.toLowerCase() || "";
      return (
        input === userEmail || (cleanPhone !== "" && cleanPhone === userPhone)
      );
    });

    if (allMatchingUsers.length === 0) {
      setError("We couldn't find a profile with that info.");
      return;
    }

    // 2. Filter that list down to people actually registered for THIS event
    const registeredMatches = allMatchingUsers
      .map((u) => {
        const reg = attendees.find((r) => r.userId === u.id);
        return reg ? { ...reg, ...u, registrationId: reg.id } : null;
      })
      .filter(Boolean); // Removes nulls (unregistered matches)

    if (registeredMatches.length === 0) {
      setError(
        "Profile found, but no registration for this event was detected.",
      );
    } else if (registeredMatches.length === 1) {
      // Only one person? Log them in immediately
      setMyProfile(registeredMatches[0]);
    } else {
      // Multiple people? Show the selection modal
      setPotentialMatches(registeredMatches);
    }
  };

  // --- ADMIN ACTIONS ---
  const handleAdminSubmit = async () => {
    if (!adminTargetUser || !manualEntry.partnerId) return;

    try {
      const userRef = doc(db, "users", adminTargetUser.id);
      if (manualEntry.isPriority) {// need to make all other entries for this user non-priority if this one is marked as priority
        const existingFeedback = userRef.feedbackData || [];
        const updatedFeedback = existingFeedback.map((entry) => ({
          ...entry,
          isPriority: false, // reset all to non-priority
        }));
        await updateDoc(userRef, { feedbackData: updatedFeedback });
      }
      await updateDoc(userRef, {
        feedbackData: arrayUnion({
          event: selectedEventId,
          partnerName:
            masterUsers.find((u) => u.id === manualEntry.partnerId)?.firstName +
              " " +
              masterUsers.find((u) => u.id === manualEntry.partnerId)
                ?.lastName || "Unknown",
          partnerId: manualEntry.partnerId,
          interested: manualEntry.interest,
          isPriority: manualEntry.isPriority || false,
          optionalNotes: manualEntry.optionalNotes || "",
          round: manualEntry.round,
          tableNumber: "Admin Entry",
          timestamp: new Date(),
        }),
      });
      alert(`Entry saved for ${adminTargetUser.firstName}`);
      setAdminTargetUser(null);
    } catch (err) {
      console.error(err);
    }
  };

const tableGrid = useMemo(() => {
  // Helper to extract ONLY numbers from a string (e.g., "Table 5" becomes 5)
  const getOnlyNumber = (val) => {
    if (!val) return 0;
    const cleaned = String(val).replace(/\D/g, ""); // Remove everything that isn't a digit
    return parseInt(cleaned) || 0;
  };

  const checkedInUsers = masterUsers.filter((u) =>
    attendees.some((reg) => reg.userId === u.id)
  );

  // 1. Find the highest table number found in the registrations
  const maxTableFound = Math.max(
    ...attendees.map((a) => getOnlyNumber(a.tableNumber)),
    0
  );

  // 2. Set a minimum grid size (e.g., at least 6 tables) so it looks like a room
  const totalTables = Math.max(maxTableFound, 6); 

  const girlsRow = Array(totalTables).fill(null);
  const boysRow = Array(totalTables).fill(null);

  checkedInUsers.forEach((user) => {
    const reg = attendees.find((r) => r.userId === user.id);
    const tableNum = getOnlyNumber(reg?.tableNumber);
    
    // tableNum 1 goes into Index 0
    const tableIdx = tableNum - 1;

    if (tableIdx >= 0) {
      if (user.gender === "man") {
        boysRow[tableIdx] = { ...user, registration: reg };
      } else {
        girlsRow[tableIdx] = { ...user, registration: reg };
      }
    }
  });

  return { girlsRow, boysRow, tableCount: totalTables };
}, [masterUsers, attendees]);

  // Helper to render a table square
  const TableSquare = ({ person, tableNum, colorClass }) => (
    <div 
      onClick={() => person && setAdminTargetUser(person)}
      className={`relative h-24 w-full border-2 rounded-xl flex flex-col items-center justify-center p-2 transition-all cursor-pointer
        ${person 
          ? `${colorClass} border-transparent shadow-sm hover:scale-105` 
          : "border-dashed border-slate-200 bg-white opacity-40"}`}
    >
      <span className="absolute top-1 left-2 text-[10px] font-black opacity-30">
        T-{tableNum}
      </span>
      {person ? (
        <>
          <p className="text-xs font-bold text-center leading-tight">
            {person.firstName}
          </p>
          <div className="mt-1 flex gap-1">
             {person.feedbackData?.length > 0 && (
               <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
             )}
          </div>
        </>
      ) : (
        <span className="text-[10px] text-slate-300 font-bold uppercase">Empty</span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin mb-4" size={48} />
        <p className="text-slate-400 font-medium">Loading events...</p>
      </div>
    );
  }

  // --- VIEW: ADMIN DASHBOARD ---
  if (viewMode === "admin") {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-2xl font-black text-slate-900 uppercase">Control Room</h1>
              <p className="text-slate-500">{currentEvent?.name} • {attendees.length} Checked In</p>
            </div>
            <button
              onClick={() => setViewMode("user")}
              className="bg-slate-900 text-white px-6 py-2 rounded-full font-bold text-sm"
            >
              User View
            </button>
          </div>

          <div className="space-y-12">
            {/* GIRLS ROW */}
            <section>
              <h2 className="text-xs font-black text-pink-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-8 h-px bg-pink-200" /> Women's Row
              </h2>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                {tableGrid.girlsRow.map((person, idx) => (
                  <TableSquare 
                    key={`girl-${idx}`} 
                    person={person} 
                    tableNum={idx + 1} 
                    colorClass="bg-pink-100 text-pink-700"
                  />
                ))}
              </div>
            </section>

            {/* BOYS ROW */}
            <section>
              <h2 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-8 h-px bg-blue-200" /> Men's Row
              </h2>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                {tableGrid.boysRow.map((person, idx) => (
                  <TableSquare 
                    key={`boy-${idx}`} 
                    person={person} 
                    tableNum={idx + 1} 
                    colorClass="bg-blue-100 text-blue-700"
                  />
                ))}
              </div>
            </section>
          </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {masterUsers
              .filter((u) => attendees.some((reg) => reg.userId === u.id))
              .map((user) => {
                // 1. Find the specific registration record for this user
                const registration = attendees.find(
                  (reg) => reg.userId === user.id,
                );

                return (
                  <div
                    key={user.id}
                    className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg">
                          {user.firstName} {user.lastName}
                        </h3>
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-widest">
                          <span
                            className={
                              user.gender === "man"
                                ? "text-blue-600"
                                : "text-pink-500"
                            }
                          >
                            {user.gender}
                          </span>{" "}
                          • Age {user.age}
                        </p>
                      </div>
                      <button
                        onClick={() => setAdminTargetUser(user)}
                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                      >
                        <ClipboardEdit size={20} />
                      </button>
                    </div>
                    <div className="text-xs text-slate-500">
                      Starting Table: {registration.tableNumber || "N/A"}
                    </div>
                    <div className="text-xs text-slate-500">
                      Feedback recorded: {user.feedbackData?.length || 0} rounds
                    </div>
                  </div>
                );
              })}
          </div>
      </div>

        {/* MANUAL ENTRY MODAL */}
        {adminTargetUser && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
              <h2 className="text-xl font-bold mb-1 text-slate-900">
                Manual Entry
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Recording response for{" "}
                <b className="text-slate-900">
                  {adminTargetUser.firstName} {adminTargetUser.lastName}
                </b>
              </p>

              <div className="space-y-4">
                {/* PARTNER SELECT */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Met with (Partner Name)
                  </label>
                  <select
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    value={manualEntry.partnerId || ""}
                    onChange={(e) =>
                      setManualEntry({
                        ...manualEntry,
                        partnerId: e.target.value,
                      })
                    }
                  >
                    <option value="">Select Partner...</option>
                    {masterUsers
                      .filter((u) => u.gender !== adminTargetUser.gender)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.firstName} {p.lastName}
                        </option>
                      ))}
                  </select>
                </div>

                {/* RESPONSE BUTTONS */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Response
                  </label>
                  <div className="flex gap-2">
                    {["yes", "maybe", "no"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() =>
                          setManualEntry({ ...manualEntry, interest: opt })
                        }
                        className={`flex-1 py-3 rounded-xl font-bold capitalize border-2 transition-all ${
                          manualEntry.interest === opt
                            ? "border-blue-600 bg-blue-50 text-blue-600"
                            : "border-slate-100 text-slate-400"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PRIORITY TOGGLE */}
                {manualEntry.interest === "yes" && (
                  <div className="mt-4">
                    <button
                      onClick={() =>
                        setManualEntry({
                          ...manualEntry,
                          isPriority: !manualEntry.isPriority,
                        })
                      }
                      className={`w-full py-2 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                        manualEntry.isPriority
                          ? "border-amber-500 bg-amber-50 text-amber-600"
                          : "border-slate-100 text-slate-400"
                      }`}
                    >
                      <span>⭐</span>
                      {manualEntry.isPriority
                        ? "Priority Selection"
                        : "Mark as Priority?"}
                    </button>
                  </div>
                )}

                {/* ADDITIONAL NOTES */}
                <div className="mt-4">
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Additional Notes
                  </label>
                  <textarea
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    rows={3}
                    placeholder="Any specific feedback or observations..."
                    value={manualEntry.optionalNotes || ""}
                    onChange={(e) =>
                      setManualEntry({
                        ...manualEntry,
                        optionalNotes: e.target.value,
                      })
                    }
                  />
                </div>

                {/* ACTION BUTTONS */}
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => setAdminTargetUser(null)}
                    className="flex-1 py-4 font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdminSubmit}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 active:scale-95 transition-transform"
                  >
                    Save Entry
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  {/* IDENTITY SELECTION MODAL */}
  if (potentialMatches.length > 1) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100]">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
          <h2 className="text-2xl font-black mb-2 text-slate-900">
            Which one is you?
          </h2>
          <p className="text-slate-500 mb-6 font-medium">
            Multiple people are registered under this{" "}
            {loginInput.includes("@") ? "email" : "number"}.
          </p>

          <div className="space-y-3">
            {potentialMatches.map((match) => (
              <button
                key={match.id}
                onClick={() => {
                  setMyProfile(match);
                  setPotentialMatches([]); // Close modal
                }}
                className="w-full p-5 border-2 border-slate-100 rounded-2xl flex justify-between items-center hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
              >
                <div>
                  <p className="font-bold text-lg text-slate-900">
                    {match.firstName} {match.lastName}
                  </p>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    {match.gender} • Age {match.age}
                  </p>
                </div>
                <ArrowRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setPotentialMatches([])}
            className="w-full mt-6 py-4 font-bold text-slate-400 text-sm uppercase tracking-widest"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // --- PHASE 1: LOGIN MODAL ---
  if (!myProfile) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-lg">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-slate-900 mb-2">
              Event Login
            </h1>
            <p className="text-slate-500 font-medium">
              {currentEvent
                ? `Welcome to ${currentEvent.name}`
                : "No event selected. Please contact the organizer."}
            </p>
          </div>

          <form onSubmit={handleVerifyIdentity} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Email or Mobile Number
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="Enter Email/Number used at signup"
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:ring-0 transition-all text-lg font-medium"
                  required
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2 text-slate-300">
                  <Mail size={20} />
                  <Smartphone size={20} />
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white p-5 rounded-2xl font-bold text-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-3 group"
            >
              Verify & Start
              <ArrowRight className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <button
            onClick={() => setViewMode("admin")}
            className="w-full mt-8 flex items-center justify-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-blue-600 transition-colors"
          >
            <ShieldCheck size={14} /> Admin Access
          </button>
        </div>
      </div>
    );
  }

  // --- PHASE 2: THE LOBBY (WAITING FOR ADMIN) ---
  if (currentEvent && !currentEvent.active) {
    return (
      <div className="min-h-screen bg-blue-900 flex flex-col items-center justify-center text-white p-10 text-center">
        <div className="animate-bounce mb-8">
          <Clock size={80} strokeWidth={1} />
        </div>
        <h1 className="text-4xl font-black mb-4">
          Hi, {myProfile.firstName} {myProfile.lastName}!
        </h1>
        <p className="text-xl text-blue-200 max-w-md">
          You're all set. Please wait comfortably. The event will begin shortly.
        </p>
        <div className="mt-12 flex items-center gap-2 bg-blue-800 px-6 py-3 rounded-full">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-sm font-bold tracking-widest uppercase">
            Connection Active
          </span>
        </div>
      </div>
    );
  }

  // --- PHASE 3: LIVE ROUNDS ---
  return (
    <LiveRoundView
      event={currentEvent}
      user={myProfile}
      attendees={attendees}
      users={masterUsers}
    />
  );
}
