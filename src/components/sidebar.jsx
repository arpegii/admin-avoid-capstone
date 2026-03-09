import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FaChartBar,
  FaMotorcycle,
  FaBox,
  FaCog,
  FaSignOutAlt,
  FaPen,
  FaChevronDown,
} from "react-icons/fa";
import { useAuth } from "../contexts/AuthContext";
import { useImport } from "../contexts/ImportContext";
import { supabaseClient } from "../App";
import NotificationCenter from "./NotificationCenter";

export default function Sidebar() {
  const { user, openLogoutModal } = useAuth();
  const {
    bgImport,
    panelMinimized,
    setPanelMinimized,
    cancelImport,
    dismissPanel,
  } = useImport();

  const [profilePictureUrl, setProfilePictureUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function findAdminProfileData() {
      const candidates = [
        { column: "id", value: user?.id },
        { column: "email", value: user?.email },
      ].filter((c) => c.value);

      for (const candidate of candidates) {
        const { data, error } = await supabaseClient
          .from("admin_profile")
          .select("*")
          .eq(candidate.column, candidate.value)
          .limit(1);

        if (error) {
          const message = String(error.message || "").toLowerCase();
          if (message.includes("column") && message.includes("does not exist"))
            continue;
          console.error(
            `Failed top nav admin_profile lookup by ${candidate.column}:`,
            error,
          );
          continue;
        }

        if (Array.isArray(data) && data.length > 0) return data[0] || null;
      }
      return null;
    }

    async function loadProfilePicture() {
      if (!user?.id && !user?.email) {
        setProfilePictureUrl("");
        setDisplayName("");
        return;
      }

      const profileData = await findAdminProfileData();
      const firstName = String(profileData?.first_name || "").trim();
      const lastName = String(profileData?.last_name || "").trim();
      setDisplayName([firstName, lastName].filter(Boolean).join(" "));

      const rawValue = profileData?.profile_picture || "";
      if (!rawValue) {
        setProfilePictureUrl("");
        return;
      }

      if (rawValue.startsWith("http://") || rawValue.startsWith("https://")) {
        setProfilePictureUrl(rawValue);
        return;
      }

      const { data: signedUrlData, error: signedUrlError } =
        await supabaseClient.storage
          .from("admin_profile")
          .createSignedUrl(rawValue, 60 * 60);

      if (signedUrlError) {
        setProfilePictureUrl("");
        return;
      }
      setProfilePictureUrl(signedUrlData?.signedUrl || "");
    }

    loadProfilePicture();

    const handleProfilePictureUpdated = () => loadProfilePicture();
    const handleStorageChange = (e) => {
      if (e.key === "profilePictureUpdatedAt") loadProfilePicture();
    };

    window.addEventListener(
      "profile-picture-updated",
      handleProfilePictureUpdated,
    );
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(
        "profile-picture-updated",
        handleProfilePictureUpdated,
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [user?.id, user?.email]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const nav = document.querySelector(".tnav");
    if (!nav) return undefined;

    const scrollSelectors = [
      ".dashboard-page",
      ".riders-content-shell",
      ".riders-page",
      ".parcels-page",
      ".settings-page",
      ".profile-main-content",
      ".reports-page",
    ];

    let scrollEls = [];
    let observer = null;
    const getCurrentScrollY = () => {
      if (!scrollEls.length) return 0;
      return Math.max(...scrollEls.map((el) => el.scrollTop || 0));
    };

    const handleScroll = () => {
      if (!scrollEls.length) return;
      const isModalOpen = !!document.querySelector(
        ".riders-modal-overlay, .parcels-modal-overlay, .dashboard-modal-overlay, .modal-overlay, .reports-validation-modal",
      );
      if (isModalOpen) {
        nav.classList.remove("tnav--hidden");
        document.body.classList.remove("tnav-hidden");
        return;
      }
      const currentY = getCurrentScrollY();
      const shouldHide = currentY > 2;
      nav.classList.toggle("tnav--hidden", shouldHide);
      document.body.classList.toggle("tnav-hidden", shouldHide);
    };

    const handleWheel = (event) => {
      if (!scrollEls.length) return;
      const isModalOpen = !!document.querySelector(
        ".riders-modal-overlay, .parcels-modal-overlay, .dashboard-modal-overlay, .modal-overlay, .reports-validation-modal",
      );
      if (isModalOpen) {
        nav.classList.remove("tnav--hidden");
        document.body.classList.remove("tnav-hidden");
        return;
      }
      const currentY = getCurrentScrollY();
      if (event.deltaY > 0) {
        nav.classList.add("tnav--hidden");
        document.body.classList.add("tnav-hidden");
        return;
      }
      if (event.deltaY < 0 && currentY <= 2) {
        nav.classList.remove("tnav--hidden");
        document.body.classList.remove("tnav-hidden");
      }
    };

    const bindScrollContainers = () => {
      const next = scrollSelectors
        .map((selector) => document.querySelector(selector))
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index);
      if (!next.length) return false;

      scrollEls.forEach((el) => {
        if (!next.includes(el)) el.removeEventListener("scroll", handleScroll);
      });
      next.forEach((el) => {
        if (!scrollEls.includes(el))
          el.addEventListener("scroll", handleScroll, { passive: true });
      });
      scrollEls = next;
      handleScroll();
      return true;
    };

    nav.classList.remove("tnav--hidden");
    document.body.classList.remove("tnav-hidden");

    document.addEventListener("wheel", handleWheel, {
      passive: true,
      capture: true,
    });

    if (!bindScrollContainers()) {
      observer = new MutationObserver(() => {
        if (bindScrollContainers() && observer) {
          observer.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (observer) observer.disconnect();
      scrollEls.forEach((el) => el.removeEventListener("scroll", handleScroll));
      document.removeEventListener("wheel", handleWheel, true);
      nav.classList.remove("tnav--hidden");
      document.body.classList.remove("tnav-hidden");
    };
  }, [location.pathname]);

  const getInitials = () => {
    if (profilePictureUrl) return "";
    const source = (displayName || user?.email || "").trim();
    if (!source) return "A";
    const parts = source.split(/[\s@._-]/).filter(Boolean);
    return (
      parts.length >= 2 ? parts[0][0] + parts[1][0] : source[0]
    ).toUpperCase();
  };

  const isActive = (href) => location.pathname === href;

  const menuItems = [
    { label: "Dashboard", href: "/dashboard", icon: <FaChartBar /> },
    { label: "Riders", href: "/riders", icon: <FaMotorcycle /> },
    { label: "Parcels", href: "/parcels", icon: <FaBox /> },
  ];

  // ─────────────────────────────────────────────────────────────
  // Background import floating panel — rendered via portal so it
  // sits at document.body and is never clipped by any page layout.
  // ─────────────────────────────────────────────────────────────
  const renderBgImportPanel = () => {
    if (!bgImport) return null;

    const { status, current, total, fileName, errorMsg } = bgImport;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const isRunning = status === "running";
    const isDone = status === "done";
    const isError = status === "error";
    const isCancelled = status === "cancelled";

    const panel = (
      <div
        className={[
          "parcel-bg-import-panel",
          panelMinimized ? "is-minimized" : "",
          isDone ? "is-done" : "",
          isError ? "is-error" : "",
          isCancelled ? "is-cancelled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
      >
        {/* Header */}
        <div className="parcel-bg-import-header">
          <div className="parcel-bg-import-icon" aria-hidden="true">
            {isDone ? "✓" : isError || isCancelled ? "✕" : "📦"}
          </div>
          <div className="parcel-bg-import-title-wrap">
            <p className="parcel-bg-import-title">
              {isDone
                ? "Import Complete"
                : isError
                  ? "Import Failed"
                  : isCancelled
                    ? "Import Cancelled"
                    : "Importing Parcels…"}
            </p>
            <p className="parcel-bg-import-sub">
              {isDone
                ? `${total} parcel${total !== 1 ? "s" : ""} added successfully`
                : isError
                  ? errorMsg || "An error occurred"
                  : isCancelled
                    ? "Import was stopped"
                    : `${current} / ${total} — geocoding addresses`}
            </p>
          </div>
          <div className="parcel-bg-import-actions">
            {isRunning && (
              <button
                type="button"
                className="parcel-bg-import-minimize-btn"
                onClick={() => setPanelMinimized((p) => !p)}
                title={panelMinimized ? "Expand" : "Minimize"}
                aria-label={panelMinimized ? "Expand panel" : "Minimize panel"}
              >
                {panelMinimized ? "▲" : "▼"}
              </button>
            )}
            {(isDone || isError || isCancelled) && (
              <button
                type="button"
                className="parcel-bg-import-dismiss-btn"
                onClick={dismissPanel}
                aria-label="Dismiss"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Body — hidden when minimized */}
        {!panelMinimized && (
          <div className="parcel-bg-import-body">
            {(isRunning || isDone) && (
              <div className="parcel-bg-progress-track">
                <div
                  className="parcel-bg-progress-fill"
                  style={{ width: `${isDone ? 100 : pct}%` }}
                />
              </div>
            )}
            {isRunning && (
              <div className="parcel-bg-progress-meta">
                <span className="parcel-bg-progress-pct">{pct}%</span>
                <span className="parcel-bg-progress-file">{fileName}</span>
                <button
                  type="button"
                  className="parcel-bg-cancel-btn"
                  onClick={cancelImport}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );

    return createPortal(panel, document.body);
  };

  return (
    <>
      <header
        className="tnav"
        role="navigation"
        aria-label="Primary navigation"
      >
        <div className="tnav-inner">
          {/* ── Logo ── */}
          <button
            type="button"
            className="tnav-brand"
            onClick={() => navigate("/dashboard")}
            aria-label="Go to dashboard"
          >
            <img
              src="/images/logo.png"
              alt="AVID"
              className="tnav-brand-logo"
            />
          </button>

          {/* ── Divider ── */}
          <span className="tnav-divider" aria-hidden="true" />

          {/* ── Nav links ── */}
          <nav className="tnav-nav" aria-label="Main menu">
            <ul className="tnav-list">
              {menuItems.map((item) => (
                <li key={item.href}>
                  <button
                    type="button"
                    className={`tnav-link ${isActive(item.href) ? "tnav-link--active" : ""}`}
                    onClick={() => navigate(item.href)}
                  >
                    <span className="tnav-link-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="tnav-link-label">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* ── Spacer ── */}
          <span className="tnav-spacer" />

          {/* ── Notifications ── */}
          <NotificationCenter />

          {/* ── Profile dropdown ── */}
          <div className="tnav-profile-wrap" ref={profileRef}>
            <button
              type="button"
              className={`tnav-profile-trigger ${profileOpen ? "is-open" : ""} ${isActive("/profile") ? "tnav-profile-trigger--active" : ""}`}
              onClick={() => setProfileOpen((p) => !p)}
              aria-haspopup="true"
              aria-expanded={profileOpen}
            >
              <span
                className="tnav-avatar"
                style={{
                  backgroundImage: profilePictureUrl
                    ? `url(${profilePictureUrl})`
                    : undefined,
                }}
              >
                {!profilePictureUrl && (
                  <span className="tnav-avatar-initials">{getInitials()}</span>
                )}
              </span>
              <span className="tnav-profile-meta">
                <span className="tnav-profile-name">
                  {displayName || user?.email || "Administrator"}
                </span>
                <span className="tnav-profile-role">Admin</span>
              </span>
              <FaChevronDown
                className={`tnav-chevron ${profileOpen ? "rotated" : ""}`}
                aria-hidden="true"
              />
            </button>

            {profileOpen && (
              <div className="tnav-dropdown" role="menu">
                <div className="tnav-dropdown-header">
                  <span className="tnav-dropdown-email">{user?.email}</span>
                </div>
                <div className="tnav-dropdown-body">
                  <button
                    type="button"
                    className="tnav-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      navigate("/profile");
                      setProfileOpen(false);
                    }}
                  >
                    <FaPen className="tnav-dropdown-item-icon" />
                    Edit Profile
                  </button>
                  <button
                    type="button"
                    className="tnav-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      navigate("/settings");
                      setProfileOpen(false);
                    }}
                  >
                    <FaCog className="tnav-dropdown-item-icon" />
                    Settings
                  </button>
                  <div className="tnav-dropdown-sep" />
                  <button
                    type="button"
                    className="tnav-dropdown-item tnav-dropdown-item--danger"
                    role="menuitem"
                    onClick={() => {
                      openLogoutModal?.();
                      setProfileOpen(false);
                    }}
                  >
                    <FaSignOutAlt className="tnav-dropdown-item-icon" />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Floating background import panel — persists across all pages */}
      {renderBgImportPanel()}
    </>
  );
}
