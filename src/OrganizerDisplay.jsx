import { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import { MapPin, Clock, Pause, Coffee, CheckCircle2, Play } from "lucide-react";

export default function OrganizerDisplay() {
  const [searchParams] = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  // 1. Live ticker running every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Real-time Firestore sync (url parameter if provided, otherwise most recent event)
  useEffect(() => {
    let unsubscribe;
    setLoading(true);

    if (urlEventId) {
      unsubscribe = onSnapshot(doc(db, "events", urlEventId), (docSnap) => {
        if (docSnap.exists()) {
          setEventData({ id: docSnap.id, ...docSnap.data() });
        } else {
          setEventData(null);
        }
        setLoading(false);
      });
    } else {
      const q = query(
        collection(db, "events"),
        orderBy("createdAt", "desc"),
        limit(1)
      );

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!snapshot.empty) {
            const latestDoc = snapshot.docs[0];
            setEventData({ id: latestDoc.id, ...latestDoc.data() });
          } else {
            setEventData(null);
          }
          setLoading(false);
        },
        (err) => {
          console.error("Error fetching latest event:", err);
          setLoading(false);
        }
      );
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [urlEventId]);

  // Loading Screen
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1E3D34] flex items-center justify-center text-white">
        <p className="text-2xl font-bold animate-pulse">Loading Event Display...</p>
      </div>
    );
  }

  // Fallback if no event found
  if (!eventData) {
    return (
      <div className="min-h-screen bg-[#DEE8DF] flex items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-[#95B699]">
          <h2 className="text-2xl text-[#1E3D34] font-bold">No Active Event Found</h2>
          <p className="text-slate-500 mt-2">
            Please ensure an event is created in the admin panel or pass a valid <code className="bg-slate-100 px-2 py-1 rounded">?eventId=</code> parameter.
          </p>
        </div>
      </div>
    );
  }

  // --- MATH & TIMING CALCULATIONS (Matching LiveRoundView.jsx) ---
  const parseTimestamp = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    return new Date(ts);
  };

  const startTime = parseTimestamp(eventData.startTime);

  // If event hasn't been started yet by admin
  if (!startTime) {
    return (
      <div className="min-h-screen bg-[#DEE8DF] p-6 flex flex-col items-center justify-center font-sans">
        <div className="max-w-3xl w-full bg-white rounded-3xl shadow-xl p-10 border-2 border-[#95B699]/30 text-center flex flex-col gap-6">
          <h1 className="text-4xl md:text-5xl font-black text-[#1E3D34]">
            {eventData.name || "Unnamed Event"}
          </h1>
          <p className="text-lg text-slate-500 font-medium flex items-center justify-center gap-2">
            <MapPin size={22} className="text-[#1E3D34]" />
            {eventData.address || "Address not specified"}
          </p>
          <div className="py-12 px-6 rounded-2xl bg-amber-50 border-2 border-amber-200 text-amber-900 mt-4">
            <Clock size={48} className="mx-auto mb-3 text-amber-600 animate-bounce" />
            <h2 className="text-3xl font-black uppercase">Event Not Started</h2>
            <p className="text-lg mt-2 opacity-80">
              Waiting for the admin to initiate Round 1.
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-slate-600 font-bold">
            Standard Round Length: {eventData.roundTime || 7} Minutes
          </div>
        </div>
      </div>
    );
  }

  const pausedAtTime = parseTimestamp(eventData.pausedAt);
  const effectiveNow = eventData.isPaused && pausedAtTime ? pausedAtTime : now;
  const secondsSinceStart = Math.floor((effectiveNow - startTime) / 1000);

  const startBuffer = 60; // 1 min initial buffer
  const moveBuffer = 120; // 2 min break/moving buffer
  const roundTimeMinutes = eventData.roundTime || 7;
  const roundTimeSeconds = roundTimeMinutes * 60;
  const roundLengthPlusMove = roundTimeSeconds + moveBuffer;

  const totalRounds = eventData.totalTables || 10;

  const isEventStarting = secondsSinceStart < startBuffer;
  const secondsAfterStart = secondsSinceStart - startBuffer;

  const rawRound = isEventStarting
    ? 1
    : Math.floor(secondsAfterStart / roundLengthPlusMove) + 1;

  const currentRound = Math.min(rawRound, totalRounds);

  const timeInCurrentBlock = isEventStarting
    ? 0
    : secondsAfterStart % roundLengthPlusMove;

  const isLastRound = currentRound === totalRounds;

  const isEventOver =
    rawRound > totalRounds ||
    (isLastRound && timeInCurrentBlock >= roundTimeSeconds);

  const isMoving =
    !isEventStarting && !isEventOver && timeInCurrentBlock >= roundTimeSeconds;

  // Calculate Remaining Time & Time Elapsed Into Current Round
  const secondsLeft = isEventStarting
    ? startBuffer - secondsSinceStart
    : isMoving
    ? roundLengthPlusMove - timeInCurrentBlock
    : isEventOver
    ? 0
    : roundTimeSeconds - timeInCurrentBlock;

  const secondsElapsedInRound = isEventStarting
    ? 0
    : isMoving
    ? timeInCurrentBlock - roundTimeSeconds // Time spent inside the 2-min break
    : timeInCurrentBlock; // Time spent inside the current round

  // Time Formatting Helpers
  const formatTime = (totalSeconds) => {
    const secs = Math.max(0, totalSeconds);
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="min-h-screen bg-[#DEE8DF] p-6 flex flex-col items-center justify-center font-sans">
      <div className="max-w-4xl w-full bg-white rounded-3xl shadow-xl p-8 md:p-14 border-2 border-[#95B699]/30 text-center flex flex-col gap-8">
        
        {/* HEADER: Event Name & Full Address */}
        <div>
          <h1 className="text-4xl md:text-5xl font-black text-[#1E3D34] mb-3 tracking-tight">
            {eventData.name || "Unnamed Event"}
          </h1>
          <p className="text-lg md:text-xl text-slate-600 font-medium flex items-center justify-center gap-2">
            <MapPin size={24} className="text-[#1E3D34] shrink-0" />
            <span>{eventData.fullAddress || "Address not specified"}</span>
          </p>
        </div>

        <div className="w-full h-px bg-slate-200" />

        {/* MAIN DISPLAY STATUS CARD */}
        {eventData.isPaused ? (
          // PAUSED STATE
          <div className="py-12 px-6 rounded-3xl bg-amber-50 border-4 border-amber-300 text-amber-900 transition-all">
            <Pause size={64} className="mx-auto mb-4 text-amber-600 animate-pulse" />
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wider mb-2">
              Event Paused
            </h2>
            <p className="text-xl md:text-2xl font-bold opacity-80">
              The round timer is currently on hold.
            </p>
          </div>
        ) : isEventOver ? (
          // COMPLETED STATE
          <div className="py-12 px-6 rounded-3xl bg-emerald-50 border-4 border-emerald-300 text-emerald-950 transition-all">
            <CheckCircle2 size={64} className="mx-auto mb-4 text-emerald-600" />
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wider mb-2">
              Event Complete
            </h2>
            <p className="text-xl md:text-2xl font-bold opacity-80">
              All {totalRounds} rounds have concluded.
            </p>
          </div>
        ) : isEventStarting ? (
          // PREPARATION BUFFER STATE (First 60s)
          <div className="py-12 px-6 rounded-3xl bg-blue-50 border-4 border-blue-300 text-blue-950 transition-all">
            <Play size={64} className="mx-auto mb-4 text-blue-600 animate-pulse" />
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-wider mb-2">
              Get Ready!
            </h2>
            <p className="text-lg md:text-xl font-bold opacity-80 mb-6">
              Round 1 starts shortly
            </p>
            <div className="text-7xl md:text-9xl font-bold font-mono tracking-tighter my-2">
              {formatTime(secondsLeft)}
            </div>
            <p className="text-lg md:text-xl font-bold opacity-70 uppercase tracking-widest mt-2">
              Starting Countdown
            </p>
          </div>
        ) : isMoving ? (
          // ROTATION / BREAK STATE (2-min buffer between rounds)
          <div className="py-12 px-6 rounded-3xl bg-orange-50 border-4 border-orange-300 text-orange-950 transition-all">
            <Coffee size={64} className="mx-auto mb-4 text-orange-600 animate-bounce" />
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wider mb-2">
              Rotation / Break
            </h2>
            <p className="text-xl md:text-2xl font-bold opacity-80 mb-6">
              Move to Next Table (Round {currentRound + 1} Next)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white/70 backdrop-blur-sm p-6 rounded-2xl border border-orange-200">
              <div>
                <p className="text-sm font-bold opacity-60 uppercase tracking-widest mb-1">
                  Break Remaining
                </p>
                <div className="text-5xl md:text-7xl font-bold font-mono text-orange-900">
                  {formatTime(secondsLeft)}
                </div>
              </div>
              <div>
                <p className="text-sm font-bold opacity-60 uppercase tracking-widest mb-1">
                  Time Into Break
                </p>
                <div className="text-5xl md:text-7xl font-bold font-mono text-slate-700">
                  {formatTime(secondsElapsedInRound)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          // ACTIVE ROUND STATE
          <div className="py-10 px-6 rounded-3xl bg-[#95B699]/20 border-4 border-[#95B699] text-[#1E3D34] transition-all">
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wider mb-2">
              Round {currentRound} of {totalRounds}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-2xl border border-[#95B699]/40 mt-6 shadow-inner">
              {/* Time Into Round */}
              <div className="flex flex-col items-center justify-center">
                <p className="text-sm md:text-base font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Time Into Round
                </p>
                <div className="text-6xl md:text-8xl font-black font-mono text-[#1E3D34]">
                  {formatTime(secondsElapsedInRound)}
                </div>
              </div>

              {/* Time Remaining in Round */}
              <div className="flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0">
                <p className="text-sm md:text-base font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Time Remaining
                </p>
                <div className="text-6xl md:text-8xl font-black font-mono text-amber-700">
                  {formatTime(secondsLeft)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FOOTER INFO: Settings Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex flex-col justify-center">
            <p className="text-xs md:text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">
              Round Duration
            </p>
            <p className="text-2xl md:text-3xl font-black text-[#1E3D34]">
              {roundTimeMinutes} Minute(s)
            </p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex flex-col justify-center">
            <p className="text-xs md:text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">
              Total Event Rounds
            </p>
            <p className="text-2xl md:text-3xl font-black text-[#1E3D34]">
              {totalRounds} Round(s)
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}