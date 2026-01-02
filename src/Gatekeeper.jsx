import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';

export default function Gatekeeper() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [attendees, setAttendees] = useState([]);

  // 1. Fetch Events
  useEffect(() => {
    getDocs(collection(db, "events")).then(snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // 2. Fetch Attendees for the selected event in real-time
  useEffect(() => {
    if (!selectedEvent) return;
    const q = query(collection(db, "registrations"), where("eventId", "==", selectedEvent));
    const unsubscribe = onSnapshot(q, (snap) => {
      setAttendees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [selectedEvent]);

  const toggleCheckIn = async (id, currentStatus) => {
    await updateDoc(doc(db, "registrations", id), {
      checkedIn: !currentStatus
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Event Check-In (iPad View)</h1>
      
      <select 
        className="w-full p-3 mb-6 border rounded shadow"
        onChange={(e) => setSelectedEvent(e.target.value)}
      >
        <option value="">-- Select Event to Manage --</option>
        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
      </select>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-4">Name</th>
              <th className="p-4">Gender</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {attendees.map(person => (
              <tr key={person.id} className="border-t">
                <td className="p-4 font-medium">{person.name}</td>
                <td className="p-4 capitalize">{person.gender}</td>
                <td className="p-4">
                  <button 
                    onClick={() => toggleCheckIn(person.id, person.checkedIn)}
                    className={`px-4 py-2 rounded-full text-sm font-bold ${
                      person.checkedIn ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {person.checkedIn ? 'CONFIRMED' : 'NOT ARRIVED'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {attendees.length === 0 && selectedEvent && (
          <p className="p-10 text-center text-gray-500">No registrations found for this event yet.</p>
        )}
      </div>
    </div>
  );
}