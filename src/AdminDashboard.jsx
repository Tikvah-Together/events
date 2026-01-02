import React, { useState } from 'react';
import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function AdminDashboard() {
  const [eventName, setEventName] = useState("");
  const [roundTime, setRoundTime] = useState(7);

  const createEvent = async () => {
    if (!eventName) return alert("Enter a name!");
    await addDoc(collection(db, "events"), {
      name: eventName,
      roundTime: roundTime,
      active: true,
      createdAt: new Date()
    });
    alert("Event Created!");
    setEventName("");
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Admin: Create Event</h1>
      <input 
        placeholder="Event Name (e.g. Jan 15 Social)" 
        value={eventName} 
        onChange={(e) => setEventName(e.target.value)} 
      />
      <input 
        type="number" 
        value={roundTime} 
        onChange={(e) => setRoundTime(e.target.value)} 
      />
      <button onClick={createEvent}>Launch Event</button>
    </div>
  );
}