import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegistrationForm from './RegistrationForm';
import AdminDashboard from './AdminDashboard';
import Gatekeeper from './Gatekeeper';
import EventController from './EventController';
import AdminGuard from './AdminGuard';
import { Tablet, ShieldCheck, UserPlus } from 'lucide-react'; // Added icons for clarity

function Home() {
  return (
    <div className="flex flex-col items-center justify-center pt-16 pb-12 px-4">
      <h1 className="text-4xl md:text-6xl font-light text-slate-800 tracking-tight mb-4">
        Tikvah <span className="font-semibold text-blue-900">Together</span>
      </h1>
      <div className="w-20 h-1 bg-blue-900 mb-8"></div>
      <p className="text-xl text-slate-600 mb-12 max-w-2xl text-center leading-relaxed">
        Modern events for the Jewish community. Simple, organized, and meaningful.
      </p>
      
      {/* 3-Way Entry Points */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        
        {/* User Registration */}
        <Link to="/register" className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-blue-900 hover:shadow-lg transition-all text-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-900 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-900 group-hover:text-white transition-colors">
            <UserPlus size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Registration</h3>
          <p className="text-sm text-slate-500 mt-2">Sign up for an upcoming event</p>
        </Link>

        {/* iPad / Gatekeeper Entry */}
        <Link to="/event" className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-orange-500 hover:shadow-lg transition-all text-center">
          <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-full flex items-center justify-center mb-4 group-hover:bg-orange-500 group-hover:text-white transition-colors">
            <Tablet size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Event iPad</h3>
          <p className="text-sm text-slate-500 mt-2">Claim this device and start your dates</p>
        </Link>

        {/* Admin Access */}
        <Link to="/admin" className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-slate-800 hover:shadow-lg transition-all text-center">
          <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-full flex items-center justify-center mb-4 group-hover:bg-slate-800 group-hover:text-white transition-colors">
            <ShieldCheck size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Organizer</h3>
          <p className="text-sm text-slate-500 mt-2">Manage events and attendees</p>
        </Link>

      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white">
        <nav className="border-b border-slate-100 py-6">
          <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
            <Link to="/" className="text-2xl font-bold tracking-tighter text-slate-800">
              TIKVAH<span className="text-blue-900 text-sm align-top ml-1">●</span>
            </Link>
            <div className="hidden md:flex space-x-8 text-xs uppercase tracking-widest font-bold text-slate-400">
              <Link to="/register" className="hover:text-blue-900 transition-colors">Register</Link>
              <Link to="/event" className="hover:text-orange-600 transition-colors">iPad Login</Link>
              <Link to="/admin" className="hover:text-blue-900 transition-colors">Admin</Link>
            </div>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/register" element={<RegistrationForm />} />
            
            {/* GATEKEEPER: This is the iPad's main entry point */}
            {/* We keep it under AdminGuard so only staff can set up the iPads initially */}
            <Route path="/event" element={<AdminGuard><Gatekeeper /></AdminGuard>} />
            
            {/* LIVE: This is where the iPads go after they login via Gatekeeper */}
            <Route path="/live" element={<AdminGuard><EventController /></AdminGuard>} />

            {/* ADMIN DASHBOARD */}
            <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
          </Routes>
        </main>

        <footer className="mt-20 py-10 border-t border-slate-50 text-center text-slate-400 text-sm">
          © {new Date().getFullYear()} Tikvah Together.
        </footer>
      </div>
    </Router>
  );
}

export default App;