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
  const [isCollapsed, setIsCollapsed] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  // Debug: Check if openLogoutModal exists
  useEffect(() => {
    console.log("=== SIDEBAR MOUNTED ===");
    console.log("user:", user);
    console.log("openLogoutModal:", openLogoutModal);
    console.log("openLogoutModal type:", typeof openLogoutModal);
  }, [user, openLogoutModal]);

  useEffect(() => {
    async function findAdminProfilePicturePath() {
      const candidates = [
        { column: "id", value: user?.id },
        { column: "email", value: user?.email },
      ].filter((candidate) => candidate.value);

      for (const candidate of candidates) {
        const { data, error } = await supabaseClient
          .from("admin_profile")
          .select("profile_picture")
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
          return data[0]?.profile_picture || "";
        }
      }

      return "";
    }

    async function loadProfilePicture() {
      if (!user?.id && !user?.email) {
        setProfilePictureUrl("");
        return;
      }

      const rawValue = await findAdminProfilePicturePath();
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

  const getInitials = () => {
    if (profilePictureUrl) return "";
    if (!user?.email) return "A";
    const parts = user.email.split(/[@._-]/).filter(Boolean);
    return (
      parts.length >= 2 ? parts[0][0] + parts[1][0] : user.email[0]
    ).toUpperCase();
  };

  const isActive = (href) => location.pathname === href;

  const menuItems = [
    { label: "Dashboard", href: "/dashboard", icon: <FaChartBar /> },
    { label: "Rider Management", href: "/riders", icon: <FaMotorcycle /> },
    { label: "Parcel Management", href: "/parcels", icon: <FaBox /> },
  ];

  // Define logout handler separately for debugging
  const handleLogoutClick = () => {
    console.log("=== LOGOUT CLICKED ===");
    console.log("openLogoutModal exists?", !!openLogoutModal);
    console.log("Calling openLogoutModal...");
    
    if (openLogoutModal) {
      openLogoutModal();
      console.log("openLogoutModal called successfully");
    } else {
      console.error("openLogoutModal is undefined!");
    }
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
    <div className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-logo sidebar-logo-toggle"
        onClick={() => setIsCollapsed((prev) => !prev)}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <img src="/images/logo.png" alt="Logo" />
      </button>

      {/* Main Navigation */}
      <ul className="nav-menu">
        {menuItems.map((item) => (
          <li
            key={item.href}
            className={`nav-item ${isActive(item.href) ? "active" : ""}`}
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
          className={`user-info ${isActive("/profile") ? "active" : ""}`}
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
              className="avatar-pen"
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
            <div className="user-name">{user?.email || "Administrator"}</div>
            <div className="user-role">Administrator</div>
          </div>
        </div>

        {/* User Actions */}
        <ul className="user-actions">
          {userActions.map((action, idx) => (
            <li
              key={idx}
              className={`nav-item ${
                action.href && isActive(action.href) ? "active" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                console.log("=== USER ACTION CLICKED ===");
                console.log("Action label:", action.label);
                console.log("Action onClick:", action.onClick);
                console.log("Action href:", action.href);
                
                if (action.onClick) {
                  console.log("Calling action.onClick()");
                  action.onClick();
                } else if (action.href) {
                  console.log("Navigating to:", action.href);
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
