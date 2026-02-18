import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import Chart from "chart.js/auto";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FaDownload,
  FaCheckCircle,
  FaTimesCircle,
  FaCalendarAlt,
  FaChartLine,
  FaMotorcycle,
} from "react-icons/fa";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "../styles/global.css";
import "../styles/dashboard.css";
import PageSpinner from "../components/PageSpinner";

const humanizeLabel = (label) => {
  if (!label) return "";
  if (label === "All") return "All";
  return label
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const formatPdfDate = (value) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const toTitleCase = (value) =>
  String(value)
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatPdfCellValue = (value, columnKey = "") => {
  if (value === null || value === undefined || value === "") return "-";
  if (columnKey === "created_at" || columnKey === "date") return formatPdfDate(value);

  const raw = String(value).trim();
  if (!raw) return "-";
  if (/email/i.test(columnKey) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  if (/phone|_id$|^id$/i.test(columnKey)) return raw;
  return toTitleCase(raw);
};

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const isDeliveredStatus = (value) => {
  const normalized = normalizeStatus(value);
  return (
    normalized === "successfully delivered" ||
    normalized === "delivered" ||
    normalized === "successful" ||
    normalized === "success" ||
    normalized === "completed"
  );
};

const isCancelledStatus = (value) => {
  const normalized = normalizeStatus(value);
  return normalized === "cancelled" || normalized === "canceled";
};

const extractYearKey = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return String(value.getFullYear());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value < 1e12 ? value * 1000 : value;
    const parsedNumberDate = new Date(normalized);
    if (!Number.isNaN(parsedNumberDate.getTime())) {
      return String(parsedNumberDate.getFullYear());
    }
  }

  const text = String(value).trim();
  if (!text) return null;

  // ISO-like values: 2025-... or 2025/...
  const leadingYearMatch = text.match(/^((?:19|20)\d{2})[-/]/);
  if (leadingYearMatch) return leadingYearMatch[1];

  // Non-ISO strings like 12/31/2025, Dec 31 2025, etc.
  const anyYearMatch = text.match(/\b((?:19|20)\d{2})\b/);
  if (anyYearMatch) return anyYearMatch[1];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return String(parsed.getFullYear());
  }

  return null;
};

const normalizeCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeLatLngPair = (latValue, lngValue) => {
  let lat = normalizeCoordinate(latValue);
  let lng = normalizeCoordinate(lngValue);
  if (lat === null || lng === null) return null;

  // Some records may be stored as swapped values; auto-correct when obvious.
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    const temp = lat;
    lat = lng;
    lng = temp;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

// Keep map points inside the Philippines to avoid plotting bad outlier records.
const isWithinPhilippines = (lat, lng) =>
  lat >= 4.5 && lat <= 21.5 && lng >= 116.0 && lng <= 127.5;

const getViolationType = (log = {}) =>
  log?.violation ||
  log?.violation_type ||
  log?.type ||
  log?.violationName ||
  "Unknown violation";

const getViolationRiderName = (log = {}) => {
  const candidates = [
    log?.rider_name,
    log?.rider,
    log?.user_name,
    log?.username,
    log?.name,
    log?.user_id,
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "-";
};
const getViolationAreaName = (log = {}) => {
  const candidates = [
    log?.location_name,
    log?.area_name,
    log?.area,
    log?.address,
    typeof log?.location === "string" ? log.location : "",
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^POINT\s*\(/i.test(trimmed)) continue;
    if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) continue;
    return trimmed;
  }

  return "";
};

const getViolationCoordinates = (log = {}) => {
  const normalized = normalizeLatLngPair(log?.lat, log?.lng);
  if (!normalized) return null;
  return isWithinPhilippines(normalized.lat, normalized.lng) ? normalized : null;
};

const HOTSPOT_CIRCLE_STYLE = {
  high: {
    color: "#991b1b",
    fillColor: "#ef4444",
    fillOpacity: 0.42,
    weight: 3,
    opacity: 0.95,
  },
  medium: {
    color: "#92400e",
    fillColor: "#f59e0b",
    fillOpacity: 0.38,
    weight: 2.6,
    opacity: 0.92,
  },
  low: {
    color: "#166534",
    fillColor: "#22c55e",
    fillOpacity: 0.34,
    weight: 2.4,
    opacity: 0.9,
  },
};

const getViolationDensityLevel = (incidents) => {
  if (incidents >= 11) return "high";
  if (incidents >= 6) return "medium";
  return "low";
};


const parcelColumns = [
  { value: "All", label: "All" },
  { value: "recipient_name", label: "Recipient name" },
  { value: "recipient_phone", label: "Recipient phone" },
  { value: "address", label: "Address" },
  { value: "assigned_rider", label: "Assigned rider" },
  { value: "status", label: "Status" },
  { value: "created_at", label: "Created at" },
];

const riderColumns = [
  { value: "All", label: "All" },
  { value: "email", label: "Email" },
  { value: "status", label: "Status" },
  { value: "created_at", label: "Created at" },
];

const violationColumns = [
  { value: "All", label: "All" },
  { value: "name", label: "Name" },
  { value: "violation", label: "Violation" },
  { value: "date", label: "Date" },
];

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const CIRCULAR_CHART_TYPES = new Set(["pie"]);
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_MAX_PAGES = 25;

const getYearDateRange = (yearValue) => {
  const year = Number(yearValue);
  if (!Number.isFinite(year)) return null;
  return {
    start: `${year}-01-01T00:00:00`,
    endExclusive: `${year + 1}-01-01T00:00:00`,
  };
};

const fetchAllPages = async (
  buildQuery,
  pageSize = SUPABASE_PAGE_SIZE,
  maxPages = SUPABASE_MAX_PAGES,
) => {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
};

const buildViolationPointIndicatorsFromLogs = (violationLogs = []) => {
  return (violationLogs || [])
    .map((log) => {
    const normalizedPair = getViolationCoordinates(log);
    if (!normalizedPair) return null;
    const { lat, lng } = normalizedPair;
      return {
        coords: [lat, lng],
        location: getViolationAreaName(log) || getViolationRiderName(log) || "Unknown rider",
        incidents: 1,
        violation_type: getViolationType(log),
      };
    })
    .filter(Boolean);
};

const getAssignedRiderDisplay = (parcel = {}) => {
  const assigned = parcel?.assigned_rider;
  if (typeof assigned === "string" && assigned.trim()) return assigned.trim();
  if (assigned && typeof assigned === "object") {
    const fullName = `${assigned.fname || ""} ${assigned.lname || ""}`.trim();
    if (fullName) return fullName;
    if (assigned.username) return String(assigned.username);
  }
  if (parcel?.assigned_rider_name) return String(parcel.assigned_rider_name);
  if (parcel?.assigned_rider_id) return String(parcel.assigned_rider_id);
  return "Unassigned";
};

const normalizeParcelsForReport = (parcels = []) =>
  (parcels || []).map((parcel) => ({
    ...parcel,
    assigned_rider: getAssignedRiderDisplay(parcel),
  }));

const loadImageAsDataUrl = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Failed to render logo image."));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Failed to load logo image."));
    image.src = url;
  });

const ModernSelect = ({
  value,
  onChange,
  options = [],
  placeholder = "Select",
  className = "",
  triggerClassName = "",
  menuClassName = "",
  id,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(260);
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

  useEffect(() => {
    if (!open) return undefined;

    const updateMenuPlacement = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const modalBody = root.closest(".dashboard-report-modal-body");
      const bounds = modalBody
        ? modalBody.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const spaceBelow = bounds.bottom - rect.bottom - 10;
      const spaceAbove = rect.top - bounds.top - 10;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      setMenuPlacement(openUp ? "up" : "down");
      setMenuMaxHeight(Math.max(140, Math.min(320, Math.floor(available))));
    };

    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);

    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    const modalBody = root?.closest?.(".dashboard-report-modal-body");
    if (!modalBody) return undefined;

    if (open) {
      modalBody.classList.add("dashboard-dropdown-open");
    } else {
      modalBody.classList.remove("dashboard-dropdown-open");
    }

    return () => {
      modalBody.classList.remove("dashboard-dropdown-open");
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`modern-select ${open ? "is-open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        id={id}
        className={`modern-select-trigger ${triggerClassName}`.trim()}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedOption?.label || placeholder}</span>
        <span className="modern-select-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`modern-select-menu ${menuPlacement === "up" ? "menu-up" : ""} ${menuClassName}`.trim()}
          role="listbox"
          style={{ maxHeight: `${menuMaxHeight}px` }}
        >
          {(options || []).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`modern-select-option ${value === option.value ? "is-selected" : ""}`}
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

const Dashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    delivered: 0,
    cancelled: 0,
    topMonth: "--",
    topMonthCount: 0,
    topYear: "--",
    topYearCount: 0,
    topRider: "--",
    topRiderCount: 0,
    years: [],
    yearGrowth: [],
    monthGrowth: Array(12).fill(0),
  });
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("All");
  const [growthView, setGrowthView] = useState("month");
  const [growthChartType, setGrowthChartType] = useState("line");
  const [yearFilterReady, setYearFilterReady] = useState(false);
  const [violationMapModalOpen, setViolationMapModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportType, setReportType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [column, setColumn] = useState("All");
  const [columnsOptions, setColumnsOptions] = useState([]);
  const [format, setFormat] = useState("pdf");
  const [showReportValidation, setShowReportValidation] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [violationLogs, setViolationLogs] = useState([]);
  const [violationLogsError, setViolationLogsError] = useState("");
  const yearFilterRef = useRef(null);
  const growthChartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const hasLoadedAnalyticsRef = useRef(false);
  const violationMapRef = useRef(null);
  const violationLeafletMapRef = useRef(null);
  const violationFullMapRef = useRef(null);
  const violationFullLeafletMapRef = useRef(null);
  const violationLayerGroupRef = useRef(null);
  const violationFullLayerGroupRef = useRef(null);
  const todayLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const buildViolationPopup = useCallback((location, level, incidents, _note, violationType) => `
    <div class="violation-hotspot-popup-card">
      <div class="violation-hotspot-popup-top">
        <span class="violation-hotspot-dot ${level}"></span>
        <strong>${location}</strong>
      </div>
      <small style="color: #dc2626; font-weight: 700;">Violation: ${violationType || "Unknown violation"}</small>
    </div>
  `, []);
  const violationPointIndicators = useMemo(
    () => buildViolationPointIndicatorsFromLogs(violationLogs),
    [violationLogs],
  );
  const growthChartSeries = useMemo(() => {
    if (growthView === "month") {
      return {
        labels: MONTH_LABELS,
        data: dashboardData.monthGrowth || Array(12).fill(0),
        title: "Delivery Growth by Month",
      };
    }

    return {
      labels: dashboardData.years,
      data: dashboardData.yearGrowth,
      title: "Delivery Growth by Year",
    };
  }, [growthView, dashboardData.monthGrowth, dashboardData.years, dashboardData.yearGrowth]);

  const hasGrowthData = useMemo(
    () => (growthChartSeries.data || []).some((value) => Number(value) > 0),
    [growthChartSeries.data],
  );

  const currentYear = new Date().getFullYear();
  const yearSelectOptions = useMemo(
    () => [
      { value: "All", label: "All Years" },
      ...availableYears.map((year) => ({ value: year, label: year })),
    ],
    [availableYears],
  );
  const growthViewOptions = useMemo(
    () => [
      { value: "year", label: "By Year" },
      { value: "month", label: "By Month" },
    ],
    [],
  );
  const growthTypeOptions = useMemo(
    () => [
      { value: "line", label: "Line Chart" },
      { value: "bar", label: "Bar Chart" },
      { value: "pie", label: "Pie Chart" },
    ],
    [],
  );
  const reportTypeOptions = useMemo(
    () => [
      { value: "", label: "-- Select Report Type --" },
      { value: "parcels", label: "Parcels" },
      { value: "riders", label: "Riders" },
      { value: "violations", label: "Violations" },
      { value: "overall", label: "Overall Reports" },
    ],
    [],
  );
  const formatOptions = useMemo(
    () => [
      { value: "pdf", label: "PDF" },
      { value: "csv", label: "CSV" },
    ],
    [],
  );
  const handleYearFilterPillClick = useCallback((event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(".modern-select-trigger") ||
      target.closest(".modern-select-menu") ||
      target.closest(".modern-select-option")
    ) {
      return;
    }
    const trigger = yearFilterRef.current?.querySelector(".modern-select-trigger");
    if (trigger instanceof HTMLButtonElement) {
      trigger.focus();
      trigger.click();
    }
  }, []);
  const renderViolationHotspots = useCallback((
    map,
    points,
    layerGroupRef,
    options = {},
  ) => {
    if (!map) return;
    const { autoCenter = true } = options;

    if (layerGroupRef.current) {
      layerGroupRef.current.remove();
      layerGroupRef.current = null;
    }

    let layerGroup = L.layerGroup();
    const warningIcon = L.divIcon({
      className: "violation-warning-marker-wrap",
      html: `
        <span class="violation-warning-pulse" aria-hidden="true"></span>
        <span class="violation-warning-marker" aria-hidden="true">⚠</span>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -20],
    });

    layerGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 52,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const clusterLevel = count >= 20 ? "high" : count >= 8 ? "medium" : "low";
        const clusterSize = 56;
        const halfSize = 28;

        return L.divIcon({
          className: `violation-cluster-wrap ${clusterLevel}`,
          html: `
              <span class="violation-cluster-pulse" aria-hidden="true"></span>
              <span class="violation-cluster-core">
              <span class="violation-cluster-icon" aria-hidden="true">⚠</span>
                <strong>${count}</strong>
              </span>
            `,
          iconSize: [clusterSize, clusterSize],
          iconAnchor: [halfSize, halfSize],
          popupAnchor: [0, -Math.round(clusterSize * 0.55)],
        });
      },
    });

    (points || []).forEach((point) => {
      const [lat, lng] = point.coords || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const level = getViolationDensityLevel(point.incidents);

      L.marker([lat, lng], { icon: warningIcon, zIndexOffset: 1200 })
        .addTo(layerGroup)
        .bindPopup(
          buildViolationPopup(
            point.location,
            level,
            point.incidents,
            "",
            point.violation_type,
          ),
          { className: "violation-hotspot-popup", closeButton: false },
        );
    });

    layerGroup.addTo(map);
    layerGroupRef.current = layerGroup;

    if (!autoCenter) return;

    const plottedLayers = layerGroup.getLayers();
    if (plottedLayers.length > 1) {
      const bounds = L.featureGroup(layerGroup.getLayers()).getBounds().pad(0.2);
      map.fitBounds(bounds);
    } else if (plottedLayers.length === 1) {
      const firstLayer = plottedLayers[0];
      const firstCoords = firstLayer?.getLatLng
        ? firstLayer.getLatLng()
        : firstLayer?.getBounds?.().getCenter();
      if (firstCoords) {
        map.setView([firstCoords.lat, firstCoords.lng], 14);
      }
    } else {
      map.setView([14.676, 121.0437], 13);
    }
  }, [buildViolationPopup]);

  useEffect(() => {
    if (reportType === "parcels") setColumnsOptions(parcelColumns);
    else if (reportType === "riders") setColumnsOptions(riderColumns);
    else if (reportType === "violations") setColumnsOptions(violationColumns);
    else setColumnsOptions([]);
    setColumn("All");
  }, [reportType]);

  useEffect(() => {
    if (selectedYear !== "All") {
      setGrowthView("month");
    }
  }, [selectedYear]);

  useEffect(() => {
    async function loadAvailableYears() {
      try {
        const { data: oldestRows, error: oldestError } = await supabaseClient
          .from("parcels")
          .select("created_at")
          .not("created_at", "is", null)
          .order("created_at", { ascending: true })
          .limit(1);
        const { data: newestRows, error: newestError } = await supabaseClient
          .from("parcels")
          .select("created_at")
          .not("created_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        if (oldestError || newestError) {
          console.error("Error loading year options:", oldestError || newestError);
          setAvailableYears([]);
          setSelectedYear("All");
          return;
        }

        const oldestYear = Number(extractYearKey(oldestRows?.[0]?.created_at));
        const newestYear = Number(extractYearKey(newestRows?.[0]?.created_at));
        const minDataYear = Number.isFinite(oldestYear)
          ? oldestYear
          : currentYear;
        const maxDataYear = Number.isFinite(newestYear)
          ? newestYear
          : currentYear;
        const startYear = Math.min(minDataYear, maxDataYear, currentYear);
        const endYear = Math.max(minDataYear, maxDataYear, currentYear);
        const years = [];
        for (let year = endYear; year >= startYear; year -= 1) {
          years.push(String(year));
        }

        setAvailableYears(years);
        setSelectedYear("All");
      } catch (error) {
        console.error("Error building year options:", error);
        setAvailableYears([]);
        setSelectedYear("All");
      } finally {
        setYearFilterReady(true);
      }
    }

    loadAvailableYears();
  }, [currentYear]);

  useEffect(() => {
    if (!yearFilterReady) return;

    async function loadAnalytics() {
      if (!hasLoadedAnalyticsRef.current) {
        setLoading(true);
      }
      try {
        const analyticsYears =
          selectedYear === "All"
            ? [...availableYears].reverse()
            : [selectedYear];
        const safeAnalyticsYears = analyticsYears.length
          ? analyticsYears
          : [String(currentYear)];

        const allParcels = [];
        for (const year of safeAnalyticsYears) {
          const yearRange = getYearDateRange(year);
          if (!yearRange) {
            continue;
          }

          const yearParcels = await fetchAllPages(() =>
            supabaseClient
              .from("parcels")
              .select(
                `
                *,
                assigned_rider:users!parcels_assigned_rider_id_fkey(
                  user_id,
                  username,
                  fname,
                  lname
                )
                `,
              )
              .gte("created_at", yearRange.start)
              .lt("created_at", yearRange.endExclusive),
          );
          allParcels.push(...yearParcels);
        }

        const allViolations = [];
        try {
          for (const year of safeAnalyticsYears) {
            const yearRange = getYearDateRange(year);
            if (!yearRange) continue;
            const yearViolations = await fetchAllPages(() =>
              supabaseClient
                .from("violation_logs")
                .select("*")
                .gte("date", yearRange.start)
                .lt("date", yearRange.endExclusive)
                .order("date", { ascending: false }),
            );
            allViolations.push(...yearViolations);
          }
          allViolations.sort(
            (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime(),
          );
          setViolationLogsError("");
          setViolationLogs(allViolations);
        } catch (violationsError) {
          const errorMessage =
            violationsError?.message || "Unknown violation_logs query error";
          console.error("Error fetching violation logs:", violationsError);
          setViolationLogsError(errorMessage);
          setViolationLogs([]);
        }

        const parcelsForSelectedYear = allParcels || [];

        // Count delivered parcels (status = "successfully delivered")
        const delivered = parcelsForSelectedYear.filter((p) => isDeliveredStatus(p.status)).length;

        // Count cancelled parcels (status = "cancelled")
        const cancelled = parcelsForSelectedYear.filter((p) => isCancelledStatus(p.status)).length;

        const months = {};
        const monthCounts = Array(12).fill(0);
        const yearsCount = Object.fromEntries(
          safeAnalyticsYears.map((year) => [year, 0]),
        );
        const riderCountsById = {};
        const riderNameById = {};
        let topMonth = "";
        let topMonthCount = 0;
        let topYear = "";
        let topYearCount = 0;
        let topRiderId = "";
        let topRiderCount = 0;

        // Process delivered parcels for analytics.
        parcelsForSelectedYear.forEach((p) => {
          if (!isDeliveredStatus(p.status)) return;

          // Count deliveries by assigned rider ID regardless of created_at.
          const riderId = p.assigned_rider_id;
          if (riderId) {
            if (!riderNameById[riderId]) {
              const fullName = `${p?.assigned_rider?.fname || ""} ${p?.assigned_rider?.lname || ""}`.trim();
              riderNameById[riderId] =
                fullName || p?.assigned_rider?.username || String(riderId);
            }
            riderCountsById[riderId] = (riderCountsById[riderId] || 0) + 1;
            if (riderCountsById[riderId] > topRiderCount) {
              topRiderId = riderId;
              topRiderCount = riderCountsById[riderId];
            }
          }

          // Month/year analytics still require a usable created_at.
          if (!p.created_at) return;
          const date = new Date(p.created_at);
          const yearStr = extractYearKey(p.created_at);
          if (!yearStr) return;

          if (!Number.isNaN(date.getTime())) {
            const monthIndex = date.getMonth();
            const monthStr = MONTH_LABELS[monthIndex] || date.toLocaleString("default", {
              month: "long",
            });
            months[monthStr] = (months[monthStr] || 0) + 1;
            if (monthIndex >= 0 && monthIndex <= 11) {
              monthCounts[monthIndex] = (monthCounts[monthIndex] || 0) + 1;
            }
            if (months[monthStr] > topMonthCount) {
              topMonth = monthStr;
              topMonthCount = months[monthStr];
            }
          }

          if (!yearsCount[yearStr]) yearsCount[yearStr] = 0;
          yearsCount[yearStr] += 1;
          if (yearsCount[yearStr] > topYearCount) {
            topYear = yearStr;
            topYearCount = yearsCount[yearStr];
          }
        });

        // Sort years chronologically and prepare growth data
        const sortedYears = Object.keys(yearsCount).sort((a, b) => Number(a) - Number(b));
        const chartYears =
          selectedYear === "All"
            ? sortedYears
            : [selectedYear];
        const yearGrowthData =
          selectedYear === "All"
            ? chartYears.map((y) => yearsCount[y] || 0)
            : [yearsCount[selectedYear] || 0];

        setDashboardData({
          delivered: delivered || 0,
          cancelled: cancelled || 0,
          topMonth: topMonth || "--",
          topMonthCount: topMonthCount || 0,
          topYear: topYear || "--",
          topYearCount: topYearCount || 0,
          topRider:
            (topRiderId && (riderNameById[topRiderId] || String(topRiderId))) ||
            "--",
          topRiderCount: topRiderCount || 0,
          years: chartYears,
          yearGrowth: yearGrowthData,
          monthGrowth: monthCounts,
        });
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
        hasLoadedAnalyticsRef.current = true;
      }
    }

    loadAnalytics();
  }, [selectedYear, yearFilterReady, availableYears, currentYear]);

  const fetchReportData = async (
    selectedReportType,
    selectedStartDate,
    selectedEndDate,
    selectedColumn,
  ) => {
    let data = [];
    let columns = [];

    if (selectedReportType === "parcels") {
      let query = supabaseClient
        .from("parcels")
        .select(
          `
          *,
          assigned_rider:users!parcels_assigned_rider_id_fkey(
            fname,
            lname,
            username
          )
        `,
        )
        .order("parcel_id", { ascending: true })
        .range(0, 5000);
      if (selectedStartDate) query = query.gte("created_at", selectedStartDate);
      if (selectedEndDate)
        query = query.lte("created_at", `${selectedEndDate}T23:59:59`);
      const { data: parcels, error } = await query;
      if (error) throw error;
      data = normalizeParcelsForReport(parcels);
      columns =
        selectedColumn === "All"
          ? [
              "recipient_name",
              "recipient_phone",
              "address",
              "assigned_rider",
              "status",
              "created_at",
            ]
          : [selectedColumn];
    } else if (selectedReportType === "riders") {
      let query = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      if (selectedStartDate) query = query.gte("created_at", selectedStartDate);
      if (selectedEndDate)
        query = query.lte("created_at", `${selectedEndDate}T23:59:59`);
      const { data: riders, error } = await query;
      if (error) throw error;
      data = riders;
      columns = ["email", "status", "created_at"];
    } else if (selectedReportType === "violations") {
      let query = supabaseClient
        .from("violation_logs")
        .select("violation, name, date")
        .order("date", { ascending: false });
      if (selectedStartDate) query = query.gte("date", selectedStartDate);
      if (selectedEndDate)
        query = query.lte("date", `${selectedEndDate}T23:59:59`);
      const { data: violations, error } = await query;
      if (error) throw error;
      data = violations || [];
      columns = ["name", "violation", "date"];
    } else if (selectedReportType === "overall") {
      let parcelQuery = supabaseClient
        .from("parcels")
        .select(
          `
          *,
          assigned_rider:users!parcels_assigned_rider_id_fkey(
            fname,
            lname,
            username
          )
        `,
        )
        .order("parcel_id", { ascending: true })
        .range(0, 5000);
      let riderQuery = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      let violationQuery = supabaseClient
        .from("violation_logs")
        .select("violation, name, date")
        .order("date", { ascending: false });
      if (selectedStartDate)
        parcelQuery = parcelQuery.gte("created_at", selectedStartDate);
      if (selectedEndDate)
        parcelQuery = parcelQuery.lte(
          "created_at",
          `${selectedEndDate}T23:59:59`,
        );
      if (selectedStartDate)
        violationQuery = violationQuery.gte("date", selectedStartDate);
      if (selectedEndDate)
        violationQuery = violationQuery.lte("date", `${selectedEndDate}T23:59:59`);

      const [parcelsRes, ridersRes, violationsRes] = await Promise.all([
        parcelQuery,
        riderQuery,
        violationQuery,
      ]);
      if (parcelsRes.error) throw parcelsRes.error;
      if (ridersRes.error) throw ridersRes.error;
      if (violationsRes.error) throw violationsRes.error;

      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: normalizeParcelsForReport(parcelsRes.data) },
        {
          section: "Violations",
          data: violationsRes.data || [],
        },
      ];
      columns = null;
    }

    return { data, columns };
  };

  const buildPdfDoc = async (
    selectedReportType,
    selectedStartDate,
    selectedEndDate,
    selectedColumn,
    data,
    columns,
  ) => {
    const doc = new jsPDF("landscape");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const headerHeight = 35;

    // Keep red header so white logo remains visible.
    doc.setFillColor(163, 0, 0);
    doc.rect(0, 0, pageWidth, headerHeight, "F");
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.3);
    doc.line(10, headerHeight + 1, pageWidth - 10, headerHeight + 1);
    doc.setTextColor(255, 255, 255);
    try {
      const logoDataUrl = await loadImageAsDataUrl("/images/logo.png");
      doc.addImage(logoDataUrl, "PNG", pageWidth / 2 - 18, 3, 36, 36);
    } catch (error) {
      console.error("Failed to add logo to PDF header:", error);
    }
    doc.setTextColor(33, 37, 41);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(`${humanizeLabel(selectedReportType)} Report`, 14, headerHeight + 10);

    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const metaRows = [
      ["Report Type", humanizeLabel(selectedReportType)],
      ["Date Range", `${formatPdfDate(selectedStartDate)} to ${formatPdfDate(selectedEndDate)}`],
      ["Column Scope", selectedReportType === "parcels" ? humanizeLabel(selectedColumn) : "All"],
      ["Generated", generatedAt],
    ];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    let infoY = headerHeight + 18;
    metaRows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, 14, infoY);
      doc.setFont("helvetica", "normal");
      doc.text(value, 48, infoY);
      infoY += 6;
    });

    if (selectedReportType === "overall") {
      let yOffset = infoY + 4;
      data.forEach((section) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.setTextColor(17, 24, 39);
        doc.text(section.section, 10, yOffset);
        const head =
          section.section === "Riders"
            ? ["Username", "Email", "Status", "Created At"]
            : section.section === "Violations"
              ? ["Name", "Violation", "Date"]
              : [
                  "Parcel ID",
                  "Recipient Name",
                  "Phone",
                  "Address",
                  "Rider",
                  "Status",
                  "Created At",
                ];
        const body = section.data.map((row) =>
          section.section === "Riders"
            ? [
                formatPdfCellValue(row.username, "username"),
                formatPdfCellValue(row.email, "email"),
                formatPdfCellValue(row.status, "status"),
                formatPdfCellValue(row.created_at, "created_at"),
              ]
            : section.section === "Violations"
              ? [
                  formatPdfCellValue(row.name, "name"),
                  formatPdfCellValue(row.violation, "violation"),
                  formatPdfCellValue(row.date, "date"),
                ]
              : [
                  formatPdfCellValue(row.parcel_id, "parcel_id"),
                  formatPdfCellValue(row.recipient_name, "recipient_name"),
                  formatPdfCellValue(row.recipient_phone, "recipient_phone"),
                  formatPdfCellValue(row.address, "address"),
                  formatPdfCellValue(row.assigned_rider, "assigned_rider"),
                  formatPdfCellValue(row.status, "status"),
                  formatPdfCellValue(row.created_at, "created_at"),
                ],
        );
        autoTable(doc, {
          startY: yOffset + 4,
          margin: { left: 10, right: 10 },
          head: [head],
          body,
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 8.8,
            textColor: [31, 41, 55],
            lineColor: [208, 213, 221],
            lineWidth: 0.2,
            cellPadding: 2.6,
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: [243, 244, 246],
            textColor: [17, 24, 39],
            fontStyle: "bold",
            halign: "left",
          },
          alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        yOffset = doc.lastAutoTable.finalY + 10;
        if (yOffset > pageHeight - 18) yOffset = doc.lastAutoTable.finalY + 8;
      });
    } else {
      const head = columns.map(humanizeLabel);
      const body = data.map((row) =>
        columns.map((c) => {
          const value = row[c];
          return formatPdfCellValue(value, c);
        }),
      );
      autoTable(doc, {
        startY: infoY + 4,
        margin: { left: 10, right: 10 },
        head: [head],
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.8,
          textColor: [31, 41, 55],
          lineColor: [208, 213, 221],
          lineWidth: 0.2,
          cellPadding: 2.6,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [243, 244, 246],
          textColor: [17, 24, 39],
          fontStyle: "bold",
          halign: "left",
        },
        alternateRowStyles: { fillColor: [252, 252, 252] },
      });
    }

    return doc;
  };

  const buildCsvContent = (selectedReportType, selectedColumn, data) => {
    const isLikelyIdLike = (columnKey = "") =>
      columnKey === "parcel_id" ||
      columnKey === "recipient_phone" ||
      /(^id$|_id$|phone)/i.test(columnKey);

    const formatCsvCellValue = (value, columnKey = "") => {
      if (value === null || value === undefined) return "";
      const raw = String(value).trim();
      if (!raw) return "";

      if (columnKey === "created_at" || columnKey === "date") {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
        }
      }

      // Keep large numeric strings text-like in Excel (avoid scientific notation).
      if (isLikelyIdLike(columnKey)) return `\t${raw}`;
      return raw;
    };

    const csvEscape = (value) => `"${String(value).replace(/"/g, '""')}"`;

    const effectiveColumn =
      selectedReportType === "parcels" ? selectedColumn : "All";
    let csv = "";
    if (selectedReportType === "overall") {
      data.forEach((section) => {
        csv += `\n## ${section.section}\n`;
        const cols =
          section.section === "Riders"
            ? ["username", "email", "status", "created_at"]
            : section.section === "Violations"
              ? ["name", "violation", "date"]
              : effectiveColumn === "All"
                ? [
                    "parcel_id",
                    "recipient_name",
                    "recipient_phone",
                    "address",
                    "assigned_rider",
                    "status",
                    "created_at",
                  ]
                : ["parcel_id", effectiveColumn];
        csv += cols.map(humanizeLabel).join(",") + "\n";
        section.data.forEach((row) => {
          csv +=
            cols
              .map((c) => csvEscape(formatCsvCellValue(row[c], c)))
              .join(",") + "\n";
        });
      });
    } else {
      const reportCols =
        effectiveColumn === "All"
          ? selectedReportType === "riders"
            ? ["username", "email", "status", "created_at"]
            : selectedReportType === "violations"
              ? ["name", "violation", "date"]
              : [
                  "parcel_id",
                  "recipient_name",
                  "recipient_phone",
                  "address",
                  "assigned_rider",
                  "status",
                  "created_at",
                ]
          : [effectiveColumn];
      csv += reportCols.map(humanizeLabel).join(",") + "\n";
      data.forEach((row) => {
        csv +=
          reportCols
            .map((c) => csvEscape(formatCsvCellValue(row[c], c)))
            .join(",") + "\n";
      });
    }
    return csv;
  };

  const generatePdfReport = async (
    selectedReportType,
    selectedStartDate,
    selectedEndDate,
    selectedColumn,
  ) => {
    const { data, columns } = await fetchReportData(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn,
    );
    const doc = await buildPdfDoc(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn,
      data,
      columns,
    );
    doc.save(`${selectedReportType}_report.pdf`);
  };

  const generateCsvReport = async (
    selectedReportType,
    selectedStartDate,
    selectedEndDate,
    selectedColumn,
  ) => {
    const { data } = await fetchReportData(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn,
    );
    const csv = buildCsvContent(selectedReportType, selectedColumn, data);

    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedReportType}_report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const validateReportInput = () => {
    const needsColumn = reportType === "parcels";
    if (
      !reportType ||
      (needsColumn && !column) ||
      !format ||
      !startDate ||
      !endDate
    ) {
      setShowReportValidation(true);
      return false;
    }
    return true;
  };

  const handleDownloadReport = async () => {
    if (!validateReportInput()) return;
    try {
      setIsGeneratingReport(true);
      if (format === "pdf")
        await generatePdfReport(reportType, startDate, endDate, column);
      else await generateCsvReport(reportType, startDate, endDate, column);
      setReportModalOpen(false);
    } catch (error) {
      console.error("Error generating report:", error);
      alert("Failed to generate report. Check console for details.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  useEffect(() => {
    if (!growthChartRef.current || !growthChartSeries.labels.length) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const isCircularChart = CIRCULAR_CHART_TYPES.has(growthChartType);
    const palette = [
      "#ef4444",
      "#f97316",
      "#f59e0b",
      "#84cc16",
      "#22c55e",
      "#14b8a6",
      "#06b6d4",
      "#0ea5e9",
      "#3b82f6",
      "#6366f1",
      "#8b5cf6",
      "#ec4899",
    ];
    const chartColors = growthChartSeries.labels.map(
      (_, index) => palette[index % palette.length],
    );

    chartInstanceRef.current = new Chart(growthChartRef.current, {
      type: growthChartType,
      data: {
        labels: growthChartSeries.labels,
        datasets: [
          {
            label: "Deliveries",
            data: growthChartSeries.data,
            borderColor: isCircularChart ? chartColors : "#ef4444",
            backgroundColor: isCircularChart
              ? chartColors
              : growthChartType === "bar"
                ? "rgba(239, 68, 68, 0.72)"
                : "rgba(239, 68, 68, 0.16)",
            fill: growthChartType === "line",
            tension: growthChartType === "line" ? 0.35 : 0,
            pointRadius: growthChartType === "line" ? 2.6 : 0,
            pointHoverRadius: growthChartType === "line" ? 4 : 0,
            pointBackgroundColor: "#ef4444",
            borderWidth: growthChartType === "bar" ? 1 : 2,
            borderRadius: growthChartType === "bar" ? 8 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 2,
            right: 4,
            bottom: 2,
            left: 2,
          },
        },
        plugins: {
          legend: {
            display: isCircularChart,
            position: isCircularChart ? "right" : "bottom",
            align: "center",
            maxWidth: isCircularChart ? 220 : undefined,
            labels: {
              boxWidth: isCircularChart ? 10 : 12,
              boxHeight: isCircularChart ? 10 : 12,
              usePointStyle: true,
              pointStyle: "circle",
              padding: isCircularChart ? 10 : 8,
              font: {
                size: isCircularChart ? 11 : 12,
                weight: isCircularChart ? "600" : "700",
              },
              filter: (legendItem, chartData) => {
                if (!isCircularChart) return true;
                const rawValue = chartData?.datasets?.[0]?.data?.[legendItem.index];
                return Number(rawValue) > 0;
              },
            },
          },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (context) => {
                const parsed = context?.parsed;
                const value =
                  typeof parsed === "number"
                    ? parsed
                    : typeof parsed?.y === "number"
                      ? parsed.y
                      : typeof context?.raw === "number"
                        ? context.raw
                        : 0;
                return `📦 Deliveries: ${value}`;
              },
            },
          },
        },
        scales: isCircularChart
          ? undefined
          : {
              x: { grid: { display: false } },
              y: {
                beginAtZero: true,
                grid: {
                  color: "rgba(148, 163, 184, 0.2)",
                },
                ticks: {
                  precision: 0,
                },
              },
            },
      },
    });
  }, [growthChartSeries.labels, growthChartSeries.data, growthChartType]);

  useEffect(() => {
    if (loading || !violationMapRef.current) return;

    if (!violationLeafletMapRef.current) {
      const map = L.map(violationMapRef.current, {
        minZoom: 11,
      }).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
      violationLeafletMapRef.current = map;
    }
    const map = violationLeafletMapRef.current;
    renderViolationHotspots(
      map,
      violationPointIndicators,
      violationLayerGroupRef,
      { autoCenter: true },
    );

    setTimeout(() => {
      violationLeafletMapRef.current?.invalidateSize();
    }, 120);

  }, [loading, violationPointIndicators, renderViolationHotspots]);

  useEffect(() => {
    if (!violationMapModalOpen) {
      if (violationFullLeafletMapRef.current) {
        violationFullLeafletMapRef.current.remove();
        violationFullLeafletMapRef.current = null;
      }
      return;
    }

    if (!violationFullMapRef.current) return;

    if (!violationFullLeafletMapRef.current) {
      const map = L.map(violationFullMapRef.current, {
        minZoom: 11,
      }).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
      violationFullLeafletMapRef.current = map;
    }
    const map = violationFullLeafletMapRef.current;
    renderViolationHotspots(
      map,
      violationPointIndicators,
      violationFullLayerGroupRef,
      { autoCenter: true },
    );

    setTimeout(() => {
      violationFullLeafletMapRef.current?.invalidateSize();
    }, 120);

  }, [violationMapModalOpen, violationPointIndicators, renderViolationHotspots]);

  useEffect(() => {
    return () => {
      if (violationLeafletMapRef.current) {
        violationLeafletMapRef.current.remove();
        violationLeafletMapRef.current = null;
      }
      if (violationFullLeafletMapRef.current) {
        violationFullLeafletMapRef.current.remove();
        violationFullLeafletMapRef.current = null;
      }
      violationLayerGroupRef.current = null;
      violationFullLayerGroupRef.current = null;
    };
  }, []);

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar />

      <div className="dashboard-page bg-gradient-to-br from-red-50 via-slate-50 to-slate-100 px-6 py-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {loading ? (
          <PageSpinner fullScreen label="Loading dashboard..." />
        ) : (
          <>
            <div className="dash-header">
              <div className="dash-header-copy">
                <h1 className="page-title mb-6">Dashboard</h1>
              </div>
              <div className="dash-header-actions">
                <button
                  type="button"
                  className="dash-generate-report-btn"
                  onClick={() => setReportModalOpen(true)}
                >
                  Generate Report
                </button>
                <div
                  className="dash-year-filter"
                  ref={yearFilterRef}
                  onClick={handleYearFilterPillClick}
                >
                  <span className="dash-year-filter-label">Year</span>
                  <ModernSelect
                    id="dashboard-year-filter"
                    className="dash-year-modern-select"
                    triggerClassName="dash-year-modern-trigger"
                    menuClassName="dash-modern-menu"
                    value={selectedYear}
                    options={yearSelectOptions}
                    onChange={(nextValue) => {
                      setSelectedYear(nextValue);
                      setGrowthView("month");
                    }}
                  />
                </div>
                <span className="date-range">{todayLabel}</span>
              </div>
            </div>

            <div className="dash-grid two-rows">
              <div className="dash-card top-card metric-card kpi-card delivered-card border border-emerald-200/60">
                <div className="kpi-icon delivered" aria-hidden="true">
                  <FaCheckCircle />
                </div>
                <div className="kpi-copy">
                  <div className="kpi-title">Delivered</div>
                  <div className="kpi-value">{dashboardData.delivered}</div>
                  <div className="kpi-meta">Completed parcels</div>
                </div>
              </div>

              <div className="dash-card top-card metric-card kpi-card cancelled-card border border-rose-200/70">
                <div className="kpi-icon cancelled" aria-hidden="true">
                  <FaTimesCircle />
                </div>
                <div className="kpi-copy">
                  <div className="kpi-title">Cancelled</div>
                  <div className="kpi-value">{dashboardData.cancelled}</div>
                  <div className="kpi-meta">Cancelled parcels</div>
                </div>
              </div>

              <div className="dash-card bottom-card growth rounded-2xl">
                <div className="growth-card-header">
                  <div className="card-label">{growthChartSeries.title}</div>
                  <div className="growth-controls">
                    {selectedYear === "All" && (
                      <ModernSelect
                        className="growth-view-select-shell"
                        triggerClassName="growth-view-select"
                        menuClassName="dash-modern-menu"
                        value={growthView}
                        options={growthViewOptions}
                        onChange={(nextValue) => setGrowthView(nextValue)}
                      />
                    )}
                    <ModernSelect
                      className="growth-view-select-shell"
                      triggerClassName="growth-view-select"
                      menuClassName="dash-modern-menu"
                      value={growthChartType}
                      options={growthTypeOptions}
                      onChange={(nextValue) => setGrowthChartType(nextValue)}
                    />
                  </div>
                </div>
                <div className="growth-canvas-shell">
                  {hasGrowthData ? (
                    <canvas ref={growthChartRef}></canvas>
                  ) : (
                    <div className="growth-empty">No delivery data yet</div>
                  )}
                </div>
              </div>

              <div className="dash-card bottom-card kpi-card compact-kpi top-month-card rounded-2xl">
                <div className="kpi-icon month" aria-hidden="true">
                  <FaCalendarAlt />
                </div>
                <div className="kpi-copy">
                  <div className="kpi-title">Top Month</div>
                  <div className="kpi-value">{dashboardData.topMonth}</div>
                  <div className="kpi-meta">{dashboardData.topMonthCount} deliveries</div>
                </div>
              </div>

              <div className="dash-card bottom-card kpi-card compact-kpi top-year-card rounded-2xl">
                <div className="kpi-icon year" aria-hidden="true">
                  <FaChartLine />
                </div>
                <div className="kpi-copy">
                  <div className="kpi-title">Top Year</div>
                  <div className="kpi-value">{dashboardData.topYear}</div>
                  <div className="kpi-meta">{dashboardData.topYearCount} deliveries</div>
                </div>
              </div>

              <div className="dash-card bottom-card kpi-card compact-kpi top-rider-card rounded-2xl">
                <div className="kpi-icon rider" aria-hidden="true">
                  <FaMotorcycle />
                </div>
                <div className="kpi-copy">
                  <div className="kpi-title">Top Rider</div>
                  <div className="kpi-value">{dashboardData.topRider || "--"}</div>
                  <div className="kpi-meta">{dashboardData.topRiderCount} deliveries</div>
                </div>
              </div>

              <div className="dash-card bottom-card violation-map-card rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="violation-map-header">
                  <div className="violation-map-header-top">
                    <h2>Violation Heat Map</h2>
                    <button
                      type="button"
                      className="violation-map-size-btn rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
                      onClick={() => setViolationMapModalOpen(true)}
                    >
                      View Fullscreen Map
                    </button>
                  </div>
                  {violationLogsError && (
                    <p>
                      Unable to load violation logs: {violationLogsError}
                    </p>
                  )}
                </div>
                <div className="violation-map-body">
                  <div className="violation-map-stack">
                    <div
                      ref={violationMapRef}
                      className="violation-map-canvas"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {violationMapModalOpen && (
        <div
          className="dashboard-modal-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setViolationMapModalOpen(false)}
        >
          <div
            className="dashboard-modal-content violation-full-map-modal rounded-2xl border border-slate-200 dark:border-slate-700"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="violation-full-map-header">
              <h2>Violation Heat Map</h2>
              <button
                type="button"
                className="violation-full-map-close"
                onClick={() => setViolationMapModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="violation-full-map-body">
              <div className="violation-full-map-stack">
                <div
                  ref={violationFullMapRef}
                  className="violation-full-map-canvas"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {reportModalOpen && (
        <div
          className="dashboard-modal-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setReportModalOpen(false)}
        >
          <div
            className="dashboard-modal-content dashboard-report-modal rounded-2xl shadow-2xl shadow-slate-900/35"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dashboard-report-modal-header">
              <h2>Generate Reports</h2>
            </div>
            <div className="dashboard-report-modal-body">
              <div className="dashboard-report-layout">
                <div className="dashboard-report-main">
                  <div className="dashboard-report-date-header">
                    <div className="dashboard-report-field">
                      <label>Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="dashboard-report-field">
                      <label>End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="dashboard-report-field full">
                    <label>Report Type</label>
                    <ModernSelect
                      className="dashboard-form-select-shell"
                      triggerClassName="dashboard-form-select-trigger"
                      menuClassName="dash-modern-menu"
                      value={reportType}
                      options={reportTypeOptions}
                      onChange={(nextValue) => setReportType(nextValue)}
                    />
                  </div>

                  <div className="dashboard-report-meta">
                    {reportType === "parcels" && (
                      <div className="dashboard-report-field">
                        <label>Column</label>
                        <ModernSelect
                          className="dashboard-form-select-shell"
                          triggerClassName="dashboard-form-select-trigger"
                          menuClassName="dash-modern-menu"
                          value={column}
                          options={columnsOptions}
                          onChange={(nextValue) => setColumn(nextValue)}
                        />
                      </div>
                    )}
                    <div className="dashboard-report-field">
                      <label>Format</label>
                      <ModernSelect
                        className="dashboard-form-select-shell"
                        triggerClassName="dashboard-form-select-trigger"
                        menuClassName="dash-modern-menu"
                        value={format}
                        options={formatOptions}
                        onChange={(nextValue) => setFormat(nextValue)}
                      />
                    </div>
                  </div>
                </div>

                <div className="dashboard-report-actions-panel">
                  <button
                    type="button"
                    className="dashboard-report-download-btn rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-3 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110"
                    onClick={handleDownloadReport}
                    disabled={isGeneratingReport}
                  >
                    <FaDownload aria-hidden="true" />
                    <span>
                      {isGeneratingReport ? "Downloading..." : "Download"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReportValidation && (
        <div
          className="dashboard-modal-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setShowReportValidation(false)}
        >
          <div
            className="dashboard-modal-content dashboard-report-validation"
            onClick={(event) => event.stopPropagation()}
          >
            <p>All fields are required.</p>
            <button
              type="button"
              onClick={() => setShowReportValidation(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
