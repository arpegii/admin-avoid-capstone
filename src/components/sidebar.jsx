import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FaChartBar,
  FaMotorcycle,
  FaBox,
  FaCog,
  FaSignOutAlt,
  FaPen,
} from "react-icons/fa";
import { useAuth } from "../contexts/AuthContext";
import { supabaseClient } from "../App";

export default function Sidebar() {
  const { user, openLogoutModal } = useAuth();
  const [profilePictureUrl, setProfilePictureUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 900 : false,
  );
  const [isCollapsed, setIsCollapsed] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function findAdminProfileData() {
      const candidates = [
        { column: "id", value: user?.id },
        { column: "email", value: user?.email },
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
          console.error(`Failed sidebar admin_profile lookup by ${candidate.column}:`, error);
          continue;
        }

        if (Array.isArray(data) && data.length > 0) {
          return data[0] || null;
        }
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

      const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
        .from("admin_profile")
        .createSignedUrl(rawValue, 60 * 60);

      if (signedUrlError) {
        console.error("Failed to resolve sidebar profile picture URL:", signedUrlError);
        setProfilePictureUrl("");
        return;
      }

      setProfilePictureUrl(signedUrlData?.signedUrl || "");
    }

    loadProfilePicture();

    const handleProfilePictureUpdated = () => {
      loadProfilePicture();
    };

    const handleStorageChange = (event) => {
      if (event.key === "profilePictureUpdatedAt") {
        loadProfilePicture();
      }
    };

    window.addEventListener("profile-picture-updated", handleProfilePictureUpdated);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("profile-picture-updated", handleProfilePictureUpdated);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [user?.id, user?.email]);

  useEffect(() => {
    const handleResize = () => {
      const mobileViewport = window.innerWidth <= 900;
      setIsMobile(mobileViewport);
      if (mobileViewport) {
        setIsCollapsed(true);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const handleSidebarToggle = () => {
    if (isMobile) return;
    setIsCollapsed((prev) => !prev);
  };

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
  const isSettingsPage = location.pathname === "/settings";

  const menuItems = [
    { label: "Dashboard", href: "/dashboard", icon: <FaChartBar /> },
    { label: "Rider Management", href: "/riders", icon: <FaMotorcycle /> },
    { label: "Parcel Management", href: "/parcels", icon: <FaBox /> },
  ];

  const handleLogoutClick = () => {
    openLogoutModal?.();
  };

  const userActions = [
    { label: "Settings", href: "/settings", icon: <FaCog /> },
    { 
      label: "Log out", 
      onClick: handleLogoutClick,
      icon: <FaSignOutAlt /> 
    },
  ];

  return (
    <div
      className={`sidebar ${isCollapsed ? "collapsed" : ""} shadow-2xl`}
    >
      <button
        type="button"
        className="sidebar-logo sidebar-logo-toggle rounded-2xl transition duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        onClick={handleSidebarToggle}
        disabled={isMobile}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <img src="/images/logo.png" alt="Logo" />
      </button>

      {/* Main Navigation */}
      <ul className="nav-menu space-y-1">
        {menuItems.map((item) => (
          <li
            key={item.href}
            className={`nav-item ${isActive(item.href) ? "active" : ""} border border-transparent backdrop-blur-sm`}
            onClick={() => navigate(item.href)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </li>
        ))}
      </ul>

      {/* Logged-in User */}
      <div className="user-profile">
        <div
          className={`user-info ${isActive("/profile") ? "active" : ""} border border-transparent`}
          onClick={() => navigate("/profile")}
        >
          <div className="user-avatar-wrapper">
            <div
              className="user-avatar"
              style={{
                backgroundImage: profilePictureUrl ? `url(${profilePictureUrl})` : "",
                display: profilePictureUrl ? undefined : "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {!profilePictureUrl && getInitials()}
            </div>
            <button
              type="button"
              className="avatar-pen ring-2 ring-white/30"
              onClick={(e) => {
                e.stopPropagation();
                navigate("/profile");
              }}
              aria-label="Edit profile picture"
            >
              <FaPen />
            </button>
          </div>

          <div className="user-details">
            <div className="user-name">{displayName || user?.email || "Administrator"}</div>
            <div className="user-role">Administrator</div>
          </div>
        </div>

        {/* User Actions */}
        <ul className="user-actions mt-2 space-y-1">
          {userActions.map((action, idx) => (
            <li
              key={idx}
              className={`nav-item user-action-item ${
                action.label === "Settings" && isSettingsPage ? "active" : ""
              } border border-transparent`}
              onClick={(e) => {
                e.stopPropagation();
                if (action.onClick) {
                  action.onClick();
                } else if (action.href) {
                  navigate(action.href);
                }
              }}
            >
              <span className="nav-icon">{action.icon}</span>
              <span className="nav-label">{action.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
