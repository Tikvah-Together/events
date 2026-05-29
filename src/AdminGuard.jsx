import { useState, useEffect } from 'react';
import { auth, googleProvider } from './firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
import { Loader2 } from 'lucide-react';

// ==========================================
// 1. ADD YOUR ALLOWED ADMIN EMAILS HERE
// ==========================================
const ALLOWED_ADMINS = [
  'tikvahtogetherevents@gmail.com',
  'info@tikvahtogether.org',
];

export default function AdminGuard({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Listen for auth state adjustments
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // ==========================================
        // 2. THE SECURITY CHECK
        // ==========================================
        if (ALLOWED_ADMINS.includes(user.email?.toLowerCase())) {
          setIsAuthenticated(true);
        } else {
          // If they aren't on the list, kick them out completely!
          setErrorMsg("Access Denied: Your account is not authorized as an administrator.");
          setIsAuthenticated(false);
          await signOut(auth); 
        }
      } else {
        setIsAuthenticated(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    
    const targetEmail = email.trim().toLowerCase();

    // Fail early on registration if they aren't even on the whitelist
    if (isRegistering && !ALLOWED_ADMINS.includes(targetEmail)) {
      setErrorMsg("Registration Denied: This email is not on the pre-approved admin whitelist.");
      setLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        setErrorMsg("This email address is already registered.");
      } else if (error.code === 'auth/weak-password') {
        setErrorMsg("Password should be at least 6 characters long.");
      } else if (error.code === 'auth/invalid-credential') {
        setErrorMsg("Invalid email or password combination.");
      } else {
        setErrorMsg("Authentication failed. Please verify your entries.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // The useEffect hook above handles checking the whitelist and forcing a logout if unauthorized
    } catch (error) {
      setErrorMsg("Google authentication cancelled or failed.");
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#DEE8DF] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#1E3D34]" size={40} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md bg-white p-8 border border-[#95B699] rounded-2xl shadow-md text-[#1E3D34]">
          <h2 className="text-2xl font-bold mb-2 text-center">
            {isRegistering ? "Create Admin Account" : "Admin Dashboard Access"}
          </h2>
          <p className="text-sm text-center text-slate-500 mb-6">
            {isRegistering ? "Register your secure dashboard profile" : "Secure login required"}
          </p>
          
          {errorMsg && (
            <p className="bg-red-50 text-red-600 text-sm p-3 rounded-xl mb-4 text-center font-medium border border-red-100">
              {errorMsg}
            </p>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Email Address</label>
              <input 
                type="email"
                required
                placeholder="admin@example.com"
                className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Password</label>
              <input 
                type="password"
                required
                placeholder="••••••••"
                className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button 
              type="submit"
              className="w-full mt-2 bg-[#1E3D34] hover:bg-[#1E3D34]/90 text-white font-bold py-3 rounded-xl transition-colors shadow-md"
            >
              {isRegistering ? "Sign Up & Register" : "Sign In to Dashboard"}
            </button>
          </form>

          <div className="relative flex py-5 items-center">
            <div className="grow border-t border-slate-200"></div>
            <span className="shrink mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider">or</span>
            <div className="grow border-t border-slate-200"></div>
          </div>

          <button
            type="button"
            onClick={handleGoogleAuth}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 hover:border-[#95B699] font-semibold py-3 rounded-xl transition-all text-slate-700 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.53-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-8.73z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.11 0-5.74-2.11-6.68-4.96H1.21v3.15C3.18 21.88 7.31 24 12 24z"/>
              <path fill="#FBBC05" d="M5.32 14.24A7.16 7.16 0 0 1 5 12c0-.79.13-1.57.32-2.34V6.51H1.21A11.94 11.94 0 0 0 0 12c0 1.92.45 3.74 1.21 5.39l4.11-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.18 2.12 1.21 5.39l4.11 3.15c.94-2.85 3.57-4.96 6.68-4.96z"/>
            </svg>
            Continue with Google
          </button>

          <div className="mt-6 text-center text-sm">
            {isRegistering ? (
              <p>
                Already have an account?{" "}
                <button 
                  onClick={() => { setIsRegistering(false); setErrorMsg(''); }} 
                  className="text-[#95B699] font-bold hover:underline ml-1"
                >
                  Sign In
                </button>
              </p>
            ) : (
              <p>
                Need access?{" "}
                <button 
                  onClick={() => { setIsRegistering(true); setErrorMsg(''); }} 
                  className="text-[#95B699] font-bold hover:underline ml-1"
                >
                  Create Account
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button 
        onClick={() => signOut(auth)}
        className="absolute top-4 right-4 z-50 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow transition-all"
      >
        Log Out Admin
      </button>
      {children}
    </div>
  );
}