import { useState, useEffect, useRef, use, act } from "react";
import { db } from "./firebase";
import { doc, setDoc, arrayUnion } from "firebase/firestore";
import {
  MapPin,
  PartyPopper,
  Maximize,
  Star,
  AlertCircle,
  Pause,
} from "lucide-react";

export default function LiveRoundView({ event, user, attendees, users }) {
  // Event has the Event collection table, User has the current user profile from the users collection, Attendees is the list of checked-in attendees for this event based on the registrations collection, and Users is the master list of all users from the users table (for partner lookup)
  const [now, setNow] = useState(new Date());
  const [hasStarted, setHasStarted] = useState(false);
  const [decisionMade, setDecisionMade] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [pendingSelection, setPendingSelection] = useState(null); // yes, maybe, no
  const [isPriority, setIsPriority] = useState(false); // Track if current 'yes' is a priority
  const [showPriorityConfirm, setShowPriorityConfirm] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tableAnswer, setTableAnswer] = useState("");
  const [optionalNotes, setOptionalNotes] = useState("");
  const containerRef = useRef(null);
  const debugging = false; // Set to true to show the debug overlay
  const [showDebug, setShowDebug] = useState(false);

  // This logic runs every time the partner changes
  // --- COMPATIBILITY FILTER ---
  const checkCompatibility = (me, partner) => {
    if (!partner) return false;

    // If user is a male Kohen and partner is female divorced, return false
    if (
      me.isKohen === true &&
      me.gender === "man" &&
      partner.gender === "woman" &&
      partner.maritalStatus === "Divorced"
    ) {
      console.log(
        me.firstName +
          " " +
          me.lastName +
          " is a Kohen and " +
          partner.firstName +
          " " +
          partner.lastName +
          " is divorced. Not a match. Skipping.",
      );
      return false;
    }

    // Add more filters here as needed, such as age range, shared interests, etc.

    // If all checks pass, it's a valid shidduch
    return true;
  };

  // --- 1. PRIORITY LOGIC ---
  // Find if the user has already prioritized someone in this specific event
  const existingPriorityMatch = user.feedbackData?.find(
    (f) => f.event === event.id && f.priority === true,
  );

  const handlePriorityToggle = () => {
    // If turning on and someone else is already prioritized
    if (!isPriority && existingPriorityMatch) {
      setShowPriorityConfirm(true);
    } else {
      setIsPriority(!isPriority);
    }
  };

  const formatTime = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0 && seconds > 0) {
      return `${minutes} minute${minutes > 1 ? "s" : ""} and ${seconds} second${seconds !== 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? "s" : ""}`;
    } else {
      return `${seconds} second${seconds !== 1 ? "s" : ""}`;
    }
  };

  const confirmPrioritySwitch = () => {
    setIsPriority(true);
    setShowPriorityConfirm(false);
  };

  // Toggle Fullscreen Function
  const enterFullscreen = () => {
    if (containerRef.current.requestFullscreen) {
      containerRef.current.requestFullscreen();
    } else if (containerRef.current.webkitRequestFullscreen) {
      /* iPad Safari */
      containerRef.current.webkitRequestFullscreen();
    }
    setIsFullscreen(true);
    setHasStarted(true);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      // Check if any element is currently in fullscreen
      const isActuallyFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );

      setIsFullscreen(isActuallyFullscreen);
    };

    // Listen for the event on the document
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange); // For Safari/iPad
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "mozfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "MSFullscreenChange",
        handleFullscreenChange,
      );
    };
  }, []);

  useEffect(() => {
    const hasEmail = !!user.email;
    setShowEmailModal(!hasEmail);
  }, [user.email]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!event || !event.startTime)
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="animate-pulse">Initializing Event...</p>
      </div>
    );

  // --- 1. PARSE USER TABLE & GROUP ---
  // Safely find the user, or fall back to the 'user' object if they aren't in the checked-in array
  const userInfoForThisEvent = attendees.find((a) => a.userId === (user.userId || user.id)) || user;
  console.log(userInfoForThisEvent);
  const groupName = userInfoForThisEvent?.groupId || "Group Not Found";
  const startTableNum = userInfoForThisEvent?.tableNumber || 0;
  console.log("User's starting table number:", startTableNum);

  // --- 2. DYNAMIC GROUP MATH ---
  // Filter attendees to ONLY those in this user's group (e.g., "YP")
  const groupAttendees = attendees.filter((a) => {
    const aGroup = a.groupId || "Group Not Found";
    return aGroup.toLowerCase() === groupName.toLowerCase();
  });

  // Calculate unique tables in this specific group
  const uniqueTablesInGroup = [
    ...new Set(groupAttendees.map((a) => a.tableNumber)),
  ];

  const totalTablesInGroup =
    uniqueTablesInGroup.length >= 1
      ? uniqueTablesInGroup.length
      : event.totalTables || 10; // Fallback to event setting if group detection fails

// --- 3. MATH & STOP LOGIC ---
  const startTime = event.startTime.toDate();
  const effectiveNow = event.isPaused ? event.pausedAt.toDate() : now;
  const secondsSinceStart = Math.floor((effectiveNow - startTime) / 1000);

  const startBuffer = 60; 
  const moveBuffer = 120; 
  const roundTimeSeconds = (event.roundTime || 7) * 60;
  const roundLengthPlusMove = roundTimeSeconds + moveBuffer;

  const isEventStarting = secondsSinceStart < startBuffer;
  const secondsAfterStart = secondsSinceStart - startBuffer;

  // Calculate the raw round, then CAP IT at the max number of tables
  const rawRound = isEventStarting
    ? 1
    : Math.floor(secondsAfterStart / roundLengthPlusMove) + 1;
    
  const currentRound = Math.min(rawRound, totalTablesInGroup);

  const timeInCurrentBlock = isEventStarting
    ? 0
    : secondsAfterStart % roundLengthPlusMove;

  const isLastRound = currentRound === totalTablesInGroup;
  
  // We determine if it's over if the raw mathematical round exceeds our max tables,
  // OR if we are in the last round and the dating time has expired.
  const isEventOver =
    rawRound > totalTablesInGroup ||
    (isLastRound && timeInCurrentBlock >= roundTimeSeconds);

  const isMoving =
    !isEventStarting && !isEventOver && timeInCurrentBlock >= roundTimeSeconds;

  const secondsLeft = isEventStarting
    ? startBuffer - secondsSinceStart
    : isMoving
      ? roundLengthPlusMove - timeInCurrentBlock
      : isEventOver
        ? 0
        : roundTimeSeconds - timeInCurrentBlock;

  // --- 4. TABLE ROTATION ---
  let activeNum = startTableNum;
  if (user.gender === "man") {
    // Man rotates: (Start + RoundOffset) % Total
    activeNum =
      ((startTableNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
    console.log(
      "Current round:",
      currentRound,
      " | User is a man, so active table is:",
      activeNum,
    );
  }

  const nextNum =
    user.gender === "man"
      ? ((startTableNum + currentRound - 1) % totalTablesInGroup) + 1
      : startTableNum;

  // Re-construct the strings for the UI and Matching
  const activeRoundTable = `Table ${activeNum} - ${groupName}`;
  const tableToShow = isMoving
    ? `Table ${nextNum} - ${groupName}`
    : activeRoundTable;

  // reset decision state when state changes
  useEffect(() => {
    setDecisionMade(false);
    setPendingSelection(null);
    setOptionalNotes("");
    setIsPriority(false);
  }, [currentRound]);

  // --- 5. PARTNER MATCHING ---
  const matchedAttendee = attendees.find((a) => {
    const attendeeUser = users.find((u) => u.id === a.userId);

    // Safety check: If for some reason the user ID in attendees
    // doesn't exist in the master users list, skip them.
    if (!attendeeUser) return false;

    // 1. Gender check
    if (attendeeUser.gender === user.gender) return false;

    // 2. Group check
    if (!a.groupId.toLowerCase().includes(groupName.toLowerCase()))
      return false;

    // 3. Table Calculation
    const pStartNum = a.tableNumber || 0;
    let pCurrentNum = pStartNum;

    if (attendeeUser.gender === "man") {
      pCurrentNum =
        ((pStartNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
    }

    // 4. Comparison
    return pCurrentNum === activeNum;
  });

  // Use optional chaining so partnerId is simply undefined if no match is found
  const partnerId = matchedAttendee?.userId;
  console.log("Calculated partner ID:", partnerId);

  const partner = partnerId ? users.find((u) => u.id === partnerId) : null;

  // Check if this partner meets our criteria
  const isMatch = partner ? checkCompatibility(user, partner) : true;

  console.log(
    "Round " +
      currentRound +
      " | Active Table: " +
      activeRoundTable +
      " | Partner: " +
      partner?.firstName +
      " " +
      partner?.lastName,
  );

  // --- HANDLERS ---
  const handleInterestedSelection = (type) => {
    setPendingSelection(type);
    if (type !== "yes") setIsPriority(false); // Can't prioritize a 'maybe' or 'no'
  };

  const saveInformationAndContinue = async () => {
    if (pendingSelection === "no") {
      setDecisionMade(true);
      setPendingSelection(null);
      setOptionalNotes("");
      setIsPriority(false);
      return;
    }

    const myRef = doc(db, "users", user.userId || user.id);
    const newEntry = {
      event: event.id,
      partnerId: partner.id,
      partnerName: `${partner.firstName} ${partner.lastName}`,
      interested: pendingSelection,
      isPriority: isPriority,
      tableNumber: activeRoundTable,
      round: currentRound,
      optionalNotes: optionalNotes,
      timestamp: new Date(),
    };

    try {
      // 1. Get existing feedback or default to empty array
      let currentFeedback = user.feedbackData || [];

      // 2. Clear existing priority for this event if the new entry is priority
      if (isPriority) {
        currentFeedback = currentFeedback.map((f) =>
          f.event === event.id ? { ...f, priority: false } : f,
        );
      }

      // 3. Find if an entry for this partner already exists in this event
      const existingIndex = currentFeedback.findIndex(
        (f) => f.event === event.id && f.partnerId === partner.id,
      );

      let finalFeedback;
      if (existingIndex > -1) {
        // UPDATE: Replace the existing entry with the new one
        finalFeedback = [...currentFeedback];
        finalFeedback[existingIndex] = newEntry;
      } else {
        // ADD: Append the new entry
        finalFeedback = [...currentFeedback, newEntry];
      }

      // 4. Prepare the payload
      const updatePayload = {
        feedbackData: finalFeedback,
      };

      // if (pendingSelection === "yes")
      //   updatePayload.selections = arrayUnion(partner.id);
      // if (pendingSelection === "maybe")
      //   updatePayload.maybeSelections = arrayUnion(partner.id);
      if (emailInput) updatePayload.email = emailInput;

      // 5. Save to Firestore (Creates the document if it's missing)
      await setDoc(myRef, updatePayload, { merge: true });

      // Reset local UI states
      setDecisionMade(true);
      setPendingSelection(null);
      setOptionalNotes("");
      setIsPriority(false);
    } catch (err) {
      console.error("Error saving feedback:", err);
      console.log("Feedback data:", newEntry);
      alert("Check your internet connection; feedback didn't save.");
    }
  };

  // --- UI COMPONENTS ---
  // --- 4. THE RENDERER ---
  const renderMainContent = () => {
    // A. GATEKEEPER: Only show if it's the start phase AND they haven't clicked yet
    if (isEventStarting && !isFullscreen && !hasStarted) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          <h1 className="text-4xl text-[#1E3D34] font-black mb-8">
            Event in Progress
          </h1>
          <button
            onClick={enterFullscreen}
            className="flex items-center gap-4 bg-[#1E3D34] px-12 py-6 rounded-3xl text-3xl text-white font-bold shadow-2xl active:scale-95 transition-transform"
          >
            <Maximize size={40} /> Enter Fullscreen to Begin
          </button>
        </div>
      );
    }

    if (event.isPaused) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center animate-in zoom-in-95 duration-500">
          {/* 1. Use a more sophisticated container for the icon */}
          <div className="relative mb-10">
            <div className="absolute inset-0 bg-[#EAB308]/20 rounded-full blur-2xl animate-pulse" />
            <div className="relative bg-white/50 p-8 rounded-full border-4 border-white shadow-xl">
              <Pause size={80} className="text-[#EAB308]" />
            </div>
            {/* Status indicator pill */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#1E3D34] text-white text-xs px-4 py-1 rounded-full font-bold uppercase tracking-widest shadow-lg">
              Paused
            </div>
          </div>

          {/* 2. Clear, high-contrast headings */}
          <h1 className="text-4xl md:text-5xl font-black text-[#1E3D34] mb-4 uppercase tracking-tight">
            Event Paused
          </h1>
          <p className="text-xl text-[#1E3D34]/70 max-w-sm leading-relaxed font-medium">
            Please stay nearby. The event will resume soon.
          </p>

          {/* 3. Small visual cue that the app is still active */}
          <div className="mt-12 flex items-center gap-2 opacity-50">
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-ping" />
            <span className="text-xs font-bold uppercase tracking-widest text-[#1E3D34]">
              Live Event Sync Active
            </span>
          </div>
        </div>
      );
    }

    // B. EVENT OVER
    if (isEventOver) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          {decisionMade || !partner || !isMatch ? (
            <div className="text-center">
              <div className="animate-bounce text-center">
                <PartyPopper
                  size={100}
                  className="text-yellow-400 mx-auto mb-4"
                />
                <h1 className="text-6xl font-black">All Done!</h1>
              </div>
              <p className="text-2xl text-[#1E3D34] mt-4">
                Thanks for joining us tonight. Keep an eye on your email for
                match updates.
              </p>
            </div>
          ) : (
            renderFeedbackForm()
          )}
        </div>
      );
    }

    // C. STARTING BUFFER
    if (isEventStarting) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center animate-in fade-in duration-700">
          <MapPin size={80} className="mb-6 animate-bounce text-[#1E3D34]" />
          <h1 className="text-4xl md:text-5xl text-[#1E3D34] font-black mb-8 uppercase tracking-tight">
            Your Starting Table
          </h1>

          {/* THE FIX: Added bg-white, a subtle border, and adjusted the border radius/padding */}
          <div className="bg-white text-[#1E3D34] rounded-[3rem] px-16 py-12 shadow-2xl border-4 border-white/50 relative overflow-hidden">
            <p className="text-8xl md:text-9xl font-black leading-none drop-shadow-sm">
              {startTableNum}
            </p>
            <p className="text-xl md:text-2xl font-bold mt-4 uppercase tracking-widest text-[#1E3D34]/70">
              {groupName}
            </p>
          </div>

          {/* THE TIMER: Wrapped in a dark pill to contrast heavily against the light background */}
          <div className="mt-12 bg-[#1E3D34] text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3">
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
            <p className="text-lg font-bold tracking-widest">
              STARTING IN {secondsLeft}s
            </p>
          </div>
        </div>
      );
    }

    // D. MOVING / DECISION PHASE
    if (isMoving) {
      return (
        <div className="w-full max-w-xl mx-auto flex flex-col items-center justify-center p-6 text-center">
          {/* Skip feedback if decision made, no partner found, or partner was not a match */}
          {decisionMade || !partner || !isMatch ? (
            <>
              <h1 className="text-4xl text-[#1E3D34] font-black mb-12 uppercase">
                {user.gender === "woman" ? "Stay at Table" : "Move to Table"}
              </h1>
              <div className="text-slate-900 rounded-full w-64 h-64 flex flex-col items-center justify-center mb-8 mx-auto border-12 border-[#1E3D34]">
                <p className="text-9xl text-[#1E3D34] font-black leading-none">
                  {nextNum}
                </p>
              </div>
              <p className="text-xl text-[#1E3D34] font-bold mb-4">
                {groupName}
              </p>
              <p className="text-3xl text-[#1E3D34] font-mono">
                Next Round: {formatTime(secondsLeft)}
              </p>
            </>
          ) : (
            renderFeedbackForm()
          )}
        </div>
      );
    }

    // E. ACTIVE DATING OR BREAK PHASE
    if (!partner || !isMatch) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
          <Coffee size={100} className="text-[#1E3D34] mb-8 animate-pulse" />
          <h2 className="text-6xl font-black mb-4 italic text-white">
            Short Break
          </h2>
          <p className="text-2xl text-[#1E3D34] max-w-md leading-relaxed">
            No match this round. Please stay nearby. The next round will begin
            shortly.
          </p>
          <div className="mt-12 bg-slate-800 px-10 py-5 rounded-full border border-slate-700">
            <p className="text-4xl font-mono font-bold text-white">
              {formatTime(secondsLeft)}
            </p>
          </div>
          <p className="mt-6 text-slate-500 font-bold uppercase tracking-widest">
            Table {activeNum}
          </p>
        </div>
      );
    }

    // F. STANDARD DATING PHASE
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-12">
          <p className="text-black font-black uppercase text-sm mb-2">
            Round {currentRound} of {totalTablesInGroup}
          </p>
          <div className="inline-block px-6 py-2 bg-slate-800 rounded-full border border-slate-700 text-xl text-white font-bold">
            Table {activeNum} <span className="text-slate-500 mx-2">|</span>{" "}
            {groupName}
          </div>
        </div>
        <p className="text-slate-500 uppercase font-bold mb-4 tracking-[0.3em]">
          Talking to
        </p>
        <h2 className="text-8xl font-black mb-12 tracking-tighter">
          {partner?.firstName + " " + partner?.lastName}
        </h2>
        <div className="bg-slate-800 px-16 py-8 rounded-[3rem] border-2 border-slate-700 shadow-2xl">
          <p className="text-7xl font-mono font-bold text-white">
            {Math.floor(secondsLeft / 60)}:
            {(secondsLeft % 60).toString().padStart(2, "0")}
          </p>
        </div>
      </div>
    );
  };

  const renderFeedbackForm = () => (
    <div className="w-full max-w-xl text-center">
      <h1 className="text-5xl font-black mb-12 text-white">
        How was {partner?.firstName + " " + partner?.lastName}?
      </h1>

      <div className="flex flex-col gap-4">
        {/* Interest Buttons */}
        <button
          onClick={() => setPendingSelection("yes")}
          className={`py-6 rounded-2xl text-3xl font-black border-2 transition-all ${
            pendingSelection === "yes"
              ? "bg-green-500 border-[#1E3D34] text-white"
              : "bg-white border-transparent text-[#1E3D34]"
          }`}
        >
          Interested
        </button>

        {pendingSelection === "yes" && (
          <button
            onClick={handlePriorityToggle}
            className={`py-4 rounded-xl border-2 flex items-center justify-center gap-3 transition-all ${isPriority ? "bg-yellow-500 border-yellow-400 text-white" : "border-slate-600 text-slate-400"}`}
          >
            <Star fill={isPriority ? "white" : "none"} />{" "}
            {isPriority ? "PRIORITY PICK" : "MAKE PRIORITY?"}
          </button>
        )}

        <button
          onClick={() => setPendingSelection("maybe")}
          className={`py-6 rounded-2xl text-3xl font-black border-2 transition-all ${
            pendingSelection === "maybe"
              ? "bg-[#95B699] border-[#1E3D34] text-[#1E3D34]"
              : "bg-white border-transparent text-[#1E3D34]"
          }`}
        >
          Maybe
        </button>

        <button
          onClick={() => setPendingSelection("no")}
          className={`py-4 rounded-2xl text-xl font-bold border-2 transition-all ${
            pendingSelection === "no"
              ? "bg-red-400 border-[#1E3D34] text-white"
              : "bg-white border-transparent text-[#1E3D34]"
          }`}
        >
          No thanks
        </button>

        {/* --- OPTIONAL NOTES AREA --- */}
        <div className="mt-4 text-left">
          <label className="text-xs font-bold uppercase text-slate-500 ml-2 mb-1 block tracking-widest">
            Private Notes (Optional)
          </label>
          <textarea
            className="w-full p-4 bg-slate-800 border-2 border-slate-700 rounded-2xl text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none transition-all"
            rows={3}
            placeholder="Anything you want to remember about this person..."
            value={optionalNotes}
            onChange={(e) => setOptionalNotes(e.target.value)}
          />
        </div>

        <button
          onClick={saveInformationAndContinue}
          disabled={!pendingSelection}
          className={`mt-8 py-5 rounded-2xl font-black text-2xl transition-all ${!pendingSelection ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-blue-600 text-white shadow-lg shadow-blue-900/20"}`}
        >
          Submit Selection
        </button>
      </div>
    </div>
  );

  const DebugOverlay = () => (
    <div className="fixed bottom-4 right-4 z-9999 flex flex-col items-end gap-2">
      {showDebug && (
        <div className="bg-black/90 border border-slate-700 p-4 rounded-2xl text-[10px] font-mono text-green-400 shadow-2xl w-64 backdrop-blur-md">
          <h3 className="font-bold border-b border-slate-800 pb-1 mb-2 text-white uppercase tracking-widest text-[8px]">
            System Diagnostics
          </h3>
          <p>
            <span className="text-slate-500">User Name:</span> {user.firstName}{" "}
            {user.lastName}
          </p>
          <p>
            <span className="text-slate-500">My Group:</span> {groupName}
          </p>
          <p>
            <span className="text-slate-500">Total Tables:</span>{" "}
            {totalTablesInGroup}
          </p>
          <p>
            <span className="text-slate-500">Current Round:</span>{" "}
            {currentRound} / {totalTablesInGroup}
          </p>
          <p>
            <span className="text-slate-500">Time State:</span>{" "}
            {isEventStarting
              ? "PREP"
              : isMoving
                ? "MOVING"
                : isEventOver
                  ? "OVER"
                  : "ACTIVE"}
          </p>
          <p>
            <span className="text-slate-500">Sec Left:</span> {secondsLeft}s
          </p>
          <hr className="my-2 border-slate-800" />
          <p>
            <span className="text-slate-500">My Start Pos:</span>{" "}
            {startTableNum}
          </p>
          <p>
            <span className="text-slate-500">My Current Table:</span>{" "}
            {activeNum}
          </p>
          <hr className="my-2 border-slate-800" />
          <p>
            <span className="text-slate-500">Partner Found:</span>{" "}
            {partner ? partner.firstName + " " + partner.lastName : "❌ NONE"}
          </p>
          <p>
            <span className="text-slate-500">Compatibility:</span>{" "}
            {isMatch ? "✅ PASS" : "⚠️ FAIL/NONE"}
          </p>
          <p>
            <span className="text-slate-500">Decision:</span>{" "}
            {decisionMade ? "DONE" : "PENDING"}
          </p>
        </div>
      )}
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="bg-slate-800/50 hover:bg-slate-700 p-2 rounded-full text-slate-500 transition-colors"
        title="Toggle Debug"
      >
        <AlertCircle size={16} />
      </button>
    </div>
  );

  // --- FINAL RETURN: THE SHELL ---
  return (
    <div
      ref={containerRef}
      className={`relative w-full flex-1 flex flex-col items-center justify-center ${
        isFullscreen
          ? // Lock it to the screen and apply the STANDARD background when fullscreen
            "fixed inset-0 z-50 bg-linear-to-b from-[#95B699] from-0% to-[#dde7de] to-20% overflow-y-auto"
          : ""
      }`}
    >
      {renderMainContent()}

      {/* SUBTLE FULLSCREEN RESTORE BUTTON (Bottom-Left) */}
      {hasStarted && !isFullscreen && (
        <button
          onClick={enterFullscreen}
          className="fixed bottom-6 left-6 p-4 bg-slate-800/80 hover:bg-slate-700 text-slate-400 rounded-full border border-slate-700 shadow-xl transition-all z-50 animate-in fade-in slide-in-from-bottom-4"
          title="Restore Fullscreen"
        >
          <Maximize size={24} />
        </button>
      )}

      {/* GLOBAL MODALS */}
      {showPriorityConfirm && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-6 z-100 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-yellow-500 p-8 rounded-3xl w-full max-w-md text-center">
            <AlertCircle size={60} className="text-yellow-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-4">
              Switch Priority?
            </h2>
            <p className="text-slate-400 mb-8">
              You already prioritized {existingPriorityMatch?.partnerName}.
              Switch to {partner?.firstName + " " + partner?.lastName}?
            </p>
            <button
              onClick={() => {
                setIsPriority(true);
                setShowPriorityConfirm(false);
              }}
              className="w-full py-4 bg-yellow-500 text-black rounded-xl font-black uppercase mb-3"
            >
              Yes, Switch
            </button>
            <button
              onClick={() => setShowPriorityConfirm(false)}
              className="w-full py-4 text-slate-400 font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {debugging && <DebugOverlay />}
    </div>
  );
}
