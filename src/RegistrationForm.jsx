import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { Check, User, Heart, Calendar } from 'lucide-react';

const RELIGIOUS_SUBGROUPS = ['Chabad', 'Chasidish', 'Haredi', 'Yeshivish', 'Modern Yeshivish', 'Modern Orthodox Machmir', 'Heimish', 'Out of the box'];
const ETHNICITIES = ['Ashkenazi', 'Sephardi (Syrian)', 'Sephardi (Persian)', 'Sephardi (Moroccan)', 'Sephardi (Other)'];
const MARITAL_STATUSES = ['single', 'single with kids', 'divorced', 'divorced with kids', 'widowed', 'widowed with kids'];

export default function RegistrationForm() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({
    eventId: '',
    name: '',
    gender: '',
    targetGender: '',
    birthDate: '',
    ageRange: { min: 20, max: 40 },
    parents: '',
    religiousLevel: '',
    subGroup: '',
    openToSubGroups: [],
    ethnicity: '',
    openToEthnicities: [],
    isKohen: 'no',
    maritalStatus: '',
    openToMaritalStatus: []
  });

  // Fetch active events for the dropdown
  useEffect(() => {
    const fetchEvents = async () => {
      const q = query(collection(db, "events"), where("active", "==", true));
      const snap = await getDocs(q);
      setEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchEvents();
  }, []);

  const calculateAge = (dateString) => {
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const handleCheckbox = (list, value, field) => {
    const current = [...list];
    const index = current.indexOf(value);
    if (index > -1) current.splice(index, 1);
    else current.push(value);
    setFormData({ ...formData, [field]: current });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.eventId) return alert("Please select an event");
    setLoading(true);

    try {
      await addDoc(collection(db, "registrations"), {
        ...formData,
        age: calculateAge(formData.birthDate),
        checkedIn: false, // Required for your admin entry logic
        timestamp: new Date()
      });
      alert("Registration successful! Please check in with the Admin at the event.");
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Error saving registration.");
    }
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 bg-white">
      <h2 className="text-2xl font-bold text-center text-blue-900 mb-6">Event Registration</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Event Selection */}
        <section>
          <label className="block font-semibold mb-2">Select Event</label>
          <select 
            required
            className="w-full p-3 border rounded-lg shadow-sm"
            onChange={(e) => setFormData({...formData, eventId: e.target.value})}
          >
            <option value="">-- Choose an Event --</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </section>

        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input 
            type="text" placeholder="What's your name?" required
            className="p-3 border rounded-lg"
            onChange={(e) => setFormData({...formData, name: e.target.value})}
          />
          <input 
            type="date" required
            className="p-3 border rounded-lg text-gray-500"
            onChange={(e) => setFormData({...formData, birthDate: e.target.value})}
          />
        </div>

        {/* Gender Choice */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">You're a...</label>
            <select required className="w-full p-3 border rounded-lg" onChange={(e) => setFormData({...formData, gender: e.target.value})}>
              <option value="">Select</option>
              <option value="man">Man</option>
              <option value="woman">Woman</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Looking for a...</label>
            <select required className="w-full p-3 border rounded-lg" onChange={(e) => setFormData({...formData, targetGender: e.target.value})}>
              <option value="">Select</option>
              <option value="man">Man</option>
              <option value="woman">Woman</option>
            </select>
          </div>
        </div>

        {/* Parents Background */}
        <section>
          <label className="block font-semibold mb-2">Your parents are:</label>
          <select required className="w-full p-3 border rounded-lg" onChange={(e) => setFormData({...formData, parents: e.target.value})}>
            <option value="">Select</option>
            <option>Both Jewish</option>
            <option>Mom is Jewish, Dad is not</option>
            <option>Dad is Jewish, Mom is not</option>
            <option>Neither</option>
          </select>
        </section>

        {/* Religious Level */}
        <section>
          <label className="block font-semibold mb-2">Which best describes you?</label>
          <select required className="w-full p-3 border rounded-lg" onChange={(e) => setFormData({...formData, religiousLevel: e.target.value})}>
            <option value="">Select</option>
            {['Orthodox', 'Modern', 'Traditional', 'Conservative', 'Reform', 'Reconstructionist', 'Just Jewish', 'Spiritual'].map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </section>

        {/* Religious Subgroup (Multi) */}
        <section>
          <label className="block font-semibold mb-2">Community / Hashkafa</label>
          <select required className="w-full p-3 border rounded-lg mb-2" onChange={(e) => setFormData({...formData, subGroup: e.target.value})}>
            <option value="">Select yours...</option>
            {RELIGIOUS_SUBGROUPS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <label className="block text-sm text-gray-600 mb-2 italic">I am open to date someone who is:</label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {RELIGIOUS_SUBGROUPS.map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" onChange={() => handleCheckbox(formData.openToSubGroups, opt, 'openToSubGroups')} />
                {opt}
              </label>
            ))}
          </div>
        </section>

        {/* Ethnicity */}
        <section>
          <label className="block font-semibold mb-2">Ethnicity</label>
          <select required className="w-full p-3 border rounded-lg mb-2" onChange={(e) => setFormData({...formData, ethnicity: e.target.value})}>
            <option value="">Select yours...</option>
            {ETHNICITIES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <label className="block text-sm text-gray-600 mb-2 italic">I am open to date someone who is:</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {ETHNICITIES.map(opt => (
              <label key={opt} className="flex items-center gap-2">
                <input type="checkbox" onChange={() => handleCheckbox(formData.openToEthnicities, opt, 'openToEthnicities')} />
                {opt}
              </label>
            ))}
          </div>
        </section>

        {/* Marital Status */}
        <section>
          <label className="block font-semibold mb-2">Marital Status</label>
          <select required className="w-full p-3 border rounded-lg mb-2" onChange={(e) => setFormData({...formData, maritalStatus: e.target.value})}>
            <option value="">Select yours...</option>
            {MARITAL_STATUSES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <label className="block text-sm text-gray-600 mb-2 italic">I am open to date someone who is:</label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {MARITAL_STATUSES.map(opt => (
              <label key={opt} className="flex items-center gap-2">
                <input type="checkbox" onChange={() => handleCheckbox(formData.openToMaritalStatus, opt, 'openToMaritalStatus')} />
                {opt}
              </label>
            ))}
          </div>
        </section>

        {/* Kohen */}
        <section>
          <label className="block font-semibold mb-2">Are you a Kohen?</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" name="kohen" value="yes" onChange={() => setFormData({...formData, isKohen: 'yes'})}/> Yes</label>
            <label className="flex items-center gap-2"><input type="radio" name="kohen" value="no" defaultChecked onChange={() => setFormData({...formData, isKohen: 'no'})}/> No</label>
          </div>
        </section>

        <button 
          disabled={loading}
          type="submit" 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-colors shadow-lg"
        >
          {loading ? "Saving..." : "Register for Event"}
        </button>
      </form>
    </div>
  );
}