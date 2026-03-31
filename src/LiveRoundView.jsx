import { useState, useEffect, useRef, use, act } from "react";
import { db } from "./firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import {
  MapPin,
  PartyPopper,
  Maximize,
  Star,
  AlertCircle,
  Coffee,
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
  const debugging = true; // Set to true to show the debug overlay
  const [showDebug, setShowDebug] = useState(false);

  // This logic runs every time the partner changes
  // --- COMPATIBILITY FILTER ---
  const checkCompatibility = (me, partner) => {
    if (!partner) return false;

    // If user is a male Kohen and partner is female divorced, return false
    if (
      me.isKohen &&
      me.gender === "man" &&
      partner.gender === "woman" &&
      partner.maritalStatus === "Divorced"
    ) {
      console.log("Kohen compatibility failed.");
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

  // Add this inside your LiveRoundView component
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
  // Logic: "Table 1 - YP" -> "Table 1" and "YP"
  const userInfoForThisEvent = attendees.find((a) => a.userId === user.id);
  console.log(userInfoForThisEvent);
  console.log("User's table number string:", userInfoForThisEvent.tableNumber);
  const tableString = userInfoForThisEvent.tableNumber || "Table 1 - Default";
  const tableParts = tableString.split(" - ");
  console.log("Parsed table parts:", tableParts);
  const tablePart = tableParts[0] || "Table 1";
  const groupName = tableParts[1] || "Default"; // Ensure groupName isn't undefined
  const startTableNum = parseInt(tablePart.replace("Table ", ""), 10) || 1;
  console.log("User's starting table number:", startTableNum);

  // --- 2. DYNAMIC GROUP MATH ---
  // Filter attendees to ONLY those in this user's group (e.g., "YP")
  const groupAttendees = attendees.filter((a) => {
    const aTable = a.tableNumber || "";
    return aTable.toLowerCase().includes(`- ${groupName.toLowerCase()}`);
  });

  // Calculate unique tables in this specific group
  const uniqueTablesInGroup = [
    ...new Set(groupAttendees.map((a) => a.tableNumber)),
  ];

  // CRITICAL FIX: If we can't find any other tables, we check the event settings
  // or default to a reasonable number to prevent immediate event ending.
  const totalTablesInGroup =
    uniqueTablesInGroup.length > 1
      ? uniqueTablesInGroup.length
      : event.maxRounds || 10; // Fallback to event setting if group detection fails

  // --- 3. MATH & STOP LOGIC ---
  const startTime = event.startTime.toDate();
  // If paused, we calculate time based on when the pause started
// If not paused, we use the current time (now)
  const effectiveNow = event.isPaused ? event.pausedAt.toDate() : now;
  const secondsSinceStart = Math.floor((effectiveNow - startTime) / 1000);
  const prepBuffer = 60; // 1 minute buffer at the start before any rounds begin to allow people to find their tables and get settled
  const roundTimeSeconds = (event.roundTime || 7) * 60;
  const roundLengthPlusMove = roundTimeSeconds + prepBuffer;

  const isEventStarting = secondsSinceStart < prepBuffer;
  const secondsAfterPrep = secondsSinceStart - prepBuffer;

  // Determine current round
  const currentRound = isEventStarting
    ? 1
    : Math.floor(secondsAfterPrep / roundLengthPlusMove) + 1;

  // We use the total potential rounds to decide when the event is "Over"
  const totalPotentialRounds = totalTablesInGroup;

  const timeInCurrentBlock = isEventStarting
    ? 0
    : secondsAfterPrep % roundLengthPlusMove;

  const isLastRound = currentRound === totalPotentialRounds;
  const isEventOver =
    currentRound > totalPotentialRounds ||
    (isLastRound && timeInCurrentBlock >= roundTimeSeconds);
  const isMoving =
    !isEventStarting && !isEventOver && timeInCurrentBlock >= roundTimeSeconds;

  // Reset local decision state for the new round
  useEffect(() => {
    if (!isEventOver) {
      setDecisionMade(false);
    }
    setIsPriority(false); // Reset priority toggle for the new person
    setOptionalNotes("");
  }, [currentRound]);

  const secondsLeft = isEventStarting
    ? prepBuffer - secondsSinceStart
    : isMoving
      ? roundLengthPlusMove - timeInCurrentBlock
      : isEventOver
        ? 0
        : roundTimeSeconds - timeInCurrentBlock;

  // --- 4. TABLE ROTATION (STRING AWARE) ---
  let activeNum = startTableNum;
  if (user.gender === "man") {
    // Man rotates: (Start + RoundOffset) % Total
    activeNum =
      ((startTableNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
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

  useEffect(() => {
    setDecisionMade(false);
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
  const pTableString = a.tableNumber || "";
  if (!pTableString.toLowerCase().includes(`- ${groupName.toLowerCase()}`))
    return false;

  // 3. Table Calculation
  const pTablePart = pTableString.split(" - ")[0] || "Table 1";
  const pStartNum = parseInt(pTablePart.replace("Table ", ""), 10) || 1;
  let pCurrentNum = pStartNum;

  if (attendeeUser.gender === "man") {
    pCurrentNum = ((pStartNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
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
    // if (tableAnswer !== String(tableToShow)) {
    //   alert("Please enter the correct table number.");
    //   return;
    // }
  if (pendingSelection === "no") {
    setDecisionMade(true);
    return;
  }

  const myRef = doc(db, "users", user.id);
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
        f.event === event.id ? { ...f, priority: false } : f
      );
    }

    // 3. Find if an entry for this partner already exists in this event
    const existingIndex = currentFeedback.findIndex(
      (f) => f.event === event.id && f.partnerId === partner.id
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
      feedbackData: finalFeedback
    };
    
      // if (pendingSelection === "yes")
      //   updatePayload.selections = arrayUnion(partner.id);
      // if (pendingSelection === "maybe")
      //   updatePayload.maybeSelections = arrayUnion(partner.id);
    if (emailInput) updatePayload.email = emailInput;

    // 5. Save to Firestore
    await updateDoc(myRef, updatePayload);

    // Reset local UI states
    setDecisionMade(true);
    setPendingSelection(null);
    setOptionalNotes("");
    setIsPriority(false);
  } catch (err) {
    console.error("Error saving feedback:", err);
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
          <h1 className="text-4xl font-black mb-8">Ready to Start?</h1>
          <button
            onClick={enterFullscreen}
            className="flex items-center gap-4 bg-blue-600 px-12 py-6 rounded-3xl text-3xl font-bold shadow-2xl active:scale-95 transition-transform"
          >
            <Maximize size={40} /> Enter Fullscreen
          </button>
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
              <p className="text-2xl text-slate-400 mt-4">
                Thanks for participating in this event. We hope you had a great
                time and made some meaningful connections.
              </p>
            </div>
          ) : (
            <FeedbackForm />
          )}
        </div>
      );
    }

    // C. STARTING BUFFER
    if (isEventStarting) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          <MapPin size={80} className="mb-6 animate-bounce text-white" />
          <h1 className="text-5xl font-black mb-4 uppercase">
            Find Your Table
          </h1>
          <div className="bg-white text-blue-700 rounded-3xl p-10 shadow-2xl">
            <p className="text-9xl font-black">{startTableNum}</p>
            <p className="text-xl font-bold mt-2">{groupName}</p>
          </div>
          <p className="mt-10 text-xl font-medium">
            Starting in {secondsLeft}s
          </p>
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
              <h1 className="text-4xl font-black mb-12 uppercase">
                {user.gender === "woman" ? "Stay at Table" : "Move to Table"}
              </h1>
              <div className="bg-white text-slate-900 rounded-full w-64 h-64 flex flex-col items-center justify-center shadow-2xl mb-8 mx-auto border-12 border-blue-500">
                <p className="text-9xl font-black leading-none">{nextNum}</p>
              </div>
              <p className="text-xl font-bold text-slate-400 mb-4">
                {groupName}
              </p>
              <p className="text-3xl font-mono text-blue-400">
                Next Round: {secondsLeft}s
              </p>
            </>
          ) : (
            <FeedbackForm />
          )}
        </div>
      );
    }

    if (event.isPaused) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <div className="relative">
        <Coffee size={120} className="text-yellow-500 mb-8 animate-bounce" />
        <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-2 py-1 rounded-full font-bold">
          PAUSED
        </div>
      </div>
      <h1 className="text-5xl font-black mb-4">Event Paused</h1>
      <p className="text-2xl text-slate-400">
        The organizer has temporarily paused the event. <br />
        Grab a drink—we'll be back shortly!
      </p>
    </div>
  );
}

    // E. ACTIVE DATING OR BREAK PHASE
    if (!partner || !isMatch) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
          <Coffee size={100} className="text-blue-400 mb-8 animate-pulse" />
          <h2 className="text-6xl font-black mb-4 italic text-white">
            Break Time!
          </h2>
          <p className="text-2xl text-slate-400 max-w-md leading-relaxed">
            You don't have a match this round. Grab a drink, stretch, and get
            ready for the next one!
          </p>
          <div className="mt-12 bg-slate-800 px-10 py-5 rounded-full border border-slate-700">
            <p className="text-4xl font-mono font-bold text-blue-400">
              {Math.floor(secondsLeft / 60)}:
              {(secondsLeft % 60).toString().padStart(2, "0")}
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
          <p className="text-blue-400 font-black uppercase text-sm mb-2">
            Round {currentRound} of {totalPotentialRounds}
          </p>
          <div className="inline-block px-6 py-2 bg-slate-800 rounded-full border border-slate-700 text-xl font-bold">
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
          <p className="text-7xl font-mono font-bold text-blue-400">
            {Math.floor(secondsLeft / 60)}:
            {(secondsLeft % 60).toString().padStart(2, "0")}
          </p>
        </div>
      </div>
    );
  };

  const FeedbackForm = () => (
    <div className="w-full max-w-xl text-center">
      {/* <h2 className="text-2xl font-bold mb-2 text-slate-300">
      Quick check: What table are you at?
    </h2>
    <input
      type="text" // Changed to text as tableNumber is now "Table X - Group"
      className="w-full max-w-sm p-4 text-center border-2 border-slate-700 bg-slate-800 rounded-xl mb-8 text-2xl text-white font-black"
      placeholder="1"
      value={tableAnswer}
      onChange={(e) => setTableAnswer(e.target.value)}
    /> */}

      <h1 className="text-5xl font-black mb-12 text-white">
        How was {partner?.firstName + " " + partner?.lastName}?
      </h1>

      <div className="flex flex-col gap-4">
        {/* Interest Buttons */}
        <button
          onClick={() => setPendingSelection("yes")}
          className={`py-6 rounded-2xl text-3xl font-black transition-colors ${pendingSelection === "yes" ? "bg-green-600 text-white" : "bg-white text-green-600"}`}
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
          className={`py-6 rounded-2xl text-3xl font-black transition-colors ${pendingSelection === "maybe" ? "bg-blue-600 text-white" : "bg-white text-blue-600"}`}
        >
          Maybe
        </button>

        <button
          onClick={() => setPendingSelection("no")}
          className={`py-4 rounded-2xl text-xl font-bold transition-colors ${pendingSelection === "no" ? "bg-orange-900 text-orange-200" : "bg-slate-800 text-slate-400"}`}
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
            {currentRound} / {totalPotentialRounds}
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
      className="min-h-screen bg-slate-900 text-white flex flex-col justify-center items-center overflow-hidden"
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
