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
import { exportReportAsWorkbook } from "../utils/reportExcel";

const humanizeLabel = (label) => {
  if (!label) return "";
  if (label === "All") return "All";
  if (label === "delivery_attempt") return "Delivery Attempt";
  if (label === "attempt1_status") return "Attempt 1 Status";
  if (label === "attempt1_date") return "Attempt 1 Date";
  if (label === "attempt2_status") return "Attempt 2 Status";
  if (label === "attempt2_date") return "Attempt 2 Date";
  if (label === "fname") return "First Name";
  if (label === "mname") return "Middle Name";
  if (label === "lname") return "Last Name";
  if (label === "doj") return "Date of Join";
  if (label === "pnumber") return "Phone Number";
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
  if (
    columnKey === "created_at" ||
    columnKey === "date" ||
    columnKey === "doj" ||
    /_date$/i.test(columnKey)
  ) {
    return formatPdfDate(value);
  }

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

const getPdfStatusTextColor = (value) => {
  const normalized = normalizeStatus(value);
  if (!normalized || normalized === "-") return null;
  if (
    normalized === "successfully delivered" ||
    normalized === "delivered" ||
    normalized === "successful" ||
    normalized === "success" ||
    normalized === "completed"
  ) {
    return [22, 163, 74];
  }
  if (
    normalized === "on going" ||
    normalized === "ongoing" ||
    normalized === "in progress" ||
    normalized === "pending"
  ) {
    return [202, 138, 4];
  }
  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "failed" ||
    normalized === "failure"
  ) {
    return [220, 38, 38];
  }
  return null;
};

const applyPdfStatusCellColor = (tableData) => {
  if (tableData.section !== "body") return;
  const rawValue = Array.isArray(tableData.cell.text)
    ? tableData.cell.text.join(" ")
    : tableData.cell.raw;
  const color = getPdfStatusTextColor(rawValue);
  if (!color) return;
  tableData.cell.styles.textColor = color;
  tableData.cell.styles.fontStyle = "bold";
};

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
  { value: "delivery_attempt", label: "Delivery Attempt" },
  { value: "created_at", label: "Created at" },
];

const DELIVERY_ATTEMPT_COLUMNS = [
  "attempt1_status",
  "attempt1_date",
  "attempt2_status",
  "attempt2_date",
];

const riderColumns = [
  { value: "All", label: "All" },
  { value: "username", label: "Username" },
  { value: "email", label: "Email" },
  { value: "fname", label: "First name" },
  { value: "mname", label: "Middle name" },
  { value: "lname", label: "Last name" },
  { value: "gender", label: "Gender" },
  { value: "doj", label: "Date of join" },
  { value: "pnumber", label: "Phone number" },
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

const getSafePercent = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const buildMonthlyCounts = (rows = [], dateKey) => {
  const values = Array(12).fill(0);
  (rows || []).forEach((row) => {
    const parsed = new Date(row?.[dateKey]);
    if (Number.isNaN(parsed.getTime())) return;
    values[parsed.getMonth()] += 1;
  });
  return { labels: MONTH_LABELS, values };
};

const buildYearlyCounts = (rows = [], dateKey) => {
  const yearMap = {};
  (rows || []).forEach((row) => {
    const year = extractYearKey(row?.[dateKey]);
    if (!year) return;
    yearMap[year] = (yearMap[year] || 0) + 1;
  });
  const labels = Object.keys(yearMap).sort((a, b) => Number(a) - Number(b));
  return { labels, values: labels.map((label) => yearMap[label] || 0) };
};

const buildWeekdayCounts = (rows = [], dateKey) => {
  const values = Array(7).fill(0);
  (rows || []).forEach((row) => {
    const parsed = new Date(row?.[dateKey]);
    if (Number.isNaN(parsed.getTime())) return;
    values[parsed.getDay()] += 1;
  });
  return { labels: WEEKDAY_LABELS, values };
};

const buildHourlyCounts = (rows = [], dateKey) => {
  const values = Array(24).fill(0);
  (rows || []).forEach((row) => {
    const parsed = new Date(row?.[dateKey]);
    if (Number.isNaN(parsed.getTime())) return;
    values[parsed.getHours()] += 1;
  });
  const labels = values.map((_, hour) => `${String(hour).padStart(2, "0")}:00`);
  return { labels, values };
};

const topEntries = (mapObject, limit = 5) =>
  Object.entries(mapObject || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

const countBy = (rows = [], resolver) => {
  const map = {};
  (rows || []).forEach((row) => {
    const key = resolver(row);
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return map;
};

const buildParcelsAnalytics = (parcels = []) => {
  const deliveredRows = parcels.filter((parcel) => isDeliveredStatus(parcel?.status));
  const delivered = deliveredRows.length;
  const cancelled = parcels.filter((parcel) => isCancelledStatus(parcel?.status)).length;
  const delayed = parcels.filter((parcel) =>
    normalizeStatus(parcel?.attempt1_status) === "failed" ||
    normalizeStatus(parcel?.attempt2_status) === "failed" ||
    isCancelledStatus(parcel?.status),
  ).length;
  const undelivered = Math.max(parcels.length - delivered - cancelled, 0);
  const firstAttemptSuccessCount = deliveredRows.filter((parcel) =>
    normalizeStatus(parcel?.attempt1_status) === "success" ||
    normalizeStatus(parcel?.attempt1_status) === "successfully delivered",
  ).length;
  const riderCountMap = countBy(deliveredRows, (parcel) => parcel?.assigned_rider || "Unassigned");
  const topRiders = topEntries(riderCountMap, 5);
  const monthlyDeliveries = buildMonthlyCounts(deliveredRows, "created_at");
  const yearlyDeliveries = buildYearlyCounts(deliveredRows, "created_at");
  const activeDaySet = new Set(
    deliveredRows
      .map((parcel) => {
        const parsed = new Date(parcel?.created_at);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
      })
      .filter(Boolean),
  );
  const avgPerActiveDay = activeDaySet.size ? delivered / activeDaySet.size : 0;

  return {
    summaryRows: [
      ["Total Parcels", String(parcels.length)],
      ["Delivered", String(delivered)],
      ["Cancelled", String(cancelled)],
      ["In Progress/Other", String(undelivered)],
      ["Delayed", String(delayed)],
      ["Delivery Rate", `${getSafePercent(delivered, parcels.length).toFixed(1)}%`],
      ["Cancellation Rate", `${getSafePercent(cancelled, parcels.length).toFixed(1)}%`],
      ["Delay Rate", `${getSafePercent(delayed, parcels.length).toFixed(1)}%`],
      ["First Attempt Success", `${getSafePercent(firstAttemptSuccessCount, delivered).toFixed(1)}%`],
      ["Avg Deliveries per Active Day", avgPerActiveDay.toFixed(2)],
      ["Top Rider", topRiders[0] ? `${topRiders[0][0]} (${topRiders[0][1]})` : "N/A"],
    ],
    charts: [
      {
        title: "Parcel Status Mix",
        type: "doughnut",
        labels: ["Delivered", "Cancelled", "In Progress/Other"],
        values: [delivered, cancelled, undelivered],
        colors: ["#16a34a", "#ef4444", "#94a3b8"],
      },
      {
        title: "Monthly Deliveries",
        type: "line",
        labels: monthlyDeliveries.labels,
        values: monthlyDeliveries.values,
        datasetLabel: "Deliveries",
        colors: ["#0ea5e9"],
      },
      {
        title: "Delay vs Cancellation Risk (%)",
        type: "bar",
        labels: ["Delay %", "Cancellation %"],
        values: [
          Number(getSafePercent(delayed, parcels.length).toFixed(1)),
          Number(getSafePercent(cancelled, parcels.length).toFixed(1)),
        ],
        datasetLabel: "Rate",
        colors: ["#f59e0b", "#ef4444"],
      },
      {
        title: "Top Riders by Delivered Parcels",
        type: "bar",
        labels: topRiders.map(([label]) => label),
        values: topRiders.map(([, count]) => count),
        datasetLabel: "Deliveries",
        colors: ["#2563eb"],
      },
      {
        title: yearlyDeliveries.labels.length > 1 ? "Yearly Deliveries Trend" : "Monthly Deliveries Trend",
        type: "line",
        labels: yearlyDeliveries.labels.length > 1 ? yearlyDeliveries.labels : monthlyDeliveries.labels,
        values: yearlyDeliveries.labels.length > 1 ? yearlyDeliveries.values : monthlyDeliveries.values,
        datasetLabel: "Deliveries",
        colors: ["#14b8a6"],
      },
    ],
  };
};

const buildViolationsAnalytics = (violations = []) => {
  const byType = countBy(violations, (row) => String(row?.violation || "Unknown violation"));
  const byRider = countBy(violations, (row) => String(row?.name || "Unknown rider"));
  const monthly = buildMonthlyCounts(violations, "date");
  const weekday = buildWeekdayCounts(violations, "date");
  const hourly = buildHourlyCounts(violations, "date");
  const topTypes = topEntries(byType, 8);
  const topRiders = topEntries(byRider, 8);
  const busiestMonthIndex = monthly.values.reduce(
    (best, value, index, arr) => (value > arr[best] ? index : best),
    0,
  );
  const activeDays = new Set(
    violations
      .map((row) => {
        const parsed = new Date(row?.date);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
      })
      .filter(Boolean),
  );
  const avgPerActiveDay = activeDays.size ? violations.length / activeDays.size : 0;

  return {
    summaryRows: [
      ["Total Violations", String(violations.length)],
      ["Distinct Violation Types", String(Object.keys(byType).length)],
      ["Riders Flagged", String(Object.keys(byRider).length)],
      ["Avg Violations per Active Day", avgPerActiveDay.toFixed(2)],
      ["Top Violation Type", topTypes[0] ? `${topTypes[0][0]} (${topTypes[0][1]})` : "N/A"],
      ["Most Flagged Rider", topRiders[0] ? `${topRiders[0][0]} (${topRiders[0][1]})` : "N/A"],
      ["Busiest Month", `${MONTH_LABELS[busiestMonthIndex]} (${monthly.values[busiestMonthIndex] || 0})`],
    ],
    charts: [
      {
        title: "Monthly Violation Trend",
        type: "line",
        labels: monthly.labels,
        values: monthly.values,
        datasetLabel: "Violations",
        colors: ["#f59e0b"],
      },
      {
        title: "Top Violation Types",
        type: "bar",
        labels: topTypes.map(([label]) => label),
        values: topTypes.map(([, count]) => count),
        datasetLabel: "Incidents",
        colors: ["#ef4444"],
      },
      {
        title: "Most Flagged Riders",
        type: "bar",
        labels: topRiders.map(([label]) => label),
        values: topRiders.map(([, count]) => count),
        datasetLabel: "Incidents",
        colors: ["#8b5cf6"],
      },
      {
        title: "Violations by Weekday",
        type: "bar",
        labels: weekday.labels,
        values: weekday.values,
        datasetLabel: "Incidents",
        colors: ["#0ea5e9"],
      },
      {
        title: "Violations by Hour",
        type: "line",
        labels: hourly.labels,
        values: hourly.values,
        datasetLabel: "Incidents",
        colors: ["#fb7185"],
      },
    ],
  };
};

const buildRidersAnalytics = (riders = []) => {
  const monthlyJoins = buildMonthlyCounts(riders, "created_at");
  const genderMap = countBy(riders, (row) => String(row?.gender || "Unknown"));
  const topJoinMonthIndex = monthlyJoins.values.reduce(
    (best, value, index, arr) => (value > arr[best] ? index : best),
    0,
  );
  return {
    summaryRows: [
      ["Total Riders", String(riders.length)],
      ["Distinct Gender Values", String(Object.keys(genderMap).length)],
      ["Top Join Month", `${MONTH_LABELS[topJoinMonthIndex]} (${monthlyJoins.values[topJoinMonthIndex] || 0})`],
    ],
    charts: [
      {
        title: "Rider Gender Distribution",
        type: "doughnut",
        labels: Object.keys(genderMap),
        values: Object.values(genderMap),
        colors: ["#3b82f6", "#ec4899", "#22c55e", "#f59e0b", "#a855f7"],
      },
      {
        title: "Monthly Rider Joins",
        type: "line",
        labels: monthlyJoins.labels,
        values: monthlyJoins.values,
        colors: ["#0ea5e9"],
        datasetLabel: "Riders",
      },
    ],
  };
};

const buildReportAnalyticsBundle = (reportType, data) => {
  if (reportType === "overall") {
    const parcels = (data || []).find((section) => section?.section === "Parcels")?.data || [];
    const riders = (data || []).find((section) => section?.section === "Riders")?.data || [];
    const violations = (data || []).find((section) => section?.section === "Violations")?.data || [];
    const parcelAnalytics = buildParcelsAnalytics(parcels);
    const violationsAnalytics = buildViolationsAnalytics(violations);
    return {
      summaryRows: [
        ["Total Parcels", String(parcels.length)],
        ["Total Riders", String(riders.length)],
        ["Total Violations", String(violations.length)],
        ...parcelAnalytics.summaryRows.slice(3, 8),
        ["Top Violation Type", violationsAnalytics.summaryRows[4]?.[1] || "N/A"],
        ["Most Flagged Rider", violationsAnalytics.summaryRows[5]?.[1] || "N/A"],
      ],
      charts: [
        ...parcelAnalytics.charts.slice(0, 3),
        ...violationsAnalytics.charts.slice(0, 3),
      ],
    };
  }
  if (reportType === "parcels") return buildParcelsAnalytics(data || []);
  if (reportType === "violations") return buildViolationsAnalytics(data || []);
  if (reportType === "riders") return buildRidersAnalytics(data || []);
  return { summaryRows: [], charts: [] };
};

const buildChartImageFromSpec = async (spec, width = 900, height = 360) => {
  if (!spec || !Array.isArray(spec.labels) || !Array.isArray(spec.values) || !spec.values.length) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const palette = Array.isArray(spec.colors) && spec.colors.length
    ? spec.colors
    : ["#ef4444", "#0ea5e9", "#16a34a", "#f59e0b", "#8b5cf6"];
  const isCircular = spec.type === "doughnut" || spec.type === "pie";
  const chart = new Chart(context, {
    type: spec.type || "line",
    data: {
      labels: spec.labels,
      datasets: [
        {
          label: spec.datasetLabel || "Value",
          data: spec.values,
          borderColor: isCircular ? palette : palette[0],
          backgroundColor: isCircular
            ? palette
            : spec.type === "bar"
              ? spec.values.map((_, idx) => palette[idx % palette.length])
              : `${palette[0]}33`,
          borderWidth: 2,
          tension: 0.35,
          fill: !isCircular,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: isCircular, position: "right" },
      },
      scales: isCircular
        ? undefined
        : {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const dataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  return { title: spec.title || "Chart", dataUrl };
};

const buildReportChartImages = async (chartSpecs = []) => {
  const images = [];
  for (const spec of (chartSpecs || []).slice(0, 6)) {
    const image = await buildChartImageFromSpec(spec);
    if (image) images.push(image);
  }
  return images;
};

const resolveReportGeneratedBy = async () => {
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    const metadata = user?.user_metadata || {};
    const explicitName = String(
      metadata.full_name ||
      metadata.name ||
      [metadata.fname || metadata.first_name, metadata.lname || metadata.last_name]
        .filter(Boolean)
        .join(" "),
    ).trim();
    if (explicitName) return explicitName;

    const userEmail = user?.email;
    if (userEmail) {
      const { data: profileRows } = await supabaseClient
        .from("users")
        .select("fname,lname,username,email")
        .eq("email", userEmail)
        .limit(1);
      const profile = profileRows?.[0];
      const profileName = String(`${profile?.fname || ""} ${profile?.lname || ""}`).trim();
      if (profileName) return profileName;
      if (profile?.username) return String(profile.username);

      const localPart = String(userEmail).split("@")[0].replace(/[._-]+/g, " ");
      if (localPart.trim()) {
        return localPart
          .split(" ")
          .filter(Boolean)
          .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
          .join(" ");
      }
    }
    return "Unknown User";
  } catch {
    return "Unknown User";
  }
};

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
    totalParcels: 0,
    delivered: 0,
    cancelled: 0,
    delayed: 0,
    topMonth: "--",
    topMonthCount: 0,
    topYear: "--",
    topYearCount: 0,
    topRider: "--",
    topRiderCount: 0,
    years: [],
    yearGrowth: [],
    monthGrowth: Array(12).fill(0),
    yearDelayGrowth: [],
    monthDelayGrowth: Array(12).fill(0),
  });
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("All");
  const [isYearSwitching, setIsYearSwitching] = useState(false);
  const [dashboardView, setDashboardView] = useState("overview");
  const [growthView, setGrowthView] = useState("year");
  const [growthMetric, setGrowthMetric] = useState("deliveries");
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
  const analyticsConversionChartRef = useRef(null);
  const analyticsRiskChartRef = useRef(null);
  const analyticsTrendChartRef = useRef(null);
  const analyticsConversionChartInstanceRef = useRef(null);
  const analyticsRiskChartInstanceRef = useRef(null);
  const analyticsTrendChartInstanceRef = useRef(null);
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
    const isDelayMetric = growthMetric === "delays";
    if (growthView === "month") {
      return {
        labels: MONTH_LABELS,
        data: isDelayMetric
          ? (dashboardData.monthDelayGrowth || Array(12).fill(0))
          : (dashboardData.monthGrowth || Array(12).fill(0)),
        title: isDelayMetric ? "Delivery Delay Analysis by Month" : "Delivery Growth by Month",
      };
    }

    return {
      labels: dashboardData.years,
      data: isDelayMetric ? dashboardData.yearDelayGrowth : dashboardData.yearGrowth,
      title: isDelayMetric ? "Delivery Delay Analysis by Year" : "Delivery Growth by Year",
    };
  }, [
    growthView,
    growthMetric,
    dashboardData.monthGrowth,
    dashboardData.monthDelayGrowth,
    dashboardData.years,
    dashboardData.yearGrowth,
    dashboardData.yearDelayGrowth,
  ]);

  const hasGrowthData = useMemo(
    () => (growthChartSeries.data || []).some((value) => Number(value) > 0),
    [growthChartSeries.data],
  );
  const analyticsSummary = useMemo(() => {
    const totalParcels = Number(dashboardData.totalParcels) || 0;
    const delivered = Number(dashboardData.delivered) || 0;
    const cancelled = Number(dashboardData.cancelled) || 0;
    const delayed = Number(dashboardData.delayed) || 0;
    const safeTotal = totalParcels > 0 ? totalParcels : 1;

    const deliveryRate = (delivered / safeTotal) * 100;
    const cancellationRate = (cancelled / safeTotal) * 100;
    const delayRate = (delayed / safeTotal) * 100;
    const activeMonths = (dashboardData.monthGrowth || []).filter((value) => Number(value) > 0).length;
    const activeYears = (dashboardData.yearGrowth || []).filter((value) => Number(value) > 0).length;
    const averageMonthlyDeliveries = activeMonths > 0 ? delivered / activeMonths : 0;
    const averageYearlyDeliveries = activeYears > 0 ? delivered / activeYears : 0;

    const isAllYears = selectedYear === "All";
    let trendLabel = isAllYears ? "No yearly trend yet" : "No monthly trend yet";
    if (isAllYears) {
      const yearlySeries = (dashboardData.yearGrowth || [])
        .map((value, index) => ({
          label: dashboardData.years?.[index] || `Year ${index + 1}`,
          value: Number(value) || 0,
        }))
        .filter((entry) => entry.value > 0);

      if (yearlySeries.length >= 2) {
        const latestYear = yearlySeries[yearlySeries.length - 1];
        const previousYear = yearlySeries[yearlySeries.length - 2];
        const deltaPercent = ((latestYear.value - previousYear.value) / previousYear.value) * 100;
        trendLabel = `${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}% ${latestYear.label} vs ${previousYear.label}`;
      } else if (yearlySeries.length === 1) {
        trendLabel = `Activity started in ${yearlySeries[0].label}`;
      }
    } else {
      const monthlySeries = dashboardData.monthGrowth || [];
      const activeMonthlySeries = monthlySeries
        .map((value, index) => ({
          label: MONTH_LABELS[index],
          value: Number(value) || 0,
        }))
        .filter((entry) => entry.value > 0);

      if (activeMonthlySeries.length >= 2) {
        const latestMonth = activeMonthlySeries[activeMonthlySeries.length - 1];
        const previousMonth = activeMonthlySeries[activeMonthlySeries.length - 2];
        const deltaPercent = ((latestMonth.value - previousMonth.value) / previousMonth.value) * 100;
        trendLabel = `${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}% ${latestMonth.label} vs ${previousMonth.label}`;
      } else if (activeMonthlySeries.length === 1) {
        trendLabel = `Activity started in ${activeMonthlySeries[0].label}`;
      }
    }

    return {
      totalParcels,
      deliveryRate,
      cancellationRate,
      delayRate,
      averageMonthlyDeliveries,
      averageYearlyDeliveries,
      trendMode: isAllYears ? "yearly" : "monthly",
      trendLabel,
    };
  }, [dashboardData, selectedYear]);

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
  const growthMetricOptions = useMemo(
    () => [
      { value: "deliveries", label: "Deliveries" },
      { value: "delays", label: "Delays" },
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
      { value: "xlsx", label: "Excel" },
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
        <span class="violation-warning-marker" aria-hidden="true">&#9888;</span>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -34],
    });

    layerGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 52,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const clusterSize = 56;
        const halfSize = 28;

        return L.divIcon({
          className: "violation-cluster-wrap",
          html: `
              <span class="violation-cluster-pulse" aria-hidden="true"></span>
              <span class="violation-cluster-ring" aria-hidden="true"></span>
              <span class="violation-cluster-core">
                <strong class="violation-cluster-count">${count}</strong>
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
          {
            className: "violation-hotspot-popup",
            closeButton: false,
            autoPan: false,
            keepInView: false,
          },
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
        const isDelayedParcel = (parcel) =>
          normalizeStatus(parcel?.attempt1_status) === "failed" ||
          normalizeStatus(parcel?.attempt2_status) === "failed" ||
          isCancelledStatus(parcel?.status);
        const delayed = parcelsForSelectedYear.filter((p) => isDelayedParcel(p)).length;

        const months = {};
        const monthCounts = Array(12).fill(0);
        const monthDelayCounts = Array(12).fill(0);
        const yearsCount = Object.fromEntries(
          safeAnalyticsYears.map((year) => [year, 0]),
        );
        const yearsDelayCount = Object.fromEntries(
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
          if (p.created_at) {
            const parsedDate = new Date(p.created_at);
            const yearStr = extractYearKey(p.created_at);
            if (!Number.isNaN(parsedDate.getTime()) && yearStr && isDelayedParcel(p)) {
              const monthIndex = parsedDate.getMonth();
              if (monthIndex >= 0 && monthIndex <= 11) {
                monthDelayCounts[monthIndex] = (monthDelayCounts[monthIndex] || 0) + 1;
              }
              yearsDelayCount[yearStr] = (yearsDelayCount[yearStr] || 0) + 1;
            }
          }

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
        const yearDelayGrowthData =
          selectedYear === "All"
            ? chartYears.map((y) => yearsDelayCount[y] || 0)
            : [yearsDelayCount[selectedYear] || 0];

        setDashboardData({
          totalParcels: parcelsForSelectedYear.length || 0,
          delivered: delivered || 0,
          cancelled: cancelled || 0,
          delayed: delayed || 0,
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
          yearDelayGrowth: yearDelayGrowthData,
          monthDelayGrowth: monthDelayCounts,
        });
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
        setIsYearSwitching(false);
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
      const parcels = await fetchAllPages(() => {
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
        return query;
      });
      data = normalizeParcelsForReport(parcels);
      columns =
        selectedColumn === "All"
          ? [
              "parcel_id",
              "recipient_name",
              "recipient_phone",
              "address",
              "assigned_rider",
              "status",
              ...DELIVERY_ATTEMPT_COLUMNS,
              "created_at",
            ]
          : selectedColumn === "delivery_attempt"
            ? ["parcel_id", ...DELIVERY_ATTEMPT_COLUMNS]
            : ["parcel_id", selectedColumn];
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
      columns = [
        "username",
        "email",
        "fname",
        "mname",
        "lname",
        "gender",
        "doj",
        "pnumber",
      ];
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
      const parcelQueryBuilder = () => {
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
        if (selectedStartDate)
          query = query.gte("created_at", selectedStartDate);
        if (selectedEndDate)
          query = query.lte("created_at", `${selectedEndDate}T23:59:59`);
        return query;
      };
      let riderQuery = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      let violationQuery = supabaseClient
        .from("violation_logs")
        .select("violation, name, date")
        .order("date", { ascending: false });
      if (selectedStartDate)
        violationQuery = violationQuery.gte("date", selectedStartDate);
      if (selectedEndDate)
        violationQuery = violationQuery.lte("date", `${selectedEndDate}T23:59:59`);

      const [parcels, ridersRes, violationsRes] = await Promise.all([
        fetchAllPages(parcelQueryBuilder),
        riderQuery,
        violationQuery,
      ]);
      if (ridersRes.error) throw ridersRes.error;
      if (violationsRes.error) throw violationsRes.error;

      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: normalizeParcelsForReport(parcels) },
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
    reportAnalytics,
    reportChartImages,
    generatedBy,
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
      ["Generated By", generatedBy || "Unknown User"],
      ["Generated", generatedAt],
    ];
    autoTable(doc, {
      startY: headerHeight + 6,
      margin: { left: 12, right: 12 },
      head: [["Detail", "Value"]],
      body: metaRows.map(([label, value]) => [label, value]),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9.2,
        textColor: [31, 41, 55],
        lineColor: [209, 213, 219],
        lineWidth: 0.25,
        cellPadding: 2.2,
      },
      headStyles: {
        fillColor: [239, 68, 68],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 44, fontStyle: "bold" },
        1: { cellWidth: "auto" },
      },
      didParseCell: (tableData) => {
        if (tableData.section === "body" && tableData.row.index % 2 === 1) {
          tableData.cell.styles.fillColor = [250, 250, 251];
        }
      },
    });

    let contentY = doc.lastAutoTable.finalY + 8;
    if (reportAnalytics?.summaryRows?.length) {
      autoTable(doc, {
        startY: contentY,
        margin: { left: 12, right: 12 },
        head: [["Analytics KPI", "Result"]],
        body: reportAnalytics.summaryRows.map(([label, value]) => [label, String(value ?? "-")]),
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 9,
          textColor: [31, 41, 55],
          lineColor: [209, 213, 219],
          lineWidth: 0.2,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 68, fontStyle: "bold" },
          1: { cellWidth: "auto" },
        },
        didParseCell: (tableData) => {
          if (tableData.section === "body" && tableData.row.index % 2 === 1) {
            tableData.cell.styles.fillColor = [248, 250, 252];
          }
        },
      });
      contentY = doc.lastAutoTable.finalY + 8;
    }

    if ((reportChartImages || []).length) {
      const chartGap = 8;
      const marginX = 12;
      const chartWidth = (pageWidth - (marginX * 2) - chartGap) / 2;
      const chartHeight = 50;
      const rowHeight = chartHeight + 9;
      let chartY = contentY;

      reportChartImages.forEach((chartImage, index) => {
        if (index % 2 === 0 && chartY + rowHeight > pageHeight - 14) {
          doc.addPage();
          chartY = 16;
        }
        const isRight = index % 2 === 1;
        const chartX = marginX + (isRight ? chartWidth + chartGap : 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(chartImage.title || "Analytics Chart", chartX, chartY + 3);
        doc.addImage(chartImage.dataUrl, "PNG", chartX, chartY + 5, chartWidth, chartHeight);
        if (isRight || index === reportChartImages.length - 1) {
          chartY += rowHeight;
        }
      });
      contentY = chartY + 2;
    }

    if (selectedReportType === "overall") {
      let yOffset = contentY + 4;
      data.forEach((section) => {
        if (yOffset > pageHeight - 28) {
          doc.addPage();
          yOffset = 16;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.setTextColor(17, 24, 39);
        doc.text(section.section, 10, yOffset);
        const head =
          section.section === "Riders"
            ? [
                "Username",
                "Email",
                "First Name",
                "Middle Name",
                "Last Name",
                "Gender",
                "Date of Join",
                "Phone Number",
              ]
            : section.section === "Violations"
              ? ["Name", "Violation", "Date"]
              : [
                  "Parcel ID",
                  "Recipient Name",
                  "Phone",
                  "Address",
                  "Rider",
                  "Status",
                  "Attempt 1 Status",
                  "Attempt 1 Date",
                  "Attempt 2 Status",
                  "Attempt 2 Date",
                  "Created At",
                ];
        const body = section.data.map((row) =>
          section.section === "Riders"
            ? [
                formatPdfCellValue(row.username, "username"),
                formatPdfCellValue(row.email, "email"),
                formatPdfCellValue(row.fname, "fname"),
                formatPdfCellValue(row.mname, "mname"),
                formatPdfCellValue(row.lname, "lname"),
                formatPdfCellValue(row.gender, "gender"),
                formatPdfCellValue(row.doj, "doj"),
                formatPdfCellValue(row.pnumber, "pnumber"),
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
                  formatPdfCellValue(row.attempt1_status, "attempt1_status"),
                  formatPdfCellValue(row.attempt1_date, "attempt1_date"),
                  formatPdfCellValue(row.attempt2_status, "attempt2_status"),
                  formatPdfCellValue(row.attempt2_date, "attempt2_date"),
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
          didParseCell: applyPdfStatusCellColor,
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
      if (contentY > pageHeight - 30) {
        doc.addPage();
        contentY = 16;
      }
      autoTable(doc, {
        startY: contentY + 4,
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
        didParseCell: applyPdfStatusCellColor,
      });
    }

    return doc;
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
    const reportAnalytics = buildReportAnalyticsBundle(selectedReportType, data);
    const reportChartImages = await buildReportChartImages(reportAnalytics.charts);
    const generatedBy = await resolveReportGeneratedBy();
    const doc = await buildPdfDoc(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn,
      data,
      columns,
      reportAnalytics,
      reportChartImages,
      generatedBy,
    );
    doc.save(`${selectedReportType}_report.pdf`);
  };

  const resolveOverallSectionColumns = (sectionName) => {
    if (sectionName === "Riders") {
      return ["username", "email", "fname", "mname", "lname", "gender", "doj", "pnumber"];
    }
    if (sectionName === "Violations") return ["name", "violation", "date"];
    return [
      "parcel_id",
      "recipient_name",
      "recipient_phone",
      "address",
      "assigned_rider",
      "status",
      ...DELIVERY_ATTEMPT_COLUMNS,
      "created_at",
    ];
  };

  const generateExcelReport = async (
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
    const reportAnalytics = buildReportAnalyticsBundle(selectedReportType, data);
    const reportChartImages = await buildReportChartImages(reportAnalytics.charts);
    const generatedBy = await resolveReportGeneratedBy();

    await exportReportAsWorkbook({
      reportType: selectedReportType,
      selectedColumn,
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      data,
      columns,
      reportAnalytics,
      reportChartImages,
      generatedBy,
      humanizeLabel,
      resolveSectionColumns: resolveOverallSectionColumns,
      fileName: `${selectedReportType}_report.xlsx`,
    });
  };

  const validateReportInput = () => {
    const needsColumn = reportType === "parcels";
    const needsDate = reportType === "parcels" || reportType === "overall";
    if (
      !reportType ||
      (needsColumn && !column) ||
      !format ||
      (needsDate && (!startDate || !endDate))
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
      else await generateExcelReport(reportType, startDate, endDate, column);
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
    const isDelayMetric = growthMetric === "delays";
    const accentColor = isDelayMetric ? "#ef4444" : "#16a34a";
    const accentFill = isDelayMetric ? "rgba(239, 68, 68, 0.16)" : "rgba(22, 163, 74, 0.16)";
    const accentBarFill = isDelayMetric ? "rgba(239, 68, 68, 0.72)" : "rgba(22, 163, 74, 0.72)";
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
            label: isDelayMetric ? "Delayed Parcels" : "Deliveries",
            data: growthChartSeries.data,
            borderColor: isCircularChart ? chartColors : accentColor,
            backgroundColor: isCircularChart
              ? chartColors
              : growthChartType === "bar"
                ? accentBarFill
                : accentFill,
            fill: growthChartType === "line",
            tension: growthChartType === "line" ? 0.35 : 0,
            pointRadius: growthChartType === "line" ? 2.6 : 0,
            pointHoverRadius: growthChartType === "line" ? 4 : 0,
            pointBackgroundColor: accentColor,
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
                return isDelayMetric
                  ? `Delayed Parcels: ${value}`
                  : `Deliveries: ${value}`;
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
  }, [growthChartSeries.labels, growthChartSeries.data, growthChartType, growthMetric]);

  useEffect(() => {
    const destroyAnalyticsCharts = () => {
      if (analyticsConversionChartInstanceRef.current) {
        analyticsConversionChartInstanceRef.current.destroy();
        analyticsConversionChartInstanceRef.current = null;
      }
      if (analyticsRiskChartInstanceRef.current) {
        analyticsRiskChartInstanceRef.current.destroy();
        analyticsRiskChartInstanceRef.current = null;
      }
      if (analyticsTrendChartInstanceRef.current) {
        analyticsTrendChartInstanceRef.current.destroy();
        analyticsTrendChartInstanceRef.current = null;
      }
    };

    if (dashboardView !== "analytics") {
      destroyAnalyticsCharts();
      return;
    }

    if (
      !analyticsConversionChartRef.current ||
      !analyticsRiskChartRef.current ||
      !analyticsTrendChartRef.current
    ) {
      return;
    }

    destroyAnalyticsCharts();

    analyticsConversionChartInstanceRef.current = new Chart(analyticsConversionChartRef.current, {
      type: "doughnut",
      data: {
        labels: ["Delivered", "Remaining"],
        datasets: [
          {
            data: [
              dashboardData.delivered || 0,
              Math.max((analyticsSummary.totalParcels || 0) - (dashboardData.delivered || 0), 0),
            ],
            backgroundColor: ["#16a34a", "rgba(148, 163, 184, 0.35)"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${context.raw}`,
            },
          },
        },
      },
    });

    analyticsRiskChartInstanceRef.current = new Chart(analyticsRiskChartRef.current, {
      type: "bar",
      data: {
        labels: ["Delay %", "Cancel %"],
        datasets: [
          {
            data: [analyticsSummary.delayRate, analyticsSummary.cancellationRate],
            backgroundColor: ["rgba(245, 158, 11, 0.78)", "rgba(239, 68, 68, 0.78)"],
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(10, Math.ceil(analyticsSummary.delayRate), Math.ceil(analyticsSummary.cancellationRate)),
            ticks: {
              callback: (value) => `${value}%`,
            },
            grid: { color: "rgba(148, 163, 184, 0.2)" },
          },
        },
      },
    });

    const trendLabels = selectedYear === "All"
      ? ((dashboardData.years || []).length ? dashboardData.years : ["Current"])
      : MONTH_LABELS;
    const trendData = selectedYear === "All"
      ? (((dashboardData.yearGrowth || []).length ? dashboardData.yearGrowth : [dashboardData.delivered || 0]))
      : (((dashboardData.monthGrowth || []).length ? dashboardData.monthGrowth : Array(12).fill(0)));

    analyticsTrendChartInstanceRef.current = new Chart(analyticsTrendChartRef.current, {
      type: "line",
      data: {
        labels: trendLabels,
        datasets: [
          {
            data: trendData,
            borderColor: "#0ea5e9",
            backgroundColor: "rgba(14, 165, 233, 0.18)",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "rgba(148, 163, 184, 0.2)" },
          },
        },
      },
    });

    return () => {
      destroyAnalyticsCharts();
    };
  }, [
    dashboardView,
    selectedYear,
    analyticsSummary.totalParcels,
    analyticsSummary.delayRate,
    analyticsSummary.cancellationRate,
    dashboardData.delivered,
    dashboardData.years,
    dashboardData.yearGrowth,
    dashboardData.monthGrowth,
  ]);

  useEffect(() => {
    if (dashboardView !== "overview") {
      if (violationLeafletMapRef.current) {
        violationLeafletMapRef.current.remove();
        violationLeafletMapRef.current = null;
      }
      violationLayerGroupRef.current = null;
      return;
    }

    if (loading || !violationMapRef.current) return;

    const existingMap = violationLeafletMapRef.current;
    const hasContainerMismatch =
      existingMap &&
      typeof existingMap.getContainer === "function" &&
      existingMap.getContainer() !== violationMapRef.current;
    if (hasContainerMismatch) {
      existingMap.remove();
      violationLeafletMapRef.current = null;
      violationLayerGroupRef.current = null;
    }

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

  }, [dashboardView, loading, violationPointIndicators, renderViolationHotspots]);

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

  const reportNeedsDate = reportType === "parcels" || reportType === "overall";

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar />

      <div className="dashboard-page ui-page-shell px-6 py-6">
        {loading ? (
          <PageSpinner fullScreen label="Loading dashboard..." />
        ) : (
          <>
            <div className="dash-header">
              <div className="dash-header-copy">
                <h1 className="page-title mb-6">Dashboard</h1>
              </div>
              <div className="dash-header-controls">
                <button
                  type="button"
                  className="dash-view-toggle-btn ui-btn-secondary"
                  onClick={() =>
                    setDashboardView((current) =>
                      current === "overview" ? "analytics" : "overview"
                    )}
                  aria-pressed={dashboardView === "analytics"}
                  aria-label={`Switch dashboard view. Current view is ${dashboardView === "analytics" ? "analytics" : "overview"}.`}
                >
                  <span className="dash-view-toggle-indicator" aria-hidden="true" />
                  <span className="dash-view-toggle-label">View</span>
                  <span className="dash-view-toggle-value">
                    {dashboardView === "analytics" ? "Analytics" : "Overview"}
                  </span>
                </button>
                <div className="dash-header-actions">
                  <div className="dash-action-group">
                    <button
                      type="button"
                      className="dash-generate-report-btn ui-btn-primary"
                      onClick={() => setReportModalOpen(true)}
                    >
                      Generate Report
                    </button>
                  </div>
                  <div className="dash-filter-group">
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
                        if (nextValue === selectedYear) return;
                        setIsYearSwitching(true);
                        setSelectedYear(nextValue);
                        setGrowthView(nextValue === "All" ? "year" : "month");
                      }}
                    />
                    </div>
                    <span className="date-range">{todayLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`dash-grid two-rows ${dashboardView === "analytics" ? "analytics-focus" : "overview-focus"} ${isYearSwitching ? "year-switching" : "year-stable"}`}
              aria-busy={isYearSwitching}
            >
              {dashboardView === "overview" && (
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
              )}

              {dashboardView === "overview" && (
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
              )}

              {dashboardView === "analytics" && (
                <div className="dash-card top-card metric-card analytics-kpi analytics-delivery-card rounded-2xl">
                  <div className="card-label">Delivery Conversion</div>
                  <div className="card-value">{analyticsSummary.deliveryRate.toFixed(1)}%</div>
                  <div className="card-desc">
                    {dashboardData.delivered} delivered out of {analyticsSummary.totalParcels} tracked parcels
                  </div>
                  <div className="analytics-kpi-chart">
                    <canvas ref={analyticsConversionChartRef}></canvas>
                  </div>
                </div>
              )}

              {dashboardView === "analytics" && (
                <div className="dash-card top-card metric-card analytics-kpi analytics-reliability-card rounded-2xl">
                  <div className="card-label">Delay and Cancellation Risk</div>
                  <div className="card-value">{analyticsSummary.delayRate.toFixed(1)}%</div>
                  <div className="card-desc">
                    Delay rate, with cancellation at {analyticsSummary.cancellationRate.toFixed(1)}%
                  </div>
                  <div className="analytics-kpi-chart">
                    <canvas ref={analyticsRiskChartRef}></canvas>
                  </div>
                </div>
              )}

              {dashboardView === "analytics" && (
                <div className="dash-card top-card metric-card analytics-kpi analytics-trend-card rounded-2xl">
                  <div className="card-label">
                    {analyticsSummary.trendMode === "yearly" ? "Yearly Trend" : "Monthly Trend"}
                  </div>
                  <div className="card-value">{analyticsSummary.trendLabel}</div>
                  <div className="card-desc">
                    {analyticsSummary.trendMode === "yearly"
                      ? `Avg ${analyticsSummary.averageYearlyDeliveries.toFixed(1)} deliveries per active year`
                      : `Avg ${analyticsSummary.averageMonthlyDeliveries.toFixed(1)} deliveries per active month`}
                  </div>
                  <div className="analytics-kpi-chart">
                    <canvas ref={analyticsTrendChartRef}></canvas>
                  </div>
                </div>
              )}

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
                      value={growthMetric}
                      options={growthMetricOptions}
                      onChange={(nextValue) => setGrowthMetric(nextValue)}
                    />
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
                    <div className="growth-empty">No analytics data yet</div>
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

              {dashboardView === "overview" && (
                <div className="dash-card bottom-card violation-map-card rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="violation-map-header">
                    <div className="violation-map-header-top">
                      <h2>Violation Heat Map</h2>
                      <button
                        type="button"
                        className="violation-map-size-btn ui-btn-secondary rounded-lg px-3 py-1.5 text-xs"
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
              )}

            </div>
          </>
        )}
      </div>

      {violationMapModalOpen && (
        <div
          className="dashboard-modal-overlay violation-fullscreen-overlay bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setViolationMapModalOpen(false)}
        >
          <div
            className="dashboard-modal-content violation-full-map-modal violation-fullscreen-map"
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
            className="dashboard-modal-content dashboard-report-modal ui-modal-panel rounded-2xl shadow-2xl shadow-slate-900/35"
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
                      <label>Start Date{reportNeedsDate ? " *" : ""}</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="dashboard-report-field">
                      <label>End Date{reportNeedsDate ? " *" : ""}</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="dashboard-report-field full">
                    <label>Report Type *</label>
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
                        <label>Column *</label>
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
                      <label>Format *</label>
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
                    className="dashboard-report-download-btn ui-btn-primary rounded-xl px-3 py-2"
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



