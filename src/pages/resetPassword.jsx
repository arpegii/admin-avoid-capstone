import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabaseClient } from "../App";
import "../styles/login.css";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (!mounted) return;
      if (data?.session) {
        setReady(true);
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: "", message: "" });

    if (!ready) {
      setStatus({
        type: "error",
        message: "Invalid or expired recovery link. Request a new reset email.",
      });
      return;
    }

    if (password.length < 8) {
      setStatus({
        type: "error",
        message: "Password must be at least 8 characters.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setStatus({
        type: "error",
        message: "Passwords do not match.",
      });
      return;
    }

    setIsLoading(true);
    const { error } = await supabaseClient.auth.updateUser({ password });
    setIsLoading(false);

    if (error) {
      setStatus({
        type: "error",
        message: error.message || "Failed to update password.",
      });
      return;
    }

    setSuccessModalOpen(true);
    setTimeout(() => {
      navigate("/");
    }, 1600);
  };

  const closeSuccessModal = () => {
    setSuccessModalOpen(false);
    navigate("/");
  };

  return (
    <div className="login-page ui-auth-page font-sans">
      <div className="float-shape float-shape--1" />
      <div className="float-shape float-shape--2" />
      <div className="float-shape float-shape--3" />
      <div className="float-shape float-shape--4" />
      <div className="float-shape float-shape--5" />
      <div className="float-shape float-shape--6" />
      <div className="float-shape float-shape--7" />
      <div className="float-shape float-shape--8" />
      <div className="float-shape float-shape--9" />
      <div className="float-shape float-shape--10" />

      <div className="centered-content">
        <div className="modern-card reset-card ui-auth-panel overflow-hidden">
          <div className="login-right-panel bg-gradient-to-br from-red-600 to-red-900">
            <div className="login-logo-top reset-logo-top">
              <img src="images/logo.png" alt="Logo" />
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>New Password</label>
                <div className="input-wrapper has-toggle">
                  <svg
                    className="input-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={showNewPassword ? "text" : "password"}
                    className="form-input rounded-xl border border-white/30 bg-white/95 focus:ring-4 focus:ring-white/25"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle icon-toggle"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                  >
                    {showNewPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5.05 0-9.27-3.11-11-8 1-2.84 2.94-5.06 5.38-6.36" />
                        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5.05 0 9.27 3.11 11 8a11.05 11.05 0 0 1-4.07 5.04" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <path d="m1 1 22 22" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Confirm New Password</label>
                <div className="input-wrapper has-toggle">
                  <svg
                    className="input-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    className="form-input rounded-xl border border-white/30 bg-white/95 focus:ring-4 focus:ring-white/25"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle icon-toggle"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5.05 0-9.27-3.11-11-8 1-2.84 2.94-5.06 5.38-6.36" />
                        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5.05 0 9.27 3.11 11 8a11.05 11.05 0 0 1-4.07 5.04" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <path d="m1 1 22 22" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {status.message && (
                <div className="login-error">
                  {status.message}
                </div>
              )}

              <button
                type="submit"
                className={`login-btn ${isLoading ? "loading" : ""} ui-btn-secondary rounded-xl border-white/50 bg-white font-semibold text-red-700 hover:bg-red-50`}
                disabled={isLoading}
              >
                {isLoading ? "" : "Update Password"}
              </button>

              <div className="login-inline-actions">
                <Link to="/" className="otp-link-btn reset-back-link">
                  Back to Login
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>

      {successModalOpen && (
        <div
          className="otp-result-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={closeSuccessModal}
        >
          <div
            className="otp-result-modal rounded-2xl border border-slate-200 shadow-2xl dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-result-header">
              <h3>Password Updated</h3>
            </div>
            <div className="otp-result-body">
              <div className="otp-result-symbol success" aria-hidden="true">
                <span className="otp-result-checkmark" />
              </div>
              <p className="otp-result-message">
                Your password was changed successfully. Redirecting to login...
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
