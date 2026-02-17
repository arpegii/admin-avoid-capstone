import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import "../styles/global.css";
import "../styles/profile.css";
import { useAuth } from "../contexts/AuthContext";
import PageSpinner from "../components/PageSpinner";

const PSGC_API_BASE_URL = "https://psgc.gitlab.io/api";

const normalizePsgcItems = (payload) => {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return list
    .map((item) => ({
      code: String(item?.code ?? item?.psgc_code ?? item?.id ?? ""),
      name: String(item?.name ?? item?.full_name ?? "").trim(),
    }))
    .filter((item) => item.code && item.name)
    .sort((a, b) => a.name.localeCompare(b.name));
};

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
    region: "",
    province: "",
    city: "",
    barangay: "",
    postal_code: "",
    profile_picture: "",
  });
  const [profilePicturePath, setProfilePicturePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [personalInitial, setPersonalInitial] = useState(null);
  const [addressInitial, setAddressInitial] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedRegionCode, setSelectedRegionCode] = useState("");
  const [selectedProvinceCode, setSelectedProvinceCode] = useState("");
  const [selectedCityCode, setSelectedCityCode] = useState("");
  const fileInputRef = useRef(null);
  const todayIso = new Date().toISOString().split("T")[0];
  const personalFields = ["first_name", "last_name", "date_of_birth", "phone_number"];
  const addressFields = ["region", "province", "city", "barangay", "postal_code"];

  const sanitizeProfileValue = (name, rawValue) => {
    const value = String(rawValue ?? "");
    switch (name) {
      case "first_name":
      case "last_name":
      case "city":
      case "region":
      case "province":
      case "barangay":
        return value;
      case "phone_number":
        return value
          .replace(/[^\d+]/g, "")
          .replace(/(?!^)\+/g, "")
          .slice(0, 13);
      case "postal_code":
        return value.replace(/[^a-zA-Z0-9\s-]/g, "").toUpperCase().slice(0, 12);
      default:
        return value;
    }
  };

  const validatePersonalFields = (currentProfile) => {
    const errors = {};
    const personNameRegex = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

    if (currentProfile.first_name && !personNameRegex.test(currentProfile.first_name.trim())) {
      errors.first_name = "Use letters only (spaces, apostrophe, and hyphen allowed).";
    }
    if (currentProfile.last_name && !personNameRegex.test(currentProfile.last_name.trim())) {
      errors.last_name = "Use letters only (spaces, apostrophe, and hyphen allowed).";
    }
    if (currentProfile.date_of_birth) {
      if (currentProfile.date_of_birth > todayIso) {
        errors.date_of_birth = "Date of birth cannot be in the future.";
      } else if (currentProfile.date_of_birth < "1900-01-01") {
        errors.date_of_birth = "Enter a valid date of birth.";
      }
    }
    if (currentProfile.phone_number) {
      const normalizedPhone = currentProfile.phone_number.replace(/\s+/g, "");
      const phPhoneRegex = /^(\+639\d{9}|639\d{9}|09\d{9})$/;
      if (!phPhoneRegex.test(normalizedPhone)) {
        errors.phone_number = "Enter a valid PH mobile number (09XXXXXXXXX, 639XXXXXXXXX, or +639XXXXXXXXX).";
      }
    }

    return errors;
  };

  const validateAddressFields = (currentProfile) => {
    const errors = {};
    if (!selectedRegionCode || !regions.some((item) => item.code === selectedRegionCode)) {
      errors.region = "Select a valid Philippine region.";
    }

    if (!selectedProvinceCode || !provinces.some((item) => item.code === selectedProvinceCode)) {
      errors.province = "Select a valid province for the selected region.";
    }

    if (!selectedCityCode || !cities.some((item) => item.code === selectedCityCode)) {
      errors.city = "Select a valid city/municipality for the selected province.";
    }

    if (!currentProfile.barangay || !barangays.some((item) => item.name === currentProfile.barangay)) {
      errors.barangay = "Select a valid barangay for the selected city/municipality.";
    }
    if (currentProfile.postal_code) {
      const postalRegex = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;
      if (!postalRegex.test(currentProfile.postal_code.trim())) {
        errors.postal_code = "Use letters, numbers, spaces, or hyphen only.";
      }
    }

    return errors;
  };

  const validateField = (name, value, currentProfile) => {
    const personNameRegex = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;
    const normalized = String(value ?? "").trim();

    if (name === "first_name" || name === "last_name") {
      if (normalized && !personNameRegex.test(normalized)) {
        return "Use letters only (spaces, apostrophe, and hyphen allowed).";
      }
      return "";
    }

    if (name === "date_of_birth") {
      if (!normalized) return "";
      if (normalized > todayIso) return "Date of birth cannot be in the future.";
      if (normalized < "1900-01-01") return "Enter a valid date of birth.";
      return "";
    }

    if (name === "phone_number") {
      if (!normalized) return "";
      const phPhoneRegex = /^(\+639\d{9}|639\d{9}|09\d{9})$/;
      if (!phPhoneRegex.test(normalized.replace(/\s+/g, ""))) {
        return "Enter a valid PH mobile number (09XXXXXXXXX, 639XXXXXXXXX, or +639XXXXXXXXX).";
      }
      return "";
    }

    if (name === "postal_code") {
      if (!normalized) return "";
      const postalRegex = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;
      if (!postalRegex.test(normalized.toUpperCase())) {
        return "Use letters, numbers, spaces, or hyphen only.";
      }
      return "";
    }

    if (name === "region") {
      if (!normalized) return "Select a valid Philippine region.";
      if (!selectedRegionCode || !regions.some((item) => item.code === selectedRegionCode)) {
        return "Select a valid Philippine region.";
      }
      return "";
    }

    if (name === "province") {
      if (!normalized) return "Select a valid province for the selected region.";
      if (!selectedProvinceCode || !provinces.some((item) => item.code === selectedProvinceCode)) {
        return "Select a valid province for the selected region.";
      }
      return "";
    }

    if (name === "city") {
      if (!normalized) return "Select a valid city/municipality for the selected province.";
      if (!selectedCityCode || !cities.some((item) => item.code === selectedCityCode)) {
        return "Select a valid city/municipality for the selected province.";
      }
      return "";
    }

    if (name === "barangay") {
      if (!normalized) return "Select a valid barangay for the selected city/municipality.";
      if (!barangays.some((item) => item.name === currentProfile.barangay)) {
        return "Select a valid barangay for the selected city/municipality.";
      }
      return "";
    }

    return "";
  };

  const pickFields = (source, fields) =>
    fields.reduce((acc, field) => {
      acc[field] = source?.[field] ?? "";
      return acc;
    }, {});

  const hasFieldChanges = (current, initial, fields) => {
    if (!initial) return false;
    return fields.some((field) => (current?.[field] ?? "") !== (initial?.[field] ?? ""));
  };

  const personalHasChanges = editingPersonal && hasFieldChanges(profile, personalInitial, personalFields);
  const addressHasChanges = editingAddress && hasFieldChanges(profile, addressInitial, addressFields);

  const fetchPsgc = useCallback(async (path) => {
    const response = await fetch(`${PSGC_API_BASE_URL}${path}`);
    if (!response.ok) {
      throw new Error(`PSGC request failed: ${response.status}`);
    }
    return response.json();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadRegions() {
      try {
        const payload = await fetchPsgc("/regions/");
        if (!active) return;
        setRegions(normalizePsgcItems(payload));
      } catch (error) {
        console.error("Failed to load PSGC regions:", error);
      }
    }
    loadRegions();
    return () => {
      active = false;
    };
  }, [fetchPsgc]);

  useEffect(() => {
    if (!regions.length || !profile.region || selectedRegionCode) return;
    const regionMatch = regions.find((item) => item.name === profile.region);
    if (regionMatch) {
      setSelectedRegionCode(regionMatch.code);
    }
  }, [regions, profile.region, selectedRegionCode]);

  useEffect(() => {
    let active = true;
    async function loadProvinces() {
      if (!selectedRegionCode) {
        setProvinces([]);
        setSelectedProvinceCode("");
        return;
      }
      try {
        const payload = await fetchPsgc(`/regions/${selectedRegionCode}/provinces/`);
        const provinceItems = normalizePsgcItems(payload);
        if (!active) return;
        setProvinces(provinceItems);
      } catch (error) {
        console.error("Failed to load PSGC provinces:", error);
        if (active) setProvinces([]);
      }
    }
    loadProvinces();
    return () => {
      active = false;
    };
  }, [fetchPsgc, selectedRegionCode]);

  useEffect(() => {
    if (!provinces.length || !profile.province || selectedProvinceCode) return;
    const provinceMatch = provinces.find((item) => item.name === profile.province);
    if (provinceMatch) {
      setSelectedProvinceCode(provinceMatch.code);
    }
  }, [provinces, profile.province, selectedProvinceCode]);

  useEffect(() => {
    let active = true;
    async function loadCities() {
      if (!selectedProvinceCode) {
        setCities([]);
        setSelectedCityCode("");
        return;
      }
      try {
        const payload = await fetchPsgc(`/provinces/${selectedProvinceCode}/cities-municipalities/`);
        const cityItems = normalizePsgcItems(payload);
        if (!active) return;
        setCities(cityItems);
      } catch (error) {
        console.error("Failed to load PSGC cities/municipalities:", error);
        if (active) setCities([]);
      }
    }
    loadCities();
    return () => {
      active = false;
    };
  }, [fetchPsgc, selectedProvinceCode]);

  useEffect(() => {
    if (!cities.length || !profile.city || selectedCityCode) return;
    const cityMatch = cities.find((item) => item.name === profile.city);
    if (cityMatch) {
      setSelectedCityCode(cityMatch.code);
    }
  }, [cities, profile.city, selectedCityCode]);

  useEffect(() => {
    let active = true;
    async function loadBarangays() {
      if (!selectedCityCode) {
        setBarangays([]);
        return;
      }
      try {
        const payload = await fetchPsgc(`/cities-municipalities/${selectedCityCode}/barangays/`);
        if (!active) return;
        setBarangays(normalizePsgcItems(payload));
      } catch (error) {
        console.error("Failed to load PSGC barangays:", error);
        if (active) setBarangays([]);
      }
    }
    loadBarangays();
    return () => {
      active = false;
    };
  }, [fetchPsgc, selectedCityCode]);

  const handleRegionChange = (e) => {
    const nextRegionCode = e.target.value;
    const nextRegionName = regions.find((item) => item.code === nextRegionCode)?.name || "";
    setSelectedRegionCode(nextRegionCode);
    setSelectedProvinceCode("");
    setSelectedCityCode("");
    setProvinces([]);
    setCities([]);
    setBarangays([]);
    const nextProfile = {
      ...profile,
      region: nextRegionName,
      province: "",
      city: "",
      barangay: "",
    };
    setProfile(nextProfile);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.province;
      delete next.city;
      delete next.barangay;
      const regionError = validateField("region", nextProfile.region, nextProfile);
      if (regionError) next.region = regionError;
      else delete next.region;
      return next;
    });
  };

  const handleProvinceChange = (e) => {
    const nextProvinceCode = e.target.value;
    const nextProvinceName = provinces.find((item) => item.code === nextProvinceCode)?.name || "";
    setSelectedProvinceCode(nextProvinceCode);
    setSelectedCityCode("");
    setCities([]);
    setBarangays([]);
    const nextProfile = {
      ...profile,
      province: nextProvinceName,
      city: "",
      barangay: "",
    };
    setProfile(nextProfile);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.city;
      delete next.barangay;
      const provinceError = validateField("province", nextProfile.province, nextProfile);
      if (provinceError) next.province = provinceError;
      else delete next.province;
      return next;
    });
  };

  const handleCityChange = (e) => {
    const nextCityCode = e.target.value;
    const nextCityName = cities.find((item) => item.code === nextCityCode)?.name || "";
    setSelectedCityCode(nextCityCode);
    setBarangays([]);
    const nextProfile = {
      ...profile,
      city: nextCityName,
      barangay: "",
    };
    setProfile(nextProfile);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.barangay;
      const cityError = validateField("city", nextProfile.city, nextProfile);
      if (cityError) next.city = cityError;
      else delete next.city;
      return next;
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const sanitizedValue = sanitizeProfileValue(name, value);
    const nextProfile = { ...profile, [name]: sanitizedValue };
    setProfile(nextProfile);
    setFieldErrors((prev) => {
      const next = { ...prev };
      const fieldError = validateField(name, sanitizedValue, nextProfile);
      if (fieldError) next[name] = fieldError;
      else delete next[name];
      return next;
    });
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
          region: row.region ?? row.country ?? "",
          profile_picture: resolvedProfilePicture,
          date_of_birth: row.date_of_birth ?? row.birthday ?? "",
          phone_number: row.phone_number ?? row.phone ?? "",
        }));
        setSelectedRegionCode("");
        setSelectedProvinceCode("");
        setSelectedCityCode("");
        setProvinces([]);
        setCities([]);
        setBarangays([]);
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
    const errors = validatePersonalFields(profile);
    if (Object.keys(errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return;
    }

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
      setPersonalInitial(null);
    }
  };

  const handleSaveAddress = async () => {
    if (!authUser?.email) return;
    const errors = validateAddressFields(profile);
    if (Object.keys(errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return;
    }

    let payload = {
      region: profile.region,
      province: profile.province,
      city: profile.city,
      barangay: profile.barangay,
      postal_code: profile.postal_code,
      profile_picture: profilePicturePath || undefined,
    };
    let response = await saveAdminProfile(payload);

    while (response.error) {
      const msg = String(response.error?.message || "").toLowerCase();
      const candidateColumns = Object.keys(payload);
      const referencedColumn = candidateColumns.find(
        (column) => msg.includes(`'${column}'`) || msg.includes(`"${column}"`) || msg.includes(` ${column} `),
      );
      const unknownColumn =
        referencedColumn &&
        msg.includes("column") &&
        (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("not found"))
          ? referencedColumn
          : undefined;
      if (!unknownColumn || !(unknownColumn in payload)) break;
      const { [unknownColumn]: _omit, ...rest } = payload;
      payload = rest;
      response = await saveAdminProfile(payload);
    }

    if (response.error) console.error(response.error);
    else {
      setSuccessMessage("Address updated successfully.");
      setShowSuccessModal(true);
      setEditingAddress(false);
      setAddressInitial(null);
    }
  };

  const startEditPersonal = () => {
    setPersonalInitial(pickFields(profile, personalFields));
    setEditingPersonal(true);
  };

  const cancelEditPersonal = () => {
    if (personalInitial) {
      setProfile((prev) => ({ ...prev, ...personalInitial }));
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.first_name;
      delete next.last_name;
      delete next.date_of_birth;
      delete next.phone_number;
      return next;
    });
    setEditingPersonal(false);
    setPersonalInitial(null);
  };

  const startEditAddress = () => {
    setAddressInitial(pickFields(profile, addressFields));
    setEditingAddress(true);
  };

  const cancelEditAddress = () => {
    if (addressInitial) {
      setProfile((prev) => ({ ...prev, ...addressInitial }));
      setSelectedRegionCode("");
      setSelectedProvinceCode("");
      setSelectedCityCode("");
      setProvinces([]);
      setCities([]);
      setBarangays([]);
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.region;
      delete next.province;
      delete next.city;
      delete next.barangay;
      delete next.postal_code;
      return next;
    });
    setEditingAddress(false);
    setAddressInitial(null);
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
                {profile.city && profile.region
                  ? `${profile.barangay ? `${profile.barangay}, ` : ""}${profile.city}${profile.province ? `, ${profile.province}` : ""}, ${profile.region}`
                  : "Location not set"}
              </p>
            </div>
          </div>
        </div>

        {/* Personal Information Card */}
        <div className="profile-info-card rounded-2xl bg-white/95 shadow-2xl shadow-slate-900/10 dark:bg-slate-900/90 dark:shadow-black/35">
          <div className="card-header">
            <h3 className="card-title">Personal Information</h3>
            {!editingPersonal ? (
              <button
                className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
                onClick={startEditPersonal}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={cancelEditPersonal}
                >
                  Cancel
                </button>
                {personalHasChanges && (
                  <button
                    type="button"
                    className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
                    onClick={handleSavePersonal}
                  >
                    Save
                  </button>
                )}
              </div>
            )}
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
                  className={`info-input ${fieldErrors.first_name ? "invalid" : ""}`}
                  maxLength={50}
                />
              ) : (
                <p className="info-value">{profile.first_name || "-"}</p>
              )}
              {editingPersonal && fieldErrors.first_name && (
                <p className="info-error">{fieldErrors.first_name}</p>
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
                  className={`info-input ${fieldErrors.last_name ? "invalid" : ""}`}
                  maxLength={50}
                />
              ) : (
                <p className="info-value">{profile.last_name || "-"}</p>
              )}
              {editingPersonal && fieldErrors.last_name && (
                <p className="info-error">{fieldErrors.last_name}</p>
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
                  className={`info-input ${fieldErrors.date_of_birth ? "invalid" : ""}`}
                  max={todayIso}
                />
              ) : (
                <p className="info-value">{profile.date_of_birth || "-"}</p>
              )}
              {editingPersonal && fieldErrors.date_of_birth && (
                <p className="info-error">{fieldErrors.date_of_birth}</p>
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
                  className={`info-input ${fieldErrors.phone_number ? "invalid" : ""}`}
                  inputMode="numeric"
                  maxLength={13}
                  placeholder="09XXXXXXXXX"
                />
              ) : (
                <p className="info-value">{profile.phone_number || "-"}</p>
              )}
              {editingPersonal && fieldErrors.phone_number && (
                <p className="info-error">{fieldErrors.phone_number}</p>
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
            {!editingAddress ? (
              <button
                className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
                onClick={startEditAddress}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={cancelEditAddress}
                >
                  Cancel
                </button>
                {addressHasChanges && (
                  <button
                    type="button"
                    className="btn-edit inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/20 transition hover:brightness-110"
                    onClick={handleSaveAddress}
                  >
                    Save
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="info-grid">
            <div className="info-field">
              <label>Region</label>
              {editingAddress ? (
                <select
                  name="region"
                  value={selectedRegionCode}
                  onChange={handleRegionChange}
                  className={`info-input ${fieldErrors.region ? "invalid" : ""}`}
                >
                  <option value="">Select region</option>
                  {regions.map((region) => (
                    <option key={region.code} value={region.code}>
                      {region.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="info-value">{profile.region || "-"}</p>
              )}
              {editingAddress && fieldErrors.region && (
                <p className="info-error">{fieldErrors.region}</p>
              )}
            </div>
            <div className="info-field">
              <label>Province</label>
              {editingAddress ? (
                <select
                  name="province"
                  value={selectedProvinceCode}
                  onChange={handleProvinceChange}
                  className={`info-input ${fieldErrors.province ? "invalid" : ""}`}
                  disabled={!selectedRegionCode}
                >
                  <option value="">{selectedRegionCode ? "Select province" : "Select region first"}</option>
                  {provinces.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="info-value">{profile.province || "-"}</p>
              )}
              {editingAddress && fieldErrors.province && (
                <p className="info-error">{fieldErrors.province}</p>
              )}
            </div>
            <div className="info-field">
              <label>City/Municipality</label>
              {editingAddress ? (
                <select
                  name="city"
                  value={selectedCityCode}
                  onChange={handleCityChange}
                  className={`info-input ${fieldErrors.city ? "invalid" : ""}`}
                  disabled={!selectedProvinceCode}
                >
                  <option value="">{selectedProvinceCode ? "Select city/municipality" : "Select province first"}</option>
                  {cities.map((city) => (
                    <option key={city.code} value={city.code}>
                      {city.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="info-value">{profile.city || "-"}</p>
              )}
              {editingAddress && fieldErrors.city && (
                <p className="info-error">{fieldErrors.city}</p>
              )}
            </div>
            <div className="info-field">
              <label>Barangay</label>
              {editingAddress ? (
                <select
                  name="barangay"
                  value={profile.barangay || ""}
                  onChange={handleChange}
                  className={`info-input ${fieldErrors.barangay ? "invalid" : ""}`}
                  disabled={!selectedCityCode}
                >
                  <option value="">{selectedCityCode ? "Select barangay" : "Select city/municipality first"}</option>
                  {barangays.map((barangay) => (
                    <option key={barangay.code} value={barangay.name}>
                      {barangay.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="info-value">{profile.barangay || "-"}</p>
              )}
              {editingAddress && fieldErrors.barangay && (
                <p className="info-error">{fieldErrors.barangay}</p>
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
                  className={`info-input ${fieldErrors.postal_code ? "invalid" : ""}`}
                  inputMode="text"
                  maxLength={12}
                />
              ) : (
                <p className="info-value">{profile.postal_code || "-"}</p>
              )}
              {editingAddress && fieldErrors.postal_code && (
                <p className="info-error">{fieldErrors.postal_code}</p>
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
