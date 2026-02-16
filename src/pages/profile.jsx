import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import "../styles/global.css";
import "../styles/profile.css";
import { useAuth } from "../contexts/AuthContext";
import PageSpinner from "../components/PageSpinner";

export default function Profile() {
  const { user: authUser } = useAuth(); // ✅ Get user from AuthContext
  const [profile, setProfile] = useState({
    first_name: "",
    last_name: "",
    age: "",
    date_of_birth: "",
    gender: "",
    email: "",
    phone_number: "",
    country: "",
    city: "",
    postal_code: "",
    profile_picture: "",
  });
  const [profilePicturePath, setProfilePicturePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const resolveProfilePictureUrl = useCallback(async (value) => {
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) return value;

    const { data, error } = await supabaseClient.storage
      .from("admin_profile")
      .createSignedUrl(value, 60 * 60);

    if (error) {
      console.error("Failed to resolve profile picture URL:", error);
      return "";
    }

    return data?.signedUrl || "";
  }, []);

  const findAdminProfileRow = useCallback(async () => {
    const candidates = [
      { column: "id", value: authUser?.id },
      { column: "email", value: authUser?.email },
    ].filter((candidate) => candidate.value);

    for (const candidate of candidates) {
      const { data, error } = await supabaseClient
        .from("admin_profile")
        .select("*")
        .eq(candidate.column, candidate.value)
        .limit(1);

      if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes("column") && message.includes("does not exist")) {
          continue;
        }
        console.error(`Failed admin_profile lookup by ${candidate.column}:`, error);
        continue;
      }

      if (Array.isArray(data) && data.length > 0) {
        return { row: data[0], locator: candidate };
      }
    }

    return { row: null, locator: null };
  }, [authUser?.id, authUser?.email]);

  const saveAdminProfile = async (payload) => {
    if (!authUser?.id && !authUser?.email) {
      return { error: new Error("Missing authenticated user identity.") };
    }

    const { row, locator } = await findAdminProfileRow();

    if (row && locator) {
      const { error: updateError } = await supabaseClient
        .from("admin_profile")
        .update(payload)
        .eq(locator.column, locator.value);
      return { error: updateError };
    }

    const insertCandidates = [
      { id: authUser?.id, email: authUser?.email, ...payload },
      { email: authUser?.email, ...payload },
    ];

    let lastError = null;

    for (const candidate of insertCandidates) {
      const { error: insertError } = await supabaseClient
        .from("admin_profile")
        .insert(candidate);

      if (!insertError) return { error: null };

      const message = String(insertError.message || "").toLowerCase();
      if (message.includes("column") && message.includes("does not exist")) {
        lastError = insertError;
        continue;
      }

      if (message.includes("duplicate key") || message.includes("unique")) {
        const retry = await findAdminProfileRow();
        if (retry.row && retry.locator) {
          const { error: retryUpdateError } = await supabaseClient
            .from("admin_profile")
            .update(payload)
            .eq(retry.locator.column, retry.locator.value);
          return { error: retryUpdateError };
        }
      }

      return { error: insertError };
    }

    return { error: lastError || new Error("Failed to insert admin profile row.") };
  };

  useEffect(() => {
    async function loadProfile() {
      if (!authUser?.id && !authUser?.email) {
        setLoading(false);
        return;
      }

      const { row } = await findAdminProfileRow();
      if (row) {
        const rawProfilePicture = row.profile_picture || "";
        const resolvedProfilePicture = await resolveProfilePictureUrl(rawProfilePicture);
        setProfile((prev) => ({
          ...prev,
          ...row,
          profile_picture: resolvedProfilePicture,
          date_of_birth: row.date_of_birth ?? row.birthday ?? "",
          phone_number: row.phone_number ?? row.phone ?? "",
        }));
        setProfilePicturePath(rawProfilePicture);
      }
      setLoading(false);
    }

    if (authUser) {
      loadProfile();
    }
  }, [authUser, findAdminProfileRow, resolveProfilePictureUrl]);

  useEffect(() => {
    if (!showSuccessModal) return undefined;
    const timerId = setTimeout(() => {
      setShowSuccessModal(false);
    }, 2200);
    return () => clearTimeout(timerId);
  }, [showSuccessModal]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || (!authUser?.id && !authUser?.email)) return;
    if (!file.type?.startsWith("image/")) return;

    setUploading(true);
    const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
    const fileName = `profile_picture_${Date.now()}.${fileExt}`;
    const filePath = `${authUser.id || authUser.email}/profile_pictures/${fileName}`;

    try {
      const { error: uploadError } = await supabaseClient.storage
        .from("admin_profile")
        .upload(filePath, file, { upsert: false, contentType: file.type || "image/jpeg" });

      if (uploadError) {
        console.error("Profile upload error:", uploadError);
        return;
      }

      const { error: updateError } = await saveAdminProfile({
        profile_picture: filePath,
      });

      if (updateError) {
        console.error("Failed to save profile_picture column:", updateError);
        return;
      }

      const resolvedProfilePicture = await resolveProfilePictureUrl(filePath);
      if (!resolvedProfilePicture) {
        console.error("Failed to generate signed URL for uploaded profile picture.");
        return;
      }

      setProfile((prev) => ({ ...prev, profile_picture: resolvedProfilePicture }));
      setProfilePicturePath(filePath);
      setSuccessMessage("Profile picture uploaded successfully.");
      setShowSuccessModal(true);
      localStorage.setItem("profilePictureUpdatedAt", String(Date.now()));
      window.dispatchEvent(new Event("profile-picture-updated"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleSavePersonal = async () => {
    if (!authUser?.email) return;

    const { error } = await saveAdminProfile({
      first_name: profile.first_name,
      last_name: profile.last_name,
      date_of_birth: profile.date_of_birth,
      phone_number: profile.phone_number,
      profile_picture: profilePicturePath || undefined,
    });

    if (error) console.error(error);
    else {
      setSuccessMessage("Personal information updated successfully.");
      setShowSuccessModal(true);
      setEditingPersonal(false);
    }
  };

  const handleSaveAddress = async () => {
    if (!authUser?.email) return;

    const { error } = await saveAdminProfile({
      country: profile.country,
      city: profile.city,
      postal_code: profile.postal_code,
      profile_picture: profilePicturePath || undefined,
    });

    if (error) console.error(error);
    else {
      setSuccessMessage("Address updated successfully.");
      setShowSuccessModal(true);
      setEditingAddress(false);
    }
  };

  if (loading) return <PageSpinner fullScreen label="Loading profile..." />;

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      {/* ✅ No props needed - Sidebar gets everything from AuthContext */}
      <Sidebar />

      <div className="profile-main-content bg-gradient-to-br from-red-50 via-slate-50 to-slate-100 p-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {/* Profile Header Card */}
        <div className="profile-header-card rounded-2xl bg-white/95 shadow-2xl shadow-slate-900/10 dark:bg-slate-900/90 dark:shadow-black/35">
          <div className="profile-header-content">
            <div
              className="profile-avatar-large"
              style={{
                backgroundImage: profile.profile_picture
                  ? `url(${profile.profile_picture})`
                  : undefined,
              }}
              onClick={() => {
                if (!uploading) fileInputRef.current?.click();
              }}
            >
              {!profile.profile_picture && (
                <span className="avatar-placeholder">
                  {profile.first_name?.[0]?.toUpperCase() || authUser?.email?.[0]?.toUpperCase() || "A"}
                </span>
              )}
              <div className="avatar-camera-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="image/*"
              disabled={uploading}
              onChange={handleUpload}
            />
            <div className="profile-header-info">
              <h2 className="profile-name">
                {profile.first_name} {profile.last_name}
              </h2>
              <p className="profile-role">Admin</p>
              <p className="profile-location">
                {profile.city && profile.country 
                  ? `${profile.city}, ${profile.country}` 
                  : "Location not set"}
              </p>
            </div>
          </div>
        </div>

        {/* Personal Information Card */}
        <div className="profile-info-card rounded-2xl bg-white/95 shadow-2xl shadow-slate-900/10 dark:bg-slate-900/90 dark:shadow-black/35">
          <div className="card-header">
            <h3 className="card-title">Personal Information</h3>
            <button 
              className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
              onClick={() => {
                if (editingPersonal) {
                  handleSavePersonal();
                } else {
                  setEditingPersonal(true);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              {editingPersonal ? "Save" : "Edit"}
            </button>
          </div>
          <div className="info-grid">
            <div className="info-field">
              <label>First Name</label>
              {editingPersonal ? (
                <input
                  type="text"
                  name="first_name"
                  value={profile.first_name || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.first_name || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>Last Name</label>
              {editingPersonal ? (
                <input
                  type="text"
                  name="last_name"
                  value={profile.last_name || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.last_name || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>Date of Birth</label>
              {editingPersonal ? (
                <input
                  type="date"
                  name="date_of_birth"
                  value={profile.date_of_birth || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.date_of_birth || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>Email Address</label>
              <p className="info-value">{authUser?.email || "-"}</p>
            </div>
            <div className="info-field">
              <label>Phone Number</label>
              {editingPersonal ? (
                <input
                  type="tel"
                  name="phone_number"
                  value={profile.phone_number || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.phone_number || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>User Role</label>
              <p className="info-value">Admin</p>
            </div>
          </div>
        </div>

        {/* Address Card */}
        <div className="profile-info-card rounded-2xl bg-white/95 shadow-2xl shadow-slate-900/10 dark:bg-slate-900/90 dark:shadow-black/35">
          <div className="card-header">
            <h3 className="card-title">Address</h3>
            <button 
              className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
              onClick={() => {
                if (editingAddress) {
                  handleSaveAddress();
                } else {
                  setEditingAddress(true);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              {editingAddress ? "Save" : "Edit"}
            </button>
          </div>
          <div className="info-grid">
            <div className="info-field">
              <label>Country</label>
              {editingAddress ? (
                <input
                  type="text"
                  name="country"
                  value={profile.country || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.country || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>City</label>
              {editingAddress ? (
                <input
                  type="text"
                  name="city"
                  value={profile.city || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.city || "-"}</p>
              )}
            </div>
            <div className="info-field">
              <label>Postal Code</label>
              {editingAddress ? (
                <input
                  type="text"
                  name="postal_code"
                  value={profile.postal_code || ""}
                  onChange={handleChange}
                  className="info-input"
                />
              ) : (
                <p className="info-value">{profile.postal_code || "-"}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSuccessModal && (
        <div className="modal-overlay bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowSuccessModal(false)}>
          <div className="profile-success-modal rounded-2xl bg-white shadow-2xl shadow-slate-900/30 dark:bg-slate-900 dark:shadow-black/50" onClick={(e) => e.stopPropagation()}>
            <div className="profile-success-header">
              <h3>Success</h3>
              <button
                type="button"
                className="profile-success-close"
                onClick={() => setShowSuccessModal(false)}
                aria-label="Close success modal"
              >
                &times;
              </button>
            </div>
            <div className="profile-success-body">
              <div className="profile-success-check" aria-hidden="true">
                <span className="profile-success-checkmark" />
              </div>
              <p>{successMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
