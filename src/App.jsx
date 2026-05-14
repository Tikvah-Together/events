import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import RegistrationForm from "./RegistrationForm";
import AdminDashboard from "./AdminDashboard";
import Gatekeeper from "./Gatekeeper";
import AdminGuard from "./AdminGuard";
import SelfCheckIn from "./SelfCheckIn";
import { Tablet, ShieldCheck, UserPlus } from "lucide-react";
import RsvpPage from "./RSVP";

function Home() {
  return (
    <div className="flex flex-col items-center justify-center pt-16 pb-12 px-4">
      <h1 className="text-4xl md:text-6xl font-light text-[#1E3D34] tracking-tight mb-4">
        Tikvah <span className="font-semibold text-[#95B699]">Together</span>
      </h1>
      <div className="w-20 h-1 bg-[#95B699] mb-8"></div>
      <p className="text-xl text-slate-600 mb-12 max-w-2xl text-center leading-relaxed">
        Modern events for the Jewish community. Simple, organized, and
        meaningful.
      </p>

      {/* 3-Way Entry Points */}
      <div className="grid grid-cols-1 md:grid-cols-1 gap-6 w-full max-w-4xl">
        {/* User Registration */}
        <Link
          to="/register"
          className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-blue-900 hover:shadow-lg transition-all text-center"
        >
          <div className="w-12 h-12 bg-blue-50 text-[#95B699] rounded-full flex items-center justify-center mb-4 group-hover:bg-[#95B699] group-hover:text-white transition-colors">
            <UserPlus size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Registration</h3>
          <p className="text-sm text-slate-500 mt-2">
            Sign up for an upcoming event
          </p>
        </Link>

        {/* COMMENT OUT THIS ENTRY FOR NOW 
        <Link
          to="/event"
          className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-orange-500 hover:shadow-lg transition-all text-center"
        >
          <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-full flex items-center justify-center mb-4 group-hover:bg-orange-500 group-hover:text-white transition-colors">
            <Tablet size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Event Login</h3>
          <p className="text-sm text-slate-500 mt-2">
            Claim this device and start your dates
          </p>
        </Link>

        
        <Link
          to="/admin"
          className="group flex flex-col items-center p-8 bg-white border border-slate-200 rounded-2xl hover:border-slate-800 hover:shadow-lg transition-all text-center"
        >
          <div className="w-12 h-12 bg-slate-50 text-slate-600 rounded-full flex items-center justify-center mb-4 group-hover:bg-slate-800 group-hover:text-white transition-colors">
            <ShieldCheck size={24} />
          </div>
          <h3 className="font-bold text-lg text-slate-800">Admin</h3>
          <p className="text-sm text-slate-500 mt-2">
            Manage events and attendees
          </p>
        </Link>
        */}
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white flex flex-col">
        <nav className="border-b border-slate-100 py-6 shrink-0">
          <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
            <Link
              to="/"
              className="flex flex-col hover:opacity-90 transition-opacity"
            >
              <div className="text-xl md:text-2xl font-bold tracking-tighter text-[#1E3D34] leading-none flex items-start">
                SY SmartMatch
              </div>
              <span className="text-[10px] md:text-xs font-semibold text-[#1E3D34]/70 tracking-widest uppercase mt-1">
                by Tikvah Together
              </span>
            </Link>

            {/* 

            <div className="flex space-x-4 md:space-x-8 text-[10px] md:text-xs uppercase tracking-widest font-bold text-slate-400">
              <Link
                to="/register"
                className="hover:text-blue-900 transition-colors"
              >
                Register
              </Link>
              <Link
                to="/event"
                className="hover:text-orange-600 transition-colors"
              >
                Event Login
              </Link>
              <Link
                to="/admin"
                className="hover:text-blue-900 transition-colors"
              >
                Admin
              </Link>
              
              
            </div>

            */}
          </div>
        </nav>

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/register" element={<RegistrationForm />} />
            <Route path="/event" element={<Gatekeeper />} />
            <Route
              path="/admin"
              element={
                <AdminGuard>
                  <AdminDashboard />
                </AdminGuard>
              }
            />
            <Route path="/rsvp" element={<RsvpPage />} />
            <Route path="/selfcheckin" element={<SelfCheckIn />} />
          </Routes>
        </main>

        <footer className="py-8 border-t border-slate-200 text-center text-slate-400 text-sm shrink-0 bg-white">
          © {new Date().getFullYear()} Tikvah Together.
        </footer>
      </div>
    </Router>
  );
}

export default App;
