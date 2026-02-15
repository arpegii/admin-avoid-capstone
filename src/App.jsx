import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { useEffect } from "react";

// Pages
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Riders from "./pages/riders";
import Parcels from "./pages/Parcels";
import Settings from "./pages/Settings";
import Profile from "./pages/profile";

// Components
import LogoutModal from "./components/logoutmodal";
import PageSpinner from "./components/PageSpinner";

const SUPABASE_URL = "https://jyoumapskekkstkuzeai.supabase.co";
const SUPABASE_KEY = "sb_publishable_s2slGVKymzp1c54Hg_J80Q_oKO9eG7V";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

function ProtectedRoute({ children }) {
  const { otpVerified, loading } = useAuth();

  if (loading) {
    return <PageSpinner fullScreen label="Loading..." />;
  }

  if (!otpVerified) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function GlobalLogoutModal() {
  const { showLogoutModal, closeLogoutModal, handleLogout } = useAuth();

  // Force re-render tracking
  useEffect(() => {
    console.log("=== GLOBAL LOGOUT MODAL useEffect ===");
    console.log("showLogoutModal changed to:", showLogoutModal);
  }, [showLogoutModal]);

  console.log("=== GLOBAL LOGOUT MODAL RENDER ===");
  console.log("showLogoutModal:", showLogoutModal);

  return (
    <>
      {showLogoutModal && (
        <LogoutModal
          isOpen={showLogoutModal}
          onCancel={closeLogoutModal}
          onConfirm={handleLogout}
        />
      )}
    </>
  );
}

function AppRoutes() {
  const { setOtpVerified } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<Login setOtpVerified={setOtpVerified} />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/riders" element={<ProtectedRoute><Riders /></ProtectedRoute>} />
      <Route path="/parcels" element={<ProtectedRoute><Parcels /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppContent() {
  const { showLogoutModal } = useAuth();
  
  console.log("=== APP CONTENT RENDER ===");
  console.log("showLogoutModal in AppContent:", showLogoutModal);
  
  // ==================== GLOBAL DARK MODE INITIALIZATION ====================
  useEffect(() => {
    const initializeDarkMode = () => {
      const savedDarkMode = localStorage.getItem('darkMode');
      
      if (savedDarkMode === 'enabled') {
        // User has dark mode enabled
        document.body.classList.add('dark');
      } else if (savedDarkMode === 'disabled') {
        // User has dark mode disabled
        document.body.classList.remove('dark');
      } else {
        // No preference saved - check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.body.classList.add('dark');
          localStorage.setItem('darkMode', 'enabled');
        } else {
          localStorage.setItem('darkMode', 'disabled');
        }
      }
    };

    // Initialize dark mode on app load
    initializeDarkMode();

    // Sync dark mode across browser tabs
    const handleStorageChange = (e) => {
      if (e.key === 'darkMode') {
        if (e.newValue === 'enabled') {
          document.body.classList.add('dark');
        } else {
          document.body.classList.remove('dark');
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
  // ==================== END DARK MODE INITIALIZATION ====================
  
  return (
    <>
      <GlobalLogoutModal />
      <AppRoutes />
    </>
  );
}

function App() {
  console.log("=== APP COMPONENT RENDER ===");
  
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
