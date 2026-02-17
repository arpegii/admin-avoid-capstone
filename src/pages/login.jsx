import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabaseClient } from "../App";
import "../styles/login.css";

const OTP_RESEND_COOLDOWN_SECONDS = 60;

export default function Login({ setOtpVerified }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpResultModal, setOtpResultModal] = useState({
    open: false,
    type: "success",
    message: "",
  });
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const otpInputRefs = useRef([]);
  const lastAutoSubmittedOtpRef = useRef("");

  const normalizedEmail = email.trim().toLowerCase();
  const otpCode = otpDigits.join("");

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timerId = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timerId);
  }, [resendCooldown]);

  useEffect(() => {
    if (showOtpInput) {
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 0);
    }
  }, [showOtpInput]);

  const isEmailRateLimitError = (err) => {
    const message = String(err?.message || "").toLowerCase();
    return err?.status === 429 || message.includes("rate limit");
  };

  // ------------------- LOGIN (Step 1: Password) -------------------
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const { error: loginError } =
        await supabaseClient.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

      if (loginError) {
        setError(loginError.message);
        setIsLoading(false);
        return;
      }

      if (setOtpVerified) setOtpVerified(false);
      await supabaseClient.auth.signOut();
      try {
        await sendOTP(normalizedEmail);
        setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      } catch (otpError) {
        if (isEmailRateLimitError(otpError)) {
          setShowOtpInput(true);
          setError(
            "A code was sent recently. Please use it or wait before requesting a new one.",
          );
          setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
          return;
        }
        throw otpError;
      }

      setShowOtpInput(true);
      setOtpDigits(["", "", "", "", "", ""]);
      lastAutoSubmittedOtpRef.current = "";
      setError("");
    } catch (err) {
      console.error(err);
      setError("Login failed. Please check your credentials and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------- SEND OTP -------------------
  const sendOTP = async (targetEmail = normalizedEmail) => {
    const { error: otpError } = await supabaseClient.auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser: false },
    });
    if (otpError) throw otpError;
  };

  // ------------------- VERIFY OTP -------------------
  const handleVerifyOTP = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      setIsLoading(true);

      try {
        const { error: verifyError } = await supabaseClient.auth.verifyOtp({
          email: normalizedEmail,
          token: otpCode.trim(),
          type: "email",
        });

        if (verifyError) {
          setOtpResultModal({
            open: true,
            type: "error",
            message: verifyError.message || "Incorrect OTP. Please try again.",
          });
          setIsLoading(false);
          return;
        }

        if (setOtpVerified) setOtpVerified(true);
        setOtpResultModal({
          open: true,
          type: "success",
          message:
            "OTP verified successfully. You can now continue to the dashboard.",
        });
        setIsLoading(false);
      } catch (err) {
        console.error(err);
        setOtpResultModal({
          open: true,
          type: "error",
          message: "OTP verification failed. Try again.",
        });
        setIsLoading(false);
      }
    },
    [normalizedEmail, otpCode, setOtpVerified],
  );

  // ------------------- RESEND OTP -------------------
  const handleResendOTP = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setIsLoading(true);
    try {
      await sendOTP(normalizedEmail);
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setError("A new verification code has been sent.");
      setOtpDigits(["", "", "", "", "", ""]);
      lastAutoSubmittedOtpRef.current = "";
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 0);
    } catch (err) {
      console.error(err);
      if (isEmailRateLimitError(err)) {
        setError("You requested codes too quickly. Please wait and try again.");
        setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      } else {
        setError("Failed to resend OTP. Try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      const next = [...otpDigits];
      next[index] = "";
      setOtpDigits(next);
      return;
    }
    const next = [...otpDigits];
    next[index] = cleaned.slice(-1);
    setOtpDigits(next);
    if (index < 5) otpInputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      otpInputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData.getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    pasted.split("").forEach((digit, idx) => {
      next[idx] = digit;
    });
    setOtpDigits(next);
    const nextFocusIndex = Math.min(pasted.length, 5);
    setTimeout(() => {
      otpInputRefs.current[nextFocusIndex]?.focus();
    }, 0);
  };

  const openForgotModal = () => {
    setForgotEmail(normalizedEmail || "");
    setForgotError("");
    setForgotMessage("");
    setForgotModalOpen(true);
  };

  const closeForgotModal = () => {
    if (forgotLoading) return;
    setForgotModalOpen(false);
    setForgotError("");
    setForgotMessage("");
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError("");
    setForgotMessage("");

    const targetEmail = forgotEmail.trim().toLowerCase();
    if (!targetEmail) {
      setForgotError("Please enter your email address.");
      return;
    }

    setForgotLoading(true);
    try {
      const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(
        targetEmail,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        },
      );
      if (resetError) {
        setForgotError(resetError.message || "Failed to send reset email.");
        return;
      }
      setForgotMessage("Password reset link sent. Check your email inbox.");
    } catch (err) {
      console.error(err);
      setForgotError("Failed to send reset email. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  useEffect(() => {
    if (!showOtpInput) return;
    if (otpCode.length !== 6) return;
    if (isLoading) return;
    if (otpCode === lastAutoSubmittedOtpRef.current) return;
    lastAutoSubmittedOtpRef.current = otpCode;
    handleVerifyOTP({ preventDefault: () => {} });
  }, [otpCode, isLoading, showOtpInput, handleVerifyOTP]);

  const closeOtpResultModal = () => {
    const isSuccess = otpResultModal.type === "success";
    setOtpResultModal({ open: false, type: "success", message: "" });
    if (isSuccess) {
      navigate("/dashboard");
      return;
    }
    setOtpDigits(["", "", "", "", "", ""]);
    lastAutoSubmittedOtpRef.current = "";
    setTimeout(() => {
      otpInputRefs.current[0]?.focus();
    }, 0);
  };

  useEffect(() => {
    if (!otpResultModal.open || otpResultModal.type !== "success")
      return undefined;
    const timerId = setTimeout(() => {
      navigate("/dashboard");
    }, 2200);
    return () => clearTimeout(timerId);
  }, [otpResultModal.open, otpResultModal.type, navigate]);

  // ------------------- RENDER -------------------
  return (
    <div className="login-page bg-gradient-to-br from-red-600 via-red-700 to-red-900 font-sans">
      {/* Floating decorative shapes */}
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
        <div className="modern-card overflow-hidden rounded-3xl border border-white/20 shadow-2xl shadow-slate-950/40">
          {/* ── Left panel: illustration ── */}
          <div className="login-card-brand">
            <img
              src="images/rider-logo.png"
              alt="Rider illustration"
              className="logo-placeholder"
            />
          </div>

          {/* ── Right panel: form ── */}
          <div className="login-right-panel bg-gradient-to-br from-red-600 to-red-900">
            {/* Logo at the top of the form */}
            <div className="login-logo-top">
              <img src="images/logo.png" alt="Logo" />
            </div>

            {!showOtpInput ? (
              // Password Form
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label>Email Address</label>
                  <div className="input-wrapper">
                    <svg
                      className="input-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <input
                      type="email"
                      className="form-input rounded-xl border border-white/30 bg-white/95 focus:ring-4 focus:ring-white/25"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Password</label>
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
                      type={showLoginPassword ? "text" : "password"}
                      className="form-input rounded-xl border border-white/30 bg-white/95 focus:ring-4 focus:ring-white/25"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle icon-toggle"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                    >
                      {showLoginPassword ? (
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

                <div className="login-inline-actions">
                  <button
                    type="button"
                    className="otp-link-btn font-semibold text-white transition hover:text-red-100"
                    onClick={openForgotModal}
                    disabled={isLoading}
                  >
                    Forgot password?
                  </button>
                </div>
                {error && <div className="login-error">{error}</div>}

                <button
                  type="submit"
                  className={`login-btn ${isLoading ? "loading" : ""} rounded-xl bg-white font-semibold text-red-700 shadow-lg transition hover:bg-red-50`}
                  disabled={isLoading}
                >
                  {isLoading ? "" : "Login"}
                </button>
              </form>
            ) : (
              // OTP Form
              <form onSubmit={handleVerifyOTP}>
                <div className="otp-info">
                  <p>
                    A verification code has been sent to{" "}
                    <strong>{email}</strong>
                  </p>
                  <p className="otp-subtext">
                    Please check your email and enter the code below.
                  </p>
                </div>

                <div className="form-group">
                  <label>Verification Code</label>
                  <div className="otp-input-container" onPaste={handleOtpPaste}>
                    {otpDigits.map((digit, index) => (
                      <input
                        key={`otp-${index}`}
                        ref={(el) => {
                          otpInputRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        className="otp-input-box rounded-xl border border-white/30 bg-white/95 text-slate-900 focus:ring-4 focus:ring-white/20"
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        maxLength={1}
                        aria-label={`OTP digit ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>

                {error && <div className="login-error">{error}</div>}

                <p className="otp-auto-verify">
                  {isLoading
                    ? "Verifying code…"
                    : "Code verifies automatically after 6 digits."}
                </p>

                <div className="otp-actions">
                  <button
                    type="button"
                    onClick={handleResendOTP}
                    disabled={isLoading || resendCooldown > 0}
                    className="otp-link-btn font-semibold text-white transition hover:text-red-100"
                  >
                    {resendCooldown > 0
                      ? `Resend in ${resendCooldown}s`
                      : "Resend Code"}
                  </button>
                  <span className="otp-divider">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowOtpInput(false);
                      setOtpDigits(["", "", "", "", "", ""]);
                      lastAutoSubmittedOtpRef.current = "";
                      setError("");
                    }}
                    className="otp-link-btn font-semibold text-white transition hover:text-red-100"
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* OTP result modal */}
      {otpResultModal.open && (
        <div
          className="otp-result-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => {
            if (otpResultModal.type === "error") closeOtpResultModal();
          }}
        >
          <div
            className="otp-result-modal rounded-2xl border border-slate-200 shadow-2xl dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-result-header">
              <h3>
                {otpResultModal.type === "success"
                  ? "Verification Successful"
                  : "Verification Failed"}
              </h3>
            </div>
            <div className="otp-result-body">
              <div
                className={`otp-result-symbol ${otpResultModal.type}`}
                aria-hidden="true"
              >
                {otpResultModal.type === "success" ? (
                  <span className="otp-result-checkmark" />
                ) : (
                  <span className="otp-result-xmark" />
                )}
              </div>
              <p className="otp-result-message">
                {otpResultModal.type === "success"
                  ? "OTP verified successfully. Redirecting to dashboard…"
                  : otpResultModal.message}
              </p>
              {otpResultModal.type === "error" && (
                <button
                  type="button"
                  className="otp-result-btn rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-5 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110"
                  onClick={closeOtpResultModal}
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Forgot password modal */}
      {forgotModalOpen && (
        <div
          className="otp-result-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={closeForgotModal}
        >
          <div
            className="forgot-modal rounded-2xl border border-slate-200 shadow-2xl dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-result-header">
              <h3>Reset Password</h3>
            </div>
            <form className="forgot-modal-body" onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label>Email Address</label>
                <div className="input-wrapper">
                  <svg
                    className="input-icon forgot-input-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <input
                    type="email"
                    className="form-input forgot-input rounded-xl border border-slate-300 bg-white focus:ring-4 focus:ring-red-100"
                    placeholder="Enter your email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {forgotError && <div className="login-error">{forgotError}</div>}
              {forgotMessage && <div className="login-success">{forgotMessage}</div>}

              <div className="forgot-modal-actions">
                <button
                  type="button"
                  className="forgot-cancel-btn"
                  onClick={closeForgotModal}
                  disabled={forgotLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`forgot-submit-btn ${forgotLoading ? "loading" : ""}`}
                  disabled={forgotLoading}
                >
                  <span className="forgot-submit-content">
                    {forgotLoading && <span className="forgot-submit-spinner" aria-hidden="true" />}
                    {forgotLoading ? "Sending..." : "Send Reset Link"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
