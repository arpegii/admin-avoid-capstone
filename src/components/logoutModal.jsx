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
      <div className="modal-content w-full max-w-md rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
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
            className="btn-cancel rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700" 
            onClick={onCancel}
            disabled={isLoggingOut}
          >
            Cancel
          </button>
          <button 
            className="btn-logout rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:brightness-110 disabled:opacity-60" 
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
