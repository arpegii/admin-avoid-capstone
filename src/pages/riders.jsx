import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import { useNotification } from "../contexts/NotificationContext";
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
  const n = normalizeStatus(value);
  return n === "online" || n === "active";
};

const isDeliveredStatus = (value) => {
  const n = normalizeStatus(value);
  return (
    n === "successfully delivered" ||
    n === "delivered" ||
    n === "successful" ||
    n === "success" ||
    n === "completed"
  );
};

const toLocalDayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const calculateQuotaStreak = (parcels = [], dailyQuota = RIDER_DAILY_QUOTA) => {
  const deliveredPerDay = {};
  (parcels || []).forEach((p) => {
    if (!isDeliveredStatus(p?.status)) return;
    const key = toLocalDayKey(p?.created_at);
    if (!key) return;
    deliveredPerDay[key] = (deliveredPerDay[key] || 0) + 1;
  });
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < 366; i++) {
    const key = toLocalDayKey(cursor);
    if ((deliveredPerDay[key] || 0) >= dailyQuota) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  const todayKey = toLocalDayKey(new Date());
  const todayCount = deliveredPerDay[todayKey] || 0;
  return { streak, todayCount, metToday: todayCount >= dailyQuota };
};

const normalizeCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const buildRoutePreviewTrail = (rider, trail = []) => {
  if (Array.isArray(trail) && trail.length >= 2) return trail;
  const lat = Number(rider?.lat),
    lng = Number(rider?.lng);
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
  { mainWeight = 3, casingWeight = 6, isPreview = false } = {},
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
  const endpoint =
    Number.isFinite(endLat) && Number.isFinite(endLng)
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
  return `${month} ${day}, ${year} ${String(hour12).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} ${meridiem}`;
};

const getRiderDisplayName = (rider) => {
  const fullName = [rider?.fname, rider?.lname]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || rider?.username || "Unknown Rider";
};

const formatRelativeTime = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    return "No activity";
  const now = new Date();
  const diffMs = now.getTime() - value.getTime();
  if (diffMs <= 0) return "Just now";
  const minute = 60000,
    hour = 3600000,
    day = 86400000;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute);
    return `${m}m ago`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `${h}h ago`;
  }
  const d = Math.floor(diffMs / day);
  return `${d}d ago`;
};

const RiderTableSelect = ({
  value,
  onChange,
  options = [],
  className = "",
  ariaLabel = "Select option",
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = useMemo(
    () => (options || []).find((o) => o.value === value),
    [options, value],
  );

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") setOpen(false);
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
        className="rider-table-modern-trigger"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selectedOption?.label || "-"}</span>
        <span className="rider-table-modern-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="rider-table-modern-menu" role="listbox">
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

// ── Flood Zone Legend Component ──
const FloodLegend = () => (
  <div
    className="flood-legend"
    role="complementary"
    aria-label="Flood zone legend"
  >
    <div className="flood-legend-header">
      <span className="flood-legend-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M2 7.5c1.5-3 3.5-3 4.5 0s3 3 4.5 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M2 11c1.5-2.5 3.5-2.5 4.5 0s3 2.5 4.5 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="flood-legend-title">Flood Prone Areas</span>
    </div>
    <div className="flood-legend-items">
      <div className="flood-legend-item">
        <span className="flood-legend-swatch flood-swatch-zone" />
        <span>5-Year Flood Zone</span>
      </div>
      <div className="flood-legend-item">
        <span className="flood-legend-swatch flood-swatch-border" />
        <span>Zone Boundary</span>
      </div>
    </div>
  </div>
);

// ── Module-level GeoJSON cache — fetched once, reused across re-renders ──
let rizalFloodCache = null;
let rizalFloodFetchPromise = null;

const getRizalFloodData = () => {
  if (rizalFloodCache) return Promise.resolve(rizalFloodCache);
  if (rizalFloodFetchPromise) return rizalFloodFetchPromise;
  rizalFloodFetchPromise = fetch("/geojson/rizal_flood.geojson")
    .then((r) => r.json())
    .then((data) => {
      rizalFloodCache = data;
      rizalFloodFetchPromise = null;
      return data;
    })
    .catch((err) => {
      rizalFloodFetchPromise = null;
      throw err;
    });
  return rizalFloodFetchPromise;
};

// ── Assign Parcels Modal — fully isolated so checkbox ticks never re-render Riders ──
const ASSIGN_SORT_OPTIONS = [
  { value: "id_desc", label: "ID: Newest" },
  { value: "id_asc", label: "ID: Oldest" },
  { value: "name_asc", label: "Name: A–Z" },
  { value: "name_desc", label: "Name: Z–A" },
  { value: "date_desc", label: "Date: Newest" },
  { value: "date_asc", label: "Date: Oldest" },
];
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function AssignParcelsModal({ riders, onClose, onAssigned, refreshRiders }) {
  const [parcels, setParcels] = useState([]);
  const [loadingParcels, setLoadingParcels] = useState(false);
  const [parcelsError, setParcelsError] = useState("");
  const [selected, setSelected] = useState({});
  const [step, setStep] = useState("parcels");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [riderSearch, setRiderSearch] = useState("");
  const [sortBy, setSortBy] = useState("id_desc");

  useEffect(() => {
    let cancelled = false;
    setLoadingParcels(true);
    setParcelsError("");
    supabaseClient
      .from("parcels")
      .select("parcel_id, recipient_name, address, status, created_at")
      .is("assigned_rider_id", null)
      .eq("status", "on-going")
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setParcelsError("Failed to load unassigned parcels.");
        } else {
          setParcels(data || []);
        }
        setLoadingParcels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCount = useMemo(() => Object.keys(selected).length, [selected]);

  const filteredParcels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let result = q
      ? parcels.filter((p) => String(p.parcel_id || "").includes(q))
      : parcels;
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "id_asc":
          return Number(a.parcel_id) - Number(b.parcel_id);
        case "id_desc":
          return Number(b.parcel_id) - Number(a.parcel_id);
        case "name_asc":
          return (a.recipient_name || "").localeCompare(b.recipient_name || "");
        case "name_desc":
          return (b.recipient_name || "").localeCompare(a.recipient_name || "");
        case "date_asc":
          return new Date(a.created_at) - new Date(b.created_at);
        case "date_desc":
          return new Date(b.created_at) - new Date(a.created_at);
        default:
          return 0;
      }
    });
    return result.map((p) => ({
      ...p,
      _formattedDate: p.created_at
        ? DATE_FORMATTER.format(new Date(p.created_at))
        : "—",
    }));
  }, [parcels, searchTerm, sortBy]);

  const allVisibleSelected = useMemo(
    () =>
      filteredParcels.length > 0 &&
      filteredParcels.every((p) => selected[p.parcel_id]),
    [filteredParcels, selected],
  );

  const toggle = useCallback((parcelId) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[parcelId]) delete next[parcelId];
      else next[parcelId] = true;
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(
    (checked) => {
      setSelected((prev) => {
        const next = { ...prev };
        filteredParcels.forEach((p) => {
          if (checked) next[p.parcel_id] = true;
          else delete next[p.parcel_id];
        });
        return next;
      });
    },
    [filteredParcels],
  );

  const filteredRiders = useMemo(() => {
    const q = riderSearch.trim().toLowerCase();
    if (!q) return riders;
    return riders.filter((r) =>
      getRiderDisplayName(r).toLowerCase().includes(q),
    );
  }, [riders, riderSearch]);

  const handleAssign = async (rider) => {
    const parcelIds = Object.keys(selected).map(Number).filter(Number.isFinite);
    if (parcelIds.length === 0 || assigning) return;
    setAssigning(true);
    setError("");
    try {
      const { error: err } = await supabaseClient
        .from("parcels")
        .update({ assigned_rider_id: rider.user_id })
        .in("parcel_id", parcelIds);
      if (err) throw err;
      setSuccess(
        `${parcelIds.length} parcel${parcelIds.length > 1 ? "s" : ""} assigned to ${getRiderDisplayName(rider)}.`,
      );
      setParcels((prev) =>
        prev.filter((p) => !parcelIds.includes(Number(p.parcel_id))),
      );
      setSelected({});
      setStep("parcels");
      setRiderSearch("");
      const data = await refreshRiders();
      if (data) onAssigned(data);
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setError("Failed to assign parcels. Please try again.");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div
      className="riders-modal-overlay"
      onClick={() => {
        if (!assigning) onClose();
      }}
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        className="riders-modal-content assign-parcels-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 740, maxWidth: "96%" }}
      >
        {/* Header */}
        <div className="riders-modal-header assign-modal-header">
          <div className="assign-modal-header-left">
            {step === "rider" && (
              <button
                type="button"
                className="assign-back-btn"
                onClick={() => {
                  setStep("parcels");
                  setRiderSearch("");
                  setError("");
                }}
                disabled={assigning}
                aria-label="Back to parcel selection"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M9 2L4 7l5 5" />
                </svg>
                Back
              </button>
            )}
            <div>
              <h2 style={{ margin: 0 }}>
                {step === "parcels" ? "Assign Parcels" : "Select Rider"}
              </h2>
              <p className="assign-modal-subtitle">
                {step === "parcels"
                  ? "Select unassigned parcels to assign to a rider"
                  : `Assigning ${selectedCount} parcel${selectedCount !== 1 ? "s" : ""} — choose a rider`}
              </p>
            </div>
          </div>
          {step === "parcels" && selectedCount > 0 && (
            <button
              type="button"
              className="assign-next-btn"
              onClick={() => {
                setStep("rider");
                setRiderSearch("");
              }}
            >
              Assign {selectedCount} Parcel{selectedCount !== 1 ? "s" : ""}
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M2 7h10M7 2l5 5-5 5" />
              </svg>
            </button>
          )}
        </div>

        {/* Banners */}
        {success && (
          <div className="assign-success-banner">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M2 7l3.5 3.5L12 3" />
            </svg>
            {success}
          </div>
        )}
        {error && <div className="assign-error-banner">{error}</div>}

        {/* Body */}
        <div className="riders-modal-body assign-modal-body">
          {/* ── STEP 1: Parcel Selection ── */}
          {step === "parcels" && (
            <div className="assign-parcels-shell">
              <div className="assign-search-sort-row">
                <div className="assign-search-bar">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <circle cx="6" cy="6" r="4.5" />
                    <path d="M10 10l2.5 2.5" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search by parcel ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="assign-search-input"
                  />
                  {selectedCount > 0 && (
                    <span className="assign-selected-badge">
                      {selectedCount} selected
                    </span>
                  )}
                </div>
                <RiderTableSelect
                  value={sortBy}
                  onChange={setSortBy}
                  options={ASSIGN_SORT_OPTIONS}
                  ariaLabel="Sort parcels"
                  className="assign-sort-select"
                />
              </div>

              {loadingParcels ? (
                <div className="assign-loading-state">
                  <div className="assign-spinner" />
                  <p>Loading unassigned parcels...</p>
                </div>
              ) : parcelsError ? (
                <div style={{ padding: "16px" }}>
                  <p className="rider-info-error">{parcelsError}</p>
                </div>
              ) : parcels.length === 0 ? (
                <div className="assign-empty-state">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  >
                    <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                    <path d="M16 3H8l-2 4h12l-2-4z" />
                  </svg>
                  <p>All parcels are currently assigned.</p>
                  <span>There are no unassigned parcels at this time.</span>
                </div>
              ) : (
                <>
                  <div className="assign-select-all-row">
                    <label className="assign-checkbox-label">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(e) => selectAllVisible(e.target.checked)}
                      />
                      <span>Select all visible</span>
                    </label>
                    <span className="assign-count-hint">
                      {filteredParcels.length} parcel
                      {filteredParcels.length !== 1 ? "s" : ""} shown
                      {searchTerm && ` · ${parcels.length} total`}
                    </span>
                  </div>
                  <div className="assign-parcel-list">
                    {filteredParcels.length === 0 ? (
                      <div
                        className="assign-empty-state"
                        style={{ padding: "32px 16px" }}
                      >
                        <p style={{ margin: 0 }}>
                          No parcels match your search.
                        </p>
                      </div>
                    ) : (
                      filteredParcels.map((parcel) => (
                        <ParcelRow
                          key={parcel.parcel_id}
                          parcel={parcel}
                          isSelected={!!selected[parcel.parcel_id]}
                          onToggle={toggle}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 2: Rider Selection ── */}
          {step === "rider" && (
            <div className="assign-rider-shell">
              <div className="assign-search-bar">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <circle cx="6" cy="6" r="4.5" />
                  <path d="M10 10l2.5 2.5" />
                </svg>
                <input
                  type="text"
                  placeholder="Search riders..."
                  value={riderSearch}
                  onChange={(e) => setRiderSearch(e.target.value)}
                  className="assign-search-input"
                />
                <span className="assign-count-hint" style={{ flexShrink: 0 }}>
                  {filteredRiders.length} rider
                  {filteredRiders.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="assign-rider-list">
                {filteredRiders.length === 0 ? (
                  <div
                    className="assign-empty-state"
                    style={{ padding: "32px 16px" }}
                  >
                    <p style={{ margin: 0 }}>No riders match your search.</p>
                  </div>
                ) : (
                  filteredRiders.map((rider) => {
                    const online = isActiveRiderStatus(rider.status);
                    return (
                      <button
                        key={rider.user_id || rider.username}
                        type="button"
                        className={`assign-rider-item ${online ? "is-online" : ""}`}
                        onClick={() => handleAssign(rider)}
                        disabled={assigning}
                      >
                        <div
                          className="assign-rider-avatar"
                          style={{ overflow: "hidden", padding: 0 }}
                        >
                          {rider.profile_url ? (
                            <img
                              src={rider.profile_url}
                              alt={getRiderDisplayName(rider)}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                borderRadius: "50%",
                                display: "block",
                              }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span
                              style={{
                                display: "flex",
                                width: "100%",
                                height: "100%",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {(
                                rider.fname?.[0] ||
                                rider.username?.[0] ||
                                "R"
                              ).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="assign-rider-details">
                          <span className="assign-rider-name">
                            {getRiderDisplayName(rider)}
                          </span>
                          <span className="assign-rider-stats">
                            {rider.ongoingParcels ?? 0} ongoing ·{" "}
                            {rider.deliveredParcels ?? 0} delivered
                          </span>
                        </div>
                        <div className="assign-rider-right">
                          <span
                            className={`assign-rider-status-dot ${online ? "online" : "offline"}`}
                          />
                          <span className="assign-rider-status-text">
                            {online ? "Online" : "Offline"}
                          </span>
                        </div>
                        {assigning && (
                          <div className="assign-rider-loading-indicator" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ParcelRow = React.memo(function ParcelRow({
  parcel,
  isSelected,
  onToggle,
}) {
  return (
    <label className={`assign-parcel-item ${isSelected ? "is-selected" : ""}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(parcel.parcel_id)}
        className="assign-parcel-checkbox"
      />
      <div className="assign-parcel-info">
        <div className="assign-parcel-tracking">
          {`#${String(parcel.parcel_id)}`}
        </div>
        <div className="assign-parcel-recipient">
          {parcel.recipient_name || "—"}
        </div>
        <div className="assign-parcel-address">
          {parcel.address || "No address provided"}
        </div>
      </div>
      <div className="assign-parcel-meta">
        <span className="assign-parcel-status">
          {parcel.status || "Unassigned"}
        </span>
        <span className="assign-parcel-date">{parcel._formattedDate}</span>
      </div>
    </label>
  );
});

export default function Riders() {
  const location = useLocation();
  const navigate = useNavigate();
  const { notifyRiderViolation } = useNotification();

  // ── FIX: track which violations have already been notified this session ──
  const notifiedViolationsRef = useRef(new Set());

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

  const [violationsActiveTab, setViolationsActiveTab] = useState("overview");
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [perfActiveTab, setPerfActiveTab] = useState("overview");
  const [perfAssignedParcels, setPerfAssignedParcels] = useState([]);
  const [perfParcelsLoading, setPerfParcelsLoading] = useState(false);
  const [perfParcelsError, setPerfParcelsError] = useState("");
  const [perfParcelsSearch, setPerfParcelsSearch] = useState("");
  const [perfParcelsFilter, setPerfParcelsFilter] = useState("all");

  const tableSortOptions = useMemo(
    () => [
      { value: "name_asc", label: "Name (A–Z)" },
      { value: "name_desc", label: "Name (Z–A)" },
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
    getRizalFloodData().catch(() => {});
  }, []);

  useEffect(() => {
    if (!showCreateSuccessModal) return;
    const t = setTimeout(() => setShowCreateSuccessModal(false), 2400);
    return () => clearTimeout(t);
  }, [showCreateSuccessModal]);

  useEffect(() => {
    if (!showTrackFailModal) return;
    const t = setTimeout(() => setShowTrackFailModal(false), 2600);
    return () => clearTimeout(t);
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
  const safeQuotaTarget =
    Number.isFinite(quotaTargetForSelectedRider) &&
    quotaTargetForSelectedRider > 0
      ? quotaTargetForSelectedRider
      : RIDER_DELIVERY_QUOTA;
  const quotaPercent = Math.min(
    Math.round((deliveredForQuota / safeQuotaTarget) * 100),
    100,
  );
  const quotaMetTarget = Math.ceil(
    safeQuotaTarget * RIDER_QUOTA_REACHED_THRESHOLD,
  );
  const hasMetQuota = deliveredForQuota >= quotaMetTarget;
  const hasMetFullQuota = deliveredForQuota >= safeQuotaTarget;
  const isIncentiveEligible = hasMetQuota;
  const quotaStatusLabel = hasMetQuota ? "QUOTA REACHED" : "BELOW QUOTA";
  const quotaStrokeDasharray = `${quotaPercent * 3.02} 302`;

  const joinDateToday = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const trackingRiderDisplayName = useMemo(() => {
    const r = riders.find((r) => r.username === trackingRider);
    return getRiderDisplayName(r || { username: trackingRider });
  }, [riders, trackingRider]);

  const selectedRiderDisplayName = useMemo(
    () => getRiderDisplayName(selectedRiderInfo),
    [selectedRiderInfo],
  );

  const topRiders = useMemo(
    () =>
      [...riders].sort(
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
    const s = (topRidersPage - 1) * RIDER_INSIGHT_PAGE_SIZE;
    return topRiders.slice(s, s + RIDER_INSIGHT_PAGE_SIZE);
  }, [topRiders, topRidersPage]);

  const isMapsPage = location.pathname === "/maps";
  const focusedRiderQuery = useMemo(
    () => new URLSearchParams(location.search).get("focus") || "",
    [location.search],
  );

  const totalDelivered = useMemo(
    () => riders.reduce((s, r) => s + Number(r?.deliveredParcels || 0), 0),
    [riders],
  );
  const totalCancelled = useMemo(
    () => riders.reduce((s, r) => s + Number(r?.cancelledParcels || 0), 0),
    [riders],
  );
  const onlineCount = useMemo(
    () => riders.filter((r) => isActiveRiderStatus(r?.status)).length,
    [riders],
  );

  const tableRows = useMemo(() => {
    const query = tableSearchTerm.trim().toLowerCase();
    let rows = [...riders];
    if (query)
      rows = rows.filter((r) =>
        getRiderDisplayName(r).toLowerCase().includes(query),
      );
    if (tableFilterBy === "has_deliveries")
      rows = rows.filter((r) => Number(r?.deliveredParcels || 0) > 0);
    else if (tableFilterBy === "high_cancelled")
      rows = rows.filter((r) => Number(r?.cancelledParcels || 0) >= 5);
    if (tableSortBy === "delivered_desc")
      rows.sort(
        (a, b) =>
          Number(b?.deliveredParcels || 0) - Number(a?.deliveredParcels || 0),
      );
    else if (tableSortBy === "cancelled_desc")
      rows.sort(
        (a, b) =>
          Number(b?.cancelledParcels || 0) - Number(a?.cancelledParcels || 0),
      );
    else if (tableSortBy === "name_desc")
      rows.sort((a, b) =>
        getRiderDisplayName(b).localeCompare(getRiderDisplayName(a)),
      );
    else
      rows.sort((a, b) =>
        getRiderDisplayName(a).localeCompare(getRiderDisplayName(b)),
      );
    return rows;
  }, [riders, tableSearchTerm, tableSortBy, tableFilterBy]);

  const totalTablePages = useMemo(
    () => Math.max(1, Math.ceil(tableRows.length / RIDER_TABLE_PAGE_SIZE)),
    [tableRows.length],
  );
  const pagedTableRows = useMemo(() => {
    const s = (tablePage - 1) * RIDER_TABLE_PAGE_SIZE;
    return tableRows.slice(s, s + RIDER_TABLE_PAGE_SIZE);
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
    if (topRidersPage > topRidersTotalPages)
      setTopRidersPage(topRidersTotalPages);
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
  const floodGeoJsonRef = useRef(null);
  const fullFloodGeoJsonRef = useRef(null);
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
    const n = String(riderName || "").trim();
    if (!n) return;
    openInfoModalRef.current?.(n);
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
      const riderName = (
        popupButton?.getAttribute("data-rider-name") ||
        popupCard?.getAttribute("data-rider-name") ||
        ""
      ).trim();
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
        "user_id, username, fname, lname, status, last_active, last_seen_lat, last_seen_lng, profile_url",
      );
    if (error) throw error;
    return (data || []).map((r) => ({
      ...r,
      lat: normalizeCoordinate(r.last_seen_lat),
      lng: normalizeCoordinate(r.last_seen_lng),
    }));
  }, []);

  const fetchRiderMetrics = useCallback(async (ridersData = []) => {
    const riderIds = (ridersData || []).map((r) => r.user_id).filter(Boolean);
    if (riderIds.length === 0) {
      setRiderDailyStats({ deliveredToday: 0, cancelledToday: 0 });
      return (ridersData || []).map((r) => ({
        ...r,
        deliveredParcels: 0,
        ongoingParcels: 0,
        cancelledParcels: 0,
      }));
    }
    const { data: parcelsData, error: parcelsError } = await supabaseClient
      .from("parcels")
      .select("assigned_rider_id, status, created_at")
      .in("assigned_rider_id", riderIds);
    if (parcelsError) throw parcelsError;
    const statsByRiderId = new Map();
    riderIds.forEach((id) =>
      statsByRiderId.set(id, {
        deliveredParcels: 0,
        ongoingParcels: 0,
        cancelledParcels: 0,
      }),
    );
    const todayKey = toLocalDayKey(new Date());
    let deliveredToday = 0,
      cancelledToday = 0;
    (parcelsData || []).forEach((parcel) => {
      const riderId = parcel?.assigned_rider_id;
      if (!riderId || !statsByRiderId.has(riderId)) return;
      const stats = statsByRiderId.get(riderId);
      const n = normalizeStatus(parcel?.status);
      const parcelDayKey = toLocalDayKey(parcel?.created_at);
      if (isDeliveredStatus(parcel?.status)) {
        stats.deliveredParcels++;
        if (parcelDayKey === todayKey) deliveredToday++;
      }
      if (n === "on going") stats.ongoingParcels++;
      if (n === "cancelled" || n === "canceled") {
        stats.cancelledParcels++;
        if (parcelDayKey === todayKey) cancelledToday++;
      }
    });
    setRiderDailyStats({ deliveredToday, cancelledToday });
    return (ridersData || []).map((r) => ({
      ...r,
      ...(statsByRiderId.get(r.user_id) || {
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
    const displayName = getRiderDisplayName(
      selected || { username: riderName },
    );
    const safeDisplayName = escapeHtml(displayName);
    const n = selected?.status?.toLowerCase() || "";
    const isOnline = ["online", "active"].includes(n);
    const statusClass = isOnline
      ? "is-online"
      : ["offline", "inactive"].includes(n)
        ? "is-offline"
        : "is-default";
    return `<div class="rider-location-popup ${statusClass}" data-rider-name="${safeName}"><div class="rider-location-popup-head"><span class="rider-location-dot" aria-hidden="true"></span><span class="rider-location-popup-label">Rider location</span></div><button type="button" class="rider-location-popup-btn" data-rider-name="${safeName}">${safeDisplayName}</button><span class="rider-location-status">${escapeHtml(selected?.status || "Unknown")}</span><span class="rider-location-popup-hint">Tap name to view rider details</span></div>`;
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
        domEvent?.preventDefault?.();
        domEvent?.stopPropagation?.();
        openRiderInfoFromPopup(
          button?.getAttribute?.("data-rider-name") || riderName,
        );
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
      if (!currentRes.ok || !forecastRes.ok)
        throw new Error("Failed to load weather information.");
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
      setWeatherForecast(
        (forecast?.list || []).slice(0, 4).map((item) => ({
          time: new Date(item.dt * 1000).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          temp: Math.round(item?.main?.temp ?? 0),
          icon: item?.weather?.[0]?.icon || null,
        })),
      );
    } catch {
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
      if (!currentRes.ok || !forecastRes.ok) throw new Error();
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
      setFullWeatherForecast(
        (forecast?.list || []).slice(0, 4).map((item) => ({
          time: new Date(item.dt * 1000).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          temp: Math.round(item?.main?.temp ?? 0),
          icon: item?.weather?.[0]?.icon || null,
        })),
      );
    } catch {
      setFullWeatherError("Unable to load weather data.");
      setFullWeatherCurrent(null);
      setFullWeatherForecast([]);
    } finally {
      setFullWeatherLoading(false);
    }
  };

  const riderLocations = useMemo(
    () =>
      riders.filter(
        (r) =>
          r.lat !== null && r.lng !== null && isActiveRiderStatus(r?.status),
      ),
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
        return (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0);
      });
    remainingRiders.forEach((entry) => {
      if (!entry.riderKey || seen.has(entry.riderKey)) return;
      seen.add(entry.riderKey);
      merged.push(entry);
    });
    return merged;
  }, [recentRiderActivity, riders]);

  const activityTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(recentActivityRows.length / RIDER_INSIGHT_PAGE_SIZE),
      ),
    [recentActivityRows.length],
  );
  const pagedActivityRows = useMemo(() => {
    const s = (activityPage - 1) * RIDER_INSIGHT_PAGE_SIZE;
    return recentActivityRows.slice(s, s + RIDER_INSIGHT_PAGE_SIZE);
  }, [recentActivityRows, activityPage]);
  useEffect(() => {
    if (activityPage > activityTotalPages) setActivityPage(activityTotalPages);
  }, [activityPage, activityTotalPages]);

  useEffect(() => {
    let isMounted = true;
    async function loadRiders() {
      try {
        const data = await refreshRiders();
        if (isMounted) {
          setRiders(data);
          setLastUpdatedAt(new Date());
        }
      } catch (error) {
        console.error("Failed to load rider locations:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadRiders();
    const pollingInterval = setInterval(async () => {
      try {
        const data = await refreshRiders();
        if (isMounted) {
          setRiders(data);
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
    appliedFocusViewRef.current = focusedRiderQuery;
  }, [isMapsPage, focusedRiderQuery]);

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
          nextTrailsMap.set(key, [...existingTrail, currentPoint].slice(-8));
        }
      }
      if (hasMoved) {
        const parsedLastActive = rider?.last_active
          ? new Date(rider.last_active)
          : null;
        const lastActive =
          parsedLastActive && !Number.isNaN(parsedLastActive.getTime())
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
    if (activityEntries.length > 0)
      setRecentRiderActivity((prev) =>
        [...activityEntries, ...prev].slice(0, RIDER_ACTIVITY_HISTORY_LIMIT),
      );
  }, [riderLocations]);

  // ── Main map ──
  useEffect(() => {
    if (loading || !allMapRef.current) return;
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
    allMarkersRef.current.forEach((m) => map.removeLayer(m));
    allMarkersRef.current = [];
    allMarkersByRiderRef.current = new Map();
    allRouteLinesRef.current.forEach((l) => map.removeLayer(l));
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
    if (!hasAutoCenteredAllMapRef.current && allMarkersRef.current.length > 1) {
      map.fitBounds(L.featureGroup(allMarkersRef.current).getBounds().pad(0.2));
      hasAutoCenteredAllMapRef.current = true;
    } else if (
      !hasAutoCenteredAllMapRef.current &&
      allMarkersRef.current.length === 1
    ) {
      const f = allMarkersRef.current[0].getLatLng();
      map.setView([f.lat, f.lng], 14);
      hasAutoCenteredAllMapRef.current = true;
    }
    setTimeout(() => map.invalidateSize(), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, riderLocations]);

  useEffect(() => {
    if (!isMapsPage || !focusedRiderQuery) return;
    const map = allLeafletMapRef.current;
    if (!map) return;
    const focusedRider = riderLocations.find(
      (r) =>
        String(r?.username || "").toLowerCase() ===
        focusedRiderQuery.toLowerCase(),
    );
    if (!focusedRider) return;
    map.setView([focusedRider.lat, focusedRider.lng], 16);
    const marker = allMarkersByRiderRef.current.get(focusedRider.username);
    marker?.openPopup();
    marker?.getPopup?.()?.update?.();
    const params = new URLSearchParams(location.search);
    if (params.has("focus")) {
      params.delete("focus");
      const q = params.toString();
      navigate(q ? `/maps?${q}` : "/maps", { replace: true });
    }
  }, [
    isMapsPage,
    focusedRiderQuery,
    riderLocations,
    loading,
    location.search,
    navigate,
  ]);

  // ── Fullscreen map ──
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
      if (fullFloodGeoJsonRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullFloodGeoJsonRef.current);
        fullFloodGeoJsonRef.current = null;
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
    if (!fullMapRef.current) return;
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
    fullMarkersRef.current.forEach((m) => map.removeLayer(m));
    fullMarkersRef.current = [];
    fullMarkersByRiderRef.current = new Map();
    fullRouteLinesRef.current.forEach((l) => map.removeLayer(l));
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
    if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length > 1
    ) {
      map.fitBounds(
        L.featureGroup(fullMarkersRef.current).getBounds().pad(0.2),
      );
      hasAutoCenteredFullMapRef.current = true;
    } else if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length === 1
    ) {
      const f = fullMarkersRef.current[0].getLatLng();
      map.setView([f.lat, f.lng], 14);
      hasAutoCenteredFullMapRef.current = true;
    }
    setTimeout(() => map.invalidateSize(), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMapModalOpen, riderLocations]);

  useEffect(() => {
    const map = fullLeafletMapRef.current;
    if (!fullMapModalOpen || !map) return;
    if (fullWeatherOverlayRef.current) {
      map.removeLayer(fullWeatherOverlayRef.current);
      fullWeatherOverlayRef.current = null;
    }
    if (fullFloodOverlayRef.current) {
      map.removeLayer(fullFloodOverlayRef.current);
      fullFloodOverlayRef.current = null;
    }
    if (fullFloodGeoJsonRef.current) {
      map.removeLayer(fullFloodGeoJsonRef.current);
      fullFloodGeoJsonRef.current = null;
    }
    if (activeMapLayer === "weather") {
      fullWeatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        { maxZoom: 19, opacity: 0.9 },
      );
      fullWeatherOverlayRef.current.addTo(map);
    } else if (activeMapLayer === "flood") {
      const loadFullFlood = async () => {
        try {
          const rizalData = await getRizalFloodData();
          if (!fullLeafletMapRef.current) return;
          const renderer = L.canvas({ padding: 0.5 });
          const floodStyle = {
            renderer,
            color: "#1d4ed8",
            weight: 1.5,
            opacity: 0.75,
            fillColor: "#3b82f6",
            fillOpacity: 0.22,
            dashArray: null,
            lineJoin: "round",
          };
          const hoverStyle = {
            fillOpacity: 0.42,
            weight: 2.5,
            color: "#1e40af",
          };
          const layer = L.geoJSON(rizalData, {
            style: floodStyle,
            onEachFeature: (_, lyr) => {
              lyr.on("mouseover", () => lyr.setStyle(hoverStyle));
              lyr.on("mouseout", () => lyr.setStyle(floodStyle));
            },
          }).addTo(fullLeafletMapRef.current);
          fullFloodGeoJsonRef.current = layer;
        } catch (err) {
          console.error("Failed to load flood GeoJSON (fullscreen):", err);
        }
      };
      loadFullFlood();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMapModalOpen, activeMapLayer]);

  useEffect(() => {
    if (
      !trackModalOpen ||
      !trackingRider ||
      !currentMarkerRef.current ||
      !leafletMapRef.current
    )
      return;
    const selectedRider = riderLocations.find(
      (r) => r.username === trackingRider,
    );
    if (!selectedRider) return;
    currentMarkerRef.current.setLatLng([selectedRider.lat, selectedRider.lng]);
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
    if (floodGeoJsonRef.current) {
      map.removeLayer(floodGeoJsonRef.current);
      floodGeoJsonRef.current = null;
    }
    if (activeMapLayer === "weather") {
      weatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        { maxZoom: 19, opacity: 0.9 },
      );
      weatherOverlayRef.current.addTo(map);
      weatherOverlayRef.current.bringToFront();
    } else if (activeMapLayer === "flood") {
      const loadFlood = async () => {
        try {
          const rizalData = await getRizalFloodData();
          if (!allLeafletMapRef.current) return;
          const renderer = L.canvas({ padding: 0.5 });
          const floodStyle = {
            renderer,
            color: "#1d4ed8",
            weight: 1.5,
            opacity: 0.75,
            fillColor: "#3b82f6",
            fillOpacity: 0.22,
            dashArray: null,
            lineJoin: "round",
          };
          const hoverStyle = {
            fillOpacity: 0.42,
            weight: 2.5,
            color: "#1e40af",
          };
          const layer = L.geoJSON(rizalData, {
            style: floodStyle,
            onEachFeature: (_, lyr) => {
              lyr.on("mouseover", () => lyr.setStyle(hoverStyle));
              lyr.on("mouseout", () => lyr.setStyle(floodStyle));
            },
          }).addTo(allLeafletMapRef.current);
          floodGeoJsonRef.current = layer;
        } catch (err) {
          console.error("Failed to load flood GeoJSON:", err);
        }
      };
      loadFlood();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMapLayer, loading]);

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
      const c = map.getCenter();
      fetchWeatherForLocation(c.lat, c.lng);
    };
    requestWeather();
    map.on("moveend", requestWeather);
    return () => map.off("moveend", requestWeather);
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
      const c = map.getCenter();
      fetchFullWeatherForLocation(c.lat, c.lng);
    };
    requestWeather();
    map.on("moveend", requestWeather);
    return () => map.off("moveend", requestWeather);
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
      if (floodGeoJsonRef.current && allLeafletMapRef.current) {
        allLeafletMapRef.current.removeLayer(floodGeoJsonRef.current);
        floodGeoJsonRef.current = null;
      }
      if (fullFloodGeoJsonRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullFloodGeoJsonRef.current);
        fullFloodGeoJsonRef.current = null;
      }
      allRouteLinesRef.current.forEach((l) => {
        if (allLeafletMapRef.current) allLeafletMapRef.current.removeLayer(l);
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
      fullRouteLinesRef.current.forEach((l) => {
        if (fullLeafletMapRef.current) fullLeafletMapRef.current.removeLayer(l);
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
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      currentMarkerRef.current = null;
    }
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
      setTrackFailMessage(
        `${getRiderDisplayName(rider)} is offline or not available on the live rider map.`,
      );
      setShowTrackFailModal(true);
      return;
    }
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
      const { data: riderData, error: riderError } = await supabaseClient
        .from("users")
        .select(
          "user_id, username, email, fname, lname, mname, gender, age, status, pnumber, profile_url",
        )
        .eq("username", riderName)
        .maybeSingle();
      if (riderError) throw riderError;
      if (!riderData) {
        setInfoError("Rider information not found.");
        return;
      }
      const { data: parcelsData, error: parcelsError } = await supabaseClient
        .from("parcels")
        .select("status, assigned_rider_id, created_at")
        .eq("assigned_rider_id", riderData.user_id);
      setLoadingViolationLogs(true);
      const { data: violationData, error: violationError } =
        await supabaseClient
          .from("violation_logs")
          .select("violation, date, lat, lng, name")
          .eq("user_id", riderData.user_id)
          .order("date", { ascending: false });
      setLoadingViolationLogs(false);
      if (parcelsError) console.error("Failed to fetch parcels:", parcelsError);
      if (violationError) {
        console.error("Failed to fetch rider violation logs:", violationError);
        setViolationLogsError("Failed to load rider violation logs.");
      } else {
        setRiderViolationLogs(violationData || []);
        if (violationData && violationData.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const recentViolations = violationData.filter((v) => {
            const vDate = new Date(v.date);
            return vDate >= today;
          });
          // ── FIX: only notify for violations not yet seen this session ──
          recentViolations.slice(0, 3).forEach((violation) => {
            const violationKey = `${riderData.user_id}-${violation.date}-${violation.violation}`;
            if (notifiedViolationsRef.current.has(violationKey)) return;
            notifiedViolationsRef.current.add(violationKey);
            notifyRiderViolation(
              riderData.user_id,
              riderData.fname || riderData.username || "Rider",
              violation.violation || "Speed violation",
              Math.floor(Math.random() * 30 + 60),
            );
          });
        }
      }
      const parcels = parcelsData || [];
      const { streak, todayCount, metToday } = calculateQuotaStreak(
        parcels,
        RIDER_DAILY_QUOTA,
      );
      setSelectedRiderInfo({
        ...riderData,
        deliveredParcels: parcels.filter((p) => isDeliveredStatus(p.status))
          .length,
        ongoingParcels: parcels.filter(
          (p) => normalizeStatus(p.status) === "on going",
        ).length,
        cancelledParcels: parcels.filter(
          (p) => normalizeStatus(p.status) === "cancelled",
        ).length,
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

  const fetchAssignedParcels = useCallback(async (riderId) => {
    if (!riderId) return;
    setPerfParcelsLoading(true);
    setPerfParcelsError("");
    try {
      const { data, error } = await supabaseClient
        .from("parcels")
        .select("parcel_id, recipient_name, address, status, created_at")
        .eq("assigned_rider_id", riderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPerfAssignedParcels(data || []);
    } catch (err) {
      console.error("Failed to fetch assigned parcels:", err);
      setPerfParcelsError("Failed to load assigned parcels.");
    } finally {
      setPerfParcelsLoading(false);
    }
  }, []);

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

  const openAssignModal = () => setAssignModalOpen(true);
  const closeAssignModal = () => setAssignModalOpen(false);

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
      if (usersUpdateError) throw usersUpdateError;
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
        if (usersInsertError) throw usersInsertError;
      }
      const data = await refreshRiders();
      if (data) {
        setRiders(data);
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

  const WeatherPanel = ({
    current,
    forecast,
    loading: wLoading,
    error: wError,
  }) => (
    <div className="weather-forecast-card">
      {wLoading ? (
        <p className="weather-forecast-loading">Loading weather...</p>
      ) : wError ? (
        <p className="weather-forecast-error">{wError}</p>
      ) : current ? (
        <>
          <div className="weather-now">
            <div className="weather-now-main">
              <strong>{current.city}</strong>
              <span className="weather-desc">{current.description}</span>
            </div>
            <div className="weather-temp-block">
              {current.icon && (
                <img
                  src={`https://openweathermap.org/img/wn/${current.icon}@2x.png`}
                  alt={current.description}
                />
              )}
              <span>{current.temp}°C</span>
            </div>
          </div>
          <div className="weather-metrics">
            <span>Feels {current.feelsLike}°C</span>
            <span>Humidity {current.humidity}%</span>
            <span>Wind {current.wind} m/s</span>
          </div>
          <div className="weather-forecast-row">
            {forecast.map((item) => (
              <div
                key={`${item.time}-${item.temp}`}
                className="weather-forecast-chip"
              >
                <span>{item.time}</span>
                {item.icon && (
                  <img
                    src={`https://openweathermap.org/img/wn/${item.icon}.png`}
                    alt="forecast"
                  />
                )}
                <strong>{item.temp}°</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="weather-forecast-loading">Weather data unavailable.</p>
      )}
    </div>
  );

  const perfTotal =
    (selectedRiderInfo?.deliveredParcels ?? 0) +
    (selectedRiderInfo?.ongoingParcels ?? 0) +
    (selectedRiderInfo?.cancelledParcels ?? 0);
  const perfSuccessRate =
    perfTotal > 0
      ? Math.round(
          ((selectedRiderInfo?.deliveredParcels ?? 0) / perfTotal) * 100,
        )
      : 0;
  const perfCancelRate =
    perfTotal > 0
      ? Math.round(
          ((selectedRiderInfo?.cancelledParcels ?? 0) / perfTotal) * 100,
        )
      : 0;
  const perfRemaining = Math.max(
    0,
    (selectedRiderInfo?.quotaTarget ?? RIDER_DELIVERY_QUOTA) -
      (selectedRiderInfo?.deliveredParcels ?? 0),
  );
  const perfAvgPerDay = selectedRiderInfo
    ? ((selectedRiderInfo.deliveredParcels ?? 0) / Math.max(1, 22)).toFixed(1)
    : "0";
  const perfQuotaGap =
    (selectedRiderInfo?.quotaTarget ?? RIDER_DELIVERY_QUOTA) > 0
      ? Math.max(
          0,
          Math.round(
            (perfRemaining /
              (selectedRiderInfo?.quotaTarget ?? RIDER_DELIVERY_QUOTA)) *
              100,
          ),
        )
      : 0;

  const perfFilteredParcels = useMemo(() => {
    const q = perfParcelsSearch.trim().toLowerCase();
    return perfAssignedParcels.filter((p) => {
      const matchSearch =
        !q ||
        String(p.parcel_id).includes(q) ||
        (p.recipient_name || "").toLowerCase().includes(q) ||
        (p.address || "").toLowerCase().includes(q);
      const matchFilter =
        perfParcelsFilter === "all" ||
        normalizeStatus(p.status) === normalizeStatus(perfParcelsFilter);
      return matchSearch && matchFilter;
    });
  }, [perfAssignedParcels, perfParcelsSearch, perfParcelsFilter]);

  const violationStats = useMemo(() => {
    if (!riderViolationLogs.length) return null;
    const byType = {};
    riderViolationLogs.forEach((v) => {
      const t = (v.violation || "Unknown").trim();
      byType[t] = (byType[t] || 0) + 1;
    });
    const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const mostCommon = sorted[0]?.[0] || "—";
    const total = riderViolationLogs.length;
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d;
    });
    const dayLabels = days.map((d) =>
      d.toLocaleDateString("en-US", { weekday: "short" }),
    );
    const perDay = days.map((day) => {
      const key = toLocalDayKey(day);
      return riderViolationLogs.filter((v) => toLocalDayKey(v.date) === key)
        .length;
    });
    const maxPerDay = Math.max(...perDay, 1);
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const key = toLocalDayKey(cursor);
      const count = riderViolationLogs.filter(
        (v) => toLocalDayKey(v.date) === key,
      ).length;
      if (count > 0) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return {
      byType: sorted,
      mostCommon,
      total,
      perDay,
      dayLabels,
      maxPerDay,
      streak,
    };
  }, [riderViolationLogs]);

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar currentPage="riders.html" />

      <div className="riders-page page-with-topnav">
        <div className={`riders-content-shell ${loading ? "is-loading" : ""}`}>
          {loading ? (
            <PageSpinner label="Loading riders..." />
          ) : (
            <>
              {/* ── Page Header ── */}
              <div className="rider-header-row">
                <h1 className="page-title">Rider Management</h1>
                <div className="rider-header-actions">
                  <button
                    type="button"
                    className="assign-parcels-btn"
                    onClick={openAssignModal}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 6h10M4 10h8M4 14h6" />
                      <path d="M16 14l3 3 3-3" />
                      <path d="M19 17V9" />
                    </svg>
                    Assign Parcels
                  </button>
                  <button
                    type="button"
                    className="add-rider-btn"
                    onClick={openCreateModal}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M7 1v12M1 7h12" />
                    </svg>
                    Add Rider
                  </button>
                </div>
              </div>

              {/* ── Stats Strip ── */}
              <div className="rider-stats-strip">
                <div className="rider-stat-card">
                  <span className="rider-stat-label">Total Riders</span>
                  <span className="rider-stat-value">{riders.length}</span>
                  <span className="rider-stat-sub">
                    <span
                      className="rider-stat-dot"
                      style={{ color: "var(--c-text-3)" }}
                    />
                    All registered riders
                  </span>
                </div>
                <div className="rider-stat-card is-online">
                  <span className="rider-stat-label">Online Now</span>
                  <span className="rider-stat-value">{onlineCount}</span>
                  <span className="rider-stat-sub is-green">
                    <span className="rider-stat-dot" />
                    Active on the road
                  </span>
                </div>
                <div className="rider-stat-card is-delivered">
                  <span className="rider-stat-label">Total Delivered</span>
                  <span className="rider-stat-value">
                    {totalDelivered.toLocaleString()}
                  </span>
                  <span className="rider-stat-sub is-green">
                    <span className="rider-stat-dot" />
                    Across all riders
                  </span>
                </div>
                <div className="rider-stat-card is-cancelled">
                  <span className="rider-stat-label">Total Cancelled</span>
                  <span className="rider-stat-value">
                    {totalCancelled.toLocaleString()}
                  </span>
                  <span className="rider-stat-sub is-red">
                    <span className="rider-stat-dot" />
                    Across all riders
                  </span>
                </div>
              </div>

              {/* ── Main Grid ── */}
              <div className="riders-main-grid">
                {/* ── Live Map ── */}
                <div className="rider-map-section">
                  <div className="rider-map-topbar">
                    <div className="rider-map-topbar-left">
                      <div className="rider-map-badge">
                        <span className="rider-live-dot" />
                      </div>
                      <span className="rider-map-title">Live Rider Map</span>
                      <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
                        · auto-refreshes every 5s
                      </span>
                    </div>
                    <div className="rider-map-controls">
                      <label
                        className={`rider-layer-pill ${activeMapLayer === "weather" ? "is-active" : ""}`}
                        aria-label="Toggle weather layer"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M4 15a4 4 0 010-8 5 5 0 019.9 1H14a3 3 0 010 6H4z" />
                        </svg>
                        Weather
                        <input
                          type="checkbox"
                          checked={activeMapLayer === "weather"}
                          onChange={(e) => {
                            setActiveMapLayer(
                              e.target.checked ? "weather" : null,
                            );
                            setShowWeatherPanel(false);
                          }}
                        />
                      </label>
                      <label
                        className={`rider-layer-pill ${activeMapLayer === "flood" ? "is-active" : ""}`}
                        aria-label="Toggle flood layer"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M2 10c2-4 5-4 6 0s4 4 6 0M2 14c2-3 5-3 6 0s4 3 6 0" />
                        </svg>
                        Flood
                        <input
                          type="checkbox"
                          checked={activeMapLayer === "flood"}
                          onChange={(e) => {
                            setActiveMapLayer(
                              e.target.checked ? "flood" : null,
                            );
                            setShowWeatherPanel(false);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="rider-expand-btn"
                        onClick={() => setFullMapModalOpen(true)}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M8.5 1.5H12.5V5.5M12.5 1.5L8 6M5.5 12.5H1.5V8.5M1.5 12.5L6 8" />
                        </svg>
                        Expand
                      </button>
                    </div>
                  </div>

                  <div className="rider-map-canvas-wrap">
                    <div ref={allMapRef} className="rider-live-map" />
                    {activeMapLayer === "weather" && (
                      <button
                        type="button"
                        className={`weather-panel-toggle-btn ${showWeatherPanel ? "open" : ""}`}
                        onClick={() => setShowWeatherPanel((p) => !p)}
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
                      <WeatherPanel
                        current={weatherCurrent}
                        forecast={weatherForecast}
                        loading={weatherLoading}
                        error={weatherError}
                      />
                    )}
                    {activeMapLayer === "flood" && <FloodLegend />}
                  </div>
                </div>

                {/* ── Rider Table ── */}
                <div className="rider-table-section">
                  <div className="rider-table-header">
                    <span className="rider-table-title">Rider Summary</span>
                    <div className="rider-table-tools">
                      <input
                        type="text"
                        className="rider-table-search"
                        placeholder="Search rider..."
                        value={tableSearchTerm}
                        onChange={(e) => setTableSearchTerm(e.target.value)}
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
                  </div>

                  <div className="rider-full-table-wrapper">
                    <table className="rider-full-table">
                      <thead>
                        <tr>
                          <th className="col-index">#</th>
                          <th className="col-rider">Rider</th>
                          <th className="col-metric col-delivered">
                            Delivered
                          </th>
                          <th className="col-metric col-ongoing">On-Going</th>
                          <th className="col-metric col-cancelled">
                            Cancelled
                          </th>
                          <th className="col-action">Track</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTableRows.length > 0 ? (
                          pagedTableRows.map((rider, index) => (
                            <tr key={rider.user_id || rider.username}>
                              <td className="col-index">
                                {tableRowStartIndex + index + 1}
                              </td>
                              <td className="col-rider">
                                <button
                                  type="button"
                                  className="rider-name-link"
                                  onClick={() =>
                                    rider?.username &&
                                    openInfoModal(rider.username)
                                  }
                                  disabled={!rider?.username}
                                  title="View rider information"
                                >
                                  {getRiderDisplayName(rider)}
                                </button>
                              </td>
                              <td className="col-metric col-delivered">
                                {rider.deliveredParcels ?? 0}
                              </td>
                              <td className="col-metric col-ongoing">
                                {rider.ongoingParcels ?? 0}
                              </td>
                              <td className="col-metric col-cancelled">
                                {rider.cancelledParcels ?? 0}
                              </td>
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
                            <td
                              colSpan={6}
                              style={{
                                textAlign: "center",
                                padding: "24px",
                                color: "var(--c-text-3)",
                              }}
                            >
                              No riders found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {tableRows.length > RIDER_TABLE_PAGE_SIZE && (
                    <div className="rider-table-pagination">
                      <button
                        type="button"
                        className="rider-page-btn"
                        onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                        disabled={tablePage === 1}
                      >
                        Prev
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
                          setTablePage((p) => Math.min(totalTablePages, p + 1))
                        }
                        disabled={tablePage === totalTablePages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Insights Sidebar ── */}
                <aside className="rider-insights-card">
                  <div className="rider-insight-section">
                    <div className="rider-insight-head">
                      <span
                        className="rider-insight-head-icon"
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          focusable="false"
                          aria-hidden="true"
                        >
                          <path d="M12 3a4 4 0 110 8 4 4 0 010-8zm0 10c4.42 0 8 2.24 8 5v1H4v-1c0-2.76 3.58-5 8-5z" />
                        </svg>
                      </span>
                      <h3>Top Riders</h3>
                    </div>
                    {topRiders.length > 0 ? (
                      <ul className="rider-insight-list rider-top-list">
                        {pagedTopRiders.map((rider, index) => (
                          <li key={rider.user_id || rider.username}>
                            <span className="rider-item-title">
                              {(topRidersPage - 1) * RIDER_INSIGHT_PAGE_SIZE +
                                index +
                                1}
                              . {getRiderDisplayName(rider)}
                            </span>
                            <strong>{rider.deliveredParcels ?? 0}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rider-insight-empty">No data available.</p>
                    )}
                    {topRiders.length > RIDER_INSIGHT_PAGE_SIZE && (
                      <div className="rider-insight-pagination">
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setTopRidersPage((p) => Math.max(1, p - 1))
                          }
                          disabled={topRidersPage === 1}
                        >
                          Prev
                        </button>
                        <span>
                          {topRidersPage}/{topRidersTotalPages}
                        </span>
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setTopRidersPage((p) =>
                              Math.min(topRidersTotalPages, p + 1),
                            )
                          }
                          disabled={topRidersPage === topRidersTotalPages}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="rider-insight-section">
                    <div className="rider-insight-head">
                      <span
                        className="rider-insight-head-icon"
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          focusable="false"
                          aria-hidden="true"
                        >
                          <path d="M12 4a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 11-6 6 6 6 0 016-6zm-1 2h2v4.5l3 1.8-1 1.7-4-2.3V8z" />
                        </svg>
                      </span>
                      <h3>Activity</h3>
                    </div>
                    {recentActivityRows.length > 0 ? (
                      <ul className="rider-insight-list rider-activity-list">
                        {pagedActivityRows.map((activity) => {
                          const online = isActiveRiderStatus(activity.status);
                          const timeSource = online
                            ? activity.timestamp
                            : activity.lastActive;
                          return (
                            <li key={activity.id}>
                              <span className="rider-item-title">
                                {activity.riderName}
                              </span>
                              <small className="rider-activity-meta">
                                <span
                                  className={`rider-activity-dot ${online ? "is-online" : "is-offline"}`}
                                  aria-hidden="true"
                                />
                                {online
                                  ? "Active now"
                                  : `Offline · ${formatRelativeTime(timeSource)}`}
                              </small>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="rider-insight-empty">No activity yet.</p>
                    )}
                    {recentActivityRows.length > RIDER_INSIGHT_PAGE_SIZE && (
                      <div className="rider-insight-pagination">
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setActivityPage((p) => Math.max(1, p - 1))
                          }
                          disabled={activityPage === 1}
                        >
                          Prev
                        </button>
                        <span>
                          {activityPage}/{activityTotalPages}
                        </span>
                        <button
                          type="button"
                          className="rider-page-btn"
                          onClick={() =>
                            setActivityPage((p) =>
                              Math.min(activityTotalPages, p + 1),
                            )
                          }
                          disabled={activityPage === activityTotalPages}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══ FULLSCREEN MAP MODAL ══ */}
      {fullMapModalOpen && (
        <div
          className="riders-modal-overlay rider-fullscreen-overlay"
          onClick={() => setFullMapModalOpen(false)}
        >
          <div
            className="riders-modal-content rider-full-map-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rider-full-map-header">
              <div className="rider-full-map-header-left">
                <div className="rider-full-map-live-badge">
                  <span className="rider-live-dot" />
                  <span>LIVE</span>
                </div>
                <div className="rider-full-map-title-block">
                  <h2>Live Rider Map</h2>
                  <span className="rider-full-map-subtitle">
                    {riderLocations.length} rider
                    {riderLocations.length !== 1 ? "s" : ""} active ·
                    auto-refreshes every 5s
                  </span>
                </div>
              </div>
              <div className="rider-full-map-header-right">
                <label
                  className={`rider-layer-pill rider-layer-pill-light ${activeMapLayer === "weather" ? "is-active" : ""}`}
                  aria-label="Toggle weather"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M4 15a4 4 0 010-8 5 5 0 019.9 1H14a3 3 0 010 6H4z" />
                  </svg>
                  Weather
                  <input
                    type="checkbox"
                    checked={activeMapLayer === "weather"}
                    onChange={(e) => {
                      setActiveMapLayer(e.target.checked ? "weather" : null);
                      setShowFullWeatherPanel(false);
                    }}
                  />
                </label>
                <label
                  className={`rider-layer-pill rider-layer-pill-light ${activeMapLayer === "flood" ? "is-active" : ""}`}
                  aria-label="Toggle flood"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M2 10c2-4 5-4 6 0s4 4 6 0M2 14c2-3 5-3 6 0s4 3 6 0" />
                  </svg>
                  Flood
                  <input
                    type="checkbox"
                    checked={activeMapLayer === "flood"}
                    onChange={(e) => {
                      setActiveMapLayer(e.target.checked ? "flood" : null);
                      setShowFullWeatherPanel(false);
                    }}
                  />
                </label>
                <div className="rider-full-map-divider" />
                <button
                  type="button"
                  className="rider-full-map-close"
                  onClick={() => setFullMapModalOpen(false)}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M2 2l10 10M12 2L2 12" />
                  </svg>
                  Close
                </button>
              </div>
            </div>
            <div className="rider-full-map-body">
              <div className="rider-full-map-stack">
                <div ref={fullMapRef} className="rider-full-map-canvas" />
                {activeMapLayer === "weather" && (
                  <button
                    type="button"
                    className={`weather-panel-toggle-btn ${showFullWeatherPanel ? "open" : ""}`}
                    onClick={() => setShowFullWeatherPanel((p) => !p)}
                    aria-label="Toggle weather panel"
                  >
                    <span aria-hidden="true">☁</span>
                  </button>
                )}
                {activeMapLayer === "weather" && showFullWeatherPanel && (
                  <WeatherPanel
                    current={fullWeatherCurrent}
                    forecast={fullWeatherForecast}
                    loading={fullWeatherLoading}
                    error={fullWeatherError}
                  />
                )}
                {activeMapLayer === "flood" && <FloodLegend />}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ TRACK MODAL ══ */}
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
                Tracking: <strong>{trackingRiderDisplayName}</strong>
              </p>
              {loadingMap && (
                <div
                  className="track-rider-loading"
                  role="status"
                  aria-live="polite"
                >
                  <div className="track-loader-shell">
                    <div className="track-loader-spinner" aria-hidden="true">
                      <span className="track-loader-ring" />
                      <span className="track-loader-core" />
                    </div>
                    <p className="track-loader-title">
                      Preparing live location map
                    </p>
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
                style={{ display: loadingMap ? "none" : "block" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ══ RIDER INFO MODAL ══ */}
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
            style={{ width: 600, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Rider Information</h2>
            </div>
            <div className="riders-modal-body rider-info-body">
              {loadingInfo ? (
                <div className="rider-info-skeleton">
                  <div className="ris-hero">
                    <div className="ris-avatar-wrap">
                      <div className="ris-skeleton ris-avatar" />
                    </div>
                    <div className="ris-details">
                      <div className="ris-skeleton ris-name" />
                      <div className="ris-skeleton ris-email" />
                      <div className="ris-pills">
                        <div className="ris-skeleton ris-pill" />
                        <div className="ris-skeleton ris-pill" />
                      </div>
                    </div>
                  </div>
                  <div className="ris-grid">
                    {[...Array(6)].map((_, i) => (
                      <div className="ris-field" key={i}>
                        <div className="ris-skeleton ris-field-label" />
                        <div className="ris-skeleton ris-field-value" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : infoError ? (
                <p className="rider-info-error">{infoError}</p>
              ) : (
                <div className="rider-info-shell">
                  <div className="rider-info-hero">
                    <span
                      className={`rider-streak-pill rider-streak-pill-corner ${selectedRiderInfo?.metDailyQuotaToday ? "is-met" : "is-miss"}`}
                    >
                      <span className="rider-streak-icon" aria-hidden="true">
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          role="presentation"
                        >
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
                        </svg>
                      </span>
                      <span>
                        {(() => {
                          const d = selectedRiderInfo?.quotaStreakDays ?? 0;
                          return `Streak: ${d} Day${d === 1 ? "" : "s"}`;
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
                            const n =
                              selectedRiderInfo?.status?.toLowerCase() || "";
                            const statusClass = ["online", "active"].includes(n)
                              ? "is-online"
                              : ["offline", "inactive"].includes(n)
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
                            onClick={() => {
                              setPerfActiveTab("overview");
                              setPerfAssignedParcels([]);
                              setPerfParcelsSearch("");
                              setPerfParcelsFilter("all");
                              setPerformanceModalOpen(true);
                              if (selectedRiderInfo?.user_id) {
                                fetchAssignedParcels(selectedRiderInfo.user_id);
                              }
                            }}
                          >
                            <span
                              className="rider-action-icon"
                              aria-hidden="true"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                role="presentation"
                              >
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
                              </svg>
                            </span>
                            Performance
                          </button>
                          <button
                            type="button"
                            className="rider-performance-btn"
                            onClick={() => {
                              setViolationsActiveTab("overview");
                              setViolationLogsModalOpen(true);
                            }}
                          >
                            <span
                              className="rider-action-icon"
                              aria-hidden="true"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                role="presentation"
                              >
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
                                <circle
                                  cx="8"
                                  cy="11.2"
                                  r="0.9"
                                  fill="currentColor"
                                />
                              </svg>
                            </span>
                            Violations
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rider-info-grid">
                    <div className="rider-info-item">
                      <span>Phone</span>
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ PERFORMANCE MODAL ══ */}
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
            onClick={(e) => e.stopPropagation()}
            style={{ width: 960, maxWidth: "96%" }}
          >
            <div className="rp2-header-strip">
              <div className="rp2-header-stat">
                <span className="rp2-header-stat-label">TOTAL PARCELS</span>
                <strong className="rp2-header-stat-value">{perfTotal}</strong>
              </div>
              <div className="rp2-header-stat">
                <span className="rp2-header-stat-label">SUCCESS RATE</span>
                <strong className="rp2-header-stat-value rp2-green">
                  {perfSuccessRate}%
                </strong>
              </div>
              <div className="rp2-header-stat">
                <span className="rp2-header-stat-label">CANCEL RATE</span>
                <strong className="rp2-header-stat-value rp2-red">
                  {perfCancelRate}%
                </strong>
              </div>
            </div>

            <div className="rp2-tabs">
              <button
                type="button"
                className={`rp2-tab ${perfActiveTab === "overview" ? "is-active" : ""}`}
                onClick={() => setPerfActiveTab("overview")}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="1" y="1" width="5" height="5" rx="1" />
                  <rect x="8" y="1" width="5" height="5" rx="1" />
                  <rect x="1" y="8" width="5" height="5" rx="1" />
                  <rect x="8" y="8" width="5" height="5" rx="1" />
                </svg>
                Overview
              </button>
              <button
                type="button"
                className={`rp2-tab ${perfActiveTab === "parcels" ? "is-active" : ""}`}
                onClick={() => setPerfActiveTab("parcels")}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect
                    x="1"
                    y="2"
                    width="8"
                    height="10"
                    rx="1.5"
                    strokeWidth="1.6"
                  />
                  <path d="M4 5h4M4 7.5h3" />
                </svg>
                Assigned Parcels
                <span className="rp2-tab-badge">
                  {perfAssignedParcels.length}
                </span>
              </button>
            </div>

            {perfActiveTab === "overview" && (
              <div className="rp2-body">
                <div className="rp2-left">
                  <div className="rp2-section-label">
                    <span className="rp2-section-bar" />
                    QUOTA PROGRESS
                  </div>

                  <div className="rp2-donut-wrap">
                    <svg viewBox="0 0 120 120" className="rp2-donut-svg">
                      <circle className="rp2-donut-bg" cx="60" cy="60" r="48" />
                      <circle
                        className={`rp2-donut-fg ${hasMetFullQuota ? "is-met" : ""}`}
                        cx="60"
                        cy="60"
                        r="48"
                        strokeDasharray={quotaStrokeDasharray}
                      />
                    </svg>
                    <div className="rp2-donut-center">
                      <strong
                        className={`rp2-donut-pct ${hasMetFullQuota ? "is-met" : ""}`}
                      >
                        {quotaPercent}%
                      </strong>
                      <span className="rp2-donut-sub">OF QUOTA</span>
                    </div>
                  </div>

                  <p className="rp2-donut-count">
                    <strong>{selectedRiderInfo.deliveredParcels ?? 0}</strong>
                    {" / "}
                    {selectedRiderInfo.quotaTarget ?? RIDER_DELIVERY_QUOTA}{" "}
                    delivered
                  </p>

                  <div className="rp2-status-rows">
                    <div className="rp2-status-row">
                      <span>Status</span>
                      <span
                        className={`rp2-chip ${hasMetQuota ? "rp2-chip-green" : "rp2-chip-red"}`}
                      >
                        {quotaStatusLabel}
                      </span>
                    </div>
                    <div className="rp2-status-row">
                      <span>Incentive</span>
                      <span
                        className={`rp2-chip ${isIncentiveEligible ? "rp2-chip-eligible" : "rp2-chip-pending"}`}
                      >
                        {isIncentiveEligible ? "ELIGIBLE" : "PENDING"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rp2-right">
                  <div className="rp2-section-label">
                    <span className="rp2-section-bar" />
                    DELIVERY BREAKDOWN
                  </div>
                  <div className="rp2-breakdown">
                    {[
                      {
                        label: "Delivered",
                        value: selectedRiderInfo.deliveredParcels ?? 0,
                        cls: "rp2-bar-green",
                      },
                      {
                        label: "Ongoing",
                        value: selectedRiderInfo.ongoingParcels ?? 0,
                        cls: "rp2-bar-amber",
                      },
                      {
                        label: "Cancelled",
                        value: selectedRiderInfo.cancelledParcels ?? 0,
                        cls: "rp2-bar-red",
                      },
                    ].map(({ label, value, cls }) => {
                      const pct = perfTotal > 0 ? (value / perfTotal) * 100 : 0;
                      return (
                        <div className="rp2-bar-row" key={label}>
                          <span className="rp2-bar-label">{label}</span>
                          <div className="rp2-bar-track">
                            <div
                              className={`rp2-bar-fill ${cls}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rp2-section-label" style={{ marginTop: 12 }}>
                    <span className="rp2-section-bar" />
                    WEEKLY TREND
                  </div>
                  <div className="rp2-trend-cards">
                    <div className="rp2-trend-card">
                      <span className="rp2-trend-card-label">DELIVERIES</span>
                      <strong className="rp2-trend-card-value rp2-green">
                        {selectedRiderInfo.deliveredParcels ?? 0}
                      </strong>
                      <svg
                        className="rp2-sparkline rp2-sparkline-green"
                        viewBox="0 0 80 32"
                        fill="none"
                        preserveAspectRatio="none"
                      >
                        <polyline
                          points="0,24 16,18 32,22 48,10 64,14 80,8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                      <span className="rp2-trend-badge rp2-badge-green">
                        {perfSuccessRate}%
                      </span>
                    </div>
                    <div className="rp2-trend-card">
                      <span className="rp2-trend-card-label">
                        CANCELLATIONS
                      </span>
                      <strong className="rp2-trend-card-value rp2-red">
                        {selectedRiderInfo.cancelledParcels ?? 0}
                      </strong>
                      <svg
                        className="rp2-sparkline rp2-sparkline-red"
                        viewBox="0 0 80 32"
                        fill="none"
                        preserveAspectRatio="none"
                      >
                        <polyline
                          points="0,10 16,8 32,14 48,10 64,20 80,24"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </div>
                  </div>

                  <div className="rp2-section-label" style={{ marginTop: 12 }}>
                    <span className="rp2-section-bar" />
                    EFFICIENCY METRICS
                  </div>
                  <div className="rp2-efficiency-grid">
                    <div className="rp2-eff-card rp2-eff-blue">
                      <span>REMAINING</span>
                      <strong>{perfRemaining}</strong>
                      <small>to hit quota</small>
                    </div>
                    <div className="rp2-eff-card rp2-eff-amber">
                      <span>ACTIVE LOAD</span>
                      <strong>{selectedRiderInfo.ongoingParcels ?? 0}</strong>
                      <small>in progress</small>
                    </div>
                    <div className="rp2-eff-card rp2-eff-purple">
                      <span>AVG / DAY</span>
                      <strong>{perfAvgPerDay}</strong>
                      <small>est. working days</small>
                    </div>
                    <div className="rp2-eff-card rp2-eff-pink">
                      <span>QUOTA GAP</span>
                      <strong>{perfQuotaGap}%</strong>
                      <small>remaining</small>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {perfActiveTab === "parcels" && (
              <div className="rp2-parcels-body">
                <div className="rp2-parcels-toolbar">
                  <div className="rp2-parcels-search-wrap">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <circle cx="6" cy="6" r="4.5" />
                      <path d="M10 10l2.5 2.5" />
                    </svg>
                    <input
                      type="text"
                      className="rp2-parcels-search"
                      placeholder="Search by ID or recipient..."
                      value={perfParcelsSearch}
                      onChange={(e) => setPerfParcelsSearch(e.target.value)}
                    />
                  </div>
                  <div className="rp2-parcels-filter-pills">
                    {[
                      { value: "all", label: "All" },
                      { value: "successfully delivered", label: "Delivered" },
                      { value: "on going", label: "Ongoing" },
                      { value: "cancelled", label: "Cancelled" },
                    ].map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        className={`rp2-filter-pill ${perfParcelsFilter === f.value ? "is-active" : ""}`}
                        onClick={() => setPerfParcelsFilter(f.value)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {perfParcelsLoading ? (
                  <div className="rp2-parcels-loading">
                    <div className="assign-spinner" />
                    <p>Loading assigned parcels...</p>
                  </div>
                ) : perfParcelsError ? (
                  <p
                    className="rider-info-error"
                    style={{ padding: "16px 20px" }}
                  >
                    {perfParcelsError}
                  </p>
                ) : perfAssignedParcels.length === 0 ? (
                  <div className="rp2-parcels-empty">
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    >
                      <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                      <path d="M16 3H8l-2 4h12l-2-4z" />
                    </svg>
                    <p>No parcels assigned to this rider yet.</p>
                  </div>
                ) : perfFilteredParcels.length === 0 ? (
                  <div className="rp2-parcels-empty">
                    <p>No parcels match your search or filter.</p>
                  </div>
                ) : (
                  <div className="rp2-parcels-table-wrap">
                    <table className="rp2-parcels-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Parcel ID</th>
                          <th>Recipient</th>
                          <th>Address</th>
                          <th>Status</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perfFilteredParcels.map((parcel, idx) => {
                          const n = normalizeStatus(parcel.status);
                          const statusClass = isDeliveredStatus(parcel.status)
                            ? "rp2-status-delivered"
                            : n === "on going"
                              ? "rp2-status-ongoing"
                              : n === "cancelled" || n === "canceled"
                                ? "rp2-status-cancelled"
                                : "rp2-status-default";
                          return (
                            <tr key={parcel.parcel_id}>
                              <td className="rp2-parcel-idx">{idx + 1}</td>
                              <td className="rp2-parcel-id">
                                #{parcel.parcel_id}
                              </td>
                              <td>{parcel.recipient_name || "—"}</td>
                              <td className="rp2-parcel-addr">
                                {parcel.address || "—"}
                              </td>
                              <td>
                                <span
                                  className={`rp2-parcel-status-pill ${statusClass}`}
                                >
                                  {parcel.status || "Unknown"}
                                </span>
                              </td>
                              <td className="rp2-parcel-date">
                                {parcel.created_at
                                  ? new Date(
                                      parcel.created_at,
                                    ).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="rp2-parcels-count">
                      Showing {perfFilteredParcels.length} of{" "}
                      {perfAssignedParcels.length} parcel
                      {perfAssignedParcels.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ PHOTO PREVIEW ══ */}
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
            style={{ width: 480, maxWidth: "92%" }}
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

      {/* ══ VIOLATION LOGS MODAL ══ */}
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
            onClick={(e) => e.stopPropagation()}
            style={{ width: 760, maxWidth: "96%" }}
          >
            <div className="riders-modal-header">
              <h2>{selectedRiderDisplayName} — Violations</h2>
            </div>

            {loadingViolationLogs ? (
              <div className="riders-modal-body">
                <PageSpinner label="Loading violation logs..." />
              </div>
            ) : violationLogsError ? (
              <div className="riders-modal-body">
                <p className="rider-info-error">{violationLogsError}</p>
              </div>
            ) : riderViolationLogs.length === 0 ? (
              <div className="riders-modal-body">
                <p className="rider-violations-empty">
                  No violation logs found for this rider.
                </p>
              </div>
            ) : (
              <>
                <div className="viol-tabs">
                  <button
                    type="button"
                    className={`viol-tab ${violationsActiveTab === "overview" ? "is-active" : ""}`}
                    onClick={() => setViolationsActiveTab("overview")}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <rect x="1" y="1" width="5" height="5" rx="1" />
                      <rect x="8" y="1" width="5" height="5" rx="1" />
                      <rect x="1" y="8" width="5" height="5" rx="1" />
                      <rect x="8" y="8" width="5" height="5" rx="1" />
                    </svg>
                    Analytics
                  </button>
                  <button
                    type="button"
                    className={`viol-tab ${violationsActiveTab === "logs" ? "is-active" : ""}`}
                    onClick={() => setViolationsActiveTab("logs")}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <rect
                        x="1"
                        y="2"
                        width="8"
                        height="10"
                        rx="1.5"
                        strokeWidth="1.6"
                      />
                      <path d="M4 5h4M4 7.5h3" />
                    </svg>
                    Violation Logs
                    <span className="viol-tab-badge">
                      {riderViolationLogs.length}
                    </span>
                  </button>
                </div>

                {violationsActiveTab === "overview" && (
                  <div className="viol-analytics-body">
                    <div className="viol-analytics-left">
                      <div className="viol-section-label">
                        <span className="viol-section-bar" />
                        RISK LEVEL
                      </div>
                      {(() => {
                        const total = violationStats?.total ?? 0;
                        const level =
                          total >= 10
                            ? "HIGH"
                            : total >= 5
                              ? "MODERATE"
                              : "LOW";
                        const cls =
                          total >= 10
                            ? "viol-risk-high"
                            : total >= 5
                              ? "viol-risk-mod"
                              : "viol-risk-low";
                        const pct = Math.min(
                          100,
                          Math.round((total / 15) * 100),
                        );
                        return (
                          <div className="viol-risk-block">
                            <div className="viol-risk-row">
                              <span className={`viol-risk-chip ${cls}`}>
                                {level}
                              </span>
                              <span className="viol-risk-hint">
                                {total} Total Violation
                                {total !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="viol-risk-bar-track">
                              <div
                                className={`viol-risk-bar-fill ${cls}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="viol-risk-desc">
                              {level === "HIGH"
                                ? "This rider has a high violation count. Immediate review recommended."
                                : level === "MODERATE"
                                  ? "Moderate violations detected. Monitor closely and provide guidance."
                                  : "Violation count is within acceptable range. Continue monitoring."}
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="viol-analytics-right">
                      <div className="viol-section-label">
                        <span className="viol-section-bar" />
                        7-DAY TREND
                      </div>
                      <div className="viol-trend-chart">
                        {violationStats?.perDay.map((count, i) => {
                          const pct = Math.round(
                            (count / (violationStats.maxPerDay || 1)) * 100,
                          );
                          return (
                            <div className="viol-trend-col" key={i}>
                              <span className="viol-trend-count">
                                {count > 0 ? count : ""}
                              </span>
                              <div className="viol-trend-bar-wrap">
                                <div
                                  className={`viol-trend-bar ${count > 0 ? "has-data" : ""}`}
                                  style={{
                                    height: `${Math.max(pct, count > 0 ? 8 : 0)}%`,
                                  }}
                                />
                              </div>
                              <span className="viol-trend-day">
                                {violationStats.dayLabels[i]}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        className="viol-section-label"
                        style={{ marginTop: 14 }}
                      >
                        <span className="viol-section-bar" />
                        SUMMARY
                      </div>
                      <div className="viol-summary-grid">
                        <div className="viol-summary-card">
                          <span>THIS WEEK</span>
                          <strong className="viol-red">
                            {violationStats?.perDay.reduce(
                              (s, c) => s + c,
                              0,
                            ) ?? 0}
                          </strong>
                          <small>violations</small>
                        </div>
                        <div className="viol-summary-card">
                          <span>TODAY</span>
                          <strong>{violationStats?.perDay[6] ?? 0}</strong>
                          <small>violations</small>
                        </div>
                        <div className="viol-summary-card">
                          <span>WORST DAY</span>
                          <strong
                            className={
                              Math.max(...(violationStats?.perDay ?? [0])) > 0
                                ? "viol-red"
                                : ""
                            }
                          >
                            {Math.max(...(violationStats?.perDay ?? [0]))}
                          </strong>
                          <small>in a day</small>
                        </div>
                        <div className="viol-summary-card">
                          <span>STREAK</span>
                          <strong
                            className={
                              (violationStats?.streak ?? 0) > 0
                                ? "viol-red"
                                : ""
                            }
                          >
                            {violationStats?.streak ?? 0}
                          </strong>
                          <small>
                            day{violationStats?.streak !== 1 ? "s" : ""} active
                          </small>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {violationsActiveTab === "logs" && (
                  <div className="viol-logs-body">
                    <div className="viol-logs-table-wrap">
                      <table className="viol-logs-table">
                        <thead>
                          <tr>
                            <th className="viol-logs-th viol-logs-th-num">#</th>
                            <th className="viol-logs-th">Violation Type</th>
                            <th className="viol-logs-th viol-logs-th-date">
                              Date &amp; Time
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {riderViolationLogs.map((log, index) => (
                            <tr
                              className="viol-logs-row"
                              key={`${log.date || "no-date"}-${log.violation || "no-violation"}-${index}`}
                            >
                              <td className="viol-logs-td viol-logs-td-num">
                                {index + 1}
                              </td>
                              <td className="viol-logs-td">
                                <span className="viol-logs-type-pill">
                                  {(
                                    log.violation || "Unknown violation"
                                  ).replace(/\b\w/g, (c) => c.toUpperCase())}
                                </span>
                              </td>
                              <td className="viol-logs-td viol-logs-td-date">
                                {formatViolationLogDate(log.date)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="viol-logs-count">
                      {riderViolationLogs.length} violation
                      {riderViolationLogs.length !== 1 ? "s" : ""} recorded
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ CREATE RIDER ══ */}
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
            className="rider-create-modal-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Form panel (single column, no brand panel) ── */}
            <div className="rcm-form-panel">
              <div className="rcm-form-header">
                <h2>Create Rider Account</h2>
                <button
                  type="button"
                  className="rcm-close-btn"
                  onClick={closeCreateModal}
                  aria-label="Close"
                  disabled={creatingRider}
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    width="16"
                    height="16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <form className="rcm-form" onSubmit={handleCreateRider}>
                {/* Username */}
                <div className="rcm-field">
                  <label htmlFor="create-rider-username" className="rcm-label">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="13"
                      height="13"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Username
                  </label>
                  <input
                    id="create-rider-username"
                    className="rcm-input"
                    type="text"
                    value={createUsername}
                    onChange={(e) => setCreateUsername(e.target.value)}
                    placeholder="e.g. rider_juan"
                    required
                    autoComplete="username"
                    disabled={creatingRider}
                  />
                  <div className="rcm-rules" aria-live="polite">
                    <div
                      className={`rcm-rule ${usernameLengthValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      At least 3 characters
                    </div>
                    <div
                      className={`rcm-rule ${usernamePatternValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      Letters, numbers, underscore only
                    </div>
                  </div>
                </div>

                {/* Email */}
                <div className="rcm-field">
                  <label htmlFor="create-rider-email" className="rcm-label">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="13"
                      height="13"
                    >
                      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                    Email Address
                  </label>
                  <input
                    id="create-rider-email"
                    className="rcm-input"
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="rider@example.com"
                    required
                    autoComplete="email"
                    disabled={creatingRider}
                  />
                </div>

                {/* Password */}
                <div className="rcm-field">
                  <label htmlFor="create-rider-password" className="rcm-label">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="13"
                      height="13"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Password
                  </label>
                  <input
                    id="create-rider-password"
                    className="rcm-input"
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    placeholder="Strong password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    disabled={creatingRider}
                  />
                  <div className="rcm-strength-bar">
                    <div
                      className="rcm-strength-fill"
                      style={{
                        width: `${([passwordLengthValid, passwordUpperValid, passwordLowerValid, passwordNumberValid, passwordSpecialValid].filter(Boolean).length / 5) * 100}%`,
                        background:
                          [
                            passwordLengthValid,
                            passwordUpperValid,
                            passwordLowerValid,
                            passwordNumberValid,
                            passwordSpecialValid,
                          ].filter(Boolean).length <= 2
                            ? "#ef4444"
                            : [
                                  passwordLengthValid,
                                  passwordUpperValid,
                                  passwordLowerValid,
                                  passwordNumberValid,
                                  passwordSpecialValid,
                                ].filter(Boolean).length <= 4
                              ? "#f59e0b"
                              : "#22c55e",
                      }}
                    />
                  </div>
                  <div className="rcm-rules rcm-rules--grid" aria-live="polite">
                    <div
                      className={`rcm-rule ${passwordLengthValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      8+ characters
                    </div>
                    <div
                      className={`rcm-rule ${passwordUpperValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      Uppercase
                    </div>
                    <div
                      className={`rcm-rule ${passwordLowerValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      Lowercase
                    </div>
                    <div
                      className={`rcm-rule ${passwordNumberValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      Number
                    </div>
                    <div
                      className={`rcm-rule ${passwordSpecialValid ? "rcm-rule--met" : ""}`}
                    >
                      <span className="rcm-rule-dot" />
                      Special char
                    </div>
                  </div>
                </div>

                {createRiderError && (
                  <div className="rcm-error">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="14"
                      height="14"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {createRiderError}
                  </div>
                )}

                <div className="rcm-actions">
                  <button
                    type="button"
                    className="rcm-btn-cancel"
                    onClick={closeCreateModal}
                    disabled={creatingRider}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rcm-btn-submit"
                    disabled={
                      creatingRider || !isUsernameValid || !isPasswordValid
                    }
                  >
                    {creatingRider ? (
                      <>
                        <span className="rcm-spinner" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          width="15"
                          height="15"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Create Account
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ══ MANUAL ASSIGN PARCELS MODAL ══ */}
      {assignModalOpen && (
        <AssignParcelsModal
          riders={riders}
          onClose={closeAssignModal}
          onAssigned={(data) => {
            setRiders(data);
            setLastUpdatedAt(new Date());
          }}
          refreshRiders={refreshRiders}
        />
      )}

      {/* ══ TOASTS ══ */}
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
            className="riders-fail-modal riders-success-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="riders-success-header riders-fail-header">
              <h3>Track Unavailable</h3>
            </div>
            <div className="riders-success-body riders-fail-body">
              <div
                className="riders-success-check riders-fail-icon"
                aria-hidden="true"
              >
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
