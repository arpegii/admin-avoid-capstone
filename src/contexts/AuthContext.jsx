/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabaseClient } from "../App";

const AuthContext = createContext({});
const OTP_VERIFIED_KEY = "adminOtpVerified";

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [otpVerified, setOtpVerifiedState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const navigate = useNavigate();

  const clearAuthState = useCallback(() => {
    setUser(null);
    setOtpVerifiedState(false);
    sessionStorage.removeItem(OTP_VERIFIED_KEY);
  }, []);

  const setOtpVerified = (value) => {
    setOtpVerifiedState(value);
    if (value) {
      sessionStorage.setItem(OTP_VERIFIED_KEY, "true");
    } else {
      sessionStorage.removeItem(OTP_VERIFIED_KEY);
    }
  };

  useEffect(() => {
    const isInvalidRefreshTokenError = (error) => {
      const msg = String(error?.message || "").toLowerCase();
      return msg.includes("invalid refresh token") || msg.includes("refresh token not found");
    };

    let mounted = true;

    // Restore session on refresh
    const hydrateSession = async () => {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
          if (isInvalidRefreshTokenError(error)) {
            // Drop only local auth state to recover from stale tokens.
            await supabaseClient.auth.signOut({ scope: "local" });
          }
          if (!mounted) return;
          clearAuthState();
          setLoading(false);
          return;
        }

        if (!mounted) return;
        if (data?.session) {
          setUser(data.session.user);
          setOtpVerifiedState(sessionStorage.getItem(OTP_VERIFIED_KEY) === "true");
        } else {
          clearAuthState();
        }
      } catch {
        if (!mounted) return;
        clearAuthState();
      } finally {
        if (mounted) setLoading(false);
      }
    };

    hydrateSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") {
        setUser(session?.user ?? null);
        setOtpVerifiedState(sessionStorage.getItem(OTP_VERIFIED_KEY) === "true");
      }
      if (event === "SIGNED_OUT") {
        clearAuthState();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [clearAuthState]);

  const openLogoutModal = () => {
    setShowLogoutModal(true);
  };

  const closeLogoutModal = () => {
    setShowLogoutModal(false);
  };

  const handleLogout = async () => {
    await supabaseClient.auth.signOut();
    setShowLogoutModal(false);
    navigate("/");
  };

  const value = {
    user,
    otpVerified,
    loading,
    showLogoutModal,
    openLogoutModal,
    closeLogoutModal,
    handleLogout,
    setOtpVerified,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
