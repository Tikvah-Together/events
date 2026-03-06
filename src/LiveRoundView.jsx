import { useState, useEffect, useRef, use } from "react";
import { db } from "./firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import {
  MapPin,
  PartyPopper,
  Maximize,
  Star,
  AlertCircle,
} from "lucide-react";

export default function LiveRoundView({ event, user, attendees }) {
  const [now, setNow] = useState(new Date());
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
  // --- 1. COMPATIBILITY FILTER ---
  // This logic runs every time the partner changes
  // --- 1. COMPATIBILITY FILTER ---
  const checkCompatibility = (me, partner) => {
    if (!partner) return false;

    // Kohen Logic
    // If user is a male Kohen and partner is female divorced, return false
    if (me.isKohen && me.gender === 'man' && partner.gender === 'woman' && partner.maritalStatus === 'Divorced') {
      console.log("Kohen compatibility failed.");
      return false;
    }
    console.log("Kohen compatibility passed.");

    // TODO - Add more filters here as needed, such as age range, shared interests, etc.

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

  // Reset local decision state for the new round
  useEffect(() => {
    setDecisionMade(false);
    setIsPriority(false); // Reset priority toggle for the new person
    setOptionalNotes("");
  }, [currentRound]);

  if (!event || !event.startTime)
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="animate-pulse">Initializing Event...</p>
      </div>
    );

// --- 1. PARSE USER TABLE & GROUP ---
  // Format: "Table 1 - YP" -> tablePart: "Table 1", groupName: "YP", startTableNum: 1
  const tableString = user.tableNumber || "Table 1 - Default";
  const [tablePart, groupName] = tableString.split(" - ");
  const startTableNum = parseInt(tablePart.replace("Table ", ""), 10) || 1;

  // --- 2. DYNAMIC GROUP MATH ---
  // We need to know how many tables are in THIS specific group so rotation works
  const groupAttendees = attendees.filter(a => a.tableNumber?.includes(` - ${groupName}`));
  const uniqueTablesInGroup = [...new Set(groupAttendees.map(a => a.tableNumber))];
  const totalTablesInGroup = uniqueTablesInGroup.length || 1;

  // --- 3. MATH & STOP LOGIC ---
  const startTime = event.startTime.toDate();
  const secondsSinceStart = Math.floor((now - startTime) / 1000);
  const prepBuffer = 60;
  const roundTimeSeconds = (event.roundTime || 7) * 60;
  const roundLengthPlusMove = roundTimeSeconds + prepBuffer;

  const isEventStarting = secondsSinceStart < prepBuffer;
  const secondsAfterPrep = secondsSinceStart - prepBuffer;
  const currentRound = isEventStarting
    ? 1
    : Math.floor(secondsAfterPrep / roundLengthPlusMove) + 1;

  // Total rounds is usually based on how many tables are in the group
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
    activeNum = ((startTableNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
  }

  const nextNum = user.gender === "man"
    ? ((startTableNum + currentRound - 1) % totalTablesInGroup) + 1
    : startTableNum;

  // Re-construct the strings for the UI and Matching
  const activeRoundTable = `Table ${activeNum} - ${groupName}`;
  const tableToShow = isMoving ? `Table ${nextNum} - ${groupName}` : activeRoundTable;

  useEffect(() => {
    setDecisionMade(false);
  }, [currentRound]);

  // --- 5. PARTNER MATCHING ---
  const partner = attendees.find((a) => {
    if (a.gender === user.gender) return false;

    // To find a match, we calculate the partner's CURRENT table string 
    // and see if it matches the user's CURRENT table string.
    const pTableString = a.tableNumber || "";
    const [pTablePart, pGroup] = pTableString.split(" - ");
    
    // Safety check: Must be in the same group (YP, etc.)
    if (pGroup !== groupName) return false;

    const pStartNum = parseInt(pTablePart.replace("Table ", ""), 10) || 1;
    let pCurrentNum = pStartNum;

    // If the partner is a man, he is rotating. If a woman, she is stationary.
    if (a.gender === "man") {
      pCurrentNum = ((pStartNum + (currentRound - 1) - 1) % totalTablesInGroup) + 1;
    }

    const pCurrentTableFull = `Table ${pCurrentNum} - ${pGroup}`;
    return pCurrentTableFull === activeRoundTable;
  });

  // Check if this partner meets our criteria
  const isMatch = partner ? checkCompatibility(user, partner) : false;

  // --- HANDLERS ---
  const handleInterestedSelection = (type) => {
    setPendingSelection(type);
    if (type !== "yes") setIsPriority(false); // Can't prioritize a 'maybe' or 'no'
  };

  const saveInformationAndContinue = async () => {
    if (tableAnswer !== String(tableToShow)) {
      alert("Please enter the correct table number.");
      return;
    }

    const myRef = doc(db, "users", user.id);
    const newFeedbackEntry = {
      event: event.id,
      partnerId: partner.id,
      partnerName: partner.name,
      interested: pendingSelection,
      priority: isPriority,
      tableNumber: tableAnswer,
      round: currentRound,
      optionalNotes,
      timestamp: new Date(),
    };

    try {
      let finalFeedbackData = [...(user.feedbackData || [])];

      // If this is a new priority, we must find any OLD priority in this event and set it to false
      if (isPriority) {
        finalFeedbackData = finalFeedbackData.map((f) =>
          f.event === event.id ? { ...f, priority: false } : f,
        );
      }

      // Add the new entry
      finalFeedbackData.push(newFeedbackEntry);

      await updateDoc(myRef, {
        feedbackData: finalFeedbackData,
        // Keep your legacy arrays if still using them for other logic
        ...(pendingSelection === "yes" && {
          selections: arrayUnion(partner.id),
        }),
        ...(pendingSelection === "maybe" && {
          maybeSelections: arrayUnion(partner.id),
        }),
        ...(emailInput && { email: emailInput }),
      });

      setDecisionMade(true);
      setShowEmailModal(false);
    } catch (err) {
      console.error("Error saving feedback:", err);
    }
  };

  // --- UI COMPONENTS ---

  // --- 4. THE RENDERER ---
  const renderMainContent = () => {
    // A. GATEKEEPER: Not Fullscreen
    if (!isFullscreen) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          <h1 className="text-4xl font-black mb-8">Ready to Start?</h1>
          <button onClick={enterFullscreen} className="flex items-center gap-4 bg-blue-600 px-12 py-6 rounded-3xl text-3xl font-bold shadow-2xl active:scale-95 transition-transform">
            <Maximize size={40} /> Enter Fullscreen
          </button>
        </div>
      );
    }

    // B. EVENT OVER
    if (isEventOver) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          {(decisionMade || !partner || !isMatch) ? (
            <div className="animate-bounce text-center">
              <PartyPopper size={100} className="text-yellow-400 mx-auto mb-4" />
              <h1 className="text-6xl font-black">All Done!</h1>
            </div>
          ) : <FeedbackForm />}
        </div>
      );
    }

    // C. STARTING BUFFER
    if (isEventStarting) {
      return (
        <div className="flex flex-col items-center justify-center p-10 text-center">
          <MapPin size={80} className="mb-6 animate-bounce text-white" />
          <h1 className="text-5xl font-black mb-4 uppercase">Find Your Table</h1>
          <div className="bg-white text-blue-700 rounded-3xl p-10 shadow-2xl">
            <p className="text-9xl font-black">{startTableNum}</p>
            <p className="text-xl font-bold mt-2">{groupName}</p>
          </div>
          <p className="mt-10 text-xl font-medium">Starting in {secondsLeft}s</p>
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
              <p className="text-xl font-bold text-slate-400 mb-4">{groupName}</p>
              <p className="text-3xl font-mono text-blue-400">Next Round: {secondsLeft}s</p>
            </>
          ) : <FeedbackForm />}
        </div>
      );
    }

    // E. ACTIVE DATING OR BREAK PHASE
    if (!partner || !isMatch) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
          <Coffee size={100} className="text-blue-400 mb-8 animate-pulse" />
          <h2 className="text-6xl font-black mb-4 italic text-white">Break Time!</h2>
          <p className="text-2xl text-slate-400 max-w-md leading-relaxed">
            You don't have a match this round. Grab a drink, stretch, and get ready for the next one!
          </p>
          <div className="mt-12 bg-slate-800 px-10 py-5 rounded-full border border-slate-700">
             <p className="text-4xl font-mono font-bold text-blue-400">
              {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
            </p>
          </div>
          <p className="mt-6 text-slate-500 font-bold uppercase tracking-widest">Table {activeNum}</p>
        </div>
      );
    }

    // F. STANDARD DATING PHASE
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-12">
          <p className="text-blue-400 font-black uppercase text-sm mb-2">Round {currentRound} of {totalPotentialRounds}</p>
          <div className="inline-block px-6 py-2 bg-slate-800 rounded-full border border-slate-700 text-xl font-bold">
            Table {activeNum} <span className="text-slate-500 mx-2">|</span> {groupName}
          </div>
        </div>
        <p className="text-slate-500 uppercase font-bold mb-4 tracking-[0.3em]">Talking to</p>
        <h2 className="text-8xl font-black mb-12 tracking-tighter">{partner.name}</h2>
        <div className="bg-slate-800 px-16 py-8 rounded-[3rem] border-2 border-slate-700 shadow-2xl">
          <p className="text-7xl font-mono font-bold text-blue-400">
            {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
          </p>
        </div>
      </div>
    );
  };

  const FeedbackForm = () => (
    <div className="w-full max-w-xl text-center">
      <h2 className="text-2xl font-bold mb-2 text-slate-300">
        Quick check: What table are you at?
      </h2>
      <input
        type="number"
        className="w-32 p-4 text-center border-2 border-slate-700 bg-slate-800 rounded-xl mb-8 text-3xl text-white font-black"
        placeholder="#"
        value={tableAnswer}
        onChange={(e) => setTableAnswer(e.target.value)}
      />
      <h1 className="text-5xl font-black mb-12 text-white">
        How was {partner?.name}?
      </h1>
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setPendingSelection("yes")}
          className={`py-6 rounded-2xl text-3xl font-black ${pendingSelection === "yes" ? "bg-green-600 text-white" : "bg-white text-green-600"}`}
        >
          Interested
        </button>
        {pendingSelection === "yes" && (
          <button
            onClick={handlePriorityToggle}
            className={`py-4 rounded-xl border-2 flex items-center justify-center gap-3 ${isPriority ? "bg-yellow-500 border-yellow-400 text-white" : "border-slate-600 text-slate-400"}`}
          >
            <Star fill={isPriority ? "white" : "none"} />{" "}
            {isPriority ? "PRIORITY PICK" : "MAKE PRIORITY?"}
          </button>
        )}
        <button
          onClick={() => setPendingSelection("maybe")}
          className={`py-6 rounded-2xl text-3xl font-black ${pendingSelection === "maybe" ? "bg-blue-600 text-white" : "bg-white text-blue-600"}`}
        >
          Maybe
        </button>
        <button
          onClick={() => setPendingSelection("no")}
          className={`py-4 rounded-2xl text-xl font-bold ${pendingSelection === "no" ? "bg-orange-900 text-orange-200" : "bg-slate-800 text-slate-400"}`}
        >
          No thanks
        </button>
        <button
          onClick={saveInformationAndContinue}
          className="mt-8 py-5 bg-blue-600 text-white rounded-2xl font-black text-2xl"
        >
          Submit Selection
        </button>
      </div>
    </div>
  );

  // --- FINAL RETURN: THE SHELL ---
  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-slate-900 text-white flex flex-col justify-center items-center overflow-hidden"
    >
      {renderMainContent()}

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
              Switch to {partner?.name}?
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
    </div>
  );
}
