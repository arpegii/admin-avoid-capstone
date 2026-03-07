/* eslint-disable react-refresh/only-export-components */
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { useEffect } from "react";

// Pages
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Riders from "./pages/riders";
import Parcels from "./pages/parcels";
import Settings from "./pages/settings";
import Profile from "./pages/profile";
import ResetPassword from "./pages/resetPassword";

// Components
import LogoutModal from "./components/logoutModal";
import PageSpinner from "./components/PageSpinner";
import "./styles/mobile.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/riders"
        element={
          <ProtectedRoute>
            <Riders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/maps"
        element={
          <ProtectedRoute>
            <Riders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/parcels"
        element={
          <ProtectedRoute>
            <Parcels />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppContent() {
  const location = useLocation();

  // ==================== GLOBAL DARK MODE INITIALIZATION ====================
  useEffect(() => {
    const updateFavicon = () => {
      const faviconHref = "/images/rider.png";
      let favicon = document.querySelector("link[rel='icon']");

      if (!favicon) {
        favicon = document.createElement("link");
        favicon.setAttribute("rel", "icon");
        document.head.appendChild(favicon);
      }

      favicon.setAttribute("type", "image/png");
      favicon.setAttribute("href", faviconHref);
    };

    const initializeDarkMode = () => {
      const savedDarkMode = localStorage.getItem("darkMode");

      if (savedDarkMode === "enabled") {
        document.body.classList.add("dark");
        return;
      } else if (savedDarkMode === "disabled") {
        document.body.classList.remove("dark");
        return;
      } else {
        document.body.classList.remove("dark");
        localStorage.setItem("darkMode", "disabled");
      }
    };

    initializeDarkMode();
    updateFavicon();

    const darkClassObserver = new MutationObserver(() => {
      updateFavicon();
    });
    darkClassObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const handleStorageChange = (e) => {
      if (e.key === "darkMode") {
        if (e.newValue === "enabled") {
          document.body.classList.add("dark");
        } else {
          document.body.classList.remove("dark");
        }
        updateFavicon();
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      darkClassObserver.disconnect();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);
  // ==================== END DARK MODE INITIALIZATION ====================

  useEffect(() => {
    const pageTitles = {
      "/": "Login",
      "/dashboard": "Dashboard",
      "/riders": "Riders",
      "/maps": "Maps",
      "/parcels": "Parcels",
      "/settings": "Settings",
      "/profile": "Profile",
      "/reset-password": "Reset Password",
    };

    document.title = pageTitles[location.pathname] || "Login";
  }, [location.pathname]);

  return (
    <>
      <GlobalLogoutModal />
      <AppRoutes />
      <Analytics />
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        {/* supabaseClient is passed so NotificationProvider can set up
            its own Realtime channel for violation_logs without depending
            on any page component to open modals first. */}
        <NotificationProvider supabase={supabaseClient}>
          <Toaster
            position="top-right"
            reverseOrder={false}
            gutter={8}
            toastOptions={{
              duration: 3000,
            }}
          />
          <AppContent />
        </NotificationProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
