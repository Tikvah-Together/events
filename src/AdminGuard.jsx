import { useState, useEffect } from 'react';

export default function AdminGuard({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const ADMIN_PIN = "1234"; // CHANGE THIS TO YOUR SECURE PIN

  useEffect(() => {
    const savedAuth = localStorage.getItem('tikvah_admin_auth');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const checkPin = (e) => {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      localStorage.setItem('tikvah_admin_auth', 'true');
      setIsAuthenticated(true);
    } else {
      alert("Incorrect PIN");
      setPin('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center pt-20 px-6">
        <div className="w-full max-w-sm bg-white p-8 border border-slate-200 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-800 mb-6 text-center">Admin Access</h2>
          <form onSubmit={checkPin} className="space-y-4">
            <input 
              type="password"
              placeholder="Enter Admin PIN"
              className="w-full p-3 border border-slate-300 rounded-md text-center text-2xl tracking-widest"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
            />
            <button className="w-full bg-blue-900 text-white py-3 rounded-md font-medium hover:bg-blue-800 transition">
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  return children;
}