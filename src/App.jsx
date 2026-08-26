import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import RegistrationForm from "./RegistrationForm";
import AdminDashboard from "./AdminDashboard";
import Event from "./Event";
import AdminGuard from "./AdminGuard";
import SelfCheckIn from "./SelfCheckIn";
import { UserPlus } from "lucide-react";
import RsvpPage from "./RSVP";
import OrganizerDisplay from "./OrganizerDisplay";

function Home() {
  return (
    <div className="flex flex-col items-center justify-center pt-16 pb-12 px-4">
      <h1 className="text-4xl md:text-6xl font-light text-[#1E3D34] tracking-tight mb-4">
        Tikvah <span className="font-semibold text-[#1E3D34]">Together</span>
      </h1>
      <div className="w-20 h-1 bg-[#1E3D34] mb-8"></div>
      <p className="text-xl text-slate-600 mb-12 max-w-2xl text-center leading-relaxed">
        Modern events for the Jewish community. Simple, organized, and
        meaningful.
      </p>

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
      </div>
    </div>
  );
}

function AppLayout() {
  return (
    <div id="global-app-wrapper" className="min-h-screen flex flex-col bg-linear-to-b from-[#95B699] from-0% to-[#dde7de] to-20% transition-colors duration-500">
      <nav className="border-b-0 border-white/20 py-6 shrink-0">
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
        </div>
      </nav>

      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<RegistrationForm />} />
          <Route path="/event" element={<Event />} />
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
          <Route path="/organizer" element={<OrganizerDisplay />} />
        </Routes>
      </main>

      <footer className="py-8 border-white/20 text-center text-[#1E3D34]/50 text-sm">
        © {new Date().getFullYear()} Tikvah Together.
      </footer>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
}

export default App;
