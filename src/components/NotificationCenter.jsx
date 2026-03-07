import { useState } from "react";
import { useNotification } from "../contexts/NotificationContext";
import { FaBell, FaTimes, FaCheck, FaTrash } from "react-icons/fa";
import "../styles/notifications.css";

const NotificationCenter = () => {
  const {
    notifications,
    removeNotification,
    clearAllNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotification();
  const [isOpen, setIsOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleNotificationClick = (id) => {
    markAsRead(id);
  };

  const handleRemoveNotification = (id, e) => {
    e.stopPropagation();
    removeNotification(id);
  };

  const handleMarkAllRead = () => {
    markAllAsRead();
  };

  const handleClearAll = () => {
    clearAllNotifications();
  };

  const formatTime = (timestamp) => {
    const now = new Date();
    const diff = now - new Date(timestamp);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="notification-center">
      {/* Bell Icon Button */}
      <button
        className="notification-bell"
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
        aria-label="Open notifications"
      >
        <FaBell className="bell-icon" />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount}</span>
        )}
      </button>

      {/* Notification Dropdown */}
      {isOpen && (
        <div className="notification-dropdown">
          {/* Header */}
          <div className="notification-header">
            <h3>Notifications</h3>
            <button
              className="close-btn"
              onClick={() => setIsOpen(false)}
              aria-label="Close notifications"
            >
              <FaTimes />
            </button>
          </div>

          {/* Toolbar */}
          {notifications.length > 0 && (
            <div className="notification-toolbar">
              <button
                className="toolbar-btn"
                onClick={handleMarkAllRead}
                title="Mark all as read"
              >
                <FaCheck size={12} /> Mark all read
              </button>
              <button
                className="toolbar-btn danger"
                onClick={handleClearAll}
                title="Clear all notifications"
              >
                <FaTrash size={12} /> Clear all
              </button>
            </div>
          )}

          {/* Notifications List */}
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="empty-state">
                <FaBell className="empty-icon" />
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item ${
                    notification.read ? "read" : "unread"
                  } ${notification.type}`}
                  onClick={() => handleNotificationClick(notification.id)}
                >
                  <div className="notification-content">
                    <div className="notification-icon">{notification.icon}</div>
                    <div className="notification-text">
                      <h4>{notification.title}</h4>
                      <p>{notification.message}</p>
                      <span className="notification-time">
                        {formatTime(notification.timestamp)}
                      </span>
                    </div>
                  </div>
                  <button
                    className="remove-btn"
                    onClick={(e) =>
                      handleRemoveNotification(notification.id, e)
                    }
                    aria-label="Remove notification"
                  >
                    <FaTimes />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
