// Parcel.jsx
import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import "../styles/global.css";
import "../styles/parcels.css";
import { useAuth } from "../contexts/AuthContext";
import PageSpinner from "../components/PageSpinner";

const MAX_PARCEL_ROWS = 10;

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

  const avatarRef = useRef(null);

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !avatarRef.current) return;
    const reader = new FileReader();
    reader.onload = () => {
      avatarRef.current.style.backgroundImage = `url('${reader.result}')`;
      avatarRef.current.style.backgroundSize = "cover";
      avatarRef.current.style.backgroundPosition = "center";
      avatarRef.current.textContent = "";
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const loadParcels = async () => {
      setLoading(true);
      const from = (parcelPage - 1) * parcelRows;
      const to = from + parcelRows - 1;
      const [sortColumn, sortDir] = sortBy.split("-");
      const ascending = sortDir === "asc";

      let query = supabaseClient
        .from("parcels")
        .select("*", { count: "exact" })
        .order(sortColumn, { ascending })
        .range(from, to);

      if (statusFilter !== "All") query = query.ilike("status", statusFilter);

      if (searchTerm.trim()) {
        const id = parseInt(searchTerm, 10);
        query = isNaN(id)
          ? query.eq("parcel_id", -1)
          : query.eq("parcel_id", id);
      }

      try {
        const { data, count } = await query;
        setParcels(data || []);
        setParcelTotalRows(count || 0);
      } finally {
        setLoading(false);
      }
    };
    loadParcels();
  }, [parcelPage, statusFilter, sortBy, searchTerm, parcelRows]);

  const totalPages = Math.ceil(parcelTotalRows / parcelRows);
  const prevPage = () => setParcelPage((p) => Math.max(1, p - 1));
  const nextPage = () => setParcelPage((p) => Math.min(totalPages, p + 1));

  const openParcelModal = (parcel) => setViewParcel(parcel);
  const closeParcelModal = () => setViewParcel(null);

  return (
    <div className="dashboard-container">
      <Sidebar currentPage="parcels.html" />

      <div className="parcels-page">
        {loading ? (
          <PageSpinner fullScreen label="Loading parcels..." />
        ) : (
          <>
            <h1 className="page-title">Parcel Management</h1>

            {/* Filters */}
            <div className="parcels-filter-section">
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
              <select
                value={statusFilter}
                onChange={(e) => {
                  setParcelPage(1);
                  setStatusFilter(e.target.value);
                }}
              >
                <option value="All">All</option>
                <option value="Successfully Delivered">
                  Successfully Delivered
                </option>
                <option value="On-going">On-going</option>
                <option value="Cancelled">Cancelled</option>
              </select>

              <label>
                <strong>Sort by:</strong>
              </label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setParcelPage(1);
                  setSortBy(e.target.value);
                }}
              >
                <option value="parcel_id-asc">Parcel ID (Ascending)</option>
                <option value="parcel_id-desc">Parcel ID (Descending)</option>
              </select>
            </div>

            {/* Table */}
            <div className="parcels-table-wrapper">
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
                  {parcels.map((parcel, idx) => (
                    <tr key={idx}>
                      <td>{parcel.parcel_id || "-"}</td>
                      <td>{parcel.recipient_name || "-"}</td>
                      <td>{parcel.recipient_phone || "-"}</td>
                      <td>{parcel.address || "-"}</td>
                      <td>{parcel.assigned_rider || "Unassigned"}</td>
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
                          className="btn-view"
                          onClick={() => openParcelModal(parcel)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}

                  {Array.from({ length: parcelRows - parcels.length }).map(
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
              <div className="parcels-modal-overlay show">
                <div className="parcels-modal-content view-parcel-modal">
                  <div className="parcels-modal-header">
                    <h3>Parcel Details</h3>
                    <span
                      className="parcels-close-btn"
                      onClick={closeParcelModal}
                    >
                      &times;
                    </span>
                  </div>
                  <div className="parcels-modal-body">
                    <p>
                      <strong>Sender Name:</strong>{" "}
                      {viewParcel.sender_name || "-"}
                    </p>
                    <p>
                      <strong>Sender Phone:</strong>{" "}
                      {viewParcel.sender_phone || "-"}
                    </p>
                    <p>
                      <strong>Attempt 1 Status:</strong>{" "}
                      {viewParcel.attempt1_status || "-"}
                    </p>
                    <p>
                      <strong>Attempt 1 Date:</strong>{" "}
                      {viewParcel.attempt1_datetime || "-"}
                    </p>
                    <p>
                      <strong>Attempt 2 Status:</strong>{" "}
                      {viewParcel.attempt2_status || "-"}
                    </p>
                    <p>
                      <strong>Attempt 2 Date:</strong>{" "}
                      {viewParcel.attempt2_datetime || "-"}
                    </p>
                    <p>
                      <strong>Created At:</strong>{" "}
                      {viewParcel.created_at || "-"}
                    </p>
                    <p>
                      <strong>Updated At:</strong>{" "}
                      {viewParcel.updated_at || "-"}
                    </p>
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
