// Parcel.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import { useNotification } from "../contexts/NotificationContext";
import { useImport } from "../contexts/ImportContext";
import "../styles/global.css";
import "../styles/parcels.css";
import PageSpinner from "../components/PageSpinner";

const MAX_PARCEL_ROWS = 10;

const formatTimelineDateTime = (value) => {
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

const formatStatusLabel = (value) => {
  if (!value) return "-";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const getAttemptStatusClass = (value) => {
  const n = String(value || "")
    .trim()
    .toLowerCase();
  if (!n) return "is-default";
  if (
    ["success", "successful", "successfully delivered", "delivered"].includes(n)
  )
    return "is-success";
  if (["pending", "on-going", "ongoing", "in progress"].includes(n))
    return "is-pending";
  if (["failed", "failure", "delayed"].includes(n)) return "is-failed";
  return "is-default";
};

const getParcelStatusMeta = (value) => {
  const n = String(value || "")
    .trim()
    .toLowerCase();
  if (n === "successfully delivered" || n === "delivered")
    return { className: "is-delivered", label: "Delivered" };
  if (n === "on-going" || n === "ongoing" || n === "in progress")
    return { className: "is-ongoing", label: "On-Going" };
  if (n === "delayed" || n === "cancelled" || n === "canceled")
    return { className: "is-delayed", label: "Delayed" };
  return { className: "is-default", label: formatStatusLabel(value) };
};

const isDeliveredParcel = (parcel) => {
  const n = String(parcel?.status || "")
    .trim()
    .toLowerCase();
  return n === "successfully delivered" || n === "delivered";
};

const ModernSelect = ({
  value,
  onChange,
  options = [],
  className = "",
  triggerClassName = "",
  menuClassName = "",
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = useMemo(
    () => (options || []).find((o) => o.value === value),
    [options, value],
  );

  useEffect(() => {
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`parcel-modern-select ${open ? "is-open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className={`parcel-modern-select-trigger ${triggerClassName}`.trim()}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedOption?.label || "-"}</span>
        <span className="parcel-modern-select-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`parcel-modern-select-menu ${menuClassName}`.trim()}
          role="listbox"
        >
          {(options || []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              className={`parcel-modern-select-option ${value === opt.value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// CSV HELPERS
// ─────────────────────────────────────────────────────────────

const CSV_REQUIRED_COLS = [
  "recipient_name",
  "recipient_phone",
  "address",
  "sender_name",
  "sender_phone",
  "status",
  "attempt1_status",
];

const CSV_HEADER_ONLY_COLS = [];

const parseCsvText = (text) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/"/g, ""));
  const rows = lines.slice(1).map((line, i) => {
    const cols = [];
    let cur = "",
      inQ = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        cols.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());
    const obj = { _row: i + 2 };
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    return obj;
  });
  return { headers, rows };
};

const validateCsvRows = (rows, headers) => {
  const errors = [];
  const missingRequired = CSV_REQUIRED_COLS.filter((c) => !headers.includes(c));
  const missingHeaderOnly = CSV_HEADER_ONLY_COLS.filter(
    (c) => !headers.includes(c),
  );
  const allMissing = [...missingRequired, ...missingHeaderOnly];
  if (allMissing.length > 0) {
    errors.push({
      row: "Header",
      message: `Missing required columns: ${allMissing.join(", ")}`,
    });
    return errors;
  }
  rows.forEach((row) => {
    CSV_REQUIRED_COLS.forEach((col) => {
      if (!row[col] || !String(row[col]).trim()) {
        errors.push({
          row: row._row,
          message: `Row ${row._row}: "${col}" is empty`,
        });
      }
    });
  });
  return errors;
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

const Parcel = () => {
  const { notifyParcelDelivered } = useNotification();
  const { startImport, bgImport } = useImport();

  const [parcels, setParcels] = useState([]);
  const [parcelPage, setParcelPage] = useState(1);
  const [parcelRows] = useState(MAX_PARCEL_ROWS);
  const [parcelTotalRows, setParcelTotalRows] = useState(0);
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("parcel_id-asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewParcel, setViewParcel] = useState(null);
  const [loading, setLoading] = useState(true);

  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [trackingParcel, setTrackingParcel] = useState(null);
  const [loadingTrackMap, setLoadingTrackMap] = useState(false);

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvFileName, setCsvFileName] = useState("");
  const csvFileRef = useRef(null);

  const statusFilterOptions = useMemo(
    () => [
      { value: "All", label: "All Status" },
      { value: "Successfully Delivered", label: "Delivered" },
      { value: "On-going", label: "On-Going" },
      { value: "Delayed", label: "Delayed" },
    ],
    [],
  );

  const sortOptions = useMemo(
    () => [
      { value: "parcel_id-asc", label: "ID — Ascending" },
      { value: "parcel_id-desc", label: "ID — Descending" },
    ],
    [],
  );

  const trackMapRef = useRef(null);
  const trackLeafletMapRef = useRef(null);
  const trackMarkerRef = useRef(null);

  const loadParcels = async () => {
    setLoading(true);
    const [sortColumn, sortDir] = sortBy.split("-");
    const ascending = sortDir === "asc";
    const chunkSize = 1000;
    let from = 0;
    const allParcels = [];

    try {
      while (true) {
        const { data, error } = await supabaseClient
          .from("parcels")
          .select(
            `*, assigned_rider:users!parcels_assigned_rider_id_fkey(fname, lname, profile_url)`,
          )
          .order(sortColumn, { ascending })
          .range(from, from + chunkSize - 1);

        if (error) throw error;
        const chunk = data || [];
        allParcels.push(...chunk);
        if (chunk.length < chunkSize) break;
        from += chunkSize;
      }

      const parcelsWithRiderNames = allParcels.map((p) => ({
        ...p,
        riderFullName: p.assigned_rider
          ? `${p.assigned_rider.fname || ""} ${p.assigned_rider.lname || ""}`.trim() ||
            "Unassigned"
          : "Unassigned",
      }));

      setParcels(parcelsWithRiderNames);
      setParcelTotalRows(parcelsWithRiderNames.length);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deliveredToday = parcelsWithRiderNames.filter((p) => {
        const createdDate = new Date(p.created_at);
        const isDelivered = ["successfully delivered", "delivered"].includes(
          String(p.status || "")
            .trim()
            .toLowerCase(),
        );
        return isDelivered && createdDate >= today;
      });

      deliveredToday.slice(0, 3).forEach((parcel) => {
        notifyParcelDelivered(
          parcel.parcel_id,
          parcel.riderFullName || "Customer",
        );
      });
    } catch (err) {
      console.error("Failed to load parcels:", err);
      setParcels([]);
      setParcelTotalRows(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadParcels();
  }, [sortBy]);

  const statusFilteredParcels = useMemo(() => {
    if (statusFilter === "All") return parcels;

    if (statusFilter === "Delayed") {
      return parcels.filter(
        (p) =>
          String(p?.attempt2_status || "")
            .trim()
            .toLowerCase() === "failed",
      );
    }

    const nf = statusFilter.trim().toLowerCase();
    return parcels.filter(
      (p) =>
        String(p?.status || "")
          .trim()
          .toLowerCase() === nf,
    );
  }, [parcels, statusFilter]);

  const filteredParcels = useMemo(() => {
    const keyword = searchTerm.trim();
    const source = keyword ? parcels : statusFilteredParcels;
    if (!keyword) return source;
    return source.filter((p) => String(p?.parcel_id ?? "").startsWith(keyword));
  }, [parcels, searchTerm, statusFilteredParcels]);

  useEffect(() => {
    setParcelTotalRows(filteredParcels.length);
    const nextTotal = Math.max(
      1,
      Math.ceil(filteredParcels.length / parcelRows),
    );
    if (parcelPage > nextTotal) setParcelPage(nextTotal);
  }, [filteredParcels, parcelPage, parcelRows]);

  const totalPages = Math.max(1, Math.ceil(parcelTotalRows / parcelRows));
  const prevPage = () => setParcelPage((p) => Math.max(1, p - 1));
  const nextPage = () => setParcelPage((p) => Math.min(totalPages, p + 1));
  const pageStartIndex = (parcelPage - 1) * parcelRows;
  const pagedParcels = filteredParcels.slice(
    pageStartIndex,
    pageStartIndex + parcelRows,
  );
  const showingStart = parcelTotalRows === 0 ? 0 : pageStartIndex + 1;
  const showingEnd = Math.min(pageStartIndex + parcelRows, parcelTotalRows);

  const pageItems = useMemo(() => {
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items = new Set([
      1,
      totalPages,
      parcelPage - 1,
      parcelPage,
      parcelPage + 1,
    ]);
    const pages = [...items]
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < pages.length; i++) {
      const cur = pages[i],
        prev = pages[i - 1];
      if (i > 0 && cur - prev > 1) result.push(`ellipsis-${prev}-${cur}`);
      result.push(cur);
    }
    return result;
  }, [parcelPage, totalPages]);

  const getParcelCoords = (parcel) => {
    const lat = Number(parcel?.r_lat),
      lng = Number(parcel?.r_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  };

  const openTrackModal = (parcel) => {
    if (!getParcelCoords(parcel)) return;
    setTrackingParcel(parcel);
    setLoadingTrackMap(true);
    setTrackModalOpen(true);
  };

  const closeTrackModal = () => {
    if (trackMarkerRef.current) {
      trackMarkerRef.current.remove();
      trackMarkerRef.current = null;
    }
    if (trackLeafletMapRef.current) {
      trackLeafletMapRef.current.remove();
      trackLeafletMapRef.current = null;
    }
    setTrackModalOpen(false);
    setTrackingParcel(null);
    setLoadingTrackMap(false);
  };

  const buildParcelTrackPopup = (parcel) => {
    const rawStatus = parcel?.status || "Unknown";
    const statusText = formatStatusLabel(rawStatus);
    const addressText = parcel?.address || "No address available";
    const n = String(rawStatus).trim().toLowerCase();
    const statusClass =
      n === "successfully delivered"
        ? "status-delivered"
        : n === "on-going"
          ? "status-ongoing"
          : n === "delayed"
            ? "status-delayed"
            : "status-default";
    return `
      <div class="parcel-track-popup-card">
        <div class="parcel-track-popup-head">
          <span class="parcel-track-popup-icon" aria-hidden="true">📦</span>
          <strong>Parcel #${parcel?.parcel_id || "-"}</strong>
        </div>
        <div class="parcel-track-popup-row">
          <span>Status</span>
          <b class="parcel-track-popup-status ${statusClass}">${statusText}</b>
        </div>
        <div class="parcel-track-popup-row address">
          <span>Address</span>
          <b>${addressText}</b>
        </div>
      </div>`;
  };

  useEffect(() => {
    if (!trackModalOpen || !trackingParcel) return;
    const coords = getParcelCoords(trackingParcel);
    if (!coords) {
      setLoadingTrackMap(false);
      return;
    }

    if (trackMarkerRef.current) {
      trackMarkerRef.current.remove();
      trackMarkerRef.current = null;
    }
    if (trackLeafletMapRef.current) {
      trackLeafletMapRef.current.remove();
      trackLeafletMapRef.current = null;
    }

    const t = setTimeout(() => {
      if (!trackMapRef.current) {
        setLoadingTrackMap(false);
        return;
      }
      const map = L.map(trackMapRef.current).setView(
        [coords.lat, coords.lng],
        15,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({
        className: "parcel-map-marker-wrap",
        html: `<span class="parcel-map-marker" aria-hidden="true">📦</span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18],
      });

      const marker = L.marker([coords.lat, coords.lng], {
        icon,
        zIndexOffset: 1200,
      })
        .addTo(map)
        .bindPopup(buildParcelTrackPopup(trackingParcel), {
          className: "parcel-track-popup",
          closeButton: false,
        });

      trackLeafletMapRef.current = map;
      trackMarkerRef.current = marker;

      setTimeout(() => {
        map.invalidateSize();
        marker.openPopup();
        setLoadingTrackMap(false);
      }, 180);
    }, 380);

    return () => clearTimeout(t);
  }, [trackModalOpen, trackingParcel]);

  useEffect(() => {
    return () => {
      if (trackMarkerRef.current) {
        trackMarkerRef.current.remove();
        trackMarkerRef.current = null;
      }
      if (trackLeafletMapRef.current) {
        trackLeafletMapRef.current.remove();
        trackLeafletMapRef.current = null;
      }
    };
  }, []);

  const handleCsvFile = (file) => {
    if (!file) return;
    setCsvFileName(file.name);
    setCsvRows([]);
    setCsvErrors([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows } = parseCsvText(e.target.result);
      const errs = validateCsvRows(rows, headers);
      setCsvErrors(errs);
      setCsvRows(rows);
    };
    reader.readAsText(file);
  };

  const handleCsvDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "text/csv" || file.name.endsWith(".csv"))) {
      handleCsvFile(file);
    }
  };

  const handleCsvImport = () => {
    if (!csvRows.length || csvErrors.length > 0) return;
    startImport(csvRows, csvFileName, loadParcels);
    closeCsvModal();
  };

  const closeCsvModal = () => {
    setCsvModalOpen(false);
    setCsvRows([]);
    setCsvErrors([]);
    setCsvFileName("");
    if (csvFileRef.current) csvFileRef.current.value = "";
  };

  const hasAttempt2 = (parcel) =>
    parcel?.attempt2_status != null &&
    String(parcel.attempt2_status).trim() !== "";

  const resolveStatusMeta = (parcel) => {
    if (statusFilter === "Delayed") {
      return { className: "is-delayed", label: "Delayed" };
    }
    return getParcelStatusMeta(parcel.status);
  };

  return (
    <div className="dashboard-container">
      <Sidebar currentPage="parcels.html" />

      <div className="parcels-page page-with-topnav">
        {loading ? (
          <PageSpinner label="Loading parcels…" />
        ) : (
          <>
            <h1 className="page-title">Parcel Management</h1>

            {/* ── Toolbar ── */}
            <div className="parcels-filter-section">
              <label>Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setParcelPage(1);
                  setSearchTerm(e.target.value);
                }}
                placeholder="Search by Parcel ID…"
              />

              <label>Status</label>
              <div className="parcel-filter-select-wrap">
                <ModernSelect
                  className="parcel-filter-modern-shell"
                  triggerClassName="parcel-filter-modern-trigger"
                  menuClassName="parcel-filter-modern-menu"
                  value={statusFilter}
                  options={statusFilterOptions}
                  onChange={(v) => {
                    setParcelPage(1);
                    setStatusFilter(v);
                  }}
                />
              </div>

              <label>Sort</label>
              <div className="parcel-filter-select-wrap">
                <ModernSelect
                  className="parcel-filter-modern-shell"
                  triggerClassName="parcel-filter-modern-trigger"
                  menuClassName="parcel-filter-modern-menu"
                  value={sortBy}
                  options={sortOptions}
                  onChange={(v) => {
                    setParcelPage(1);
                    setSortBy(v);
                  }}
                />
              </div>

              <div className="parcel-csv-import-spacer" />
              <button
                type="button"
                className="parcel-csv-import-btn"
                onClick={() => setCsvModalOpen(true)}
                disabled={bgImport?.status === "running"}
                title={
                  bgImport?.status === "running"
                    ? "Import already in progress"
                    : ""
                }
              >
                <span className="parcel-csv-import-btn-icon" aria-hidden="true">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7.5 1v9M4 7l3.5 3L11 7M2 13h11"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                Import CSV
              </button>
            </div>

            {/* ── Table ── */}
            <div className="parcels-table-wrapper">
              <table className="parcel-table">
                <colgroup>
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Parcel ID</th>
                    <th>Recipient</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>Rider</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedParcels.map((parcel, idx) => (
                    <tr key={idx}>
                      <td>{parcel.parcel_id || "-"}</td>
                      <td>{parcel.recipient_name || "-"}</td>
                      <td>{parcel.recipient_phone || "-"}</td>
                      <td>{parcel.address || "-"}</td>
                      <td>{parcel.riderFullName}</td>
                      <td className="status-cell">
                        {(() => {
                          const m = resolveStatusMeta(parcel);
                          return (
                            <span
                              className={`parcel-status-pill ${m.className}`}
                            >
                              {m.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <button
                          className="btn-view"
                          onClick={() => setViewParcel(parcel)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {Array.from({ length: parcelRows - pagedParcels.length }).map(
                    (_, i) => (
                      <tr key={`empty-${i}`}>
                        <td colSpan={7} style={{ height: "46px" }} />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>

              <div className="parcels-table-footer">
                <div className="parcels-table-meta">
                  {parcelTotalRows === 0
                    ? "No parcels found"
                    : `Showing ${showingStart}–${showingEnd} of ${parcelTotalRows}`}
                </div>
                <div className="parcels-pagination">
                  <button onClick={prevPage} disabled={parcelPage <= 1}>
                    ← Prev
                  </button>
                  <div className="parcels-page-list">
                    {pageItems.map((item) =>
                      typeof item === "number" ? (
                        <button
                          key={`page-${item}`}
                          type="button"
                          className={item === parcelPage ? "is-active" : ""}
                          onClick={() => setParcelPage(item)}
                        >
                          {item}
                        </button>
                      ) : (
                        <span
                          key={item}
                          className="parcels-page-ellipsis"
                          aria-hidden="true"
                        >
                          …
                        </span>
                      ),
                    )}
                  </div>
                  <span className="parcels-page-summary">
                    {parcelPage} / {totalPages}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={parcelPage >= totalPages}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>

            {/* ── View Parcel Modal ── */}
            {viewParcel && (
              <div
                className="parcels-modal-overlay show"
                onClick={() => setViewParcel(null)}
              >
                <div
                  className="parcels-modal-content view-parcel-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="vpd-main-col">
                    {/* ── Hero Header ── */}
                    <div className="vpd-hero">
                      <div className="vpd-hero-bg" aria-hidden="true" />
                      <div className="vpd-hero-inner">
                        <div className="vpd-hero-left">
                          <div>
                            <p className="vpd-hero-eyebrow">Parcel ID</p>
                            <h2 className="vpd-hero-id">
                              #{viewParcel.parcel_id || "—"}
                            </h2>
                          </div>
                        </div>
                        <div className="vpd-hero-right">
                          {(() => {
                            const m = resolveStatusMeta(viewParcel);
                            return (
                              <span
                                className={`vpd-status-chip ${m.className}`}
                              >
                                <span
                                  className="vpd-status-dot"
                                  aria-hidden="true"
                                />
                                {m.label}
                              </span>
                            );
                          })()}
                          <button
                            type="button"
                            className="vpd-close-btn"
                            onClick={() => setViewParcel(null)}
                            aria-label="Close"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="vpd-timeline-strip">
                        <div className="vpd-timeline-item">
                          <span className="vpd-tl-label">Created</span>
                          <span className="vpd-tl-value">
                            {formatTimelineDateTime(viewParcel.created_at)}
                          </span>
                        </div>
                        <div className="vpd-timeline-arrow" aria-hidden="true">
                          →
                        </div>
                        <div className="vpd-timeline-item">
                          <span className="vpd-tl-label">Last Updated</span>
                          <span className="vpd-tl-value">
                            {formatTimelineDateTime(viewParcel.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── Scrollable Body ── */}
                    <div className="vpd-body">
                      {/* ── Recipient + Sender ── */}
                      <div className="vpd-cols">
                        <div className="vpd-info-card">
                          <div className="vpd-card-label">Recipient</div>
                          <div className="vpd-field-stack">
                            <div className="vpd-field">
                              <span>Name</span>
                              <strong>
                                {viewParcel.recipient_name || "—"}
                              </strong>
                            </div>
                            <div className="vpd-field">
                              <span>Phone</span>
                              <strong>
                                {viewParcel.recipient_phone || "—"}
                              </strong>
                            </div>
                          </div>
                        </div>

                        <div className="vpd-info-card">
                          <div className="vpd-card-label">Sender</div>
                          <div className="vpd-field-stack">
                            <div className="vpd-field">
                              <span>Name</span>
                              <strong>{viewParcel.sender_name || "—"}</strong>
                            </div>
                            <div className="vpd-field">
                              <span>Phone</span>
                              <strong>{viewParcel.sender_phone || "—"}</strong>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── Delivery Address ── */}
                      <div className="vpd-info-card">
                        <div className="vpd-card-label">Delivery Address</div>
                        <p className="vpd-address-text">
                          {viewParcel.address || "—"}
                        </p>
                        <div className="vpd-rider-row">
                          <div className="vpd-rider-avatar">
                            {viewParcel.assigned_rider?.profile_url ? (
                              <img
                                src={viewParcel.assigned_rider.profile_url}
                                alt={viewParcel.riderFullName}
                                className="vpd-rider-photo"
                              />
                            ) : (
                              <span className="vpd-rider-initials">
                                {viewParcel.riderFullName &&
                                viewParcel.riderFullName !== "Unassigned"
                                  ? viewParcel.riderFullName
                                      .split(" ")
                                      .map((n) => n[0])
                                      .join("")
                                      .slice(0, 2)
                                      .toUpperCase()
                                  : "—"}
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="vpd-rider-eyebrow">
                              Assigned Rider
                            </span>
                            <strong className="vpd-rider-name">
                              {viewParcel.riderFullName || "—"}
                            </strong>
                          </div>
                          <button
                            type="button"
                            className="vpd-track-btn"
                            onClick={() => openTrackModal(viewParcel)}
                            disabled={!getParcelCoords(viewParcel)}
                          >
                            View Delivery Location
                          </button>
                        </div>
                      </div>

                      {/* ── Attempt History ── */}
                      <div className="vpd-attempts">
                        <div className="vpd-section-title">
                          <span
                            className="vpd-section-line"
                            aria-hidden="true"
                          />
                          Attempt History
                          <span
                            className="vpd-section-line"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="vpd-attempt-cards">
                          <div className="vpd-attempt-card">
                            <div className="vpd-attempt-num">01</div>
                            <div className="vpd-attempt-info">
                              <span
                                className={`vpd-attempt-status ${getAttemptStatusClass(viewParcel.attempt1_status)}`}
                              >
                                {formatStatusLabel(
                                  viewParcel.attempt1_status,
                                ) || "—"}
                              </span>
                              <span className="vpd-attempt-date">
                                {formatTimelineDateTime(
                                  viewParcel.attempt1_date ||
                                    viewParcel.attempt1_datetime,
                                )}
                              </span>
                            </div>
                          </div>

                          {hasAttempt2(viewParcel) && (
                            <div className="vpd-attempt-card">
                              <div className="vpd-attempt-num">02</div>
                              <div className="vpd-attempt-info">
                                <span
                                  className={`vpd-attempt-status ${getAttemptStatusClass(viewParcel.attempt2_status)}`}
                                >
                                  {formatStatusLabel(
                                    viewParcel.attempt2_status,
                                  )}
                                </span>
                                <span className="vpd-attempt-date">
                                  {formatTimelineDateTime(
                                    viewParcel.attempt2_date ||
                                      viewParcel.attempt2_datetime,
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* end vpd-main-col */}

                  {/* ── Proof of Delivery side panel — only for delivered + has image ── */}
                  {isDeliveredParcel(viewParcel) &&
                    viewParcel.parcel_image_proof && (
                      <div className="vpd-proof-panel">
                        <div className="vpd-proof-panel-label">
                          Proof of Delivery
                        </div>
                        <div
                          className="vpd-proof-panel-img-wrap"
                          ref={(el) => {
                            if (el) el.classList.remove("is-loaded");
                          }}
                        >
                          <img
                            src={viewParcel.parcel_image_proof}
                            alt="Proof of delivery"
                            className="vpd-proof-panel-img"
                            onLoad={(e) => {
                              e.currentTarget.parentElement.classList.add(
                                "is-loaded",
                              );
                            }}
                            onError={(e) => {
                              e.currentTarget.parentElement.classList.add(
                                "is-loaded",
                              );
                              e.currentTarget.style.display = "none";
                              e.currentTarget.nextSibling.style.display =
                                "flex";
                            }}
                          />
                          <div
                            className="vpd-proof-panel-fallback"
                            style={{ display: "none" }}
                          >
                            <span>Image unavailable</span>
                          </div>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* ── Track modal ── */}
            {trackModalOpen && (
              <div
                className="parcels-modal-overlay show"
                onClick={closeTrackModal}
              >
                <div
                  className="parcels-modal-content parcel-track-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="parcels-modal-header">
                    <h3>Track Parcel</h3>
                  </div>
                  <div className="parcels-modal-body parcel-track-body">
                    <p>
                      Tracking{" "}
                      <strong>#{trackingParcel?.parcel_id || "-"}</strong>
                    </p>
                    <div className="parcel-track-map-wrap">
                      {loadingTrackMap && (
                        <div
                          className="parcel-track-loading-overlay"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="parcel-track-loader-shell">
                            <div
                              className="parcel-track-loader-spinner"
                              aria-hidden="true"
                            >
                              <span className="parcel-track-loader-ring" />
                              <span className="parcel-track-loader-core" />
                            </div>
                            <p className="parcel-track-loader-title">
                              Locating parcel
                            </p>
                            <div
                              className="parcel-track-loader-bars"
                              aria-hidden="true"
                            >
                              <span className="parcel-track-loader-bar bar-a" />
                              <span className="parcel-track-loader-bar bar-b" />
                              <span className="parcel-track-loader-bar bar-c" />
                            </div>
                          </div>
                        </div>
                      )}
                      <div
                        ref={trackMapRef}
                        className="parcel-track-map"
                        style={{
                          visibility: loadingTrackMap ? "hidden" : "visible",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── CSV Import Modal ── */}
            {csvModalOpen && (
              <div
                className="parcels-modal-overlay show"
                onClick={closeCsvModal}
              >
                <div
                  className="parcels-modal-content parcel-csv-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="parcels-modal-header">
                    <h3>Import Parcels via CSV</h3>
                  </div>
                  <div className="parcels-modal-body parcel-csv-body">
                    <label
                      className="parcel-csv-dropzone"
                      htmlFor="parcel-csv-file-input"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleCsvDrop}
                    >
                      <input
                        id="parcel-csv-file-input"
                        ref={csvFileRef}
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: "none" }}
                        onChange={(e) => handleCsvFile(e.target.files[0])}
                      />
                      <span className="parcel-csv-drop-icon" aria-hidden="true">
                        <svg
                          width="36"
                          height="36"
                          viewBox="0 0 36 36"
                          fill="none"
                        >
                          <rect width="36" height="36" rx="10" fill="#fdf0ee" />
                          <path
                            d="M18 9v12M13 16l5-5 5 5M9 27h18"
                            stroke="#e8192c"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="parcel-csv-drop-label">
                        {csvFileName
                          ? csvFileName
                          : "Click to choose a .csv file"}
                      </span>
                      <span className="parcel-csv-drop-sub">
                        or drag and drop here
                      </span>
                    </label>

                    {csvErrors.length > 0 && (
                      <div className="parcel-csv-errors">
                        <p className="parcel-csv-errors-title">
                          ⚠ Validation errors — fix your CSV and re-upload
                        </p>
                        <ul>
                          {csvErrors.slice(0, 8).map((e, i) => (
                            <li key={i}>{e.message}</li>
                          ))}
                          {csvErrors.length > 8 && (
                            <li>…and {csvErrors.length - 8} more</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {csvRows.length > 0 && csvErrors.length === 0 && (
                      <div className="parcel-csv-preview">
                        <p className="parcel-csv-preview-title">
                          ✓ {csvRows.length} row
                          {csvRows.length !== 1 ? "s" : ""} ready to import
                        </p>
                        <div className="parcel-csv-preview-table-wrap">
                          <table className="parcel-csv-preview-table">
                            <thead>
                              <tr>
                                {CSV_REQUIRED_COLS.map((c) => (
                                  <th key={c}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {csvRows.slice(0, 5).map((row, i) => (
                                <tr key={i}>
                                  {CSV_REQUIRED_COLS.map((c) => (
                                    <td key={c}>
                                      {String(row[c] || "-").slice(0, 30)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {csvRows.length > 5 && (
                            <p className="parcel-csv-preview-more">
                              +{csvRows.length - 5} more rows…
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="parcel-csv-modal-footer">
                      <button
                        type="button"
                        className="parcel-csv-cancel-btn"
                        onClick={closeCsvModal}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="parcel-csv-confirm-btn"
                        disabled={!csvRows.length || csvErrors.length > 0}
                        onClick={handleCsvImport}
                      >
                        Start Import{" "}
                        {csvRows.length > 0
                          ? `(${csvRows.length} Parcel${csvRows.length !== 1 ? "s" : ""})`
                          : ""}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Parcel;
