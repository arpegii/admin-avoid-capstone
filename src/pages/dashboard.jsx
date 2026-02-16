import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import Chart from "chart.js/auto";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { FaDownload } from "react-icons/fa";
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

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const extractYearKey = (value) => {
  if (!value) return null;
  const text = String(value).trim();

  // Prefer direct string extraction for ISO-like timestamps.
  const directMatch = text.match(/^(\d{4})[-/]/);
  if (directMatch) return directMatch[1];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return String(parsed.getUTCFullYear());
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
  });
  const [loading, setLoading] = useState(true);
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
  const growthChartRef = useRef(null);
  const chartInstanceRef = useRef(null);
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
    async function loadAnalytics() {
      try {
        // Fetch parcels plus assigned rider identity details.
        const { data: parcels, error: parcelsError } = await supabaseClient
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
          );

        if (parcelsError) {
          console.error("Error fetching parcels:", parcelsError);
          setLoading(false);
          return;
        }

        const { data: violations, error: violationsError } = await supabaseClient
          .from("violation_logs")
          .select("*")
          .order("date", { ascending: false });

        if (violationsError) {
          const errorMessage =
            violationsError?.message || "Unknown violation_logs query error";
          console.error("Error fetching violation logs:", violationsError);
          setViolationLogsError(errorMessage);
          setViolationLogs([]);
        } else {
          setViolationLogsError("");
          setViolationLogs(violations || []);
        }

        if (!parcels) {
          setLoading(false);
          return;
        }

        // Count delivered parcels (status = "successfully delivered")
        const delivered = parcels.filter(
          (p) => normalizeStatus(p.status) === "successfully delivered",
        ).length;

        // Count cancelled parcels (status = "cancelled")
        const cancelled = parcels.filter(
          (p) => normalizeStatus(p.status) === "cancelled",
        ).length;

        const months = {};
        const yearsCount = {};
        const riderCountsById = {};
        const riderNameById = {};
        let topMonth = "";
        let topMonthCount = 0;
        let topYear = "";
        let topYearCount = 0;
        let topRiderId = "";
        let topRiderCount = 0;

        // Process delivered parcels for analytics.
        parcels.forEach((p) => {
          if (normalizeStatus(p.status) !== "successfully delivered") return;

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
            const monthStr = date.toLocaleString("default", {
              month: "long",
            });
            months[monthStr] = (months[monthStr] || 0) + 1;
            if (months[monthStr] > topMonthCount) {
              topMonth = monthStr;
              topMonthCount = months[monthStr];
            }
          }

          yearsCount[yearStr] = (yearsCount[yearStr] || 0) + 1;
          if (yearsCount[yearStr] > topYearCount) {
            topYear = yearStr;
            topYearCount = yearsCount[yearStr];
          }
        });

        // Sort years chronologically and prepare growth data
        const sortedYears = Object.keys(yearsCount).sort(
          (a, b) => Number(a) - Number(b),
        );
        const yearGrowthData = sortedYears.map((y) => yearsCount[y]);

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
          years: sortedYears,
          yearGrowth: yearGrowthData,
        });
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, []);

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
        .order("parcel_id", { ascending: true });
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
        .order("parcel_id", { ascending: true });
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
    const headerHeight = 35;

    doc.setFillColor(163, 0, 0);
    doc.rect(0, 0, pageWidth, headerHeight, "F");
    doc.setTextColor(255, 255, 255);
    try {
      const logoDataUrl = await loadImageAsDataUrl("/images/logo.png");
      doc.addImage(logoDataUrl, "PNG", pageWidth / 2 - 18, 3, 36, 36);
    } catch (error) {
      console.error("Failed to add logo to PDF header:", error);
    }
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(12);
    const infoTexts = [
      `Report Type: ${humanizeLabel(selectedReportType)}`,
      `Start: ${selectedStartDate || "-"}`,
      `End: ${selectedEndDate || "-"}`,
    ];
    if (selectedReportType === "parcels") {
      infoTexts.push(`Column: ${humanizeLabel(selectedColumn)}`);
    }
    const spacing = 20;
    let totalWidth = infoTexts.reduce(
      (sum, text) => sum + doc.getTextWidth(text),
      0,
    );
    totalWidth += spacing * (infoTexts.length - 1);
    let startX = (pageWidth - totalWidth) / 2;
    const infoY = headerHeight + 12;

    infoTexts.forEach((text) => {
      doc.text(text, startX, infoY);
      startX += doc.getTextWidth(text) + spacing;
    });

    if (selectedReportType === "overall") {
      let yOffset = infoY + 10;
      data.forEach((section) => {
        doc.setFontSize(12);
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
            ? [row.username, row.email, row.status, row.created_at]
            : section.section === "Violations"
              ? [row.name, row.violation, row.date]
              : [
                  row.parcel_id,
                  row.recipient_name,
                  row.recipient_phone,
                  row.address,
                  row.assigned_rider,
                  row.status,
                  row.created_at,
                ],
        );
        autoTable(doc, {
          startY: yOffset + 4,
          head: [head],
          body,
          styles: { fontSize: 9 },
        });
        yOffset = doc.lastAutoTable.finalY + 10;
      });
    } else {
      const head = columns.map(humanizeLabel);
      const body = data.map((row) => columns.map((c) => row[c] || "-"));
      autoTable(doc, {
        startY: infoY + 10,
        head: [head],
        body,
        styles: { fontSize: 9 },
      });
    }

    return doc;
  };

  const buildCsvContent = (selectedReportType, selectedColumn, data) => {
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
        csv += cols.join(",") + "\n";
        section.data.forEach((row) => {
          csv +=
            cols
              .map((c) => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`)
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
      csv += reportCols.join(",") + "\n";
      data.forEach((row) => {
        csv +=
          reportCols
            .map((c) => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`)
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

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
    if (!growthChartRef.current || !dashboardData.years.length) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    chartInstanceRef.current = new Chart(growthChartRef.current, {
      type: "line",
      data: {
        labels: dashboardData.years,
        datasets: [
          {
            data: dashboardData.yearGrowth,
            borderColor: "#ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.16)",
            fill: true,
            tension: 0.35,
            pointRadius: 2.6,
            pointHoverRadius: 4,
            pointBackgroundColor: "#ef4444",
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
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (context) => `📦 Deliveries: ${context.parsed.y ?? 0}`,
            },
          },
        },
        scales: {
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
  }, [dashboardData.years, dashboardData.yearGrowth]);

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
                  className="dash-generate-report-btn rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110"
                  onClick={() => setReportModalOpen(true)}
                >
                  Generate Report
                </button>
                <span className="date-range">{todayLabel}</span>
              </div>
            </div>

            <div className="dash-grid two-rows">
              <div className="dash-card top-card metric-card delivered-card border border-emerald-200/60">
                <div className="metric-pill success">Delivered</div>
                <div className="card-value delivered">
                  {dashboardData.delivered}
                </div>
              </div>

              <div className="dash-card top-card metric-card cancelled-card border border-rose-200/70">
                <div className="metric-pill warning">Cancelled</div>
                <div className="card-value delayed">
                  {dashboardData.cancelled}
                </div>
              </div>

              <div className="dash-card bottom-card growth rounded-2xl">
                <div className="card-label">Delivery Growth by Year</div>
                <div className="growth-canvas-shell">
                  {dashboardData.years.length > 0 ? (
                    <canvas ref={growthChartRef}></canvas>
                  ) : (
                    <div className="growth-empty">No delivery data yet</div>
                  )}
                </div>
              </div>

              <div className="dash-card bottom-card performance-highlight-standalone top-month-card rounded-2xl">
                <div className="performance-highlight-label">Top Month</div>
                <div className="performance-highlight-value">
                  {dashboardData.topMonth}
                </div>
                <div className="performance-highlight-meta">
                  {dashboardData.topMonthCount} deliveries
                </div>
              </div>

              <div className="dash-card bottom-card performance-highlight-standalone top-year-card rounded-2xl">
                <div className="performance-highlight-label">Top Year</div>
                <div className="performance-highlight-value">
                  {dashboardData.topYear}
                </div>
                <div className="performance-highlight-meta">
                  {dashboardData.topYearCount} deliveries
                </div>
              </div>

              <div className="dash-card bottom-card performance-highlight-standalone top-rider-card rounded-2xl">
                <div className="performance-highlight-label">Top Rider</div>
                <div className="performance-highlight-value">
                  {dashboardData.topRider || "--"}
                </div>
                <div className="performance-highlight-meta">
                  {dashboardData.topRiderCount} deliveries
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
                    <select
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value)}
                    >
                      <option value="">-- Select Report Type --</option>
                      <option value="parcels">Parcels</option>
                      <option value="riders">Riders</option>
                      <option value="violations">Violations</option>
                      <option value="overall">Overall Reports</option>
                    </select>
                  </div>

                  <div className="dashboard-report-meta">
                    {reportType === "parcels" && (
                      <div className="dashboard-report-field">
                        <label>Column</label>
                        <select
                          value={column}
                          onChange={(e) => setColumn(e.target.value)}
                        >
                          {columnsOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="dashboard-report-field">
                      <label>Format</label>
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                      >
                        <option value="pdf">PDF</option>
                        <option value="csv">CSV</option>
                      </select>
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
