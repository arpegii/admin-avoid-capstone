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
    <div className="modal-overlay bg-slate-950/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="modal-content ui-modal-panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Confirm Logout</h2>
          <button className="close-btn text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200" onClick={onCancel} disabled={isLoggingOut}>
            &times;
          </button>
        </div>

        <div className="modal-body px-6 py-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">Are you sure you want to logout?</p>
        </div>

        <div className="modal-footer flex justify-end gap-3 px-6 py-4">
          <button 
            className="btn-cancel ui-btn-secondary text-sm" 
            onClick={onCancel}
            disabled={isLoggingOut}
          >
            Cancel
          </button>
          <button 
            className="btn-logout ui-btn-primary text-sm" 
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
