/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
// react-hot-toast is intentionally NOT imported here anymore.
// Custom toast rendering is handled entirely by NotificationCenter.jsx.

const NotificationContext = createContext({});

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context;
};

export const NotificationProvider = ({ children, supabase }) => {
  const [notifications, setNotifications] = useState([]);
  const channelRef = useRef(null);
  const floodChannelRef = useRef(null);
  const parcelChannelRef = useRef(null);

  // ── showToast kept as a no-op so existing call-sites don't break ───────
  // Custom floating toasts are rendered by ToastStack inside NotificationCenter.
  const showToast = useCallback(() => {}, []);

  // ── Add notification to notification center ────────────────────────────
  const addNotification = useCallback((notification) => {
    const id = Date.now() + Math.random();
    const newNotification = {
      id,
      timestamp: new Date(),
      read: false,
      ...notification,
    };
    setNotifications((prev) => [newNotification, ...prev]);
    return id;
  }, []);

  // ── Remove notification ────────────────────────────────────────────────
  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Clear all notifications ────────────────────────────────────────────
  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // ── Mark notification as read ──────────────────────────────────────────
  const markAsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  // ── Mark all as read ───────────────────────────────────────────────────
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // ── Notification helpers ───────────────────────────────────────────────
  const notifyParcelDelivered = useCallback(
    (parcelId, recipientName) => {
      addNotification({
        type: "parcel_delivered",
        title: "Parcel Delivered",
        message: `Parcel ${parcelId} delivered to ${recipientName}`,
        parcelId,
        recipientName,
        icon: "📦",
      });
    },
    [addNotification],
  );

  const notifyRiderViolation = useCallback(
    (riderId, riderName, violationType, speed) => {
      addNotification({
        type: "rider_violation",
        title: "Rider Violation Alert",
        message: `Rider ${riderName} exceeded speed limit: ${speed} km/h`,
        riderId,
        riderName,
        violationType,
        speed,
        icon: "⚠️",
      });
    },
    [addNotification],
  );

  const notifyRiderFloodAffected = useCallback(
    (riderId, riderName, lat, lng) => {
      const coords =
        lat && lng
          ? ` (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})`
          : "";
      addNotification({
        type: "rider_flood",
        title: "Flood Zone Alert",
        message: `Rider ${riderName} is in a flood-affected area${coords}`,
        riderId,
        riderName,
        lat,
        lng,
        icon: "🌊",
      });
    },
    [addNotification],
  );

  const notifyGeneralInfo = useCallback(
    (title, message, icon = "ℹ️") => {
      addNotification({ type: "info", title, message, icon });
    },
    [addNotification],
  );

  // ── Real-time flood-affected listener ─────────────────────────────────
  useEffect(() => {
    if (!supabase) return;

    if (floodChannelRef.current) {
      supabase.removeChannel(floodChannelRef.current);
      floodChannelRef.current = null;
    }

    const floodChannel = supabase
      .channel("rider_flood_affected_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rider_flood_affected" },
        async (payload) => {
          const log = payload.new;
          if (!log) return;

          // Use the name column directly — it's already stored on the row
          let riderName = log.name || "Unknown Rider";
          const riderId = log.user_id || null;

          // Fall back to users table if name is missing
          if (riderId && !log.name) {
            try {
              const { data } = await supabase
                .from("users")
                .select("fname, lname, username")
                .eq("user_id", riderId)
                .maybeSingle();
              if (data) {
                const full = [data.fname, data.lname]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                riderName = full || data.username || "Unknown Rider";
              }
            } catch {
              // fall back to log.name
            }
          }

          notifyRiderFloodAffected(riderId, riderName, log.lat, log.lng);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[NotificationContext] Flood affected listener active");
        }
        if (status === "CHANNEL_ERROR") {
          console.warn("[NotificationContext] Flood channel error — retrying");
        }
      });

    floodChannelRef.current = floodChannel;

    return () => {
      if (floodChannelRef.current) {
        supabase.removeChannel(floodChannelRef.current);
        floodChannelRef.current = null;
      }
    };
  }, [supabase, notifyRiderFloodAffected]);

  // ── Real-time violation listener via Supabase Realtime ─────────────────
  useEffect(() => {
    if (!supabase) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel("violation_logs_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "violation_logs" },
        async (payload) => {
          const log = payload.new;
          if (!log) return;

          let riderName = log.name || "Unknown Rider";
          const riderId = log.user_id || null;

          if (riderId && !log.name) {
            try {
              const { data } = await supabase
                .from("users")
                .select("fname, lname, username")
                .eq("user_id", riderId)
                .maybeSingle();
              if (data) {
                const full = [data.fname, data.lname]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                riderName = full || data.username || "Unknown Rider";
              }
            } catch {
              // fall back to log.name
            }
          }

          const speedMatch = String(log.violation || "").match(/(\d+)/);
          const speed = speedMatch ? parseInt(speedMatch[1], 10) : "—";

          notifyRiderViolation(
            riderId,
            riderName,
            log.violation || "Speed violation",
            speed,
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(
            "[NotificationContext] Realtime violation listener active",
          );
        }
        if (status === "CHANNEL_ERROR") {
          console.warn(
            "[NotificationContext] Realtime channel error — retrying",
          );
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [supabase, notifyRiderViolation]);

  // ── Real-time parcel delivery listener ────────────────────────────────
  // Fires when a rider updates a parcel status to delivered/completed.
  useEffect(() => {
    if (!supabase) return;

    if (parcelChannelRef.current) {
      supabase.removeChannel(parcelChannelRef.current);
      parcelChannelRef.current = null;
    }

    // Statuses that count as a successful delivery (mirrors isDeliveredStatus in Riders.jsx)
    const DELIVERED_STATUSES = [
      "successfully delivered",
      "delivered",
      "successful",
      "success",
      "completed",
    ];

    const isDelivered = (status) =>
      DELIVERED_STATUSES.includes(
        String(status || "")
          .trim()
          .toLowerCase()
          .replace(/[_-]+/g, " "),
      );

    const parcelChannel = supabase
      .channel("parcels_delivery_realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "parcels" },
        async (payload) => {
          const updated = payload.new;
          const previous = payload.old;
          if (!updated) return;

          // Only fire if status just changed TO delivered (not already delivered before)
          if (!isDelivered(updated.status)) return;
          if (isDelivered(previous?.status)) return; // already was delivered — skip

          const parcelId = updated.parcel_id || "—";
          const recipientName = updated.recipient_name || "recipient";
          let riderName = null;

          // Resolve rider name from assigned_rider_id
          if (updated.assigned_rider_id) {
            try {
              const { data } = await supabase
                .from("users")
                .select("fname, lname, username")
                .eq("user_id", updated.assigned_rider_id)
                .maybeSingle();
              if (data) {
                const full = [data.fname, data.lname]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                riderName = full || data.username || null;
              }
            } catch {
              // silently skip
            }
          }

          // parcel_id is int4 — show full number prefixed with #
          const displayParcel = `#${parcelId}`;
          const deliveredTo = riderName
            ? `${recipientName} · by ${riderName}`
            : recipientName;

          notifyParcelDelivered(displayParcel, deliveredTo);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[NotificationContext] Parcel delivery listener active");
        }
        if (status === "CHANNEL_ERROR") {
          console.warn("[NotificationContext] Parcel channel error — retrying");
        }
      });

    parcelChannelRef.current = parcelChannel;

    return () => {
      if (parcelChannelRef.current) {
        supabase.removeChannel(parcelChannelRef.current);
        parcelChannelRef.current = null;
      }
    };
  }, [supabase, notifyParcelDelivered]);

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
        notifyRiderFloodAffected,
        notifyGeneralInfo,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
