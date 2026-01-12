import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import LiveRoundView from './LiveRoundView';
import { User, Clock, MapPin, CheckCircle2 } from 'lucide-react';

export default function Gatekeeper() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [currentEvent, setCurrentEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [myProfile, setMyProfile] = useState(null); // The person using this iPad

  // 1. Fetch Active Events
  useEffect(() => {
    const q = query(collection(db, "events")); // Show all events so iPads can connect
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  // 2. Listen to the specific selected event (for LIVE status changes)
  useEffect(() => {
    if (!selectedEventId) return;
    const unsubscribe = onSnapshot(doc(db, "events", selectedEventId), (snap) => {
      setCurrentEvent({ id: snap.id, ...snap.data() });
    });
    return () => unsubscribe();
  }, [selectedEventId]);

  // 3. Fetch Attendees and their table assignments
  useEffect(() => {
    if (!selectedEventId) return;
    const q = query(collection(db, "registrations"), where("eventId", "==", selectedEventId));
    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAttendees(docs);
      // Keep my profile updated if I've already picked a name
      if (myProfile) {
        const updatedMe = docs.find(a => a.id === myProfile.id);
        setMyProfile(updatedMe);
      }
    });
    return () => unsubscribe();
  }, [selectedEventId, myProfile?.id]);

  const handleClaimiPad = async (person) => {
    setMyProfile(person);
    // Automatically check them in when they claim the iPad
    await updateDoc(doc(db, "registrations", person.id), {
      checkedIn: true,
      ipadId: navigator.userAgent // Optional: track which device they are on
    });
  };

  // --- PHASE 1: SELECT EVENT ---
  if (!selectedEventId) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-6">Device Setup</h1>
          <p className="text-slate-500 mb-6">Select the event running at this location:</p>
          <div className="space-y-3">
            {events.map(ev => (
              <button 
                key={ev.id} 
                onClick={() => setSelectedEventId(ev.id)}
                className="w-full p-4 border-2 border-slate-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all font-bold text-slate-700"
              >
                {ev.name}
              </button>
            ))}
            {events.length === 0 && <p className="text-orange-500 font-medium italic">No active events found...</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- PHASE 2: CLAIM PROFILE (CHECK-IN) ---
  if (!myProfile) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-2xl mx-auto">
          <header className="text-center mb-10">
            <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tight">Welcome</h1>
            <p className="text-slate-500">Please find your name to start the event</p>
          </header>
          
          <div className="grid grid-cols-1 gap-3">
            {attendees.filter(a => !a.checkedIn).sort((a,b) => a.name.localeCompare(b.name)).map(person => (
              <button 
                key={person.id}
                onClick={() => handleClaimiPad(person)}
                className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center hover:shadow-md transition-shadow"
              >
                <div>
                  <p className="text-xl font-bold text-slate-800">{person.name}</p>
                  <p className="text-sm text-slate-400 text-left">{person.age} years old • {person.gender}</p>
                </div>
                <div className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-sm">This is Me</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- PHASE 3: THE LOBBY (WAITING FOR ADMIN TO START ROUND 1) ---
  if (currentEvent && !currentEvent.active) {
    return (
      <div className="min-h-screen bg-blue-900 flex flex-col items-center justify-center text-white p-10 text-center">
        <div className="animate-bounce mb-8">
            <Clock size={80} strokeWidth={1} />
        </div>
        <h1 className="text-4xl font-black mb-4">Hi, {myProfile.name}!</h1>
        <p className="text-xl text-blue-200 max-w-md">You're all set. Please wait comfortably. The event will begin shortly.</p>
        <div className="mt-12 flex items-center gap-2 bg-blue-800 px-6 py-3 rounded-full">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm font-bold tracking-widest uppercase">Connection Active</span>
        </div>
      </div>
    );
  }

  // --- PHASE 4: LIVE ROUNDS ---
  return (
    <LiveRoundView 
        event={currentEvent} 
        user={myProfile} 
        attendees={attendees} 
    />
  );
}