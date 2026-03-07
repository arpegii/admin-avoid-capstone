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

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add("dark");
      localStorage.setItem("darkMode", "enabled");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("darkMode", "disabled");
    }
  }, [isDarkMode]);

  const handleDarkModeToggle = () => setIsDarkMode((prev) => !prev);
  const handleLogoutClick = () => setShowLogoutModal(true);
  const handleCancelLogout = () => setShowLogoutModal(false);
  const handleConfirmLogout = () => {};

  return (
    <div className="dashboard-container bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />

      <div className="settings-page page-with-topnav">
        <div className="settings-inner">
          {/* Appearance */}
          <div className="settings-group">
            <div className="settings-group-label">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              Appearance
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-icon settings-row-icon--violet">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">Dark Mode</span>
                  <span className="settings-row-desc">
                    Switch between light and dark theme
                  </span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={isDarkMode}
                    onChange={handleDarkModeToggle}
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="settings-group">
            <div className="settings-group-label">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Notifications
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-icon settings-row-icon--sky">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">Push Notifications</span>
                  <span className="settings-row-desc">
                    Get notified about deliveries and updates
                  </span>
                </div>
                <label className="toggle-switch toggle-switch--disabled">
                  <input type="checkbox" disabled />
                  <span className="slider" />
                </label>
              </div>
              <div className="settings-row-divider" />
              <div className="settings-row">
                <div className="settings-row-icon settings-row-icon--amber">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">Email Alerts</span>
                  <span className="settings-row-desc">
                    Receive email notifications for important events
                  </span>
                </div>
                <label className="toggle-switch toggle-switch--disabled">
                  <input type="checkbox" disabled />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>

          {/* Account */}
          <div className="settings-group">
            <div className="settings-group-label">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Account
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-icon settings-row-icon--emerald">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">Profile</span>
                  <span className="settings-row-desc">
                    View and edit your account details
                  </span>
                </div>
                <button className="settings-action-btn" disabled>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    width="14"
                    height="14"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              <div className="settings-row-divider" />
              <div className="settings-row">
                <div className="settings-row-icon settings-row-icon--rose">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">
                    Privacy &amp; Security
                  </span>
                  <span className="settings-row-desc">
                    Manage your data and security preferences
                  </span>
                </div>
                <button className="settings-action-btn" disabled>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    width="14"
                    height="14"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              <div className="settings-row-divider" />
              <div className="settings-row settings-row--logout">
                <div className="settings-row-icon settings-row-icon--red">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </div>
                <div className="settings-row-body">
                  <span className="settings-row-title">Sign Out</span>
                  <span className="settings-row-desc">
                    Sign out from your account
                  </span>
                </div>
                <button className="logout-btn" onClick={handleLogoutClick}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LogoutModal
        isOpen={showLogoutModal}
        onCancel={handleCancelLogout}
        onConfirm={handleConfirmLogout}
      />
    </div>
  );
};

export default Settings;
