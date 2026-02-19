import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, limit } from 'firebase/firestore';
import LiveRoundView from './LiveRoundView';
import { Clock, Smartphone, Mail, ArrowRight, Loader2 } from 'lucide-react';

export default function Gatekeeper() {
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [currentEvent, setCurrentEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  const [masterUsers, setMasterUsers] = useState([]);
  
  // Login State
  const [loginInput, setLoginInput] = useState('');
  const [error, setError] = useState('');

  // Fetch Master User List for verification
useEffect(() => {
  const unsubscribe = onSnapshot(collection(db, "users"), (snap) => {
    setMasterUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
  return () => unsubscribe();
}, []);

  // 1. Auto-Select Latest Event
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("scheduledAt", "desc"), limit(1));
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
    const q = query(collection(db, "registrations"), where("eventId", "==", selectedEventId));
    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAttendees(docs);
      
      if (myProfile) {
        const updatedMe = masterUsers.find(u => u.id === myProfile.userId);
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

  // STEP 1: Find the User Profile by contact info
  const matchedUser = masterUsers.find(u => {
    const userPhone = u.phone?.replace(/\D/g, "") || "";
    const userEmail = u.email?.toLowerCase() || "";
    return (input === userEmail) || (cleanPhone !== "" && cleanPhone === userPhone);
  });

  if (!matchedUser) {
    setError("We couldn't find a profile with that info. Check your spelling or see an organizer.");
    return;
  }

  // STEP 2: Check if that user is registered for THIS specific event
  const registration = attendees.find(reg => reg.userId === matchedUser.id);

  if (registration) {
    // Combine them so you have both the registration status and the user's name/age
    const combinedProfile = { ...registration, ...matchedUser, registrationId: registration.id };
    
    setMyProfile(combinedProfile);
  } else {
    setError(`Hi ${matchedUser.firstName} ${matchedUser.lastName}, you aren't registered for this specific event.`);
  }
};

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin mb-4" size={48} />
        <p className="text-slate-400 font-medium">Locating latest event...</p>
      </div>
    );
  }

  // --- PHASE 1: LOGIN MODAL ---
  if (!myProfile) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-lg">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-slate-900 mb-2">Check In</h1>
            <p className="text-slate-500 font-medium">
              {currentEvent ? `Welcome to ${currentEvent.name}` : "Please verify your registration"}
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

          <p className="mt-8 text-center text-slate-400 text-xs uppercase tracking-tighter font-bold">
            Secure iPad Entry System
          </p>
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
        <h1 className="text-4xl font-black mb-4">Hi, {myProfile.firstName} {myProfile.lastName}!</h1>
        <p className="text-xl text-blue-200 max-w-md">You're all set. Please wait comfortably. The event will begin shortly.</p>
        <div className="mt-12 flex items-center gap-2 bg-blue-800 px-6 py-3 rounded-full">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm font-bold tracking-widest uppercase">Connection Active</span>
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
    />
  );
}