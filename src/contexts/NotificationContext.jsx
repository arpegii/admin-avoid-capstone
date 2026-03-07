/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from "react";
import toast from "react-hot-toast";

const NotificationContext = createContext({});

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  // Show toast notification (temporary popup)
  const showToast = useCallback(
    (message, type = "success", duration = 3000) => {
      const toastOptions = {
        duration: duration,
        position: "top-right",
      };

      if (type === "success") {
        toast.success(message, toastOptions);
      } else if (type === "error") {
        toast.error(message, toastOptions);
      } else if (type === "loading") {
        toast.loading(message, toastOptions);
      } else {
        toast(message, toastOptions);
      }
    },
    [],
  );

  // Add notification to notification center
  const addNotification = useCallback((notification) => {
    const id = Date.now();
    const newNotification = {
      id,
      timestamp: new Date(),
      read: false,
      ...notification,
    };
    setNotifications((prev) => [newNotification, ...prev]);
    return id;
  }, []);

  // Remove notification from notification center
  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Clear all notifications
  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Mark notification as read
  const markAsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // Notification helper methods for specific events
  const notifyParcelDelivered = useCallback(
    (parcelId, recipientName) => {
      const message = `📦 Parcel ${parcelId} delivered to ${recipientName}`;
      showToast(message, "success");
      addNotification({
        type: "parcel_delivered",
        title: "Parcel Delivered",
        message: message,
        parcelId,
        recipientName,
        icon: "📦",
      });
    },
    [showToast, addNotification],
  );

  const notifyRiderViolation = useCallback(
    (riderId, riderName, violationType, speed) => {
      const message = `⚠️ Rider ${riderName} exceeded speed limit: ${speed} km/h`;
      showToast(message, "error", 4000);
      addNotification({
        type: "rider_violation",
        title: "Rider Violation Alert",
        message: message,
        riderId,
        riderName,
        violationType,
        speed,
        icon: "⚠️",
      });
    },
    [showToast, addNotification],
  );

  const notifyGeneralInfo = useCallback(
    (title, message, icon = "ℹ️") => {
      showToast(message);
      addNotification({
        type: "info",
        title,
        message,
        icon,
      });
    },
    [showToast, addNotification],
  );

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        showToast,
        addNotification,
        removeNotification,
        clearAllNotifications,
        markAsRead,
        markAllAsRead,
        notifyParcelDelivered,
        notifyRiderViolation,
        notifyGeneralInfo,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
