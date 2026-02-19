// Parcel.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
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
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getAttemptStatusClass = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "is-default";
  if (
    normalized === "success" ||
    normalized === "successful" ||
    normalized === "successfully delivered" ||
    normalized === "delivered"
  ) {
    return "is-success";
  }
  if (
    normalized === "pending" ||
    normalized === "on-going" ||
    normalized === "ongoing" ||
    normalized === "in progress"
  ) {
    return "is-pending";
  }
  if (
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  ) {
    return "is-failed";
  }
  return "is-default";
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
    <div ref={rootRef} className={`parcel-modern-select ${open ? "is-open" : ""} ${className}`.trim()}>
      <button
        type="button"
        className={`parcel-modern-select-trigger ${triggerClassName}`.trim()}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedOption?.label || "-"}</span>
        <span className="parcel-modern-select-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className={`parcel-modern-select-menu ${menuClassName}`.trim()} role="listbox">
          {(options || []).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`parcel-modern-select-option ${value === option.value ? "is-selected" : ""}`}
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

const Parcel = () => {
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
  const statusFilterOptions = useMemo(
    () => [
      { value: "All", label: "All" },
      { value: "Successfully Delivered", label: "Successfully Delivered" },
      { value: "On-going", label: "On-going" },
      { value: "Cancelled", label: "Cancelled" },
    ],
    [],
  );
  const sortOptions = useMemo(
    () => [
      { value: "parcel_id-asc", label: "Parcel ID (Ascending)" },
      { value: "parcel_id-desc", label: "Parcel ID (Descending)" },
    ],
    [],
  );

  const trackMapRef = useRef(null);
  const trackLeafletMapRef = useRef(null);
  const trackMarkerRef = useRef(null);

  useEffect(() => {
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
              `
          *,
          assigned_rider:users!parcels_assigned_rider_id_fkey(
            fname,
            lname
          )
        `,
            )
            .order(sortColumn, { ascending })
            .range(from, from + chunkSize - 1);

          if (error) {
            throw error;
          }

          const chunk = data || [];
          allParcels.push(...chunk);
          if (chunk.length < chunkSize) {
            break;
          }
          from += chunkSize;
        }

        // Transform the data to include rider name
        const parcelsWithRiderNames = allParcels.map((parcel) => ({
          ...parcel,
          riderFullName: parcel.assigned_rider
            ? `${parcel.assigned_rider.fname || ""} ${parcel.assigned_rider.lname || ""}`.trim() ||
              "Unassigned"
            : "Unassigned",
        }));

        setParcels(parcelsWithRiderNames);
        setParcelTotalRows(parcelsWithRiderNames.length);
      } catch (err) {
        console.error("Failed to load parcels:", err);
        setParcels([]);
        setParcelTotalRows(0);
      } finally {
        setLoading(false);
      }
    };
    loadParcels();
  }, [sortBy]);

  const statusFilteredParcels = useMemo(() => {
    if (statusFilter === "All") return parcels;
    const normalizedFilter = statusFilter.trim().toLowerCase();
    return parcels.filter(
      (parcel) =>
        String(parcel?.status || "")
          .trim()
          .toLowerCase() === normalizedFilter,
    );
  }, [parcels, statusFilter]);

  const filteredParcels = useMemo(() => {
    const keyword = searchTerm.trim();
    // When searching by parcel ID, search across all loaded parcels
    // regardless of status filter so exact IDs never disappear.
    const source = keyword ? parcels : statusFilteredParcels;
    if (!keyword) return source;
    return source.filter((parcel) =>
      String(parcel?.parcel_id ?? "").startsWith(keyword),
    );
  }, [parcels, searchTerm, statusFilteredParcels]);

  useEffect(() => {
    setParcelTotalRows(filteredParcels.length);
    const nextTotalPages = Math.max(
      1,
      Math.ceil(filteredParcels.length / parcelRows),
    );
    if (parcelPage > nextTotalPages) {
      setParcelPage(nextTotalPages);
    }
  }, [filteredParcels, parcelPage, parcelRows]);

  const totalPages = Math.max(1, Math.ceil(parcelTotalRows / parcelRows));
  const prevPage = () => setParcelPage((p) => Math.max(1, p - 1));
  const nextPage = () => setParcelPage((p) => Math.min(totalPages, p + 1));
  const pageStartIndex = (parcelPage - 1) * parcelRows;
  const pageEndIndex = pageStartIndex + parcelRows;
  const pagedParcels = filteredParcels.slice(pageStartIndex, pageEndIndex);

  const openParcelModal = (parcel) => setViewParcel(parcel);
  const closeParcelModal = () => setViewParcel(null);
  const getParcelCoords = (parcel) => {
    const lat = Number(parcel?.r_lat);
    const lng = Number(parcel?.r_lng);
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
    const normalizedStatus = String(rawStatus).trim().toLowerCase();
    const statusClass =
      normalizedStatus === "successfully delivered"
        ? "status-delivered"
        : normalizedStatus === "on-going"
          ? "status-ongoing"
          : normalizedStatus === "cancelled"
            ? "status-cancelled"
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
      </div>
    `;
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

    const initTimer = setTimeout(() => {
      if (!trackMapRef.current) {
        setLoadingTrackMap(false);
        return;
      }

      const map = L.map(trackMapRef.current).setView([coords.lat, coords.lng], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      const parcelIcon = L.divIcon({
        className: "parcel-map-marker-wrap",
        html: `<span class="parcel-map-marker" aria-hidden="true">📦</span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18],
      });

      const marker = L.marker([coords.lat, coords.lng], {
        icon: parcelIcon,
        zIndexOffset: 1200,
      })
        .addTo(map)
        .bindPopup(
          buildParcelTrackPopup(trackingParcel),
          { className: "parcel-track-popup", closeButton: false },
        );

      trackLeafletMapRef.current = map;
      trackMarkerRef.current = marker;

      setTimeout(() => {
        map.invalidateSize();
        marker.openPopup();
        setLoadingTrackMap(false);
      }, 180);
    }, 380);

    return () => clearTimeout(initTimer);
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

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar currentPage="parcels.html" />

      <div className="parcels-page ui-page-shell p-6">
        {loading ? (
          <PageSpinner fullScreen label="Loading parcels..." />
        ) : (
          <>
            <h1 className="page-title mb-6">Parcel Management</h1>

            {/* Filters */}
            <div className="parcels-filter-section ui-card-surface mb-5 p-4">
              <label>
                <strong>Search:</strong>
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setParcelPage(1);
                  setSearchTerm(e.target.value);
                }}
                placeholder="Search by Parcel ID..."
              />

              <label>
                <strong>Filter by Status:</strong>
              </label>
              <div className="parcel-filter-select-wrap">
                <ModernSelect
                  className="parcel-filter-modern-shell"
                  triggerClassName="parcel-filter-modern-trigger"
                  menuClassName="parcel-filter-modern-menu"
                  value={statusFilter}
                  options={statusFilterOptions}
                  onChange={(nextValue) => {
                    setParcelPage(1);
                    setStatusFilter(nextValue);
                  }}
                />
              </div>

              <label>
                <strong>Sort by:</strong>
              </label>
              <div className="parcel-filter-select-wrap">
                <ModernSelect
                  className="parcel-filter-modern-shell"
                  triggerClassName="parcel-filter-modern-trigger"
                  menuClassName="parcel-filter-modern-menu"
                  value={sortBy}
                  options={sortOptions}
                  onChange={(nextValue) => {
                    setParcelPage(1);
                    setSortBy(nextValue);
                  }}
                />
              </div>
            </div>

            {/* Table */}
            <div className="parcels-table-wrapper ui-table-shell">
              <table className="parcel-table">
                {/* colgroup locks each column to a fixed width so headers and cells always align */}
                <colgroup>
                  <col />
                  {/* Parcel ID      — 9%  */}
                  <col />
                  {/* Recipient Name — 18% */}
                  <col />
                  {/* Recipient Phone— 15% */}
                  <col />
                  {/* Address        — 26% */}
                  <col />
                  {/* Assigned Rider — 15% */}
                  <col />
                  {/* Status         — 10% */}
                  <col />
                  {/* Action         — 7%  */}
                </colgroup>
                <thead>
                  <tr>
                    <th>Parcel ID</th>
                    <th>Recipient Name</th>
                    <th>Recipient Phone</th>
                    <th>Address</th>
                    <th>Assigned Rider</th>
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
                      <td
                        className={
                          parcel.status === "successfully delivered"
                            ? "delivered"
                            : parcel.status === "on-going"
                              ? "ongoing"
                              : parcel.status === "cancelled"
                                ? "cancelled"
                                : ""
                        }
                      >
                        {parcel.status || "-"}
                      </td>
                      <td>
                        <button
                          className="btn-view ui-btn-secondary rounded-lg px-3 py-1.5 text-xs"
                          onClick={() => openParcelModal(parcel)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}

                  {Array.from({ length: parcelRows - pagedParcels.length }).map(
                    (_, i) => (
                      <tr key={`empty-${i}`}>
                        <td colSpan={7} style={{ height: "45px" }} />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>

              <div className="parcels-table-footer">
                <div className="parcels-pagination">
                  <button onClick={prevPage} disabled={parcelPage <= 1}>
                    Previous
                  </button>
                  <span>{`Page ${parcelPage} of ${totalPages}`}</span>
                  <button
                    onClick={nextPage}
                    disabled={parcelPage >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            {/* Modal */}
            {viewParcel && (
              <div className="parcels-modal-overlay show bg-slate-950/60 backdrop-blur-sm" onClick={closeParcelModal}>
                <div
                  className="parcels-modal-content view-parcel-modal ui-modal-panel"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="parcels-modal-header">
                    <h3>Parcel Details</h3>
                  </div>
                  <div className="parcels-modal-body">
                    <div className="parcel-view-shell">
                      <section className="parcel-view-card">
                        <h4>Delivery Details</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Parcel ID</span>
                            <strong>{viewParcel.parcel_id || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Status</span>
                            <strong
                              className={`parcel-view-status ${
                                (viewParcel.status || "").toLowerCase() ===
                                "successfully delivered"
                                  ? "is-delivered"
                                  : (viewParcel.status || "").toLowerCase() ===
                                      "on-going"
                                    ? "is-ongoing"
                                    : (viewParcel.status || "").toLowerCase() ===
                                        "cancelled"
                                      ? "is-cancelled"
                                      : "is-default"
                              }`}
                            >
                              {viewParcel.status || "-"}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Recipient Name</span>
                            <strong>{viewParcel.recipient_name || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Recipient Phone</span>
                            <strong>{viewParcel.recipient_phone || "-"}</strong>
                          </div>
                          <div className="parcel-view-item parcel-view-item-full">
                            <span>Address</span>
                            <strong>{viewParcel.address || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Assigned Rider</span>
                            <strong>{viewParcel.riderFullName || "-"}</strong>
                          </div>
                          <div className="parcel-view-item parcel-view-item-full parcel-view-action-inline">
                            <button
                              type="button"
                              className="parcel-track-btn ui-btn-primary rounded-xl px-4 py-2"
                              onClick={() => openTrackModal(viewParcel)}
                              disabled={!getParcelCoords(viewParcel)}
                            >
                              Track Parcel
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="parcel-view-card">
                        <h4>Sender Details</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Sender Name</span>
                            <strong>{viewParcel.sender_name || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Sender Phone</span>
                            <strong>{viewParcel.sender_phone || "-"}</strong>
                          </div>
                        </div>
                      </section>

                      <section className="parcel-view-card">
                        <h4>Attempt History</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Attempt 1 Status</span>
                            <strong
                              className={`parcel-attempt-status ${getAttemptStatusClass(
                                viewParcel.attempt1_status,
                              )}`}
                            >
                              {formatStatusLabel(viewParcel.attempt1_status)}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 1 Date</span>
                            <strong>{viewParcel.attempt1_datetime || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 2 Status</span>
                            <strong
                              className={`parcel-attempt-status ${getAttemptStatusClass(
                                viewParcel.attempt2_status,
                              )}`}
                            >
                              {formatStatusLabel(viewParcel.attempt2_status)}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 2 Date</span>
                            <strong>{viewParcel.attempt2_datetime || "-"}</strong>
                          </div>
                        </div>
                      </section>

                      <section className="parcel-view-card">
                        <h4>System Timeline</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Created At</span>
                            <strong>{formatTimelineDateTime(viewParcel.created_at)}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Updated At</span>
                            <strong>{formatTimelineDateTime(viewParcel.updated_at)}</strong>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {trackModalOpen && (
              <div className="parcels-modal-overlay show bg-slate-950/60 backdrop-blur-sm" onClick={closeTrackModal}>
                <div
                  className="parcels-modal-content parcel-track-modal ui-modal-panel"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="parcels-modal-header">
                    <h3>Track Parcel</h3>
                  </div>
                  <div className="parcels-modal-body parcel-track-body">
                    <p>
                      Tracking parcel: <strong>#{trackingParcel?.parcel_id || "-"}</strong>
                    </p>
                    <div className="parcel-track-map-wrap">
                      {loadingTrackMap && (
                        <div
                          className="parcel-track-loading-overlay"
                          role="status"
                          aria-live="polite"
                          aria-label="Loading parcel tracking map"
                        >
                          <div className="parcel-track-loader-shell">
                            <div className="parcel-track-loader-spinner" aria-hidden="true">
                              <span className="parcel-track-loader-ring" />
                              <span className="parcel-track-loader-core" />
                            </div>
                            <p className="parcel-track-loader-title">Tracking parcel</p>
                            <div className="parcel-track-loader-bars" aria-hidden="true">
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
                        style={{ visibility: loadingTrackMap ? "hidden" : "visible" }}
                      />
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
