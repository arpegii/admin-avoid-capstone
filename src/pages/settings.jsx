import React, { useState, useEffect } from "react";
import Sidebar from "../components/sidebar";
import LogoutModal from "../components/logoutModal";
import "../styles/global.css";
import "../styles/settings.css";

const Settings = () => {
  const [isDarkMode, setIsDarkMode] = useState(
    () => localStorage.getItem("darkMode") === "enabled",
  );
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Keep body class and localStorage in sync with current preference.
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add("dark");
      localStorage.setItem("darkMode", "enabled");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("darkMode", "disabled");
    }
  }, [isDarkMode]);

  // Handle dark mode toggle
  const handleDarkModeToggle = () => {
    setIsDarkMode((prev) => !prev);
  };

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleCancelLogout = () => {
    setShowLogoutModal(false);
  };

  const handleConfirmLogout = () => {
    // Logout will be handled by LogoutModal component
  };

  return (
    <div className="dashboard-container bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />

      <div className="settings-page ui-page-shell p-6">
        <h1 className="page-title mb-6">Settings</h1>

        <div className="settings-stack">
          {/* Dark Mode Toggle */}
          <section className="settings-section">
          <div className="settings-item ui-card-surface px-4 py-3">
            <div className="setting-info">
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Dark Mode</span>
              <p className="setting-description text-sm text-slate-500 dark:text-slate-400">
                Switch between light and dark theme
              </p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={isDarkMode}
                onChange={handleDarkModeToggle}
              />
              <span className="slider"></span>
            </label>
          </div>
          </section>

          {/* Notifications Toggle (placeholder) */}
          <section className="settings-section">
          <div className="settings-item ui-card-surface px-4 py-3">
            <div className="setting-info">
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Notifications</span>
              <p className="setting-description text-sm text-slate-500 dark:text-slate-400">
                Enable push notifications for updates
              </p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" disabled />
              <span className="slider"></span>
            </label>
          </div>
          </section>

          {/* Email Alerts Toggle (placeholder) */}
          <section className="settings-section">
          <div className="settings-item ui-card-surface px-4 py-3">
            <div className="setting-info">
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Email Alerts</span>
              <p className="setting-description text-sm text-slate-500 dark:text-slate-400">
                Receive email notifications for important events
              </p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" disabled />
              <span className="slider"></span>
            </label>
          </div>
          </section>

          {/* Logout Button */}
          <section className="settings-section">
          <div className="settings-item ui-card-surface px-4 py-3">
            <div className="setting-info">
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Account</span>
              <p className="setting-description text-sm text-slate-500 dark:text-slate-400">
                Sign out from your account
              </p>
            </div>
            <button className="logout-btn ui-btn-primary" onClick={handleLogoutClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Logout
            </button>
          </div>
          </section>
        </div>
      </div>

      {/* Logout Modal */}
      <LogoutModal
        isOpen={showLogoutModal}
        onCancel={handleCancelLogout}
        onConfirm={handleConfirmLogout}
      />
    </div>
  );
};

export default Settings;
