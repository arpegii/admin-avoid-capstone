import React, { useState, useEffect } from "react";
import Sidebar from "../components/sidebar";
import LogoutModal from "../components/logoutmodal";
import "../styles/global.css";
import "../styles/settings.css";

const Settings = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Initialize dark mode from localStorage on component mount
  useEffect(() => {
    const savedDarkMode = localStorage.getItem("darkMode");
    const isDark = savedDarkMode === "enabled";
    setIsDarkMode(isDark);
    
    // Apply dark mode to body
    if (isDark) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, []);

  // Handle dark mode toggle
  const handleDarkModeToggle = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);

    if (newDarkMode) {
      document.body.classList.add("dark");
      localStorage.setItem("darkMode", "enabled");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("darkMode", "disabled");
    }
  };

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleCancelLogout = () => {
    setShowLogoutModal(false);
  };

  const handleConfirmLogout = () => {
    // Logout will be handled by LogoutModal component
    console.log("Logging out...");
  };

  return (
    <div className="dashboard-container">
      <Sidebar />

      <div className="settings-page">
        <h1 className="page-title">Settings</h1>

        <div className="settings-container">
          {/* Dark Mode Toggle */}
          <div className="settings-item">
            <div className="setting-info">
              <span>Dark Mode</span>
              <p className="setting-description">
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

          {/* Notifications Toggle (placeholder) */}
          <div className="settings-item">
            <div className="setting-info">
              <span>Notifications</span>
              <p className="setting-description">
                Enable push notifications for updates
              </p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" disabled />
              <span className="slider"></span>
            </label>
          </div>

          {/* Email Alerts Toggle (placeholder) */}
          <div className="settings-item">
            <div className="setting-info">
              <span>Email Alerts</span>
              <p className="setting-description">
                Receive email notifications for important events
              </p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" disabled />
              <span className="slider"></span>
            </label>
          </div>

          {/* Logout Button */}
          <div className="settings-item">
            <div className="setting-info">
              <span>Account</span>
              <p className="setting-description">
                Sign out from your account
              </p>
            </div>
            <button className="logout-btn" onClick={handleLogoutClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Logout
            </button>
          </div>
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

