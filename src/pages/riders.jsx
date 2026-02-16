import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/riders.css";
import "../styles/global.css";
import PageSpinner from "../components/PageSpinner";

const OPENWEATHER_API_KEY = "792874a9880224b30b884c44090d0f05";
const RIDER_DELIVERY_QUOTA = 150;

const normalizeCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
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
  const hour = String(hour12).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} ${hour}:${minute} ${meridiem}`;
};

const getRiderDisplayName = (rider) => {
  const fullName = [rider?.fname, rider?.lname].filter(Boolean).join(" ").trim();
  return fullName || rider?.username || "Unknown Rider";
};

export default function Riders() {
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

  useEffect(() => {
    if (!showCreateSuccessModal) return undefined;
    const timerId = setTimeout(() => {
      setShowCreateSuccessModal(false);
    }, 2400);
    return () => clearTimeout(timerId);
  }, [showCreateSuccessModal]);

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
  const deliveredForQuota = Number(selectedRiderInfo?.deliveredParcels);
  const quotaPercent = Number.isFinite(deliveredForQuota)
    ? Math.min(
        Math.round((deliveredForQuota / RIDER_DELIVERY_QUOTA) * 100),
        100,
      )
    : 0;
  const quotaStrokeDasharray = `${quotaPercent * 3.02} 302`;
  const joinDateToday = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);
  const trackingRiderDisplayName = useMemo(() => {
    const trackedRider = riders.find((rider) => rider.username === trackingRider);
    return getRiderDisplayName(trackedRider || { username: trackingRider });
  }, [riders, trackingRider]);
  const selectedRiderDisplayName = useMemo(
    () => getRiderDisplayName(selectedRiderInfo),
    [selectedRiderInfo],
  );

  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const currentMarkerRef = useRef(null);
  const allMapRef = useRef(null);
  const allLeafletMapRef = useRef(null);
  const allMarkersRef = useRef([]);
  const weatherOverlayRef = useRef(null);
  const floodOverlayRef = useRef(null);
  const fullMapRef = useRef(null);
  const fullLeafletMapRef = useRef(null);
  const fullMarkersRef = useRef([]);
  const fullWeatherOverlayRef = useRef(null);
  const fullFloodOverlayRef = useRef(null);
  const hasAutoCenteredAllMapRef = useRef(false);
  const hasAutoCenteredFullMapRef = useRef(false);
  const openInfoModalRef = useRef(null);

  const openRiderInfoFromPopup = useCallback((riderName) => {
    const normalizedRiderName = String(riderName || "").trim();
    if (!normalizedRiderName) return;

    openInfoModalRef.current?.(normalizedRiderName);
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

      const riderNameFromButton = popupButton?.getAttribute("data-rider-name");
      const riderNameFromCard = popupCard?.getAttribute("data-rider-name");
      const riderName = (riderNameFromButton || riderNameFromCard || "").trim();
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
        "user_id, username, fname, lname, status, last_seen_lat, last_seen_lng",
      );

    if (error) {
      throw error;
    }

    return (data || []).map((rider) => ({
      ...rider,
      lat: normalizeCoordinate(rider.last_seen_lat),
      lng: normalizeCoordinate(rider.last_seen_lng),
    }));
  }, []);

  const fetchRiderMetrics = useCallback(async (ridersData = []) => {
    const riderIds = (ridersData || [])
      .map((rider) => rider.user_id)
      .filter(Boolean);

    if (riderIds.length === 0) {
      return (ridersData || []).map((rider) => ({
        ...rider,
        deliveredParcels: 0,
        ongoingParcels: 0,
        delayedParcels: 0,
      }));
    }

    const { data: parcelsData, error: parcelsError } = await supabaseClient
      .from("parcels")
      .select("assigned_rider_id, status, attempt1_status")
      .in("assigned_rider_id", riderIds);

    if (parcelsError) {
      throw parcelsError;
    }

    const statsByRiderId = new Map();
    riderIds.forEach((id) => {
      statsByRiderId.set(id, {
        deliveredParcels: 0,
        ongoingParcels: 0,
        delayedParcels: 0,
      });
    });

    (parcelsData || []).forEach((parcel) => {
      const riderId = parcel?.assigned_rider_id;
      if (!riderId || !statsByRiderId.has(riderId)) return;
      const stats = statsByRiderId.get(riderId);
      const normalizedStatus = parcel?.status?.toLowerCase?.() || "";
      const normalizedAttempt1 = parcel?.attempt1_status?.toLowerCase?.() || "";

      if (normalizedStatus === "successfully delivered") {
        stats.deliveredParcels += 1;
      }
      if (normalizedStatus === "on-going") {
        stats.ongoingParcels += 1;
      }
      if (normalizedAttempt1 === "failed") {
        stats.delayedParcels += 1;
      }
    });

    return (ridersData || []).map((rider) => ({
      ...rider,
      ...(statsByRiderId.get(rider.user_id) || {
        deliveredParcels: 0,
        ongoingParcels: 0,
        delayedParcels: 0,
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
    const displayName = getRiderDisplayName(selected || { username: riderName });
    const safeDisplayName = escapeHtml(displayName);
    const normalizedStatus = selected?.status?.toLowerCase() || "";
    const isOnline = ["online", "active"].includes(normalizedStatus);
    const statusClass = isOnline
      ? "is-online"
      : ["offline", "inactive"].includes(normalizedStatus)
        ? "is-offline"
        : "is-default";
    const statusLabel = selected?.status || "Unknown";
    return `
      <div class="rider-location-popup ${statusClass}" data-rider-name="${safeName}">
        <div class="rider-location-popup-head">
          <span class="rider-location-dot" aria-hidden="true"></span>
          <span class="rider-location-popup-label">Rider location</span>
        </div>
        <button type="button" class="rider-location-popup-btn" data-rider-name="${safeName}">${safeDisplayName}</button>
        <span class="rider-location-status">${escapeHtml(statusLabel)}</span>
        <span class="rider-location-popup-hint">Tap name to view rider details</span>
      </div>
    `;
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
        if (domEvent) {
          domEvent.preventDefault?.();
          domEvent.stopPropagation?.();
        }
        const clickedRiderName =
          button?.getAttribute?.("data-rider-name") || riderName;
        openRiderInfoFromPopup(clickedRiderName);
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

      if (!currentRes.ok || !forecastRes.ok) {
        throw new Error("Failed to load weather information.");
      }

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

      const nextForecast = (forecast?.list || []).slice(0, 4).map((item) => ({
        time: new Date(item.dt * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        temp: Math.round(item?.main?.temp ?? 0),
        icon: item?.weather?.[0]?.icon || null,
      }));
      setWeatherForecast(nextForecast);
    } catch (error) {
      console.error("Failed to fetch weather data:", error);
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

      if (!currentRes.ok || !forecastRes.ok) {
        throw new Error("Failed to load weather information.");
      }

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

      const nextForecast = (forecast?.list || []).slice(0, 4).map((item) => ({
        time: new Date(item.dt * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        temp: Math.round(item?.main?.temp ?? 0),
        icon: item?.weather?.[0]?.icon || null,
      }));
      setFullWeatherForecast(nextForecast);
    } catch (error) {
      console.error("Failed to fetch fullscreen weather data:", error);
      setFullWeatherError("Unable to load weather data.");
      setFullWeatherCurrent(null);
      setFullWeatherForecast([]);
    } finally {
      setFullWeatherLoading(false);
    }
  };

  const riderLocations = useMemo(
    () => riders.filter((rider) => rider.lat !== null && rider.lng !== null),
    [riders],
  );

  // Load riders on mount
  useEffect(() => {
    let isMounted = true;

    async function loadRiders() {
      try {
        const ridersData = await refreshRiders();
        if (isMounted) {
          setRiders(ridersData);
        }
      } catch (error) {
        console.error("Failed to load rider locations:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadRiders();

    const pollingInterval = setInterval(async () => {
      try {
        const ridersData = await refreshRiders();
        if (isMounted) {
          setRiders(ridersData);
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
    if (loading || !allMapRef.current) return;

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

    allMarkersRef.current.forEach((marker) => map.removeLayer(marker));
    allMarkersRef.current = [];

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
    });

    if (!hasAutoCenteredAllMapRef.current && allMarkersRef.current.length > 1) {
      const bounds = L.featureGroup(allMarkersRef.current).getBounds().pad(0.2);
      map.fitBounds(bounds);
      hasAutoCenteredAllMapRef.current = true;
    } else if (
      !hasAutoCenteredAllMapRef.current &&
      allMarkersRef.current.length === 1
    ) {
      const first = allMarkersRef.current[0].getLatLng();
      map.setView([first.lat, first.lng], 14);
      hasAutoCenteredAllMapRef.current = true;
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, riderLocations]);

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
      if (fullLeafletMapRef.current) {
        fullLeafletMapRef.current.remove();
        fullLeafletMapRef.current = null;
      }
      fullMarkersRef.current = [];
      hasAutoCenteredFullMapRef.current = false;
      return;
    }

    if (!fullMapRef.current) return;

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

    fullMarkersRef.current.forEach((marker) => map.removeLayer(marker));
    fullMarkersRef.current = [];

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
    });

    if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length > 1
    ) {
      const bounds = L.featureGroup(fullMarkersRef.current)
        .getBounds()
        .pad(0.2);
      map.fitBounds(bounds);
      hasAutoCenteredFullMapRef.current = true;
    } else if (
      !hasAutoCenteredFullMapRef.current &&
      fullMarkersRef.current.length === 1
    ) {
      const first = fullMarkersRef.current[0].getLatLng();
      map.setView([first.lat, first.lng], 14);
      hasAutoCenteredFullMapRef.current = true;
    }

    if (fullWeatherOverlayRef.current) {
      map.removeLayer(fullWeatherOverlayRef.current);
      fullWeatherOverlayRef.current = null;
    }
    if (fullFloodOverlayRef.current) {
      map.removeLayer(fullFloodOverlayRef.current);
      fullFloodOverlayRef.current = null;
    }

    if (activeMapLayer === "weather") {
      fullWeatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      fullWeatherOverlayRef.current.on("tileerror", (event) => {
        console.error(
          "OpenWeather tile failed to load (fullscreen map):",
          event,
        );
      });
      fullWeatherOverlayRef.current.addTo(map);
    } else if (activeMapLayer === "flood") {
      fullFloodOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      fullFloodOverlayRef.current.on("tileerror", (event) => {
        console.error("Flood tile failed to load (fullscreen map):", event);
      });
      fullFloodOverlayRef.current.addTo(map);
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMapModalOpen, riderLocations, activeMapLayer]);

  useEffect(() => {
    if (
      !trackModalOpen ||
      !trackingRider ||
      !currentMarkerRef.current ||
      !leafletMapRef.current
    )
      return;

    const selectedRider = riderLocations.find(
      (rider) => rider.username === trackingRider,
    );
    if (!selectedRider) return;

    const nextPosition = [selectedRider.lat, selectedRider.lng];
    currentMarkerRef.current.setLatLng(nextPosition);
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

    if (activeMapLayer === "weather") {
      weatherOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      weatherOverlayRef.current.on("tileerror", (event) => {
        console.error("OpenWeather tile failed to load:", event);
      });
      weatherOverlayRef.current.addTo(map);
      weatherOverlayRef.current.bringToFront();
    } else if (activeMapLayer === "flood") {
      floodOverlayRef.current = L.tileLayer(
        `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
        {
          maxZoom: 19,
          opacity: 0.9,
        },
      );
      floodOverlayRef.current.on("tileerror", (event) => {
        console.error("Flood tile failed to load:", event);
      });
      floodOverlayRef.current.addTo(map);
      floodOverlayRef.current.bringToFront();
    }
  }, [activeMapLayer, loading, riderLocations.length]);

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
      const center = map.getCenter();
      fetchWeatherForLocation(center.lat, center.lng);
    };

    requestWeather();
    map.on("moveend", requestWeather);

    return () => {
      map.off("moveend", requestWeather);
    };
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
      const center = map.getCenter();
      fetchFullWeatherForLocation(center.lat, center.lng);
    };

    requestWeather();
    map.on("moveend", requestWeather);

    return () => {
      map.off("moveend", requestWeather);
    };
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
      if (fullWeatherOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullWeatherOverlayRef.current);
        fullWeatherOverlayRef.current = null;
      }
      if (fullFloodOverlayRef.current && fullLeafletMapRef.current) {
        fullLeafletMapRef.current.removeLayer(fullFloodOverlayRef.current);
        fullFloodOverlayRef.current = null;
      }
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

    // Remove previous map if exists
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      currentMarkerRef.current = null;
    }

    // Wait until modal renders fully
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

      // Force Leaflet to render correctly
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
      // Step 1: Fetch rider information including their UUID
      const { data: riderData, error: riderError } = await supabaseClient
        .from("users")
        .select(
          "user_id, username, email, fname, lname, mname, gender, age, status, pnumber, profile_url",
        )
        .eq("username", riderName)
        .maybeSingle();

      if (riderError) {
        throw riderError;
      }

      if (!riderData) {
        setInfoError("Rider information not found.");
        return;
      }


      // Step 2: Fetch parcels using the rider's UUID
      const { data: parcelsData, error: parcelsError } = await supabaseClient
        .from("parcels")
        .select("status, assigned_rider_id")
        .eq("assigned_rider_id", riderData.user_id);

      setLoadingViolationLogs(true);
      const { data: violationData, error: violationError } = await supabaseClient
        .from("violation_logs")
        .select("violation, date, lat, lng, name")
        .eq("user_id", riderData.user_id)
        .order("date", { ascending: false });
      setLoadingViolationLogs(false);

      if (parcelsError) {
        console.error("Failed to fetch parcels:", parcelsError);
        // Continue with rider data even if parcels fail
      }
      if (violationError) {
        console.error("Failed to fetch rider violation logs:", violationError);
        setViolationLogsError("Failed to load rider violation logs.");
      } else {
        setRiderViolationLogs(violationData || []);
      }


      // Step 3: Calculate parcel counts based on status
      const parcels = parcelsData || [];

      const deliveredParcels = parcels.filter(
        (p) => p.status?.toLowerCase() === "successfully delivered",
      ).length;

      const ongoingParcels = parcels.filter(
        (p) => p.status?.toLowerCase() === "on-going",
      ).length;

      const cancelledParcels = parcels.filter(
        (p) => p.status?.toLowerCase() === "cancelled",
      ).length;

      setSelectedRiderInfo({
        ...riderData,
        deliveredParcels,
        ongoingParcels,
        cancelledParcels,
        quotaTarget: RIDER_DELIVERY_QUOTA,
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

      if (usersUpdateError) {
        throw usersUpdateError;
      }

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

        if (usersInsertError) {
          throw usersInsertError;
        }
      }

      const ridersData = await refreshRiders();
      if (ridersData) {
        setRiders(ridersData);
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

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar currentPage="riders.html" />

      <div className="riders-page bg-gradient-to-br from-red-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {loading ? (
          <PageSpinner fullScreen label="Loading riders..." />
        ) : (
          <div className="riders-content-shell p-6">
            <div className="rider-header-row mb-5">
              <h1 className="page-title mb-6">Rider Management</h1>
              <button
                type="button"
                className="add-rider-btn rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110"
                onClick={openCreateModal}
              >
                Add Rider
              </button>
            </div>
            <div className="riders-split-layout">
              <div className="riders-table-wrapper rounded-2xl bg-white shadow-2xl shadow-slate-900/12 dark:bg-slate-900 dark:shadow-black/45">
                <table className="rider-table">
                  <thead>
                    <tr>
                      <th className="col-index">No.</th>
                      <th className="col-name">Name</th>
                      <th className="col-metric">Delivered</th>
                      <th className="col-metric">Ongoing</th>
                      <th className="col-metric">Delayed</th>
                      <th className="col-action">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riders.map((rider, idx) => (
                      <tr key={rider.username}>
                        <td className="col-index">{idx + 1}</td>
                        <td className="col-name">
                          <button
                            type="button"
                            className="rider-name-btn"
                            onClick={() => openInfoModal(rider.username)}
                          >
                            {getRiderDisplayName(rider)}
                          </button>
                        </td>
                        <td className="col-metric">
                          {rider.deliveredParcels ?? 0}
                        </td>
                        <td className="col-metric">{rider.ongoingParcels ?? 0}</td>
                        <td className="col-metric">{rider.delayedParcels ?? 0}</td>
                        <td className="col-action">
                          <button
                            className="track-btn rounded-lg bg-gradient-to-r from-red-600 to-red-800 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:brightness-110"
                            onClick={() => openTrackModal(rider.username)}
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rider-map-card rounded-2xl bg-white shadow-2xl shadow-slate-900/12 dark:bg-slate-900 dark:shadow-black/45">
                <div className="rider-map-header">
                  <div className="rider-map-header-top">
                    <h2>Live Rider Map</h2>
                    <div className="rider-weather-toggle">
                      <div className="rider-layer-toggle-row">
                        <span>Weather</span>
                        <label
                          className="rider-toggle-switch"
                          aria-label="Toggle weather layer"
                        >
                          <input
                            type="checkbox"
                            checked={activeMapLayer === "weather"}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setActiveMapLayer("weather");
                                setShowWeatherPanel(false);
                                setShowFullWeatherPanel(false);
                              } else {
                                setActiveMapLayer(null);
                                setShowWeatherPanel(false);
                                setShowFullWeatherPanel(false);
                              }
                            }}
                          />
                          <span className="rider-toggle-slider" />
                        </label>
                      </div>
                      <div className="rider-layer-toggle-row">
                        <span>Flood</span>
                        <label
                          className="rider-toggle-switch"
                          aria-label="Toggle flood layer"
                        >
                          <input
                            type="checkbox"
                            checked={activeMapLayer === "flood"}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setActiveMapLayer("flood");
                              } else {
                                setActiveMapLayer(null);
                              }
                              setShowWeatherPanel(false);
                              setShowFullWeatherPanel(false);
                            }}
                          />
                          <span className="rider-toggle-slider" />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="rider-map-size-btn rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
                        onClick={() => setFullMapModalOpen(true)}
                      >
                        Open Fullscreen Map
                      </button>
                    </div>
                  </div>
                  <p>Showing all rider positions on the page map.</p>
                </div>
                <div className="rider-map-body">
                  <div className="rider-map-stack">
                    <div ref={allMapRef} className="rider-live-map" />
                    {activeMapLayer === "weather" && (
                      <button
                        type="button"
                        className={`weather-panel-toggle-btn ${showWeatherPanel ? "open" : ""}`}
                        onClick={() => setShowWeatherPanel((prev) => !prev)}
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
                      <div className="weather-forecast-card">
                        {weatherLoading ? (
                          <p className="weather-forecast-loading">
                            Loading weather...
                          </p>
                        ) : weatherError ? (
                          <p className="weather-forecast-error">
                            {weatherError}
                          </p>
                        ) : weatherCurrent ? (
                          <>
                            <div className="weather-now">
                              <div className="weather-now-main">
                                <strong>{weatherCurrent.city}</strong>
                                <span className="weather-desc">
                                  {weatherCurrent.description}
                                </span>
                              </div>
                              <div className="weather-temp-block">
                                {weatherCurrent.icon && (
                                  <img
                                    src={`https://openweathermap.org/img/wn/${weatherCurrent.icon}@2x.png`}
                                    alt={weatherCurrent.description}
                                  />
                                )}
                                <span>{weatherCurrent.temp}°C</span>
                              </div>
                            </div>
                            <div className="weather-metrics">
                              <span>Feels {weatherCurrent.feelsLike}°C</span>
                              <span>Humidity {weatherCurrent.humidity}%</span>
                              <span>Wind {weatherCurrent.wind} m/s</span>
                            </div>
                            <div className="weather-forecast-row">
                              {weatherForecast.map((item) => (
                                <div
                                  key={`${item.time}-${item.temp}`}
                                  className="weather-forecast-chip"
                                >
                                  <span>{item.time}</span>
                                  {item.icon && (
                                    <img
                                      src={`https://openweathermap.org/img/wn/${item.icon}.png`}
                                      alt="forecast icon"
                                    />
                                  )}
                                  <strong>{item.temp}°</strong>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="weather-forecast-loading">
                            Weather data unavailable.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {fullMapModalOpen && (
        <div
          className="riders-modal-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setFullMapModalOpen(false)}
        >
          <div
            className="riders-modal-content rider-full-map-modal rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="riders-modal-header rider-full-map-header">
              <h2>Live Rider Map</h2>
              <div className="rider-full-map-controls">
                <div className="rider-layer-toggle-row">
                  <span>Weather</span>
                  <label
                    className="rider-toggle-switch"
                    aria-label="Toggle weather layer (fullscreen)"
                  >
                    <input
                      type="checkbox"
                      checked={activeMapLayer === "weather"}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setActiveMapLayer("weather");
                        } else {
                          setActiveMapLayer(null);
                        }
                        setShowFullWeatherPanel(false);
                      }}
                    />
                    <span className="rider-toggle-slider" />
                  </label>
                </div>
                <div className="rider-layer-toggle-row">
                  <span>Flood</span>
                  <label
                    className="rider-toggle-switch"
                    aria-label="Toggle flood layer (fullscreen)"
                  >
                    <input
                      type="checkbox"
                      checked={activeMapLayer === "flood"}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setActiveMapLayer("flood");
                        } else {
                          setActiveMapLayer(null);
                        }
                        setShowFullWeatherPanel(false);
                      }}
                    />
                    <span className="rider-toggle-slider" />
                  </label>
                </div>
              </div>
              <button
                type="button"
                className="rider-full-map-close rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
                onClick={() => setFullMapModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="rider-full-map-body">
              <div className="rider-map-stack rider-full-map-stack">
                <div ref={fullMapRef} className="rider-full-map-canvas" />
                {activeMapLayer === "weather" && (
                  <button
                    type="button"
                    className={`weather-panel-toggle-btn ${showFullWeatherPanel ? "open" : ""}`}
                    onClick={() => setShowFullWeatherPanel((prev) => !prev)}
                    aria-label={
                      showFullWeatherPanel
                        ? "Hide weather panel"
                        : "Show weather panel"
                    }
                  >
                    <span aria-hidden="true">☁</span>
                  </button>
                )}
                {activeMapLayer === "weather" && showFullWeatherPanel && (
                  <div className="weather-forecast-card">
                    {fullWeatherLoading ? (
                      <p className="weather-forecast-loading">
                        Loading weather...
                      </p>
                    ) : fullWeatherError ? (
                      <p className="weather-forecast-error">
                        {fullWeatherError}
                      </p>
                    ) : fullWeatherCurrent ? (
                      <>
                        <div className="weather-now">
                          <div className="weather-now-main">
                            <strong>{fullWeatherCurrent.city}</strong>
                            <span className="weather-desc">
                              {fullWeatherCurrent.description}
                            </span>
                          </div>
                          <div className="weather-temp-block">
                            {fullWeatherCurrent.icon && (
                              <img
                                src={`https://openweathermap.org/img/wn/${fullWeatherCurrent.icon}@2x.png`}
                                alt={fullWeatherCurrent.description}
                              />
                            )}
                            <span>{fullWeatherCurrent.temp}°C</span>
                          </div>
                        </div>
                        <div className="weather-metrics">
                          <span>Feels {fullWeatherCurrent.feelsLike}°C</span>
                          <span>Humidity {fullWeatherCurrent.humidity}%</span>
                          <span>Wind {fullWeatherCurrent.wind} m/s</span>
                        </div>
                        <div className="weather-forecast-row">
                          {fullWeatherForecast.map((item) => (
                            <div
                              key={`${item.time}-${item.temp}`}
                              className="weather-forecast-chip"
                            >
                              <span>{item.time}</span>
                              {item.icon && (
                                <img
                                  src={`https://openweathermap.org/img/wn/${item.icon}.png`}
                                  alt="forecast icon"
                                />
                              )}
                              <strong>{item.temp}°</strong>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="weather-forecast-loading">
                        Weather data unavailable.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
                Tracking the location of: <strong>{trackingRiderDisplayName}</strong>
              </p>
              {loadingMap && (
                <div
                  className="track-rider-loading"
                  role="status"
                  aria-live="polite"
                  aria-label="Loading rider map"
                >
                  <div className="track-loader-shell">
                    <div className="track-loader-spinner" aria-hidden="true">
                      <span className="track-loader-ring" />
                      <span className="track-loader-core" />
                    </div>
                    <p className="track-loader-title">Preparing live location map</p>
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
                style={{
                  display: loadingMap ? "none" : "block",
                }}
              />
            </div>
          </div>
        </div>
      )}

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
            style={{ width: 620, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Rider Information</h2>
            </div>

            <div className="riders-modal-body rider-info-body">
              {loadingInfo ? (
                <PageSpinner label="Loading rider information..." />
              ) : infoError ? (
                <p className="rider-info-error">{infoError}</p>
              ) : (
                <div className="rider-info-shell">
                  <div className="rider-info-hero">
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
                          {[
                            selectedRiderInfo?.fname,
                            selectedRiderInfo?.mname,
                            selectedRiderInfo?.lname,
                          ]
                            .filter(Boolean)
                            .join(" ") || "No full name available"}
                        </p>
                        <div className="rider-status-row">
                          {(() => {
                            const normalizedStatus =
                              selectedRiderInfo?.status?.toLowerCase() || "";
                            const statusClass = ["online", "active"].includes(
                              normalizedStatus,
                            )
                              ? "is-online"
                              : ["offline", "inactive"].includes(
                                    normalizedStatus,
                                  )
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
                            onClick={() => setPerformanceModalOpen(true)}
                          >
                            Performance
                          </button>
                          <button
                            type="button"
                            className="rider-performance-btn rider-violations-btn"
                            onClick={() => setViolationLogsModalOpen(true)}
                          >
                            Violation Logs
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rider-info-grid">
                    <div className="rider-info-item">
                      <span>Email</span>
                      <strong>{selectedRiderInfo?.email || "-"}</strong>
                    </div>
                    <div className="rider-info-item">
                      <span>Phone Number</span>
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
                    <div className="rider-info-item">
                      <span>Status</span>
                      <strong>{selectedRiderInfo?.status || "-"}</strong>
                    </div>
                  </div>
                  {selectedRiderInfo?.profile_url && (
                    <p className="rider-info-photo-hint">
                      Tip: Click the profile photo to view it larger.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
            onClick={(event) => event.stopPropagation()}
            style={{ width: 620, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>{selectedRiderDisplayName} Performance</h2>
            </div>
            <div className="riders-modal-body rider-performance-body">
              <div className="rider-performance-grid">
                <div className="rider-performance-card rider-performance-quota">
                  <span>Quota Progress</span>
                  <div className="rider-performance-ring-wrap">
                    <svg
                      viewBox="0 0 120 120"
                      className="rider-performance-ring"
                    >
                      <circle
                        className="rider-performance-ring-bg"
                        cx="60"
                        cy="60"
                        r="48"
                      />
                      <circle
                        className="rider-performance-ring-fg"
                        cx="60"
                        cy="60"
                        r="48"
                        strokeDasharray={quotaStrokeDasharray}
                      />
                    </svg>
                    <strong className="rider-performance-ring-label">
                      {quotaPercent}%
                    </strong>
                  </div>
                  <small className="rider-performance-ring-note">
                    {selectedRiderInfo.deliveredParcels ?? 0}/
                    {selectedRiderInfo.quotaTarget ?? RIDER_DELIVERY_QUOTA}{" "}
                    delivered
                  </small>
                </div>
                <div className="rider-performance-card rider-performance-delivered">
                  <span>Delivered Parcels</span>
                  <strong>{selectedRiderInfo.deliveredParcels ?? 0}</strong>
                </div>
                <div className="rider-performance-card rider-performance-ongoing">
                  <span>Ongoing Parcels</span>
                  <strong>{selectedRiderInfo.ongoingParcels ?? 0}</strong>
                </div>
                <div className="rider-performance-card rider-performance-cancelled">
                  <span>Cancelled Parcels</span>
                  <strong>{selectedRiderInfo.cancelledParcels ?? 0}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
            style={{ width: 520, maxWidth: "92%" }}
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
            onClick={(event) => event.stopPropagation()}
            style={{ width: 760, maxWidth: "96%" }}
          >
            <div className="riders-modal-header">
              <h2>{selectedRiderDisplayName} Violation Logs</h2>
            </div>
            <div className="riders-modal-body rider-violations-body">
              {loadingViolationLogs ? (
                <PageSpinner label="Loading violation logs..." />
              ) : violationLogsError ? (
                <p className="rider-info-error">{violationLogsError}</p>
              ) : riderViolationLogs.length === 0 ? (
                <p className="rider-violations-empty">
                  No violation logs found for this rider.
                </p>
              ) : (
                <div className="rider-violations-list">
                  {riderViolationLogs.map((log, index) => (
                    <div
                      className="rider-violations-item"
                      key={`${log.date || "no-date"}-${log.violation || "no-violation"}-${index}`}
                    >
                      <div className="rider-violations-fields">
                        <div className="rider-violations-field">
                          <span className="rider-violations-label">Violation Type</span>
                          <strong>{log.violation || "Unknown violation"}</strong>
                        </div>
                        <div className="rider-violations-field">
                          <span className="rider-violations-label">Date</span>
                          <strong>{formatViolationLogDate(log.date)}</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
            className="riders-modal-content rider-create-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 560, maxWidth: "92%" }}
          >
            <div className="riders-modal-header">
              <h2>Create Rider Account</h2>
            </div>
            <div className="riders-modal-body rider-create-body">
              <form className="rider-create-form" onSubmit={handleCreateRider}>
                <div className="rider-create-field">
                  <label htmlFor="create-rider-date-join">Date of Join</label>
                  <input
                    id="create-rider-date-join"
                    type="date"
                    value={joinDateToday}
                    readOnly
                    aria-readonly="true"
                  />
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-username">Username</label>
                  <input
                    id="create-rider-username"
                    type="text"
                    value={createUsername}
                    onChange={(event) => setCreateUsername(event.target.value)}
                    placeholder="rider_username"
                    required
                    autoComplete="username"
                    disabled={creatingRider}
                  />
                  <div className="rider-rules-box" aria-live="polite">
                    <p className="rider-rules-title">Username requirements</p>
                    <div className="rider-create-rules">
                      <label
                        className={`rider-rule-item ${usernameLengthValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={usernameLengthValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>At least 3 characters</span>
                      </label>
                      <label
                        className={`rider-rule-item ${usernamePatternValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={usernamePatternValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Letters, numbers, underscore only</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-email">Email</label>
                  <input
                    id="create-rider-email"
                    type="email"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    placeholder="rider@email.com"
                    required
                    autoComplete="email"
                    disabled={creatingRider}
                  />
                </div>

                <div className="rider-create-field">
                  <label htmlFor="create-rider-password">Password</label>
                  <input
                    id="create-rider-password"
                    type="password"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    placeholder="Strong password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    disabled={creatingRider}
                  />
                  <div className="rider-rules-box" aria-live="polite">
                    <p className="rider-rules-title">Password requirements</p>
                    <div className="rider-create-rules">
                      <label
                        className={`rider-rule-item ${passwordLengthValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordLengthValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>At least 8 characters</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordUpperValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordUpperValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has uppercase letter</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordLowerValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordLowerValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has lowercase letter</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordNumberValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordNumberValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has number</span>
                      </label>
                      <label
                        className={`rider-rule-item ${passwordSpecialValid ? "met" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={passwordSpecialValid}
                          readOnly
                          tabIndex={-1}
                        />
                        <span>Has special character</span>
                      </label>
                    </div>
                  </div>
                </div>

                {createRiderError && (
                  <p className="rider-create-error">{createRiderError}</p>
                )}

                <div className="rider-create-actions">
                  <button
                    type="button"
                    className="rider-create-cancel"
                    onClick={closeCreateModal}
                    disabled={creatingRider}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rider-create-submit"
                    disabled={
                      creatingRider || !isUsernameValid || !isPasswordValid
                    }
                  >
                    {creatingRider ? "Creating..." : "Create Account"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
