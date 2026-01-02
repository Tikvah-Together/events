import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import RegistrationForm from './RegistrationForm';
import AdminDashboard from './AdminDashboard';
import Gatekeeper from './Gatekeeper';
import EventController from './EventController';

// A simple Landing Page component
function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <h1 className="text-5xl font-extrabold text-blue-900 mb-6">Tikvah Together</h1>
      <p className="text-xl text-gray-600 mb-10 max-w-lg">
        Connecting the Jewish community through meaningful, organized events.
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <Link to="/register" className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 transition">
          Register for an Event
        </Link>
        <Link to="/admin" className="bg-gray-200 text-gray-700 px-8 py-4 rounded-xl font-bold text-lg hover:bg-gray-300 transition">
          Admin Portal
        </Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {/* Simple Navigation Bar */}
        <nav className="bg-white shadow-sm p-4 flex justify-between items-center">
          <Link to="/" className="text-xl font-bold text-blue-900">Tikvah Together</Link>
          <div className="space-x-4 text-sm font-medium">
            <Link to="/register" className="hover:text-blue-600">Register</Link>
            <Link to="/gate" className="hover:text-blue-600">Check-In</Link>
            <Link to="/live" className="text-red-500 hover:text-red-600">● Live Event</Link>
          </div>
        </nav>

        {/* Page Routes */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<RegistrationForm />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/gate" element={<Gatekeeper />} />
          <Route path="/live" element={<EventController />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;