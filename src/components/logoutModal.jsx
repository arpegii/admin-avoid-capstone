// components/logoutmodal.jsx
import { useState } from "react";
import { supabaseClient } from "../App";
import "../styles/logoutModal.css";

export default function LogoutModal({ isOpen, onCancel, onConfirm }) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    
    try {
      const { error } = await supabaseClient.auth.signOut();
      
      if (error) {
        console.error("Logout error:", error);
        alert("Failed to logout. Please try again.");
        setIsLoggingOut(false);
        return;
      }

      setIsLoggingOut(false);

      if (onConfirm) {
        onConfirm();
      }
      
      if (onCancel) {
        onCancel();
      }
    } catch (err) {
      console.error("Logout failed:", err);
      alert("An error occurred during logout.");
      setIsLoggingOut(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Confirm Logout</h2>
          <button className="close-btn" onClick={onCancel} disabled={isLoggingOut}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p>Are you sure you want to logout?</p>
        </div>

        <div className="modal-footer">
          <button 
            className="btn-cancel" 
            onClick={onCancel}
            disabled={isLoggingOut}
          >
            Cancel
          </button>
          <button 
            className="btn-logout" 
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>
    </div>
  );
}
