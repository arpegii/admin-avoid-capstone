import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/riders.css";
import "../styles/global.css";
import PageSpinner from "../components/PageSpinner";

const OPENWEATHER_API_KEY = "792874a9880224b30b884c44090d0f05";
const FORCE_POLYLINE_PREVIEW = false;
const RIDER_DELIVERY_QUOTA = 150;
const RIDER_QUOTA_REACHED_THRESHOLD = 0.9;
const RIDER_TABLE_PAGE_SIZE = 10;
const RIDER_INSIGHT_PAGE_SIZE = 5;
const RIDER_ACTIVITY_HISTORY_LIMIT = 60;
const RIDER_DAILY_QUOTA = Math.ceil(
  RIDER_DELIVERY_QUOTA * RIDER_QUOTA_REACHED_THRESHOLD,
);

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const isActiveRiderStatus = (value) => {
  const normalized = normalizeStatus(value);
  return normalized === "online" || normalized === "active";
};

const isDeliveredStatus = (value) => {
  const normalized = normalizeStatus(value);
  return (
    normalized === "successfully delivered" ||
    normalized === "delivered" ||
    normalized === "successful" ||
    normalized === "success" ||
    normalized === "completed"
  );
};

const toLocalDayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateQuotaStreak = (parcels = [], dailyQuota = RIDER_DAILY_QUOTA) => {
  const deliveredPerDay = {};
  (parcels || []).forEach((parcel) => {
    if (!isDeliveredStatus(parcel?.status)) return;
    const key = toLocalDayKey(parcel?.created_at);
    if (!key) return;
    deliveredPerDay[key] = (deliveredPerDay[key] || 0) + 1;
  });

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const safetyWindow = 366;
  for (let i = 0; i < safetyWindow; i += 1) {
    const key = toLocalDayKey(cursor);
    const count = deliveredPerDay[key] || 0;
    if (count >= dailyQuota) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  const todayKey = toLocalDayKey(new Date());
  const todayCount = deliveredPerDay[todayKey] || 0;
  return {
    streak,
    todayCount,
    metToday: todayCount >= dailyQuota,
  };
};

const normalizeCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const buildRoutePreviewTrail = (rider, trail = []) => {
  if (Array.isArray(trail) && trail.length >= 2) return trail;
  const lat = Number(rider?.lat);
  const lng = Number(rider?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const key = String(rider?.username || rider?.user_id || "route");
  const seed = key.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const latStep = 0.00032 + (seed % 5) * 0.00004;
  const lngStep = 0.00028 + ((seed >> 1) % 5) * 0.00004;
  return [
    [lat, lng],
    [lat + latStep, lng + lngStep],
    [lat + latStep * 1.9, lng + lngStep * 0.6],
  ];
};

const drawStyledRoute = (
  map,
  trail,
  {
    mainWeight = 3,
    casingWeight = 6,
    isPreview = false,
  } = {},
) => {
  if (!map || !Array.isArray(trail) || trail.length < 2) return [];

  const casing = L.polyline(trail, {
    color: "#1e3a8a",
    weight: casingWeight,
    opacity: isPreview ? 0.18 : 0.24,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);

  const main = L.polyline(trail, {
    color: isPreview ? "#60a5fa" : "#2563eb",
    weight: mainWeight,
    opacity: isPreview ? 0.8 : 0.92,
    lineCap: "round",
    lineJoin: "round",
    dashArray: isPreview ? "5 8" : "10 8",
  }).addTo(map);

  const [endLat, endLng] = trail[trail.length - 1] || [];
  const endpoint = Number.isFinite(endLat) && Number.isFinite(endLng)
    ? L.circleMarker([endLat, endLng], {
        radius: isPreview ? 4 : 5,
        color: "#dbeafe",
        weight: 2,
        fillColor: isPreview ? "#60a5fa" : "#2563eb",
        fillOpacity: 0.95,
        opacity: 0.95,
      }).addTo(map)
    : null;

  return endpoint ? [casing, main, endpoint] : [casing, main];
};

const formatViolationLogDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = date.toLocaleString("en-US", { month: "long" });
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const rawHour = date.getHours();
  const meridiem = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  const hour = String(hour12).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} ${hour}:${minute} ${meridiem}`;
};

const getRiderDisplayName = (rider) => {
  const fullName = [rider?.fname, rider?.lname].filter(Boolean).join(" ").trim();
  return fullName || rider?.username || "Unknown Rider";
};

const formatRelativeTime = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "No activity";
  const now = new Date();
  const diffMs = now.getTime() - value.getTime();
  if (diffMs <= 0) return "Just now";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) {
    const mins = Math.floor(diffMs / minute);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diffMs / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const RiderTableSelect = ({
  value,
  onChange,
  options = [],
  className = "",
  triggerClassName = "",
  menuClassName = "",
  ariaLabel = "Select option",
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = useMemo(
    () => (options || []).find((option) => option.value === value),
    [options, value],
  );

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`rider-table-modern-select ${open ? "is-open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className={`rider-table-modern-trigger ${triggerClassName}`.trim()}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selectedOption?.label || "-"}</span>
        <span className="rider-table-modern-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`rider-table-modern-menu ${menuClassName}`.trim()}
          role="listbox"
        >
          {(options || []).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rider-table-modern-option ${value === option.value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              aria-selected={value === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default function Riders() {
  const location = useLocation();
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [trackingRider, setTrackingRider] = useState("");
  const [loadingMap, setLoadingMap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [selectedRiderInfo, setSelectedRiderInfo] = useState(null);
  const [performanceModalOpen, setPerformanceModalOpen] = useState(false);
  const [violationLogsModalOpen, setViolationLogsModalOpen] = useState(false);
  const [riderViolationLogs, setRiderViolationLogs] = useState([]);
  const [loadingViolationLogs, setLoadingViolationLogs] = useState(false);
  const [violationLogsError, setViolationLogsError] = useState("");
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [creatingRider, setCreatingRider] = useState(false);
  const [createRiderError, setCreateRiderError] = useState("");
  const [showCreateSuccessModal, setShowCreateSuccessModal] = useState(false);
  const [createSuccessMessage, setCreateSuccessMessage] = useState("");
  const [showTrackFailModal, setShowTrackFailModal] = useState(false);
  const [trackFailMessage, setTrackFailMessage] = useState("");
  const [activeMapLayer, setActiveMapLayer] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [weatherCurrent, setWeatherCurrent] = useState(null);
  const [weatherForecast, setWeatherForecast] = useState([]);
  const [showWeatherPanel, setShowWeatherPanel] = useState(false);
  const [fullWeatherLoading, setFullWeatherLoading] = useState(false);
  const [fullWeatherError, setFullWeatherError] = useState("");
  const [fullWeatherCurrent, setFullWeatherCurrent] = useState(null);
  const [fullWeatherForecast, setFullWeatherForecast] = useState([]);
  const [showFullWeatherPanel, setShowFullWeatherPanel] = useState(false);
  const [fullMapModalOpen, setFullMapModalOpen] = useState(false);
  const [fullMapView, setFullMapView] = useState("map");
  const [tableSearchTerm, setTableSearchTerm] = useState("");
  const [tableSortBy, setTableSortBy] = useState("name_asc");
  const [tableFilterBy, setTableFilterBy] = useState("all");
  const [tablePage, setTablePage] = useState(1);
  const [topRidersPage, setTopRidersPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [, setRiderDailyStats] = useState({
    deliveredToday: 0,
    cancelledToday: 0,
  });
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [recentRiderActivity, setRecentRiderActivity] = useState([]);
  const tableSortOptions = useMemo(
    () => [
      { value: "name_asc", label: "Name (A-Z)" },
      { value: "name_desc", label: "Name (Z-A)" },
      { value: "delivered_desc", label: "Most Delivered" },
      { value: "cancelled_desc", label: "Most Cancelled" },
    ],
    [],
  );
  const tableFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Riders" },
      { value: "has_deliveries", label: "Has Deliveries" },
      { value: "high_cancelled", label: "High Cancelled (5+)" },
    ],
    [],
  );

  useEffect(() => {
    if (!showCreateSuccessModal) return undefined;
    const timerId = setTimeout(() => {
      setShowCreateSuccessModal(false);
    }, 2400);
    return () => clearTimeout(timerId);
  }, [showCreateSuccessModal]);

  useEffect(() => {
    if (!showTrackFailModal) return undefined;
    const timerId = setTimeout(() => {
      setShowTrackFailModal(false);
    }, 2600);
    return () => clearTimeout(timerId);
  }, [showTrackFailModal]);

  const normalizedCreateUsername = createUsername.trim();
  const usernameLengthValid = normalizedCreateUsername.length >= 3;
  const usernamePatternValid = /^[A-Za-z0-9_]+$/.test(normalizedCreateUsername);
  const isUsernameValid = usernameLengthValid && usernamePatternValid;

  const passwordLengthValid = createPassword.length >= 8;
  const passwordUpperValid = /[A-Z]/.test(createPassword);
  const passwordLowerValid = /[a-z]/.test(createPassword);
  const passwordNumberValid = /[0-9]/.test(createPassword);
  const passwordSpecialValid = /[^A-Za-z0-9]/.test(createPassword);
  const isPasswordValid =
    passwordLengthValid &&
    passwordUpperValid &&
    passwordLowerValid &&
    passwordNumberValid &&
    passwordSpecialValid;
  const deliveredForQuota = Number(selectedRiderInfo?.deliveredParcels || 0);
  const quotaTargetForSelectedRider = Number(
    selectedRiderInfo?.quotaTarget || RIDER_DELIVERY_QUOTA,
  );
  const safeQuotaTarget = Number.isFinite(quotaTargetForSelectedRider) &&
    quotaTargetForSelectedRider > 0
    ? quotaTargetForSelectedRider
    : RIDER_DELIVERY_QUOTA;
  const quotaPercent = Math.min(
    Math.round((deliveredForQuota / safeQuotaTarget) * 100),
    100,
  );
  const quotaMetTarget = Math.ceil(safeQuotaTarget * RIDER_QUOTA_REACHED_THRESHOLD);
  const hasMetQuota = deliveredForQuota >= quotaMetTarget;
  const hasMetFullQuota = deliveredForQuota >= safeQuotaTarget;
  const isIncentiveEligible = hasMetQuota;
  const quotaStatusClass = hasMetQuota ? "is-met" : "is-below-minimum";
  const quotaStatusLabel = hasMetQuota ? "Quota Reached" : "Below Quota";
  const quotaStrokeDasharray = `${quotaPercent * 3.02} 302`;
  const joinDateToday = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);
  const trackingRiderDisplayName = useMemo(() => {
    const trackedRider = riders.find((rider) => rider.username === trackingRider);
    return getRiderDisplayName(trackedRider || { username: trackingRider });
  }, [riders, trackingRider]);
  const selectedRiderDisplayName = useMemo(
    () => getRiderDisplayName(selectedRiderInfo),
    [selectedRiderInfo],
  );
  const topRiders = useMemo(
    () =>
      [...riders]
        .sort(
          (a, b) =>
            Number(b?.deliveredParcels || 0) - Number(a?.deliveredParcels || 0),
        ),
    [riders],
  );
  const topRidersTotalPages = useMemo(
    () => Math.max(1, Math.ceil(topRiders.length / RIDER_INSIGHT_PAGE_SIZE)),
    [topRiders.length],
  );
  const pagedTopRiders = useMemo(() => {
    const start = (topRidersPage - 1) * RIDER_INSIGHT_PAGE_SIZE;
    return topRiders.slice(start, start + RIDER_INSIGHT_PAGE_SIZE);
  }, [topRiders, topRidersPage]);
  const isMapsPage = location.pathname === "/maps";
  const focusedRiderQuery = useMemo(
    () => new URLSearchParams(location.search).get("focus") || "",
    [location.search],
  );
  const tableRows = useMemo(() => {
    const query = tableSearchTerm.trim().toLowerCase();
    let rows = [...riders];

    if (query) {
      rows = rows.filter((rider) =>
        getRiderDisplayName(rider).toLowerCase().includes(query),
      );
    }

    if (tableFilterBy === "has_deliveries") {
      rows = rows.filter((rider) => Number(rider?.deliveredParcels || 0) > 0);
    } else if (tableFilterBy === "high_cancelled") {
      rows = rows.filter((rider) => Number(rider?.cancelledParcels || 0) >= 5);
    }

    const byDelivered = (a, b) =>
      Number(b?.deliveredParcels || 0) - Number(a?.deliveredParcels || 0);
    const byCancelled = (a, b) =>
      Number(b?.cancelledParcels || 0) - Number(a?.cancelledParcels || 0);
    const byNameAsc = (a, b) =>
      getRiderDisplayName(a).localeCompare(getRiderDisplayName(b));
    const byNameDesc = (a, b) =>
      getRiderDisplayName(b).localeCompare(getRiderDisplayName(a));

    if (tableSortBy === "delivered_desc") {
      rows.sort(byDelivered);
    } else if (tableSortBy === "cancelled_desc") {
      rows.sort(byCancelled);
    } else if (tableSortBy === "name_desc") {
      rows.sort(byNameDesc);
    } else {
      rows.sort(byNameAsc);
    }

    return rows;
  }, [riders, tableSearchTerm, tableSortBy, tableFilterBy]);
  const totalTablePages = useMemo(
    () => Math.max(1, Math.ceil(tableRows.length / RIDER_TABLE_PAGE_SIZE)),
    [tableRows.length],
  );
  const pagedTableRows = useMemo(() => {
    const start = (tablePage - 1) * RIDER_TABLE_PAGE_SIZE;
    return tableRows.slice(start, start + RIDER_TABLE_PAGE_SIZE);
  }, [tableRows, tablePage]);
  const tableRowStartIndex = useMemo(
    () => (tablePage - 1) * RIDER_TABLE_PAGE_SIZE,
    [tablePage],
  );
  const tablePageButtons = useMemo(() => {
    const end = Math.min(totalTablePages, tablePage + 1);
    const start = Math.max(1, end - 2);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [tablePage, totalTablePages]);

  useEffect(() => {
    setTablePage(1);
  }, [tableSearchTerm, tableSortBy, tableFilterBy]);

  useEffect(() => {
    if (tablePage > totalTablePages) setTablePage(totalTablePages);
  }, [tablePage, totalTablePages]);

  useEffect(() => {
    if (topRidersPage > topRidersTotalPages) {
      setTopRidersPage(topRidersTotalPages);
    }
  }, [topRidersPage, topRidersTotalPages]);

  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const currentMarkerRef = useRef(null);
  const allMapRef = useRef(null);
  const allLeafletMapRef = useRef(null);
  const allMarkersRef = useRef([]);
  const allMarkersByRiderRef = useRef(new Map());
  const weatherOverlayRef = useRef(null);
  const floodOverlayRef = useRef(null);
  const fullMapRef = useRef(null);
  const fullLeafletMapRef = useRef(null);
  const fullMarkersRef = useRef([]);
  const fullMarkersByRiderRef = useRef(new Map());
  const allRouteLinesRef = useRef([]);
  const fullRouteLinesRef = useRef([]);
  const riderTrailsRef = useRef(new Map());
  const previousRiderPositionRef = useRef(new Map());
  const fullWeatherOverlayRef = useRef(null);
  const fullFloodOverlayRef = useRef(null);
  const hasAutoCenteredAllMapRef = useRef(false);
  const hasAutoCenteredFullMapRef = useRef(false);
  const appliedFocusViewRef = useRef("");
  const openInfoModalRef = useRef(null);

  const openRiderInfoFromPopup = useCallback((riderName) => {
    const normalizedRiderName = String(riderName || "").trim();
    if (!normalizedRiderName) return;

    openInfoModalRef.current?.(normalizedRiderName);
  }, []);

  useEffect(() => {
    const handlePopupInteraction = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const popupButton = target.closest(".rider-location-popup-btn");
      const popupCard = target.closest(".rider-location-popup");
      if (!popupButton && !popupCard) return;

      event.preventDefault?.();
      event.stopPropagation?.();

      const riderNameFromButton = popupButton?.getAttribute("data-rider-name");
      const riderNameFromCard = popupCard?.getAttribute("data-rider-name");
      const riderName = (riderNameFromButton || riderNameFromCard || "").trim();
      if (!riderName) return;

      openRiderInfoFromPopup(riderName);
    };

    document.addEventListener("pointerup", handlePopupInteraction, true);
    document.addEventListener("click", handlePopupInteraction, true);

    return () => {
      document.removeEventListener("pointerup", handlePopupInteraction, true);
      document.removeEventListener("click", handlePopupInteraction, true);
    };
  }, [openRiderInfoFromPopup]);

  const fetchRiderLocations = useCallback(async () => {
    const { data, error } = await supabaseClient
      .from("users")
      .select(
        "user_id, username, fname, lname, status, last_active, last_seen_lat, last_seen_lng",
      );

    if (error) {
      throw error;
    }

    return (data || []).map((rider) => ({
      ...rider,
      lat: normalizeCoordinate(rider.last_seen_lat),
      lng: normalizeCoordinate(rider.last_seen_lng),
    }));
  }, []);

  const fetchRiderMetrics = useCallback(async (ridersData = []) => {
    const riderIds = (ridersData || [])
      .map((rider) => rider.user_id)
      .filter(Boolean);

    if (riderIds.length === 0) {
      setRiderDailyStats({ deliveredToday: 0, cancelledToday: 0 });
      return (ridersData || []).map((rider) => ({
        ...rider,
        deliveredParcels: 0,
        ongoingParcels: 0,
        cancelledParcels: 0,
      }));
    }

    const { data: parcelsData, error: parcelsError } = await supabaseClient
      .from("parcels")
      .select("assigned_rider_id, status, created_at")
      .in("assigned_rider_id", riderIds);

    if (parcelsError) {
      throw parcelsError;
    }

    const statsByRiderId = new Map();
    riderIds.forEach((id) => {
      statsByRiderId.set(id, {
        deliveredParcels: 0,
        ongoingParcels: 0,
        cancelledParcels: 0,
      });
    });

    const todayKey = toLocalDayKey(new Date());
    let deliveredToday = 0;
    let cancelledToday = 0;

    (parcelsData || []).forEach((parcel) => {
      const riderId = parcel?.assigned_rider_id;
      if (!riderId || !statsByRiderId.has(riderId)) return;
      const stats = statsByRiderId.get(riderId);
      const normalizedStatus = normalizeStatus(parcel?.status);
      const parcelDayKey = toLocalDayKey(parcel?.created_at);

      if (isDeliveredStatus(parcel?.status)) {
        stats.deliveredParcels += 1;
        if (parcelDayKey && parcelDayKey === todayKey) {
          deliveredToday += 1;
        }
      }
      if (normalizedStatus === "on going") {
        stats.ongoingParcels += 1;
      }
      if (normalizedStatus === "cancelled" || normalizedStatus === "canceled") {
        stats.cancelledParcels += 1;
        if (parcelDayKey && parcelDayKey === todayKey) {
          cancelledToday += 1;
        }
      }
    });

    setRiderDailyStats({ deliveredToday, cancelledToday });

    return (ridersData || []).map((rider) => ({
      ...rider,
      ...(statsByRiderId.get(rider.user_id) || {
        deliveredParcels: 0,
        ongoingParcels: 0,
        cancelledParcels: 0,
      }),
    }));
  }, []);

  const refreshRiders = useCallback(async () => {
    const ridersData = await fetchRiderLocations();
    return fetchRiderMetrics(ridersData);
  }, [fetchRiderLocations, fetchRiderMetrics]);

  const escapeHtml = (value = "") =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const buildLocationPopup = (riderName) => {
    const safeName = escapeHtml(riderName || "");
    const selected = riders.find((r) => r.username === riderName);
    const displayName = getRiderDisplayName(selected || { username: riderName });
    const safeDisplayName = escapeHtml(displayName);
    const normalizedStatus = selected?.status?.toLowerCase() || "";
    const isOnline = ["online", "active"].includes(normalizedStatus);
    const statusClass = isOnline
      ? "is-online"
      : ["offline", "inactive"].includes(normalizedStatus)
        ? "is-offline"
        : "is-default";
    const statusLabel = selected?.status || "Unknown";
    return `
      <div class="rider-location-popup ${statusClass}" data-rider-name="${safeName}">
        <div class="rider-location-popup-head">
          <span class="rider-location-dot" aria-hidden="true"></span>
          <span class="rider-location-popup-label">Rider location</span>
        </div>
        <button type="button" class="rider-location-popup-btn" data-rider-name="${safeName}">${safeDisplayName}</button>
        <span class="rider-location-status">${escapeHtml(statusLabel)}</span>
        <span class="rider-location-popup-hint">Tap name to view rider details</span>
      </div>
    `;
  };

  const bindRiderPopupClick = (marker, riderName) => {
    marker.on("popupopen", (event) => {
      const popupElement = event.popup?.getElement();
      if (!popupElement) return;

      const button = popupElement.querySelector(".rider-location-popup-btn");
      const popupCard = popupElement.querySelector(".rider-location-popup");
      if (!button && !popupCard) return;

      L.DomEvent.disableClickPropagation(popupElement);
      L.DomEvent.disableScrollPropagation(popupElement);

      const openFromPopup = (domEvent) => {
        if (domEvent) {
          domEvent.preventDefault?.();
          domEvent.stopPropagation?.();
        }
        const clickedRiderName =
          button?.getAttribute?.("data-rider-name") || riderName;
        openRiderInfoFromPopup(clickedRiderName);
      };

      if (button) {
        button.onclick = openFromPopup;
        button.ontouchend = openFromPopup;
        button.onpointerup = openFromPopup;
      }
      if (popupCard) {
        popupCard.onclick = openFromPopup;
        popupCard.ontouchend = openFromPopup;
      }
    });
  };

  const fetchWeatherForLocation = async (lat, lon) => {
    if (!OPENWEATHER_API_KEY) return;

    setWeatherLoading(true);
    setWeatherError("");

    try {
      const [currentRes, forecastRes] = await Promise.all([
        fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`,
        ),
        fetch(
          `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`,
        ),
      ]);

      if (!currentRes.ok || !forecastRes.ok) {
        throw new Error("Failed to load weather information.");
      }

      const current = await currentRes.json();
      const forecast = await forecastRes.json();

      setWeatherCurrent({
        temp: Math.round(current?.main?.temp ?? 0),
        feelsLike: Math.round(current?.main?.feels_like ?? 0),
        humidity: current?.main?.humidity ?? "-",
        wind: current?.wind?.speed ?? "-",
        city: current?.name || "Map Area",
        description: current?.weather?.[0]?.description || "No description",
        icon: current?.weather?.[0]?.icon || null,
      });

      const nextForecast = (forecast?.list || []).slice(0, 4).map((item) => ({
        time: new Date(item.dt * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        temp: Math.round(item?.main?.temp ?? 0),
        icon: item?.weather?.[0]?.icon || null,
      }));
      setWeatherForecast(nextForecast);
    } catch (error) {
      console.error("Failed to fetch weather data:", error);
      setWeatherError("Unable to load weather data.");
      setWeatherCurrent(null);
      setWeatherForecast([]);
    } finally {
      setWeatherLoading(false);
    }
  };

  const fetchFullWeatherForLocation = async (lat, lon) => {
    if (!OPENWEATHER_API_KEY) return;

    setFullWeatherLoading(true);
    setFullWeatherError("");

    try {
      const [currentRes, forecastRes] = await Promise.all([
        fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`,
        ),
        fetch(
          `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`,
        ),
      ]);

      if (!currentRes.ok || !forecastRes.ok) {
        throw new Error("Failed to load weather information.");
      }

      const current = await currentRes.json();
      const forecast = await forecastRes.json();

      setFullWeatherCurrent({
        temp: Math.round(current?.main?.temp ?? 0),
        feelsLike: Math.round(current?.main?.feels_like ?? 0),
        humidity: current?.main?.humidity ?? "-",
        wind: current?.wind?.speed ?? "-",
        city: current?.name || "Map Area",
        description: current?.weather?.[0]?.description || "No description",
        icon: current?.weather?.[0]?.icon || null,
      });

      const nextForecast = (forecast?.list || []).slice(0, 4).map((item) => ({
        time: new Date(item.dt * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        temp: Math.round(item?.main?.temp ?? 0),
        icon: item?.weather?.[0]?.icon || null,
      }));
      setFullWeatherForecast(nextForecast);
    } catch (error) {
      console.error("Failed to fetch fullscreen weather data:", error);
      setFullWeatherError("Unable to load weather data.");
      setFullWeatherCurrent(null);
      setFullWeatherForecast([]);
    } finally {
      setFullWeatherLoading(false);
    }
  };

  const riderLocations = useMemo(
    () => riders.filter((rider) => rider.lat !== null && rider.lng !== null),
    [riders],
  );

  const recentActivityRows = useMemo(() => {
    const merged = [];
    const seen = new Set();

    (recentRiderActivity || []).forEach((activity) => {
      const key = activity.riderKey || activity.riderName;
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(activity);
    });

    const remainingRiders = (riders || [])
      .map((rider) => {
        const parsed = rider?.last_active ? new Date(rider.last_active) : null;
        const lastActive =
          parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        const riderKey = rider.username || String(rider.user_id || "");
        const isOnline = isActiveRiderStatus(rider?.status);
        return {
          id: `rider-${riderKey}`,
          riderKey,
          riderName: getRiderDisplayName(rider),
          status: rider?.status || (isOnline ? "Online" : "Offline"),
          timestamp: lastActive || new Date(0),
          lastActive,
          isOnline,
        };
      })
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const aTime = a.lastActive ? a.lastActive.getTime() : 0;
        const bTime = b.lastActive ? b.lastActive.getTime() : 0;
        return bTime - aTime;
      });

    remainingRiders.forEach((entry) => {
      if (!entry.riderKey || seen.has(entry.riderKey)) return;
      seen.add(entry.riderKey);
      merged.push(entry);
    });

    return merged;
  }, [recentRiderActivity, riders]);
  const activityTotalPages = useMemo(
    () => Math.max(1, Math.ceil(recentActivityRows.length / RIDER_INSIGHT_PAGE_SIZE)),
    [recentActivityRows.length],
  );
  const pagedActivityRows = useMemo(() => {
    const start = (activityPage - 1) * RIDER_INSIGHT_PAGE_SIZE;
    return recentActivityRows.slice(start, start + RIDER_INSIGHT_PAGE_SIZE);
  }, [recentActivityRows, activityPage]);

  useEffect(() => {
    if (activityPage > activityTotalPages) {
      setActivityPage(activityTotalPages);
    }
  }, [activityPage, activityTotalPages]);

  // Load riders on mount
  useEffect(() => {
    let isMounted = true;

    async function loadRiders() {
      try {
        const ridersData = await refreshRiders();
        if (isMounted) {
          setRiders(ridersData);
          setLastUpdatedAt(new Date());
        }
      } catch (error) {
        console.error("Failed to load rider locations:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadRiders();

    const pollingInterval = setInterval(async () => {
      try {
        const ridersData = await refreshRiders();
        if (isMounted) {
          setRiders(ridersData);
          setLastUpdatedAt(new Date());
        }
      } catch (error) {
        console.error("Failed to refresh rider locations:", error);
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(pollingInterval);
    };
  }, [refreshRiders]);

  useEffect(() => {
    if (!isMapsPage) {
      appliedFocusViewRef.current = "";
      return;
    }
    setFullMapModalOpen(false);
    if (!focusedRiderQuery) {
      appliedFocusViewRef.current = "";
      return;
    }
    if (appliedFocusViewRef.current !== focusedRiderQuery && fullMapView !== "map") {
      setFullMapView("map");
    }
    appliedFocusViewRef.current = focusedRiderQuery;
  }, [isMapsPage, focusedRiderQuery, fullMapView]);

  useEffect(() => {
    if (fullMapView !== "table") return;

    setShowWeatherPanel(false);
    setShowFullWeatherPanel(false);

    if (weatherOverlayRef.current && allLeafletMapRef.current) {
      allLeafletMapRef.current.removeLayer(weatherOverlayRef.current);
      weatherOverlayRef.current = null;
    }
    if (floodOverlayRef.current && allLeafletMapRef.current) {
      allLeafletMapRef.current.removeLayer(floodOverlayRef.current);
      floodOverlayRef.current = null;
    }
    allRouteLinesRef.current.forEach((line) => {
      if (allLeafletMapRef.current) allLeafletMapRef.current.removeLayer(line);
    });
    allRouteLinesRef.current = [];
    allMarkersRef.current.forEach((marker) => {
      if (allLeafletMapRef.current) allLeafletMapRef.current.removeLayer(marker);
    });
    allMarkersRef.current = [];
    if (allLeafletMapRef.current) {
      allLeafletMapRef.current.remove();
      allLeafletMapRef.current = null;
    }
    hasAutoCenteredAllMapRef.current = false;

    if (fullWeatherOverlayRef.current && fullLeafletMapRef.current) {
      fullLeafletMapRef.current.removeLayer(fullWeatherOverlayRef.current);
      fullWeatherOverlayRef.current = null;
    }
    if (fullFloodOverlayRef.current && fullLeafletMapRef.current) {
      fullLeafletMapRef.current.removeLayer(fullFloodOverlayRef.current);
      fullFloodOverlayRef.current = null;
    }
    fullRouteLinesRef.current.forEach((line) => {
      if (fullLeafletMapRef.current) fullLeafletMapRef.current.removeLayer(line);
    });
    fullRouteLinesRef.current = [];
    fullMarkersRef.current.forEach((marker) => {
      if (fullLeafletMapRef.current) fullLeafletMapRef.current.removeLayer(marker);
    });
    fullMarkersRef.current = [];
    if (fullLeafletMapRef.current) {
      fullLeafletMapRef.current.remove();
      fullLeafletMapRef.current = null;
    }
    hasAutoCenteredFullMapRef.current = false;
  }, [fullMapView]);

  useEffect(() => {
    if (riderLocations.length === 0) return;

    const now = new Date();
    const nextPreviousMap = new Map(previousRiderPositionRef.current);
    const nextTrailsMap = riderTrailsRef.current;
    const activityEntries = [];

    riderLocations.forEach((rider) => {
      const key = rider.username || String(rider.user_id || "");
      if (!key) return;

      const currentPoint = [rider.lat, rider.lng];
      const previousPoint = nextPreviousMap.get(key);
      const hasMoved =
        !previousPoint ||
        previousPoint[0] !== currentPoint[0] ||
        previousPoint[1] !== currentPoint[1];

      if (isActiveRiderStatus(rider?.status)) {
        const existingTrail = nextTrailsMap.get(key) || [];
        const latestTrailPoint = existingTrail[existingTrail.length - 1];
        if (
          !latestTrailPoint ||
          latestTrailPoint[0] !== currentPoint[0] ||
          latestTrailPoint[1] !== currentPoint[1]
        ) {
          const updatedTrail = [...existingTrail, currentPoint].slice(-8);
          nextTrailsMap.set(key, updatedTrail);
        }
      }

      if (hasMoved) {
        const parsedLastActive = rider?.last_active ? new Date(rider.last_active) : null;
        const lastActive = parsedLastActive && !Number.isNaN(parsedLastActive.getTime())
          ? parsedLastActive
          : null;
        activityEntries.push({
          id: `${key}-${now.getTime()}`,
          riderKey: key,
          riderName: getRiderDisplayName(rider),
          status: rider?.status || "Unknown",
          timestamp: now,
          lastActive,
          lat: rider.lat,
          lng: rider.lng,
        });
      }

      nextPreviousMap.set(key, currentPoint);
    });

    previousRiderPositionRef.current = nextPreviousMap;
    if (activityEntries.length > 0) {
      setRecentRiderActivity((prev) =>
        [...activityEntries, ...prev].slice(0, RIDER_ACTIVITY_HISTORY_LIMIT),
      );
    }
  }, [riderLocations]);

  useEffect(() => {
    if (loading || fullMapView !== "map" || !allMapRef.current) return;

    if (
      allLeafletMapRef.current &&
      allLeafletMapRef.current._container !== allMapRef.current
    ) {
      allLeafletMapRef.current.remove();
      allLeafletMapRef.current = null;
      allMarkersRef.current = [];
      hasAutoCenteredAllMapRef.current = false;
    }

    if (!allLeafletMapRef.current) {
      allLeafletMapRef.current = L.map(allMapRef.current).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(allLeafletMapRef.current);
    }

    const map = allLeafletMapRef.current;
    const riderIcon = L.icon({
      iconUrl: "/images/rider.png",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });

    allMarkersRef.current.forEach((marker) => map.removeLayer(marker));
    allMarkersRef.current = [];
    allMarkersByRiderRef.current = new Map();
    allRouteLinesRef.current.forEach((line) => map.removeLayer(line));
    allRouteLinesRef.current = [];

    riderLocations.forEach((rider) => {
      const marker = L.marker([rider.lat, rider.lng], {
        icon: riderIcon,
        zIndexOffset: 1200,
        riseOnHover: true,
      })
        .addTo(map)
        .bindPopup(buildLocationPopup(rider.username), {
          className: "rider-location-leaflet-popup",
          closeButton: false,
        });
      bindRiderPopupClick(marker, rider.username);
      allMarkersRef.current.push(marker);
      allMarkersByRiderRef.current.set(rider.username, marker);
    });

    riderLocations.forEach((rider) => {
      if (!FORCE_POLYLINE_PREVIEW && !isActiveRiderStatus(rider?.status)) return;
      const key = rider.username || String(rider.user_id || "");
      if (!key) return;
      const trailFromHistory = riderTrailsRef.current.get(key) || [];
      const trail = FORCE_POLYLINE_PREVIEW
        ? buildRoutePreviewTrail(rider, trailFromHistory)
        : trailFromHistory;
      if (trail.length < 2) return;
      const isPreviewTrail = FORCE_POLYLINE_PREVIEW && trailFromHistory.length < 2;
      const layers = drawStyledRoute(map, trail, {
        mainWeight: 3,
        casingWeight: 6,
        isPreview: isPreviewTrail,
      });
      allRouteLinesRef.current.push(...layers);
    });

    if (!hasAutoCenteredAllMapRef.current && allMarkersRef.current.length > 1) {
      const bounds = L.featureGroup(allMarkersRef.current).getBounds().pad(0.2);
      map.fitBounds(bounds);
      hasAutoCenteredAllMapRef.current = true;
    } else if (
      !hasAutoCenteredAllMapRef.current &&
      allMarkersRef.current.length === 1
    ) {
      const first = allMarkersRef.current[0].getLatLng();
      map.setView([first.lat, first.lng], 14);
      hasAutoCenteredAllMapRef.current = true;
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, riderLocations, fullMapView]);

  useEffect(() => {
    if (!isMapsPage || !focusedRiderQuery || fullMapView !== "map") return;
    const map = allLeafletMapRef.current;
    if (!map) return;

    const focusedRider = riderLocations.find(
      (rider) =>
        String(rider?.username || "").toLowerCase() ===
        focusedRiderQuery.toLowerCase(),
    );
    if (!focusedRider) return;

    map.setView([focusedRider.lat, focusedRider.lng], 16);
    const marker = allMarkersByRiderRef.current.get(focusedRider.username);
    marker?.openPopup();
    marker?.getPopup?.()?.update?.();

    // Apply URL focus once, then clear it so users can move the map freely.
    const params = new URLSearchParams(location.search);
    if (params.has("focus")) {
      params.delete("focus");
      const nextQuery = params.toString();
      navigate(nextQuery ? `/maps?${nextQuery}` : "/maps", { replace: true });
    }
  }, [
    isMapsPage,
    focusedRiderQuery,
    riderLocations,
    fullMapView,
    loading,
    location.search,
    navigate,
  ]);

  useEffect(() => {
    if (!fullMapModalOpen) {
      if (fullWeatherOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullWeatherOverlayRef.current);
        fullWeatherOverlayRef.current = null;
      }
      if (fullFloodOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullFloodOverlayRef.current);
        fullFloodOverlayRef.current = null;
      }
      if (fullLeafletMapRef.current) {
        fullLeafletMapRef.current.remove();
        fullLeafletMapRef.current = null;
      }
      fullMarkersRef.current = [];
      fullRouteLinesRef.current = [];
      hasAutoCenteredFullMapRef.current = false;
      return;
    }

    if (fullMapView !== "map" || !fullMapRef.current) return;

    if (
      fullLeafletMapRef.current &&
      fullLeafletMapRef.current._container !== fullMapRef.current
    ) {
      fullLeafletMapRef.current.remove();
      fullLeafletMapRef.current = null;
      fullMarkersRef.current = [];
      hasAutoCenteredFullMapRef.current = false;
    }

    if (!fullLeafletMapRef.current) {
      fullLeafletMapRef.current = L.map(fullMapRef.current).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(fullLeafletMapRef.current);
    }

    const map = fullLeafletMapRef.current;
    const riderIcon = L.icon({
      iconUrl: "/images/rider.png",
      iconSize: [42, 42],
      iconAnchor: [21, 42],
      popupAnchor: [0, -42],
    });

    fullMarkersRef.current.forEach((marker) => map.removeLayer(marker));
    fullMarkersRef.current = [];
    fullMarkersByRiderRef.current = new Map();
    fullRouteLinesRef.current.forEach((line) => map.removeLayer(line));
    fullRouteLinesRef.current = [];

    riderLocations.forEach((rider) => {
      const marker = L.marker([rider.lat, rider.lng], {
        icon: riderIcon,
        zIndexOffset: 1300,
        riseOnHover: true,
      })
        .addTo(map)
        .bindPopup(buildLocationPopup(rider.username), {
          className: "rider-location-leaflet-popup",
          closeButton: false,
        });
      bindRiderPopupClick(marker, rider.username);
      fullMarkersRef.current.push(marker);
      fullMarkersByRiderRef.current.set(rider.username, marker);
    });

    riderLocations.forEach((rider) => {
      if (!FORCE_POLYLINE_PREVIEW && !isActiveRiderStatus(rider?.status)) return;
      const key = rider.username || String(rider.user_id || "");
      if (!key) return;
      const trailFromHistory = riderTrailsRef.current.get(key) || [];
      const trail = FORCE_POLYLINE_PREVIEW
        ? buildRoutePreviewTrail(rider, trailFromHistory)
        : trailFromHistory;
      if (trail.length < 2) return;
      const isPreviewTrail = FORCE_POLYLINE_PREVIEW && trailFromHistory.length < 2;
      const layers = drawStyledRoute(map, trail, {
        mainWeight: 4,
        casingWeight: 7,
        isPreview: isPreviewTrail,
      });
      fullRouteLinesRef.current.push(...layers);
    });

    if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length > 1
    ) {
      const bounds = L.featureGroup(fullMarkersRef.current)
        .getBounds()
        .pad(0.2);
      map.fitBounds(bounds);
      hasAutoCenteredFullMapRef.current = true;
    } else if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length === 1
    ) {
      const first = fullMarkersRef.current[0].getLatLng();
      map.setView([first.lat, first.lng], 14);
      hasAutoCenteredFullMapRef.current = true;
    }

    if (fullWeatherOverlayRef.current) {
      map.removeLayer(fullWeatherOverlayRef.current);
      fullWeatherOverlayRef.current = null;
    }
    if (fullFloodOverlayRef.current) {
      map.removeLayer(fullFloodOverlayRef.current);
      fullFloodOverlayRef.current = null;
    }

    if (activeMapLayer === "weather") {
      fullWeatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      fullWeatherOverlayRef.current.on("tileerror", (event) => {
        console.error(
          "OpenWeather tile failed to load (fullscreen map):",
          event,
        );
      });
      fullWeatherOverlayRef.current.addTo(map);
    } else if (activeMapLayer === "flood") {
      fullFloodOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      fullFloodOverlayRef.current.on("tileerror", (event) => {
        console.error("Flood tile failed to load (fullscreen map):", event);
      });
      fullFloodOverlayRef.current.addTo(map);
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMapModalOpen, riderLocations, activeMapLayer, fullMapView]);

  useEffect(() => {
    if (
      !trackModalOpen ||
      !trackingRider ||
      !currentMarkerRef.current ||
      !leafletMapRef.current
    )
      return;

    const selectedRider = riderLocations.find(
      (rider) => rider.username === trackingRider,
    );
    if (!selectedRider) return;

    const nextPosition = [selectedRider.lat, selectedRider.lng];
    currentMarkerRef.current.setLatLng(nextPosition);
  }, [trackModalOpen, trackingRider, riderLocations]);

  useEffect(() => {
    const map = allLeafletMapRef.current;
    if (!map) return;

    if (weatherOverlayRef.current) {
      map.removeLayer(weatherOverlayRef.current);
      weatherOverlayRef.current = null;
    }
    if (floodOverlayRef.current) {
      map.removeLayer(floodOverlayRef.current);
      floodOverlayRef.current = null;
    }

    if (activeMapLayer === "weather") {
      weatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      weatherOverlayRef.current.on("tileerror", (event) => {
        console.error("OpenWeather tile failed to load:", event);
      });
      weatherOverlayRef.current.addTo(map);
      weatherOverlayRef.current.bringToFront();
    } else if (activeMapLayer === "flood") {
      floodOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      floodOverlayRef.current.on("tileerror", (event) => {
        console.error("Flood tile failed to load:", event);
      });
      floodOverlayRef.current.addTo(map);
      floodOverlayRef.current.bringToFront();
    }
  }, [activeMapLayer, loading, riderLocations.length]);

  useEffect(() => {
    const map = allLeafletMapRef.current;
    if (!map || activeMapLayer !== "weather") {
      setWeatherCurrent(null);
      setWeatherForecast([]);
      setWeatherError("");
      setWeatherLoading(false);
      return;
    }

    const requestWeather = () => {
      const center = map.getCenter();
      fetchWeatherForLocation(center.lat, center.lng);
    };

    requestWeather();
    map.on("moveend", requestWeather);

    return () => {
      map.off("moveend", requestWeather);
    };
  }, [activeMapLayer, loading, riderLocations.length]);

  useEffect(() => {
    const map = fullLeafletMapRef.current;
    if (!fullMapModalOpen || !map || activeMapLayer !== "weather") {
      setFullWeatherCurrent(null);
      setFullWeatherForecast([]);
      setFullWeatherError("");
      setFullWeatherLoading(false);
      return;
    }

    const requestWeather = () => {
      const center = map.getCenter();
      fetchFullWeatherForLocation(center.lat, center.lng);
    };

    requestWeather();
    map.on("moveend", requestWeather);

    return () => {
      map.off("moveend", requestWeather);
    };
  }, [activeMapLayer, fullMapModalOpen, riderLocations.length]);

  useEffect(() => {
    return () => {
      if (weatherOverlayRef.current && allLeafletMapRef.current) {
        allLeafletMapRef.current.removeLayer(weatherOverlayRef.current);
        weatherOverlayRef.current = null;
      }
      if (floodOverlayRef.current && allLeafletMapRef.current) {
        allLeafletMapRef.current.removeLayer(floodOverlayRef.current);
        floodOverlayRef.current = null;
      }
      allRouteLinesRef.current.forEach((line) => {
        if (allLeafletMapRef.current) allLeafletMapRef.current.removeLayer(line);
      });
      allRouteLinesRef.current = [];
      if (fullWeatherOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullWeatherOverlayRef.current);
        fullWeatherOverlayRef.current = null;
      }
      if (fullFloodOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullFloodOverlayRef.current);
        fullFloodOverlayRef.current = null;
      }
      fullRouteLinesRef.current.forEach((line) => {
        if (fullLeafletMapRef.current) fullLeafletMapRef.current.removeLayer(line);
      });
      fullRouteLinesRef.current = [];
      if (allLeafletMapRef.current) {
        allLeafletMapRef.current.remove();
        allLeafletMapRef.current = null;
      }
      if (fullLeafletMapRef.current) {
        fullLeafletMapRef.current.remove();
        fullLeafletMapRef.current = null;
      }
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  const openTrackModal = (riderName) => {
    setTrackingRider(riderName);
    setTrackModalOpen(true);
    setLoadingMap(true);

    // Remove previous map if exists
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      currentMarkerRef.current = null;
    }

    // Wait until modal renders fully
    setTimeout(() => {
      if (!mapRef.current) return;

      setLoadingMap(false);
      const selectedRider = riderLocations.find(
        (r) => r.username === riderName,
      );
      const focusedLat = selectedRider?.lat ?? 14.676;
      const focusedLng = selectedRider?.lng ?? 121.0437;

      const map = L.map(mapRef.current).setView([focusedLat, focusedLng], 14);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      const riderIcon = L.icon({
        iconUrl: "/images/rider.png",
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40],
      });

      const marker = L.marker([focusedLat, focusedLng], {
        icon: riderIcon,
        zIndexOffset: 1200,
        riseOnHover: true,
      })
        .addTo(map)
        .bindPopup(buildLocationPopup(riderName), {
          className: "rider-location-leaflet-popup",
          closeButton: false,
        });
      bindRiderPopupClick(marker, riderName);

      leafletMapRef.current = map;
      currentMarkerRef.current = marker;

      // Force Leaflet to render correctly
      setTimeout(() => {
        map.invalidateSize();
        marker.openPopup();
        marker.getPopup()?.update();
      }, 200);
    }, 900);
  };

  const closeTrackModal = () => {
    if (currentMarkerRef.current) {
      currentMarkerRef.current.remove();
      currentMarkerRef.current = null;
    }
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }
    setTrackModalOpen(false);
  };

  const openRiderOnMapsPage = (rider) => {
    const username = String(rider?.username || "").trim();
    if (!username) return;
    const hasLiveLocation = rider?.lat !== null && rider?.lng !== null;
    const isOnline = isActiveRiderStatus(rider?.status);
    if (!isOnline || !hasLiveLocation) {
      const riderName = getRiderDisplayName(rider);
      setTrackFailMessage(
        `${riderName} is offline or not available on the live rider map.`,
      );
      setShowTrackFailModal(true);
      return;
    }
    setFullMapView("map");
    const params = new URLSearchParams();
    params.set("focus", username);
    navigate(`/maps?${params.toString()}`);
  };

  const openInfoModal = async (riderName) => {
    setInfoModalOpen(true);
    setLoadingInfo(true);
    setInfoError("");
    setSelectedRiderInfo(null);
    setViolationLogsModalOpen(false);
    setRiderViolationLogs([]);
    setViolationLogsError("");
    setLoadingViolationLogs(false);

    try {
      // Step 1: Fetch rider information including their UUID
      const { data: riderData, error: riderError } = await supabaseClient
        .from("users")
        .select(
          "user_id, username, email, fname, lname, mname, gender, age, status, pnumber, profile_url",
        )
        .eq("username", riderName)
        .maybeSingle();

      if (riderError) {
        throw riderError;
      }

      if (!riderData) {
        setInfoError("Rider information not found.");
        return;
      }


      // Step 2: Fetch parcels using the rider's UUID
      const { data: parcelsData, error: parcelsError } = await supabaseClient
        .from("parcels")
        .select("status, assigned_rider_id, created_at")
        .eq("assigned_rider_id", riderData.user_id);

      setLoadingViolationLogs(true);
      const { data: violationData, error: violationError } = await supabaseClient
        .from("violation_logs")
        .select("violation, date, lat, lng, name")
        .eq("user_id", riderData.user_id)
        .order("date", { ascending: false });
      setLoadingViolationLogs(false);

      if (parcelsError) {
        console.error("Failed to fetch parcels:", parcelsError);
        // Continue with rider data even if parcels fail
      }
      if (violationError) {
        console.error("Failed to fetch rider violation logs:", violationError);
        setViolationLogsError("Failed to load rider violation logs.");
      } else {
        setRiderViolationLogs(violationData || []);
      }


      // Step 3: Calculate parcel counts based on status
      const parcels = parcelsData || [];

      const deliveredParcels = parcels.filter((p) => isDeliveredStatus(p.status)).length;

      const ongoingParcels = parcels.filter(
        (p) => normalizeStatus(p.status) === "on going",
      ).length;

      const cancelledParcels = parcels.filter(
        (p) => normalizeStatus(p.status) === "cancelled",
      ).length;
      const { streak, todayCount, metToday } = calculateQuotaStreak(
        parcels,
        RIDER_DAILY_QUOTA,
      );

      setSelectedRiderInfo({
        ...riderData,
        deliveredParcels,
        ongoingParcels,
        cancelledParcels,
        quotaTarget: RIDER_DELIVERY_QUOTA,
        dailyQuotaTarget: RIDER_DAILY_QUOTA,
        quotaStreakDays: streak,
        dailyDeliveredToday: todayCount,
        metDailyQuotaToday: metToday,
      });
    } catch (err) {
      console.error("Failed to fetch rider information:", err);
      setInfoError("Failed to load rider information.");
    } finally {
      setLoadingInfo(false);
    }
  };
  openInfoModalRef.current = openInfoModal;

  const closeInfoModal = () => {
    setInfoModalOpen(false);
    setPerformanceModalOpen(false);
    setViolationLogsModalOpen(false);
    setSelectedRiderInfo(null);
    setInfoError("");
    setPhotoPreviewOpen(false);
    setRiderViolationLogs([]);
    setViolationLogsError("");
    setLoadingViolationLogs(false);
  };

  const openCreateModal = () => {
    setCreateRiderError("");
    setCreateUsername("");
    setCreateEmail("");
    setCreatePassword("");
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (creatingRider) return;
    setCreateModalOpen(false);
    setCreateRiderError("");
    setCreateUsername("");
    setCreateEmail("");
    setCreatePassword("");
  };

  const handleCreateRider = async (e) => {
    e.preventDefault();
    setCreateRiderError("");
    setCreateSuccessMessage("");

    const normalizedUsername = normalizedCreateUsername;
    if (!normalizedUsername) {
      setCreateRiderError("Username is required.");
      return;
    }
    if (!isUsernameValid) {
      setCreateRiderError(
        "Username must be at least 3 characters and use letters, numbers, or underscore only.",
      );
      return;
    }

    const normalizedEmail = createEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setCreateRiderError("Email is required.");
      return;
    }

    if (!isPasswordValid) {
      setCreateRiderError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      );
      return;
    }

    setCreatingRider(true);

    try {
      const { data: updatedRows, error: usersUpdateError } =
        await supabaseClient
          .from("users")
          .update({
            new_user: true,
            username: normalizedUsername,
            password: createPassword,
            doj: joinDateToday,
          })
          .eq("email", normalizedEmail)
          .select("email");

      if (usersUpdateError) {
        throw usersUpdateError;
      }

      if (!updatedRows || updatedRows.length === 0) {
        const { error: usersInsertError } = await supabaseClient
          .from("users")
          .insert({
            username: normalizedUsername,
            email: normalizedEmail,
            password: createPassword,
            new_user: true,
            doj: joinDateToday,
          });

        if (usersInsertError) {
          throw usersInsertError;
        }
      }

      const ridersData = await refreshRiders();
      if (ridersData) {
        setRiders(ridersData);
        setLastUpdatedAt(new Date());
      }

      setCreateSuccessMessage("Rider created successfully.");
      setShowCreateSuccessModal(true);
      setCreateModalOpen(false);
      setCreateUsername("");
      setCreateEmail("");
      setCreatePassword("");
    } catch (err) {
      console.error("Failed to create rider account:", err);
      setCreateRiderError(err?.message || "Failed to create rider account.");
    } finally {
      setCreatingRider(false);
    }
  };

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar currentPage="riders.html" />

      <div className="riders-page bg-gradient-to-br from-red-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {loading ? (
          <PageSpinner fullScreen label="Loading riders..." />
        ) : (
          <div className="riders-content-shell p-6">
            <div className="rider-header-row mb-5">
              <h1 className="page-title mb-6">Rider Management</h1>
              <button
                type="button"
                className="add-rider-btn rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110"
                onClick={openCreateModal}
              >
                Add Rider
              </button>
            </div>
            <div className={`riders-split-layout ${fullMapView === "table" ? "is-table-view" : ""}`}>
              <div className="rider-map-card rounded-2xl bg-white shadow-2xl shadow-slate-900/12 dark:bg-slate-900 dark:shadow-black/45">
                <div className="rider-map-header">
                  <div className="rider-map-header-top">
                    <div className="rider-map-header-copy">
                      <div className="rider-map-title-row">
                        <h2>{fullMapView === "map" ? "Live Rider Map" : "Rider Parcel Summary"}</h2>
                      </div>
                      <p>
                        {fullMapView === "map"
                          ? "Showing all rider positions on the page map."
                          : "Parcel performance per rider (delivered, on-going, cancelled)."}
                      </p>
                    </div>
                    <div className="rider-weather-toggle">
                      <div className="rider-toolbar-group">
                        <div className="rider-view-toggle-group" role="tablist" aria-label="Rider map view">
                          <button
                            type="button"
                            className={`rider-view-toggle-btn ${fullMapView === "map" ? "is-active" : ""}`}
                            onClick={() => setFullMapView("map")}
                            role="tab"
                            aria-selected={fullMapView === "map"}
                          >
                            Map
                          </button>
                          <button
                            type="button"
                            className={`rider-view-toggle-btn ${fullMapView === "table" ? "is-active" : ""}`}
                            onClick={() => {
                              setFullMapView("table");
                              setShowWeatherPanel(false);
                              setShowFullWeatherPanel(false);
                            }}
                            role="tab"
                            aria-selected={fullMapView === "table"}
                          >
                            Table
                          </button>
                        </div>
                      </div>
                      {fullMapView === "map" && (
                        <div className="rider-toolbar-group">
                          <button
                            type="button"
                            className="rider-map-size-btn rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
                            onClick={() => setFullMapModalOpen(true)}
                          >
                            Open Fullscreen
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rider-map-body">
                  {fullMapView === "map" ? (
                    <div className="rider-map-stack">
                      <div ref={allMapRef} className="rider-live-map" />
                      <div className="rider-map-layer-dock">
                        <div className="rider-layer-toggle-row">
                          <span>Weather</span>
                          <label
                            className="rider-toggle-switch"
                            aria-label="Toggle weather layer"
                          >
                            <input
                              type="checkbox"
                              checked={activeMapLayer === "weather"}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setActiveMapLayer("weather");
                                  setShowWeatherPanel(false);
                                  setShowFullWeatherPanel(false);
                                } else {
                                  setActiveMapLayer(null);
                                  setShowWeatherPanel(false);
                                  setShowFullWeatherPanel(false);
                                }
                              }}
                            />
                            <span className="rider-toggle-slider" />
                          </label>
                        </div>
                        <div className="rider-layer-toggle-row">
                          <span>Flood</span>
                          <label
                            className="rider-toggle-switch"
                            aria-label="Toggle flood layer"
                          >
                            <input
                              type="checkbox"
                              checked={activeMapLayer === "flood"}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setActiveMapLayer("flood");
                                } else {
                                  setActiveMapLayer(null);
                                }
                                setShowWeatherPanel(false);
                                setShowFullWeatherPanel(false);
                              }}
                            />
                            <span className="rider-toggle-slider" />
                          </label>
                        </div>
                      </div>
                      {activeMapLayer === "weather" && (
                        <button
                          type="button"
                          className={`weather-panel-toggle-btn ${showWeatherPanel ? "open" : ""}`}
                          onClick={() => setShowWeatherPanel((prev) => !prev)}
                          aria-label={
                            showWeatherPanel
                              ? "Hide weather panel"
                              : "Show weather panel"
                          }
                        >
                          <span aria-hidden="true">☁</span>
                        </button>
                      )}
                      {activeMapLayer === "weather" && showWeatherPanel && (
                        <div className="weather-forecast-card">
                          {weatherLoading ? (
                            <p className="weather-forecast-loading">
                              Loading weather...
                            </p>
                          ) : weatherError ? (
                            <p className="weather-forecast-error">
                              {weatherError}
                            </p>
                          ) : weatherCurrent ? (
                            <>
                              <div className="weather-now">
                                <div className="weather-now-main">
                                  <strong>{weatherCurrent.city}</strong>
                                  <span className="weather-desc">
                                    {weatherCurrent.description}
                                  </span>
                                </div>
                                <div className="weather-temp-block">
                                  {weatherCurrent.icon && (
                                    <img
                                      src={`https://openweathermap.org/img/wn/${weatherCurrent.icon}@2x.png`}
                                      alt={weatherCurrent.description}
                                    />
                                  )}
                                  <span>{weatherCurrent.temp}°C</span>
                                </div>
                              </div>
                              <div className="weather-metrics">
                                <span>Feels {weatherCurrent.feelsLike}°C</span>
                                <span>Humidity {weatherCurrent.humidity}%</span>
                                <span>Wind {weatherCurrent.wind} m/s</span>
                              </div>
                              <div className="weather-forecast-row">
                                {weatherForecast.map((item) => (
                                  <div
                                    key={`${item.time}-${item.temp}`}
                                    className="weather-forecast-chip"
                                  >
                                    <span>{item.time}</span>
                                    {item.icon && (
                                      <img
                                        src={`https://openweathermap.org/img/wn/${item.icon}.png`}
                                        alt="forecast icon"
                                      />
                                    )}
                                    <strong>{item.temp}°</strong>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="weather-forecast-loading">
                              Weather data unavailable.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rider-full-table-wrapper">
                      <div className="rider-table-tools">
                        <input
                          type="text"
                          className="rider-table-search"
                          placeholder="Search rider..."
                          value={tableSearchTerm}
                          onChange={(event) => setTableSearchTerm(event.target.value)}
                        />
                        <RiderTableSelect
                          value={tableSortBy}
                          onChange={setTableSortBy}
                          options={tableSortOptions}
                          ariaLabel="Sort riders"
                        />
                        <RiderTableSelect
                          value={tableFilterBy}
                          onChange={setTableFilterBy}
                          options={tableFilterOptions}
                          ariaLabel="Filter riders"
                        />
                      </div>
                      <table className="rider-full-table">
                        <thead>
                          <tr>
                            <th className="col-index">#</th>
                            <th className="col-rider">Rider</th>
                            <th className="col-metric col-delivered">Delivered</th>
                            <th className="col-metric col-ongoing">On-Going</th>
                            <th className="col-metric col-cancelled">Cancelled</th>
                            <th className="col-action">Track</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedTableRows.length > 0 ? (
                            pagedTableRows.map((rider, index) => (
                              <tr key={rider.user_id || rider.username}>
                                <td className="col-index">{tableRowStartIndex + index + 1}</td>
                                <td className="col-rider">
                                  <button
                                    type="button"
                                    className="rider-name-link"
                                    onClick={() => rider?.username && openInfoModal(rider.username)}
                                    disabled={!rider?.username}
                                    title="View rider information"
                                  >
                                    {getRiderDisplayName(rider)}
                                  </button>
                                </td>
                                <td className="col-metric col-delivered">{rider.deliveredParcels ?? 0}</td>
                                <td className="col-metric col-ongoing">{rider.ongoingParcels ?? 0}</td>
                                <td className="col-metric col-cancelled">{rider.cancelledParcels ?? 0}</td>
                                <td className="col-action">
                                  <button
                                    type="button"
                                    className="rider-track-map-btn"
                                    onClick={() => openRiderOnMapsPage(rider)}
                                  >
                                    Track
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6}>No riders found.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {tableRows.length > 0 && (
                        <div className="rider-table-pagination">
                          <button
                            type="button"
                            className="rider-page-btn"
                            onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                            disabled={tablePage === 1}
                          >
                            Previous
                          </button>
                          <div className="rider-page-numbers">
                            {tablePageButtons.map((page) => (
                              <button
                                type="button"
                                key={page}
                                className={`rider-page-btn ${page === tablePage ? "is-active" : ""}`}
                                onClick={() => setTablePage(page)}
                              >
                                {page}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="rider-page-btn"
                            onClick={() =>
                              setTablePage((prev) => Math.min(totalTablePages, prev + 1))
                            }
                            disabled={tablePage === totalTablePages}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {fullMapView === "map" && (
                <aside className="rider-insights-card">
                  <section className="rider-insight-section">
                    <div className="rider-insight-head">
                      <h3>
                        <span className="rider-insight-head-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                            <path d="M12 3a4 4 0 110 8 4 4 0 010-8zm0 10c4.42 0 8 2.24 8 5v1H4v-1c0-2.76 3.58-5 8-5z" />
                          </svg>
                        </span>
                        Top Riders
                      </h3>
                    </div>
                    {topRiders.length > 0 ? (
                      <ul className="rider-insight-list rider-top-list">
                        {pagedTopRiders.map((rider, index) => (
                          <li key={rider.user_id || rider.username}>
                            <span className="rider-item-title">
                              {(topRidersPage - 1) * RIDER_INSIGHT_PAGE_SIZE + index + 1}. {getRiderDisplayName(rider)}
                            </span>
                            <strong>{rider.deliveredParcels ?? 0} delivered</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rider-insight-empty">No rider performance data available.</p>
                    )}
                    {topRiders.length > RIDER_INSIGHT_PAGE_SIZE && (
                      <div className="rider-insight-pagination">
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() => setTopRidersPage((prev) => Math.max(1, prev - 1))}
                          disabled={topRidersPage === 1}
                        >
                          Previous
                        </button>
                        <span>{`Page ${topRidersPage} of ${topRidersTotalPages}`}</span>
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setTopRidersPage((prev) => Math.min(topRidersTotalPages, prev + 1))
                          }
                          disabled={topRidersPage === topRidersTotalPages}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="rider-insight-section">
                    <div className="rider-insight-head">
                      <h3>
                        <span className="rider-insight-head-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                            <path d="M12 4a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 11-6 6 6 6 0 016-6zm-1 2h2v4.5l3 1.8-1 1.7-4-2.3V8z" />
                          </svg>
                        </span>
                        Active Status
                      </h3>
                    </div>
                    {recentActivityRows.length > 0 ? (
                      <ul className="rider-insight-list rider-activity-list">
                        {pagedActivityRows.map((activity) => {
                          const online = isActiveRiderStatus(activity.status);
                          const statusLabel = online ? "Online" : "Offline";
                          const timeSource = online ? activity.timestamp : activity.lastActive;
                          return (
                            <li key={activity.id}>
                              <span className="rider-item-title">{activity.riderName}</span>
                              <small className="rider-activity-meta">
                                <span
                                  className={`rider-activity-dot ${online ? "is-online" : "is-offline"}`}
                                  aria-hidden="true"
                                />
                                {statusLabel} - {formatRelativeTime(timeSource)}
                              </small>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="rider-insight-empty">No rider activity yet.</p>
                    )}
                    {recentActivityRows.length > RIDER_INSIGHT_PAGE_SIZE && (
                      <div className="rider-insight-pagination">
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() => setActivityPage((prev) => Math.max(1, prev - 1))}
                          disabled={activityPage === 1}
                        >
                          Previous
                        </button>
                        <span>{`Page ${activityPage} of ${activityTotalPages}`}</span>
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setActivityPage((prev) => Math.min(activityTotalPages, prev + 1))
                          }
                          disabled={activityPage === activityTotalPages}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </section>
                </aside>
              )}
            </div>
          </div>
        )}
      </div>
      {fullMapModalOpen && (
        <div
          className="riders-modal-overlay rider-fullscreen-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setFullMapModalOpen(false)}
        >
          <div
            className="riders-modal-content rider-full-map-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="riders-modal-header rider-full-map-header">
              <h2>{fullMapView === "map" ? "Live Rider Map" : "Rider Parcel Summary"}</h2>
              <button
                type="button"
                className="rider-full-map-close rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
                onClick={() => setFullMapModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="rider-full-map-body">
              {fullMapView === "map" ? (
                <div className="rider-map-stack rider-full-map-stack">
                <div ref={fullMapRef} className="rider-full-map-canvas" />
                <div className="rider-full-map-layer-dock">
                  <div className="rider-layer-toggle-row">
                    <span>Weather</span>
                    <label
                      className="rider-toggle-switch"
                      aria-label="Toggle weather layer (fullscreen)"
                    >
                      <input
                        type="checkbox"
                        checked={activeMapLayer === "weather"}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setActiveMapLayer("weather");
                          } else {
                            setActiveMapLayer(null);
                          }
                          setShowFullWeatherPanel(false);
                        }}
                      />
                      <span className="rider-toggle-slider" />
                    </label>
                  </div>
                  <div className="rider-layer-toggle-row">
                    <span>Flood</span>
                    <label
                      className="rider-toggle-switch"
                      aria-label="Toggle flood layer (fullscreen)"
                    >
                      <input
                        type="checkbox"
                        checked={activeMapLayer === "flood"}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setActiveMapLayer("flood");
                          } else {
                            setActiveMapLayer(null);
                          }
                          setShowFullWeatherPanel(false);
                        }}
                      />
                      <span className="rider-toggle-slider" />
                    </label>
                  </div>
                </div>
                {activeMapLayer === "weather" && (
                  <button
                    type="button"
                    className={`weather-panel-toggle-btn ${showFullWeatherPanel ? "open" : ""}`}
                    onClick={() => setShowFullWeatherPanel((prev) => !prev)}
                    aria-label={
                      showFullWeatherPanel
                        ? "Hide weather panel"
                        : "Show weather panel"
                    }
                  >
                    <span aria-hidden="true">☁</span>
                  </button>
                )}
                {activeMapLayer === "weather" && showFullWeatherPanel && (
                  <div className="weather-forecast-card">
                    {fullWeatherLoading ? (
                      <p className="weather-forecast-loading">
                        Loading weather...
                      </p>
                    ) : fullWeatherError ? (
                      <p className="weather-forecast-error">
                        {fullWeatherError}
                      </p>
                    ) : fullWeatherCurrent ? (
                      <>
                        <div className="weather-now">
                          <div className="weather-now-main">
                            <strong>{fullWeatherCurrent.city}</strong>
                            <span className="weather-desc">
                              {fullWeatherCurrent.description}
                            </span>
                          </div>
                          <div className="weather-temp-block">
                            {fullWeatherCurrent.icon && (
                              <img
                                src={`https://openweathermap.org/img/wn/${fullWeatherCurrent.icon}@2x.png`}
                                alt={fullWeatherCurrent.description}
                              />
                            )}
                            <span>{fullWeatherCurrent.temp}°C</span>
                          </div>
                        </div>
                        <div className="weather-metrics">
                          <span>Feels {fullWeatherCurrent.feelsLike}°C</span>
                          <span>Humidity {fullWeatherCurrent.humidity}%</span>
                          <span>Wind {fullWeatherCurrent.wind} m/s</span>
                        </div>
                        <div className="weather-forecast-row">
                          {fullWeatherForecast.map((item) => (
                            <div
                              key={`${item.time}-${item.temp}`}
                              className="weather-forecast-chip"
                            >
                              <span>{item.time}</span>
                              {item.icon && (
                                <img
                                  src={`https://openweathermap.org/img/wn/${item.icon}.png`}
                                  alt="forecast icon"
                                />
                              )}
                              <strong>{item.temp}°</strong>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="weather-forecast-loading">
                        Weather data unavailable.
                      </p>
                    )}
                  </div>
                )}
                </div>
              ) : (
                <div className="rider-full-table-wrapper">
                  <div className="rider-table-tools">
                    <input
                      type="text"
                      className="rider-table-search"
                      placeholder="Search rider..."
                      value={tableSearchTerm}
                      onChange={(event) => setTableSearchTerm(event.target.value)}
                    />
                    <RiderTableSelect
                      value={tableSortBy}
                      onChange={setTableSortBy}
                      options={tableSortOptions}
                      ariaLabel="Sort riders"
                    />
                    <RiderTableSelect
                      value={tableFilterBy}
                      onChange={setTableFilterBy}
                      options={tableFilterOptions}
                      ariaLabel="Filter riders"
                    />
                  </div>
                  <table className="rider-full-table">
                    <thead>
                      <tr>
                        <th className="col-index">#</th>
                        <th className="col-rider">Rider</th>
                        <th className="col-metric col-delivered">Delivered</th>
                        <th className="col-metric col-ongoing">On-Going</th>
                        <th className="col-metric col-cancelled">Cancelled</th>
                        <th className="col-action">Track</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTableRows.length > 0 ? (
                        pagedTableRows.map((rider, index) => (
                          <tr key={rider.user_id || rider.username}>
                            <td className="col-index">{tableRowStartIndex + index + 1}</td>
                            <td className="col-rider">
                              <button
                                type="button"
                                className="rider-name-link"
                                onClick={() => rider?.username && openInfoModal(rider.username)}
                                disabled={!rider?.username}
                                title="View rider information"
                              >
                                {getRiderDisplayName(rider)}
                              </button>
                            </td>
                            <td className="col-metric col-delivered">{rider.deliveredParcels ?? 0}</td>
                            <td className="col-metric col-ongoing">{rider.ongoingParcels ?? 0}</td>
                            <td className="col-metric col-cancelled">{rider.cancelledParcels ?? 0}</td>
                            <td className="col-action">
                              <button
                                type="button"
                                className="rider-track-map-btn"
                                onClick={() => openRiderOnMapsPage(rider)}
                              >
                                Track
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6}>No riders found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {tableRows.length > 0 && (
                    <div className="rider-table-pagination">
                      <button
                        type="button"
                        className="rider-page-btn"
                        onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                        disabled={tablePage === 1}
                      >
                        Previous
                      </button>
                      <div className="rider-page-numbers">
                        {tablePageButtons.map((page) => (
                          <button
                            type="button"
                            key={page}
                            className={`rider-page-btn ${page === tablePage ? "is-active" : ""}`}
                            onClick={() => setTablePage(page)}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="rider-page-btn"
                        onClick={() =>
                          setTablePage((prev) => Math.min(totalTablePages, prev + 1))
                        }
                        disabled={tablePage === totalTablePages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {trackModalOpen && (
        <div
          className="riders-modal-overlay"
          onClick={closeTrackModal}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content track-rider-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 920, maxWidth: "96%" }}
          >
            <div className="riders-modal-header">
              <h2>Track Rider</h2>
            </div>
            <div className="riders-modal-body track-rider-body">
              <p>
                Tracking the location of: <strong>{trackingRiderDisplayName}</strong>
              </p>
              {loadingMap && (
                <div
                  className="track-rider-loading"
                  role="status"
                  aria-live="polite"
                  aria-label="Loading rider map"
                >
                  <div className="track-loader-shell">
                    <div className="track-loader-spinner" aria-hidden="true">
                      <span className="track-loader-ring" />
                      <span className="track-loader-core" />
                    </div>
                    <p className="track-loader-title">Preparing live location map</p>
                    <div className="track-loader-skeleton" aria-hidden="true">
                      <span className="track-loader-line line-a" />
                      <span className="track-loader-line line-b" />
                      <span className="track-loader-line line-c" />
                    </div>
                  </div>
                </div>
              )}
              <div
                ref={mapRef}
                className="track-rider-map"
                style={{
                  display: loadingMap ? "none" : "block",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {infoModalOpen && (
        <div
          className="riders-modal-overlay"
          onClick={closeInfoModal}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content rider-info-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 620, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Rider Information</h2>
            </div>

            <div className="riders-modal-body rider-info-body">
              {loadingInfo ? (
                <PageSpinner label="Loading rider information..." />
              ) : infoError ? (
                <p className="rider-info-error">{infoError}</p>
              ) : (
                <div className="rider-info-shell">
                  <div className="rider-info-hero">
                    <span
                      className={`rider-streak-pill rider-streak-pill-corner ${selectedRiderInfo?.metDailyQuotaToday ? "is-met" : "is-miss"}`}
                    >
                      <span className="rider-streak-icon" aria-hidden="true">
                        <svg viewBox="0 0 16 16" fill="none" role="presentation">
                          <path
                            d="M5.5 2.2H10.5C10.5 1.76 10.14 1.4 9.7 1.4H6.3C5.86 1.4 5.5 1.76 5.5 2.2Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.1 3.4H11.9C12.5 3.4 13 3.9 13 4.5V13C13 13.6 12.5 14.1 11.9 14.1H4.1C3.5 14.1 3 13.6 3 13V4.5C3 3.9 3.5 3.4 4.1 3.4Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.8 6.7L5.5 7.4L6.8 6.1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M7.9 6.8H10.9"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.8 9.2L5.5 9.9L6.8 8.6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M7.9 9.3H10.9"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.8 11.7L5.5 12.4L6.8 11.1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M7.9 11.8H10.9"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span>
                        {(() => {
                          const quotaMetDays = selectedRiderInfo?.quotaStreakDays ?? 0;
                          return `Quota Met: ${quotaMetDays} Day${quotaMetDays === 1 ? "" : "s"}`;
                        })()}
                      </span>
                    </span>
                    <div className="rider-info-profile">
                      {selectedRiderInfo?.profile_url ? (
                        <button
                          type="button"
                          className="rider-avatar-btn"
                          onClick={() => setPhotoPreviewOpen(true)}
                          aria-label="View profile picture"
                        >
                          <img
                            src={selectedRiderInfo.profile_url}
                            alt={`${selectedRiderInfo?.username || "Rider"} profile`}
                            className="rider-info-avatar"
                          />
                        </button>
                      ) : (
                        <div className="rider-info-avatar rider-info-avatar-fallback">
                          {(
                            selectedRiderInfo?.fname?.[0] ||
                            selectedRiderInfo?.username?.[0] ||
                            "R"
                          ).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="rider-info-main">
                      <div className="rider-info-headline">
                        <h3>{selectedRiderDisplayName}</h3>
                        <p>
                          {selectedRiderInfo?.email || "No email available"}
                        </p>
                        <div className="rider-status-row">
                          {(() => {
                            const normalizedStatus =
                              selectedRiderInfo?.status?.toLowerCase() || "";
                            const statusClass = ["online", "active"].includes(
                              normalizedStatus,
                            )
                              ? "is-online"
                              : ["offline", "inactive"].includes(
                                    normalizedStatus,
                                  )
                                ? "is-offline"
                                : "is-default";
                            return (
                              <span
                                className={`rider-status-pill ${statusClass}`}
                              >
                                {selectedRiderInfo?.status || "Unknown"}
                              </span>
                            );
                          })()}
                          <button
                            type="button"
                            className="rider-performance-btn"
                            onClick={() => setPerformanceModalOpen(true)}
                          >
                            <span className="rider-action-icon" aria-hidden="true">
                              <svg viewBox="0 0 16 16" fill="none" role="presentation">
                                <path
                                  d="M2.4 11.8L5.1 9.1L7.1 11.1L10.8 7.4"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M9.4 7.4H10.8V8.8"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M2.2 13.6H13.8"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                            <span>Performance</span>
                          </button>
                          <button
                            type="button"
                            className="rider-performance-btn rider-violations-btn"
                            onClick={() => setViolationLogsModalOpen(true)}
                          >
                            <span className="rider-action-icon" aria-hidden="true">
                              <svg viewBox="0 0 16 16" fill="none" role="presentation">
                                <path
                                  d="M8 2.2L14.1 12.8C14.26 13.09 14.05 13.45 13.72 13.45H2.28C1.95 13.45 1.74 13.09 1.9 12.8L8 2.2Z"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M8 6V9"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <circle cx="8" cy="11.2" r="0.9" fill="currentColor" />
                              </svg>
                            </span>
                            <span>Violation Logs</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rider-info-grid">
                    <div className="rider-info-item">
                      <span>Phone Number</span>
                      <strong>{selectedRiderInfo?.pnumber || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>First Name</span>
                      <strong>{selectedRiderInfo?.fname || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>Middle Name</span>
                      <strong>{selectedRiderInfo?.mname || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>Last Name</span>
                      <strong>{selectedRiderInfo?.lname || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>Gender</span>
                      <strong>{selectedRiderInfo?.gender || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>Age</span>
                      <strong>{selectedRiderInfo?.age ?? "-"}</strong>
                    </div>
                  </div>
                  {selectedRiderInfo?.profile_url && (
                    <p className="rider-info-photo-hint">
                      Tip: Click the profile photo to view it larger.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {performanceModalOpen && selectedRiderInfo && (
        <div
          className="riders-modal-overlay"
          onClick={() => setPerformanceModalOpen(false)}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content rider-performance-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 620, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>{selectedRiderDisplayName} Performance</h2>
            </div>
            <div className="riders-modal-body rider-performance-body">
              <div className="rider-performance-grid">
                <div className="rider-performance-card rider-performance-quota">
                  <span>Quota progress:</span>
                  <div className="rider-performance-ring-wrap">
                    <svg
                      viewBox="0 0 120 120"
                      className="rider-performance-ring"
                    >
                      <circle
                        className="rider-performance-ring-bg"
                        cx="60"
                        cy="60"
                        r="48"
                      />
                      <circle
                        className={`rider-performance-ring-fg ${hasMetFullQuota ? "is-met" : ""}`}
                        cx="60"
                        cy="60"
                        r="48"
                        strokeDasharray={quotaStrokeDasharray}
                      />
                    </svg>
                    <strong
                      className={`rider-performance-ring-label ${hasMetFullQuota ? "is-met" : ""}`}
                    >
                      {quotaPercent}%
                    </strong>
                  </div>
                  <small className="rider-performance-ring-note">
                    {selectedRiderInfo.deliveredParcels ?? 0}/
                    {selectedRiderInfo.quotaTarget ?? RIDER_DELIVERY_QUOTA}{" "}
                    delivered
                  </small>
                  <div className="rider-performance-quota-status">
                    <span className={`quota-status-chip ${quotaStatusClass}`}>
                      {quotaStatusLabel}
                    </span>
                    <span
                      className={`quota-status-chip ${isIncentiveEligible ? "is-incentive-eligible" : "is-incentive-pending"}`}
                    >
                      {isIncentiveEligible
                        ? "Incentive: Eligible"
                        : "Incentive: Not Eligible"}
                    </span>
                  </div>
                </div>
                <div className="rider-performance-card rider-performance-delivered">
                  <span>Delivered Parcels</span>
                  <strong>{selectedRiderInfo.deliveredParcels ?? 0}</strong>
                </div>
                <div className="rider-performance-card rider-performance-ongoing">
                  <span>Ongoing Parcels</span>
                  <strong>{selectedRiderInfo.ongoingParcels ?? 0}</strong>
                </div>
                <div className="rider-performance-card rider-performance-cancelled">
                  <span>Cancelled Parcels</span>
                  <strong>{selectedRiderInfo.cancelledParcels ?? 0}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {photoPreviewOpen && selectedRiderInfo?.profile_url && (
        <div
          className="riders-modal-overlay"
          onClick={() => setPhotoPreviewOpen(false)}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content rider-photo-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 520, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Profile Picture</h2>
            </div>
            <div className="riders-modal-body rider-photo-body">
              <img
                src={selectedRiderInfo.profile_url}
                alt={`${selectedRiderInfo?.username || "Rider"} full profile`}
                className="rider-photo-preview"
              />
            </div>
          </div>
        </div>
      )}

      {violationLogsModalOpen && selectedRiderInfo && (
        <div
          className="riders-modal-overlay"
          onClick={() => setViolationLogsModalOpen(false)}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content rider-violations-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 760, maxWidth: "96%" }}
          >
            <div className="riders-modal-header">
              <h2>{selectedRiderDisplayName} Violation Logs</h2>
            </div>
            <div className="riders-modal-body rider-violations-body">
              {loadingViolationLogs ? (
                <PageSpinner label="Loading violation logs..." />
              ) : violationLogsError ? (
                <p className="rider-info-error">{violationLogsError}</p>
              ) : riderViolationLogs.length === 0 ? (
                <p className="rider-violations-empty">
                  No violation logs found for this rider.
                </p>
              ) : (
                <div className="rider-violations-list">
                  {riderViolationLogs.map((log, index) => (
                    <div
                      className="rider-violations-item"
                      key={`${log.date || "no-date"}-${log.violation || "no-violation"}-${index}`}
                    >
                      <div className="rider-violations-fields">
                        <div className="rider-violations-field">
                          <span className="rider-violations-label">Violation Type</span>
                          <strong>{log.violation || "Unknown violation"}</strong>
                        </div>
                        <div className="rider-violations-field">
                          <span className="rider-violations-label">Date</span>
                          <strong>{formatViolationLogDate(log.date)}</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div
          className="riders-modal-overlay"
          onClick={closeCreateModal}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            className="riders-modal-content rider-create-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 560, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Create Rider Account</h2>
            </div>
            <div className="riders-modal-body rider-create-body">
              <form className="rider-create-form" onSubmit={handleCreateRider}>
                <div className="rider-create-field">
                  <label htmlFor="create-rider-date-join">Date of Join</label>
                  <input
                    id="create-rider-date-join"
                    type="date"
                    value={joinDateToday}
                    readOnly
                    aria-readonly="true"
                  />
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-username">Username</label>
                  <input
                    id="create-rider-username"
                    type="text"
                    value={createUsername}
                    onChange={(event) => setCreateUsername(event.target.value)}
                    placeholder="rider_username"
                    required
                    autoComplete="username"
                    disabled={creatingRider}
                  />
                  <div className="rider-rules-box" aria-live="polite">
                    <p className="rider-rules-title">Username requirements</p>
                    <div className="rider-create-rules">
                      <label
                        className={`rider-rule-item ${usernameLengthValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={usernameLengthValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>At least 3 characters</span>
                      </label>
                      <label
                        className={`rider-rule-item ${usernamePatternValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={usernamePatternValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Letters, numbers, underscore only</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-email">Email</label>
                  <input
                    id="create-rider-email"
                    type="email"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    placeholder="rider@email.com"
                    required
                    autoComplete="email"
                    disabled={creatingRider}
                  />
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-password">Password</label>
                  <input
                    id="create-rider-password"
                    type="password"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    placeholder="Strong password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    disabled={creatingRider}
                  />
                  <div className="rider-rules-box" aria-live="polite">
                    <p className="rider-rules-title">Password requirements</p>
                    <div className="rider-create-rules">
                      <label
                        className={`rider-rule-item ${passwordLengthValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordLengthValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>At least 8 characters</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordUpperValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordUpperValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has uppercase letter</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordLowerValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordLowerValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has lowercase letter</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordNumberValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordNumberValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has number</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordSpecialValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordSpecialValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has special character</span>
                      </label>
                    </div>
                  </div>
                </div>

                {createRiderError && (
                  <p className="rider-create-error">{createRiderError}</p>
                )}

                <div className="rider-create-actions">
                  <button
                    type="button"
                    className="rider-create-cancel"
                    onClick={closeCreateModal}
                    disabled={creatingRider}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rider-create-submit"
                    disabled={
                      creatingRider || !isUsernameValid || !isPasswordValid
                    }
                  >
                    {creatingRider ? "Creating..." : "Create Account"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showCreateSuccessModal && (
        <div
          className="riders-modal-overlay"
          onClick={() => setShowCreateSuccessModal(false)}
        >
          <div
            className="riders-success-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="riders-success-header">
              <h3>Success</h3>
            </div>
            <div className="riders-success-body">
              <div className="riders-success-check" aria-hidden="true">
                <span className="riders-success-checkmark" />
              </div>
              <p>{createSuccessMessage}</p>
            </div>
          </div>
        </div>
      )}

      {showTrackFailModal && (
        <div
          className="riders-modal-overlay"
          onClick={() => setShowTrackFailModal(false)}
        >
          <div
            className="riders-success-modal riders-fail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="riders-success-header riders-fail-header">
              <h3>Track Unavailable</h3>
            </div>
            <div className="riders-success-body riders-fail-body">
              <div className="riders-success-check riders-fail-icon" aria-hidden="true">
                <span className="riders-fail-mark">!</span>
              </div>
              <p>{trackFailMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

