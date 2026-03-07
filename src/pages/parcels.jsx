// Parcel.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import { useNotification } from "../contexts/NotificationContext";
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
  if (["failed", "failure", "cancelled", "canceled"].includes(n))
    return "is-failed";
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
  if (n === "cancelled" || n === "canceled")
    return { className: "is-cancelled", label: "Cancelled" };
  return { className: "is-default", label: formatStatusLabel(value) };
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

const Parcel = () => {
  const { notifyParcelDelivered } = useNotification();
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
      { value: "All", label: "All Status" },
      { value: "Successfully Delivered", label: "Delivered" },
      { value: "On-going", label: "On-Going" },
      { value: "Cancelled", label: "Cancelled" },
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
              `*, assigned_rider:users!parcels_assigned_rider_id_fkey(fname, lname)`,
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

        // Notify about recently delivered parcels
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
    loadParcels();
  }, [sortBy]);

  const statusFilteredParcels = useMemo(() => {
    if (statusFilter === "All") return parcels;
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
          : n === "cancelled"
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

  return (
    <div className="dashboard-container">
      <Sidebar currentPage="parcels.html" />

      {/* ── parcels-page is ALWAYS rendered so the Sidebar scroll
           logic can find it immediately, even while data is loading ── */}
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
                          const m = getParcelStatusMeta(parcel.status);
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

            {/* ── View parcel modal ── */}
            {viewParcel && (
              <div
                className="parcels-modal-overlay show"
                onClick={() => setViewParcel(null)}
              >
                <div
                  className="parcels-modal-content view-parcel-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="parcels-modal-header">
                    <h3>Parcel Details</h3>
                  </div>
                  <div className="parcels-modal-body">
                    <div className="parcel-view-shell">
                      <section className="parcel-view-card">
                        <h4>Delivery</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Parcel ID</span>
                            <strong>{viewParcel.parcel_id || "-"}</strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Status</span>
                            <strong>
                              {(() => {
                                const n = (
                                  viewParcel.status || ""
                                ).toLowerCase();
                                const cls =
                                  n === "successfully delivered"
                                    ? "is-delivered"
                                    : n === "on-going"
                                      ? "is-ongoing"
                                      : n === "cancelled"
                                        ? "is-cancelled"
                                        : "is-default";
                                return (
                                  <span className={`parcel-view-status ${cls}`}>
                                    {viewParcel.status || "-"}
                                  </span>
                                );
                              })()}
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
                          <div className="parcel-view-item parcel-view-action-inline">
                            <button
                              type="button"
                              className="parcel-track-btn"
                              onClick={() => openTrackModal(viewParcel)}
                              disabled={!getParcelCoords(viewParcel)}
                            >
                              View Delivery Location
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="parcel-view-card">
                        <h4>Sender</h4>
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
                              className={`parcel-attempt-status ${getAttemptStatusClass(viewParcel.attempt1_status)}`}
                            >
                              {formatStatusLabel(viewParcel.attempt1_status)}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 1 Date</span>
                            <strong>
                              {formatTimelineDateTime(
                                viewParcel.attempt1_date ||
                                  viewParcel.attempt1_datetime,
                              )}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 2 Status</span>
                            <strong
                              className={`parcel-attempt-status ${getAttemptStatusClass(viewParcel.attempt2_status)}`}
                            >
                              {formatStatusLabel(viewParcel.attempt2_status)}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Attempt 2 Date</span>
                            <strong>
                              {formatTimelineDateTime(
                                viewParcel.attempt2_date ||
                                  viewParcel.attempt2_datetime,
                              )}
                            </strong>
                          </div>
                        </div>
                      </section>

                      <section className="parcel-view-card">
                        <h4>Timeline</h4>
                        <div className="parcel-view-grid">
                          <div className="parcel-view-item">
                            <span>Created</span>
                            <strong>
                              {formatTimelineDateTime(viewParcel.created_at)}
                            </strong>
                          </div>
                          <div className="parcel-view-item">
                            <span>Updated</span>
                            <strong>
                              {formatTimelineDateTime(viewParcel.updated_at)}
                            </strong>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
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
          </>
        )}
      </div>
    </div>
  );
};

export default Parcel;
