import { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { MapPin, PartyPopper, Maximize, Coffee } from 'lucide-react';

export default function LiveRoundView({ event, user, attendees }) {
  const [now, setNow] = useState(new Date());
  const [decisionMade, setDecisionMade] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [pendingSelection, setPendingSelection] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // --- 1. COMPATIBILITY FILTER ---
  // This logic runs every time the partner changes
// --- 1. COMPATIBILITY FILTER ---
  const checkCompatibility = (me, partner) => {// TODO see if parents should be considered
    // if (!partner) return false;

    // // A. Age Filter (Simple min/max check)
    // if (me.ageRange.max > partner.age && partner.age > me.ageRange.min) return false;
    // console.log("Age compatibility passed.");

    // // B. Kohen Logic
    // // If user is a male Kohen and partner is female divorced, return false
    // if (me.isKohen && me.gender === 'man' && partner.gender === 'woman' && partner.maritalStatus === 'Divorced') return false;
    // console.log("Kohen compatibility passed.");

    // // C. Ethnicity Filter
    // // If I have preferences set, check if partner's ethnicity is in my allowed list
    // if (me.openToEthnicities && me.openToEthnicities.length > 0) {
    //   if (!me.openToEthnicities.includes(partner.ethnicity)) return false;
    // }
    // console.log("Ethnicity compatibility passed.");

    // // D. Marital Status Filter
    // // Checks if partner's status (Single, Divorced, Widowed) is in my allowed list
    // if (me.openToMaritalStatus && me.openToMaritalStatus.length > 0) {
    //   if (!me.openToMaritalStatus.includes(partner.maritalStatus)) return false;
    // }
    // console.log("Marital status compatibility passed.");

    // // E. Subgroup Filter (Ashkenazi, Sephardic, Lubavitch, etc.)
    // if (me.openToSubGroups && me.openToSubGroups.length > 0) {
    //   if (!me.openToSubGroups.includes(partner.subgroup)) return false;
    // }
    // console.log("Subgroup compatibility passed.");

    // If all checks pass, it's a valid date
    return true;
  };

  // Toggle Fullscreen Function
  const enterFullscreen = () => {
    if (containerRef.current.requestFullscreen) {
      containerRef.current.requestFullscreen();
    } else if (containerRef.current.webkitRequestFullscreen) { /* iPad Safari */
      containerRef.current.webkitRequestFullscreen();
    }
    setIsFullscreen(true);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!event || !event.startTime) return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <p className="animate-pulse">Initializing Event...</p>
    </div>
  );

// --- MATH & STOP LOGIC ---
const startTime = event.startTime.toDate();
  const secondsSinceStart = Math.floor((now - startTime) / 1000);
  const prepBuffer = 60; 
  const roundTimeSeconds = (event.roundTime || 7) * 60; 
  const roundLengthPlusMove = roundTimeSeconds + prepBuffer;

  const isEventStarting = secondsSinceStart < prepBuffer;
  const secondsAfterPrep = secondsSinceStart - prepBuffer;
  const currentRound = isEventStarting ? 1 : Math.floor(secondsAfterPrep / roundLengthPlusMove) + 1;

  const totalTables = event.totalTables || 1; 
  const totalPotentialRounds = totalTables; 
  const timeInCurrentBlock = isEventStarting ? 0 : secondsAfterPrep % roundLengthPlusMove;

  const isLastRound = currentRound === totalPotentialRounds;
  const isEventOver = currentRound > totalPotentialRounds || (isLastRound && timeInCurrentBlock >= roundTimeSeconds);
  const isMoving = !isEventStarting && !isEventOver && timeInCurrentBlock >= roundTimeSeconds;

  const secondsLeft = isEventStarting 
    ? prepBuffer - secondsSinceStart
    : isMoving 
      ? roundLengthPlusMove - timeInCurrentBlock 
      : isEventOver ? 0 : roundTimeSeconds - timeInCurrentBlock;

  useEffect(() => {
    setDecisionMade(false);
  }, [currentRound]);

  const myStartTable = user.tableNumber || 1;
  let activeRoundTable = myStartTable;

if (user.gender === 'man') {
    activeRoundTable = ((myStartTable + (currentRound - 1) - 1) % totalTables) + 1;
}

const tableToShow = (isMoving && user.gender === 'man') 
    ? ((myStartTable + (currentRound) - 1) % totalTables) + 1 
    : activeRoundTable;

// --- 3. PARTNER & FILTER VALIDATION ---
const partner = attendees.find(a => 
    a.gender !== user.gender && 
    (user.gender === 'woman' 
      ? (((a.tableNumber + (currentRound - 1) - 1) % totalTables) + 1 === activeRoundTable)
      : (a.tableNumber === activeRoundTable))
  );

  // Check if this partner meets our criteria
  const isMatch = partner ? checkCompatibility(user, partner) : false;

  // --- HANDLERS ---
const handleSelection = async (type) => {
    if (type !== 'no' && !user.email && !emailInput) {
      setPendingSelection(type);
      setShowEmailModal(true);
      return;
    }
    submitToFirebase(type);
  };

  const submitToFirebase = async (type) => {
    try {
      const myRef = doc(db, "registrations", user.id);
      const updateData = {};
      
      if (type === 'yes') updateData.selections = arrayUnion(partner.id);
      if (type === 'maybe') updateData.maybeSelections = arrayUnion(partner.id);
      if (emailInput) updateData.email = emailInput;

      await updateDoc(myRef, updateData);
      setDecisionMade(true);
      setShowEmailModal(false);
    } catch (err) {
      console.error("Save Error:", err);
    }
  };

    // --- FULLSCREEN PROMPT ---
  if (!isFullscreen) {
    return (
      <div ref={containerRef} className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-10 text-white">
        <h1 className="text-4xl font-black mb-8">Ready to Start?</h1>
        <button 
          onClick={enterFullscreen}
          className="flex items-center gap-4 bg-blue-600 px-12 py-6 rounded-3xl text-3xl font-bold shadow-2xl active:scale-95 transition-transform"
        >
          <Maximize size={40} /> Enter Fullscreen
        </button>
        <p className="mt-6 text-slate-400">This ensures the best experience for your event.</p>
      </div>
    );
  }

  // --- UI: EVENT OVER ---
if (isEventOver) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-10 text-center">
      {(!decisionMade && partner && isMatch) ? (
        <div className="w-full max-w-xl animate-in fade-in zoom-in duration-500">
          <h2 className="text-3xl font-bold mb-2 text-slate-400">Final Date! How was</h2>
          <h1 className="text-6xl font-black mb-12">{partner.name}?</h1>
          <div className="flex flex-col gap-4">
            <button onClick={() => handleSelection('yes')} className="w-full py-8 bg-white text-green-600 rounded-3xl text-4xl font-black shadow-xl">Interested</button>
            <button onClick={() => handleSelection('maybe')} className="w-full py-8 bg-white text-blue-600 rounded-3xl text-4xl font-black shadow-xl">Maybe</button>
            <button onClick={() => handleSelection('no')} className="w-full py-6 bg-slate-800 text-slate-400 rounded-3xl text-2xl font-bold">No thanks</button>
          </div>
        </div>
      ) : (
        <div className="animate-in slide-in-from-bottom duration-700">
          <PartyPopper size={100} className="mb-8 text-yellow-400 mx-auto" />
          <h1 className="text-7xl font-black mb-4 tracking-tighter">ALL DONE!</h1>
          <p className="text-2xl text-slate-400 max-w-md mx-auto leading-relaxed">
            You've met everyone! Please return your iPad to the front desk.
          </p>
          <div className="mt-12 bg-blue-600/20 border border-blue-500/30 p-6 rounded-3xl">
            <p className="text-blue-400 font-bold uppercase tracking-widest">Next Step</p>
            <p className="text-white text-lg">Check your email tomorrow for matches!</p>
          </div>
        </div>
      )}

      {/* Re-include the Email Modal here just in case they haven't entered it by the last round */}
      {showEmailModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
            <div className="bg-white text-slate-900 p-8 rounded-3xl w-full max-w-md">
              <h2 className="text-2xl font-bold mb-2">One last thing!</h2>
              <p className="text-slate-500 mb-6">Enter your email to receive your match results.</p>
              <input 
                type="email" 
                className="w-full p-4 border-2 border-slate-100 rounded-xl mb-6 text-lg"
                placeholder="email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <button 
                onClick={() => submitToFirebase(pendingSelection)}
                className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold"
              >
                Save & Submit Selection
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

  // --- UI: INITIAL STARTUP (FIRST 60 SECONDS) ---
if (isEventStarting) {
    return (
      <div className="min-h-screen bg-blue-700 flex flex-col items-center justify-center text-white p-10 text-center">
        <MapPin size={80} className="mb-6 animate-bounce" />
        <h1 className="text-5xl font-black mb-4 text-white">FIND YOUR TABLE</h1>
        <div className="bg-white text-blue-700 rounded-3xl p-10 shadow-2xl">
          <p className="text-sm uppercase font-bold mb-2">Start at Table</p>
          <p className="text-9xl font-black">{myStartTable}</p>
        </div>
        <p className="mt-10 text-xl font-medium">Starting in {secondsLeft}s</p>
      </div>
    );
  }

  // --- UI: MOVING / DECISION PHASE ---
if (isMoving) {
    return (
      <div className="min-h-screen bg-orange-600 flex flex-col items-center justify-center text-white p-6">
        {decisionMade || !partner || !isMatch ? (
          <div className="text-center">
            <h1 className="text-4xl font-black mb-6 uppercase">
              {user.gender === 'woman' ? "Stay Seated" : "Time to Rotate!"}
            </h1>
            <div className="bg-white text-orange-600 rounded-full w-48 h-48 flex flex-col items-center justify-center shadow-2xl mb-8 mx-auto">
              <p className="text-xs font-bold uppercase">Table</p>
              <p className="text-8xl font-black leading-none">{tableToShow}</p>
            </div>
            <p className="text-2xl font-mono">Next Round: {secondsLeft}s</p>
          </div>
        ) : (
          <div className="w-full max-w-xl text-center">
            <h2 className="text-3xl font-bold mb-2">How was your date with</h2>
            <h1 className="text-6xl font-black mb-12">{partner.name}?</h1>
            <div className="flex flex-col gap-4">
              <button onClick={() => handleSelection('yes')} className="w-full py-6 bg-white text-green-600 rounded-2xl text-3xl font-black shadow-xl">Interested</button>
              <button onClick={() => handleSelection('maybe')} className="w-full py-6 bg-white text-blue-600 rounded-2xl text-3xl font-black shadow-xl">Maybe</button>
              <button onClick={() => handleSelection('no')} className="w-full py-4 bg-orange-800 text-orange-200 rounded-2xl text-xl font-bold">No thanks</button>
            </div>
          </div>
        )}

        {showEmailModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
            <div className="bg-white text-slate-900 p-8 rounded-3xl w-full max-w-md">
              <h2 className="text-2xl font-bold mb-2">One last thing!</h2>
              <p className="text-slate-500 mb-6">Enter your email to receive your match results.</p>
              <input 
                type="email" 
                className="w-full p-4 border-2 border-slate-100 rounded-xl mb-6 text-lg"
                placeholder="email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <button 
                onClick={() => submitToFirebase(pendingSelection)}
                className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold"
              >
                Save & Submit Selection
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- UI: DATING OR BREAK PHASE ---
  // If no match found, show the Break Screen
  if (!isMatch) {
    return (
      <div className="min-h-screen bg-slate-800 flex flex-col items-center justify-center p-10 text-center text-white">
        <Coffee size={100} className="mb-8 text-blue-400 animate-pulse" />
        <h1 className="text-6xl font-black mb-4 uppercase">Break Round</h1>
        <div className="bg-slate-700/50 p-8 rounded-3xl border-2 border-slate-600 mb-8 max-w-md">
            <p className="text-xl text-slate-300">This partner does not match your specific preferences.</p>
        </div>
        <div className="mt-12">
            <p className="text-5xl font-mono font-bold opacity-40">
                {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')}
            </p>
        </div>
      </div>
    );
  }

return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="mb-8">
        <p className="text-blue-600 font-black tracking-widest uppercase text-sm">Round {currentRound} of {totalPotentialRounds}</p>
        <p className="text-slate-400 font-bold">Table {tableToShow}</p>
      </div>
      <p className="text-slate-400 uppercase font-bold tracking-tighter mb-2 tracking-[0.2em]">Talking to</p>
      <h2 className="text-7xl font-black text-slate-900 mb-8">{partner?.name || "Searching..."}</h2>
      <div className="bg-white px-12 py-6 rounded-[2.5rem] shadow-xl border border-slate-100">
        <p className="text-6xl font-mono font-bold text-slate-800">
          {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')}
        </p>
      </div>
    </div>
  );
}