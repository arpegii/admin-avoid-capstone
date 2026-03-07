import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNotification } from "../contexts/NotificationContext";
import { FaBell, FaTimes, FaCheck, FaTrash } from "react-icons/fa";
import "../styles/notifications.css";

const TOAST_DURATION = 5000;
const MAX_TOASTS = 4;

// ─────────────────────────────────────────────────────────────
// Internal Toast Stack — floats at document.body via portal
// ─────────────────────────────────────────────────────────────
const ToastStack = ({ notifications }) => {
  const seenIdsRef = useRef(new Set());
  const [toasts, setToasts] = useState([]);

  // Pre-seed IDs that exist on mount so they never pop as toasts
  useEffect(() => {
    notifications.forEach((n) => seenIdsRef.current.add(n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface only genuinely new notifications as toasts
  useEffect(() => {
    notifications.forEach((n) => {
      if (seenIdsRef.current.has(n.id)) return;
      seenIdsRef.current.add(n.id);
      setToasts((prev) =>
        [{ ...n, addedAt: Date.now(), exiting: false }, ...prev].slice(
          0,
          MAX_TOASTS,
        ),
      );
    });
  }, [notifications]);

  // Auto-dismiss oldest toast after TOAST_DURATION
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = [...toasts].sort((a, b) => a.addedAt - b.addedAt)[0];
    const remaining = TOAST_DURATION - (Date.now() - oldest.addedAt);
    const t = setTimeout(
      () => {
        setToasts((prev) =>
          prev.map((t) => (t.id === oldest.id ? { ...t, exiting: true } : t)),
        );
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== oldest.id));
        }, 340);
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(t);
  }, [toasts]);

  const dismiss = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 340);
  }, []);

  const variant = (type) => {
    if (type === "parcel_delivered") return "nc-toast--success";
    if (type === "info") return "nc-toast--info";
    if (type === "rider_flood") return "nc-toast--flood";
    return "nc-toast--violation";
  };

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="nc-toast-stack"
      role="region"
      aria-live="assertive"
      aria-label="Live alerts"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`nc-toast ${variant(toast.type)} ${toast.exiting ? "is-exiting" : ""}`}
          role="alert"
        >
          <div className="nc-toast-body">
            <span className="nc-toast-icon" aria-hidden="true">
              {toast.icon}
            </span>
            <div className="nc-toast-text">
              <span className="nc-toast-title">{toast.title}</span>
              <span className="nc-toast-message">{toast.message}</span>
            </div>
          </div>
          <button
            className="nc-toast-dismiss"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            <FaTimes size={10} />
          </button>
          <div className="nc-toast-progress" aria-hidden="true">
            <div
              className="nc-toast-fill"
              style={{ animationDuration: `${TOAST_DURATION}ms` }}
            />
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
};

// ─────────────────────────────────────────────────────────────
// Notification Center — bell + dropdown
// ─────────────────────────────────────────────────────────────
const NotificationCenter = () => {
  const {
    notifications,
    removeNotification,
    clearAllNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotification();

  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const bellRef = useRef(null);
  const dropdownRef = useRef(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const updatePos = useCallback(() => {
    if (!bellRef.current) return;
    const r = bellRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: `${r.bottom + 8}px`,
      right: `${window.innerWidth - r.right}px`,
      zIndex: 999999,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isOpen, updatePos]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e) => {
      if (
        bellRef.current?.contains(e.target) ||
        dropdownRef.current?.contains(e.target)
      )
        return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  const formatTime = (ts) => {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  };

  const dropdown = isOpen
    ? createPortal(
        <div
          ref={dropdownRef}
          className="nc-dropdown"
          style={dropdownStyle}
          role="dialog"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="nc-dropdown-header">
            <div className="nc-dropdown-header-left">
              <span className="nc-dropdown-title">Notifications</span>
              {unreadCount > 0 && (
                <span className="nc-dropdown-badge">{unreadCount} new</span>
              )}
            </div>
            <button
              className="nc-dropdown-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              <FaTimes size={11} />
            </button>
          </div>

          {/* Toolbar */}
          {notifications.length > 0 && (
            <div className="nc-dropdown-toolbar">
              <button className="nc-toolbar-btn" onClick={markAllAsRead}>
                <FaCheck size={10} /> Mark all read
              </button>
              <button
                className="nc-toolbar-btn nc-toolbar-btn--danger"
                onClick={clearAllNotifications}
              >
                <FaTrash size={10} /> Clear all
              </button>
            </div>
          )}

          {/* List */}
          <div className="nc-dropdown-list">
            {notifications.length === 0 ? (
              <div className="nc-empty">
                <div className="nc-empty-icon">
                  <FaBell />
                </div>
                <p className="nc-empty-title">All caught up</p>
                <p className="nc-empty-sub">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`nc-item nc-item--${n.type} ${n.read ? "is-read" : "is-unread"}`}
                  onClick={() => markAsRead(n.id)}
                >
                  <div className="nc-item-icon">{n.icon}</div>
                  <div className="nc-item-body">
                    <span className="nc-item-title">{n.title}</span>
                    <span className="nc-item-msg">{n.message}</span>
                    <span className="nc-item-time">
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                  <button
                    className="nc-item-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeNotification(n.id);
                    }}
                    aria-label="Remove"
                  >
                    <FaTimes size={10} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="nc-root">
      <button
        ref={bellRef}
        className="nc-bell"
        onClick={() => {
          if (!isOpen) updatePos();
          setIsOpen((p) => !p);
        }}
        aria-label="Open notifications"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <FaBell className="nc-bell-icon" />
        {unreadCount > 0 && (
          <span className="nc-bell-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {dropdown}
      <ToastStack notifications={notifications} />
    </div>
  );
};

export default NotificationCenter;
