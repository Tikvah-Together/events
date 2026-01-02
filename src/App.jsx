import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegistrationForm from './RegistrationForm';
import AdminDashboard from './AdminDashboard';
import Gatekeeper from './Gatekeeper';
import EventController from './EventController';

function Home() {
  return (
    <div className="flex flex-col items-center justify-center pt-20 pb-12 px-4">
      <h1 className="text-4xl md:text-6xl font-light text-slate-800 tracking-tight mb-4">
        Tikvah <span className="font-semibold text-blue-900">Together</span>
      </h1>
      <div className="w-20 h-1 bg-blue-900 mb-8"></div>
      <p className="text-xl text-slate-600 mb-12 max-w-2xl text-center leading-relaxed">
        Modern events for the Jewish community. Simple, organized, and meaningful.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-md">
        <Link to="/register" className="flex-1 text-center bg-blue-900 text-white px-8 py-4 rounded-md font-medium text-lg hover:bg-blue-800 transition-all shadow-sm">
          Register
        </Link>
        <Link to="/admin" className="flex-1 text-center border border-slate-300 text-slate-700 px-8 py-4 rounded-md font-medium text-lg hover:bg-slate-50 transition-all">
          Admin
        </Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white">
        {/* Simple Minimalist Nav */}
        <nav className="border-b border-slate-100 py-6">
          <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
            <Link to="/" className="text-2xl font-bold tracking-tighter text-slate-800">
              TIKVAH<span className="text-blue-900 text-sm align-top ml-1">●</span>
            </Link>
            <div className="hidden md:flex space-x-8 text-sm uppercase tracking-widest font-semibold text-slate-500">
              <Link to="/register" className="hover:text-blue-900 transition">Register</Link>
              <Link to="/gate" className="hover:text-blue-900 transition">Check-In</Link>
              <Link to="/live" className="text-red-600 hover:text-red-700 transition">Live</Link>
            </div>
          </div>
        </nav>

        {/* Content Container */}
        <main className="max-w-6xl mx-auto px-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/register" element={<RegistrationForm />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/gate" element={<Gatekeeper />} />
            <Route path="/live" element={<EventController />} />
          </Routes>
        </main>

        <footer className="mt-20 py-10 border-t border-slate-50 text-center text-slate-400 text-sm">
          © {new Date().getFullYear()} Tikvah Together. All rights reserved.
        </footer>
      </div>
    </Router>
  );
}

export default App;