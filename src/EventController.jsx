import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot } from 'firebase/firestore';

export default function EventController() {
  const [eventData, setEventData] = useState(null);
  const [men, setMen] = useState([]);
  const [women, setWomen] = useState([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Load the active event and checked-in users
  useEffect(() => {
    const loadData = async () => {
      // 1. Get the first active event
      const qEvent = query(collection(db, "events"), where("active", "==", true));
      const eventSnap = await getDocs(qEvent);
      if (eventSnap.empty) return;
      const ev = { id: eventSnap.docs[0].id, ...eventSnap.docs[0].data() };
      setEventData(ev);
      setTimeLeft(ev.roundTime * 60);

      // 2. Get checked-in attendees
      const qUsers = query(collection(db, "registrations"), 
        where("eventId", "==", ev.id), 
        where("checkedIn", "==", true)
      );
      
      const userSnap = await getDocs(qUsers);
      const allUsers = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      setMen(allUsers.filter(u => u.gender === 'man'));
      setWomen(allUsers.filter(u => u.gender === 'woman'));
    };
    loadData();
  }, []);

  // Timer Logic
  useEffect(() => {
    let interval = null;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      alert("Round Over! Men, please rotate to the next table.");
      handleNextRound();
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  const handleNextRound = () => {
    setCurrentRound(prev => prev + 1);
    setTimeLeft(eventData.roundTime * 60);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!eventData) return <div className="p-10 text-center">No active event found. Create one in /admin</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold mb-2">{eventData.name}</h1>
      <p className="text-xl text-blue-400 mb-8 font-mono">ROUND {currentRound}</p>

      <div className="text-9xl font-black mb-12 tabular-nums">
        {formatTime(timeLeft)}
      </div>

      <div className="flex gap-4 mb-12">
        <button 
          onClick={() => setIsActive(!isActive)}
          className={`px-10 py-4 rounded-full text-2xl font-bold transition ${
            isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
          }`}
        >
          {isActive ? 'PAUSE' : 'START ROUND'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-8 w-full max-w-2xl text-center">
        <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
          <h2 className="text-pink-400 font-bold text-lg mb-2">WOMEN (Stay Seated)</h2>
          <p className="text-3xl">{women.length}</p>
        </div>
        <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
          <h2 className="text-blue-400 font-bold text-lg mb-2">MEN (Rotate)</h2>
          <p className="text-3xl">{men.length}</p>
        </div>
      </div>
      
      <p className="mt-8 text-gray-400 italic">
        Instruction: Men move to Table # (Index + Round) % Total Men
      </p>
    </div>
  );
}