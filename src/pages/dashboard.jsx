import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import Chart from "chart.js/auto";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  FaDownload,
  FaCheckCircle,
  FaTimesCircle,
  FaCalendarAlt,
  FaChartLine,
  FaMotorcycle,
  FaBoxOpen,
  FaExclamationTriangle,
  FaPercent,
  FaTrophy,
  FaFilePdf,
  FaFileExcel,
  FaTimes,
  FaSearch,
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

// â”€â”€â”€ Utility helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  if (/email/i.test(columnKey) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
    return raw.toLowerCase();
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
  const n = normalizeStatus(value);
  if (!n || n === "-") return null;
  if (
    [
      "successfully delivered",
      "delivered",
      "successful",
      "success",
      "completed",
    ].includes(n)
  )
    return [22, 163, 74];
  if (["on going", "ongoing", "in progress", "pending"].includes(n))
    return [202, 138, 4];
  if (["cancelled", "canceled", "failed", "failure"].includes(n))
    return [220, 38, 38];
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
  const n = normalizeStatus(value);
  return [
    "successfully delivered",
    "delivered",
    "successful",
    "success",
    "completed",
  ].includes(n);
};

const isCancelledStatus = (value) => {
  const n = normalizeStatus(value);
  return n === "cancelled" || n === "canceled";
};

const isAttemptSuccessStatus = (value) => {
  const n = normalizeStatus(value);
  return [
    "successfully delivered",
    "delivered",
    "successful",
    "success",
    "completed",
  ].includes(n);
};

const extractYearKey = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return String(value.getFullYear());
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value < 1e12 ? value * 1000 : value;
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }
  const text = String(value).trim();
  if (!text) return null;
  const leading = text.match(/^((?:19|20)\d{2})[-/]/);
  if (leading) return leading[1];
  const any = text.match(/\b((?:19|20)\d{2})\b/);
  if (any) return any[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
  return null;
};

const normalizeCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeLatLngPair = (latValue, lngValue) => {
  let lat = normalizeCoordinate(latValue);
  let lng = normalizeCoordinate(lngValue);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    const t = lat;
    lat = lng;
    lng = t;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

const isWithinPhilippines = (lat, lng) =>
  lat >= 4.5 && lat <= 21.5 && lng >= 116.0 && lng <= 127.5;

const getViolationType = (log = {}) =>
  log?.violation ||
  log?.violation_type ||
  log?.type ||
  log?.violationName ||
  "Unknown violation";

const getFloodRiderName = (row = {}) =>
  row?.name ||
  row?.rider_name ||
  row?.username ||
  row?.full_name ||
  row?.user_name ||
  "Unknown rider";

const getViolationRiderName = (log = {}) => {
  for (const v of [
    log?.rider_name,
    log?.rider,
    log?.user_name,
    log?.username,
    log?.name,
    log?.user_id,
  ]) {
    if (v !== null && v !== undefined) {
      const t = String(v).trim();
      if (t) return t;
    }
  }
  return "-";
};

const getViolationAreaName = (log = {}) => {
  for (const v of [
    log?.location_name,
    log?.area_name,
    log?.area,
    log?.address,
    typeof log?.location === "string" ? log.location : "",
  ]) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (
      !t ||
      /^POINT\s*\(/i.test(t) ||
      /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(t)
    )
      continue;
    return t;
  }
  return "";
};

const getViolationCoordinates = (log = {}) => {
  const normalized = normalizeLatLngPair(log?.lat, log?.lng);
  if (!normalized) return null;
  return isWithinPhilippines(normalized.lat, normalized.lng)
    ? normalized
    : null;
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

const riderPerfColumns = [
  { value: "All", label: "All" },
  { value: "username", label: "Username" },
  { value: "email", label: "Email" },
  { value: "fname", label: "First name" },
  { value: "lname", label: "Last name" },
  { value: "doj", label: "Date of join" },
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
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
  for (let page = 0; page < maxPages; page++) {
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

const buildViolationPointIndicatorsFromLogs = (violationLogs = []) =>
  (violationLogs || [])
    .map((log) => {
      const normalizedPair = getViolationCoordinates(log);
      if (!normalizedPair) return null;
      const { lat, lng } = normalizedPair;
      return {
        coords: [lat, lng],
        location:
          getViolationAreaName(log) ||
          getViolationRiderName(log) ||
          "Unknown rider",
        incidents: 1,
        violation_type: getViolationType(log),
        date: log?.date || null,
        rider_name: log?.name || log?.rider_name || log?.rider || null,
        profile_url: log?.profile_url || null,
      };
    })
    .filter(Boolean);

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

const getSafePercent = (part, total) => (total > 0 ? (part / total) * 100 : 0);

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

const buildChartAnnotation = (spec) => {
  if (!spec || !Array.isArray(spec.labels) || !Array.isArray(spec.values))
    return "";
  const values = spec.values.map((v) => Number(v) || 0);
  const labels = spec.labels.map((l) => String(l));
  if (!values.length || !labels.length) return "";
  const total = values.reduce((a, b) => a + b, 0);
  const maxIndex = values.reduce(
    (best, v, i) => (v > values[best] ? i : best),
    0,
  );

  if (spec.type === "line") {
    if (values.length >= 2) {
      const last = values[values.length - 1];
      const prev = values[values.length - 2];
      if (prev === 0) {
        return last > 0
          ? `Rebound in ${labels[labels.length - 1]} (${last})`
          : `Flat in ${labels[labels.length - 1]}`;
      }
      const change = ((last - prev) / Math.abs(prev)) * 100;
      const dir = change >= 0 ? "Up" : "Down";
      return `${dir} ${Math.abs(change).toFixed(1)}% vs ${labels[labels.length - 2]}`;
    }
    return `Latest: ${labels[labels.length - 1]} (${values[values.length - 1]})`;
  }

  if (spec.type === "doughnut" || spec.type === "pie") {
    if (total <= 0) return "";
    const share = ((values[maxIndex] / total) * 100).toFixed(1);
    return `${labels[maxIndex]} leads at ${share}%`;
  }

  if (spec.type === "bar") {
    if (labels.length === 2) {
      const [a, b] = values;
      if (a === b) return "Even split between both metrics";
      return a > b
        ? `${labels[0]} exceeds ${labels[1]}`
        : `${labels[1]} exceeds ${labels[0]}`;
    }
    return `${labels[maxIndex]} highest (${values[maxIndex]})`;
  }

  if (total > 0) return `${labels[maxIndex]} highest (${values[maxIndex]})`;
  return "";
};

const withChartAnnotations = (charts = []) =>
  charts.map((spec) => ({
    ...spec,
    annotation: spec.annotation || buildChartAnnotation(spec),
  }));

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

// â”€â”€â”€ Analytics Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const buildParcelsAnalytics = (parcels = []) => {
  const deliveredRows = parcels.filter((p) => isDeliveredStatus(p?.status));
  const delivered = deliveredRows.length;
  const delayed = parcels.filter(
    (p) => normalizeStatus(p?.attempt2_status) === "failed",
  ).length;
  const undelivered = Math.max(parcels.length - delivered - delayed, 0);
  const firstAttemptSuccessCount = deliveredRows.filter((p) =>
    isAttemptSuccessStatus(p?.attempt1_status),
  ).length;
  const monthlyDeliveries = buildMonthlyCounts(deliveredRows, "created_at");
  const yearlyDeliveries = buildYearlyCounts(deliveredRows, "created_at");
  const activeDaySet = new Set(
    deliveredRows
      .map((p) => {
        const parsed = new Date(p?.created_at);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
      })
      .filter(Boolean),
  );
  const avgPerActiveDay = activeDaySet.size ? delivered / activeDaySet.size : 0;
  const deliveryRate = getSafePercent(delivered, parcels.length);
  const delayRate = getSafePercent(delayed, parcels.length);
  const firstAttemptSuccessRate = getSafePercent(
    firstAttemptSuccessCount,
    delivered,
  );

  const attemptFailureMap = countBy(parcels, (p) => {
    const status = normalizeStatus(p?.attempt1_status);
    if (!status) return null;
    if (isAttemptSuccessStatus(status)) return null;
    return status;
  });
  const attemptFailureTotal = Object.values(attemptFailureMap).reduce(
    (sum, count) => sum + count,
    0,
  );
  const failureReasons = topEntries(attemptFailureMap, 6).map(
    ([reason, count]) => ({
      reason: toTitleCase(reason),
      count,
      share: attemptFailureTotal
        ? Number(((count / attemptFailureTotal) * 100).toFixed(1))
        : 0,
    }),
  );

  const charts = withChartAnnotations([
    {
      title: "Parcel Status Distribution",
      type: "doughnut",
      labels: ["Delivered", "Delayed", "In Progress"],
      values: [delivered, delayed, undelivered],
      colors: ["#16a34a", "#f59e0b", "#94a3b8"],
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
      title: "Delay Rate (%)",
      type: "bar",
      labels: ["Delay %"],
      values: [Number(delayRate.toFixed(1))],
      datasetLabel: "Delay %",
      colors: ["#f59e0b"],
    },
    {
      title:
        yearlyDeliveries.labels.length > 1
          ? "Yearly Deliveries Trend"
          : "Monthly Deliveries Trend",
      type: "line",
      labels:
        yearlyDeliveries.labels.length > 1
          ? yearlyDeliveries.labels
          : monthlyDeliveries.labels,
      values:
        yearlyDeliveries.labels.length > 1
          ? yearlyDeliveries.values
          : monthlyDeliveries.values,
      datasetLabel: "Deliveries",
      colors: ["#14b8a6"],
    },
  ]);

  return {
    summaryRows: [
      ["Total Parcels", String(parcels.length)],
      ["Delivered", String(delivered)],
      ["In Progress / Other", String(undelivered)],
      ["Delayed", String(delayed)],
      ["Delivery Rate", `${deliveryRate.toFixed(1)}%`],
      ["Delay Rate", `${delayRate.toFixed(1)}%`],
      ["1st Attempt Success Rate", `${firstAttemptSuccessRate.toFixed(1)}%`],
      ["Avg Deliveries", avgPerActiveDay.toFixed(1)],
    ],
    charts,
    failureReasons,
    metrics: {
      totalParcels: parcels.length,
      delivered,
      delayed,
      deliveryRate,
      delayRate,
      firstAttemptSuccessRate,
      attemptFailureTotal,
    },
  };
};

const buildRiderPerformanceAnalytics = (
  riders = [],
  parcels = [],
  violations = [],
  floodAffected = [],
) => {
  const deliveredParcels = parcels.filter((p) => isDeliveredStatus(p?.status));
  const riderDeliveryMap = countBy(
    deliveredParcels,
    (p) => getAssignedRiderDisplay(p) || "Unassigned",
  );
  const riderTotalMap = countBy(
    parcels,
    (p) => getAssignedRiderDisplay(p) || "Unassigned",
  );
  const riderDelayMap = countBy(
    parcels.filter(
      (p) =>
        normalizeStatus(p?.attempt1_status) === "failed" ||
        normalizeStatus(p?.attempt2_status) === "failed",
    ),
    (p) => getAssignedRiderDisplay(p) || "Unassigned",
  );

  const topDeliverers = topEntries(riderDeliveryMap, 8);
  const violationByRider = countBy(violations, (v) =>
    String(v?.name || "Unknown"),
  );
  const topFlaggedRiders = topEntries(violationByRider, 8);
  const violationByType = countBy(violations, (v) =>
    String(v?.violation || "Unknown"),
  );
  const topViolationTypes = topEntries(violationByType, 8);
  const monthlyViolations = buildMonthlyCounts(violations, "date");
  const weekdayViolations = buildWeekdayCounts(violations, "date");
  const monthlyJoins = buildMonthlyCounts(riders, "created_at");
  const yearlyJoins = buildYearlyCounts(riders, "created_at");
  const monthlyFloods = buildMonthlyCounts(floodAffected, "date");
  const floodByRider = countBy(floodAffected, (row) =>
    String(getFloodRiderName(row) || "Unknown"),
  );
  const topFloodedRiders = topEntries(floodByRider, 8);
  const genderMap = countBy(riders, (r) => String(r?.gender || "Unknown"));
  const activeRiders = riders.filter(
    (r) => r?.status === "active" || r?.status === "Active",
  ).length;
  const riderNames = Object.keys(riderDeliveryMap);
  const avgDeliveriesPerRider = riderNames.length
    ? Object.values(riderDeliveryMap).reduce((a, b) => a + b, 0) /
      riderNames.length
    : 0;
  const firstAttemptByRider = {};
  const secondAttemptByRider = {};
  deliveredParcels.forEach((p) => {
    const name = getAssignedRiderDisplay(p);
    if (!name) return;
    if (!firstAttemptByRider[name])
      firstAttemptByRider[name] = { success: 0, total: 0 };
    firstAttemptByRider[name].total += 1;
    if (isAttemptSuccessStatus(p?.attempt1_status)) {
      firstAttemptByRider[name].success += 1;
    }
    // 2nd attempt: only count if 1st failed but 2nd succeeded
    if (
      !isAttemptSuccessStatus(p?.attempt1_status) &&
      isAttemptSuccessStatus(p?.attempt2_status)
    ) {
      if (!secondAttemptByRider[name])
        secondAttemptByRider[name] = { success: 0, total: 0 };
      secondAttemptByRider[name].total += 1;
      secondAttemptByRider[name].success += 1;
    }
  });
  const riderFirstAttemptRows = Object.entries(firstAttemptByRider)
    .map(([name, { success, total }]) => {
      const secondAttempt = secondAttemptByRider[name] || {
        success: 0,
        total: 0,
      };
      const secondRate =
        secondAttempt.total > 0
          ? Math.round((secondAttempt.success / secondAttempt.total) * 100)
          : 0;
      return {
        name,
        success,
        total,
        rate: total > 0 ? Math.round((success / total) * 100) : 0,
        secondRate,
      };
    })
    .sort((a, b) => b.total - a.total || b.rate - a.rate)
    .slice(0, 15);
  const topRiderFirstAttempt = riderFirstAttemptRows
    .slice()
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)
    .map((r) => [r.name, r.rate]);

  const topRider = topDeliverers[0];
  const mostFlagged = topFlaggedRiders[0];

  const charts = withChartAnnotations([
    {
      title: "Top Riders by Deliveries",
      type: "bar",
      labels: topDeliverers.map(([l]) => l),
      values: topDeliverers.map(([, c]) => c),
      datasetLabel: "Deliveries",
      colors: ["#16a34a"],
    },
    {
      title: "Rider 1st Attempt Success Rate (%)",
      type: "bar",
      labels: topRiderFirstAttempt.map(([l]) => l),
      values: topRiderFirstAttempt.map(([, v]) => v),
      datasetLabel: "Success %",
      colors: ["#0ea5e9"],
    },
    {
      title: "Most Flagged Riders (Violations)",
      type: "bar",
      labels: topFlaggedRiders.map(([l]) => l),
      values: topFlaggedRiders.map(([, c]) => c),
      datasetLabel: "Violations",
      colors: ["#ef4444"],
    },
    {
      title: "Flood-Affected Riders by Incident Count",
      type: "bar",
      labels: topFloodedRiders.map(([l]) => l),
      values: topFloodedRiders.map(([, c]) => c),
      datasetLabel: "Flood Incidents",
      colors: ["#06b6d4"],
    },
    {
      title: "Monthly Violation Trend",
      type: "line",
      labels: monthlyViolations.labels,
      values: monthlyViolations.values,
      datasetLabel: "Violations",
      colors: ["#8b5cf6"],
    },
    {
      title: "Violations by Weekday",
      type: "bar",
      labels: weekdayViolations.labels,
      values: weekdayViolations.values,
      datasetLabel: "Violations",
      colors: ["#ec4899"],
    },

    {
      title: "Monthly Rider Joins",
      type: "line",
      labels: monthlyJoins.labels,
      values: monthlyJoins.values,
      colors: ["#14b8a6"],
      datasetLabel: "New Riders",
    },
    {
      title: "Flood Alerts by Month",
      type: "line",
      labels: monthlyFloods.labels,
      values: monthlyFloods.values,
      colors: ["#38bdf8"],
      datasetLabel: "Flood Alerts",
    },
  ]);

  return {
    summaryRows: [
      ["Total Riders", String(riders.length)],
      ["Active Riders", String(activeRiders || riders.length)],
      ["Total Deliveries", String(deliveredParcels.length)],
      ["Avg Deliveries / Rider", avgDeliveriesPerRider.toFixed(1)],
      [
        "Top Performer",
        topRider ? `${topRider[0]} (${topRider[1]} deliveries)` : "N/A",
      ],
      ["Total Violations", String(violations.length)],
      [
        "Most Flagged Rider",
        mostFlagged
          ? `${mostFlagged[0]} (${mostFlagged[1]} violations)`
          : "N/A",
      ],

      ["Flood Alerts", String(floodAffected.length || 0)],
      [
        "Flood Affected Riders",
        String(Object.keys(floodByRider || {}).length || 0),
      ],
    ],
    riderPerfRows: topEntries(riderTotalMap, 20).map(([name]) => ({
      name,
      delivered: riderDeliveryMap[name] || 0,
      delayed: riderDelayMap[name] || 0,
      violations: violationByRider[name] || 0,
      deliveryRate: riderTotalMap[name]
        ? Math.round(
            ((riderDeliveryMap[name] || 0) / riderTotalMap[name]) * 100,
          )
        : 0,
    })),
    riderFirstAttemptRows,
    floodAffectedRows: (floodAffected || []).map((row) => ({
      name: getFloodRiderName(row),
      date: row?.date || row?.created_at || null,
      lat: row?.lat ?? row?.latitude ?? null,
      lng: row?.lng ?? row?.longitude ?? null,
      address: row?.location || row?.place_name || row?.address || null,
    })),
    charts,
    metrics: {
      totalRiders: riders.length,
      activeRiders: activeRiders || riders.length,
      totalDeliveries: deliveredParcels.length,
      totalViolations: violations.length,
      totalFloodAlerts: floodAffected.length || 0,
      avgDeliveriesPerRider,
      topPerformer: topRider ? topRider[0] : null,
      mostFlagged: mostFlagged ? mostFlagged[0] : null,
    },
  };
};

const buildReportAnalyticsBundle = (reportType, data) => {
  if (reportType === "overall") {
    const parcels =
      (data || []).find((s) => s?.section === "Parcels")?.data || [];
    const riders =
      (data || []).find((s) => s?.section === "Riders")?.data || [];
    const violations =
      (data || []).find((s) => s?.section === "Violations")?.data || [];
    const floodAffected =
      (data || []).find((s) => s?.section === "Flood Affected Riders")?.data ||
      [];
    const parcelAnalytics = buildParcelsAnalytics(parcels);
    const riderPerfAnalytics = buildRiderPerformanceAnalytics(
      riders,
      parcels,
      violations,
      floodAffected,
    );
    return {
      sections: [
        {
          title: "Parcels",
          summaryRows: parcelAnalytics.summaryRows,
          charts: parcelAnalytics.charts,
          failureReasons: parcelAnalytics.failureReasons,
        },
        {
          title: "Rider Performance",
          summaryRows: riderPerfAnalytics.summaryRows,
          charts: [
            ...riderPerfAnalytics.charts.slice(0, 5),
            ...riderPerfAnalytics.charts.slice(-2),
          ],
          riderPerfRows: riderPerfAnalytics.riderPerfRows,
          riderFirstAttemptRows: riderPerfAnalytics.riderFirstAttemptRows,
          floodAffectedRows: riderPerfAnalytics.floodAffectedRows,
        },
      ],
      summaryRows: [
        ["Total Parcels", String(parcels.length)],
        [
          "Delivered",
          parcelAnalytics.summaryRows.find(([k]) => k === "Delivered")?.[1] ||
            "0",
        ],
        [
          "Delivery Rate",
          parcelAnalytics.summaryRows.find(
            ([k]) => k === "Delivery Rate",
          )?.[1] || "0%",
        ],
        [
          "Delayed",
          parcelAnalytics.summaryRows.find(([k]) => k === "Delayed")?.[1] ||
            "0",
        ],
        [
          "Delay Rate",
          parcelAnalytics.summaryRows.find(([k]) => k === "Delay Rate")?.[1] ||
            "0%",
        ],
        [
          "1st Attempt Success",
          parcelAnalytics.summaryRows.find(
            ([k]) => k === "1st Attempt Success Rate",
          )?.[1] || "0%",
        ],
        ["Total Riders", String(riders.length)],
        ["Total Violations", String(violations.length)],
        [
          "Top Performer",
          riderPerfAnalytics.summaryRows.find(
            ([k]) => k === "Top Performer",
          )?.[1] || "N/A",
        ],
        [
          "Most Flagged Rider",
          riderPerfAnalytics.summaryRows.find(
            ([k]) => k === "Most Flagged Rider",
          )?.[1] || "N/A",
        ],
        [
          "Flood Alerts",
          riderPerfAnalytics.summaryRows.find(
            ([k]) => k === "Flood Alerts",
          )?.[1] || "0",
        ],
      ],
      charts: [
        ...parcelAnalytics.charts.slice(0, 2),
        ...riderPerfAnalytics.charts.slice(0, 3),
        ...riderPerfAnalytics.charts.slice(-1),
      ],
    };
  }
  if (reportType === "parcels") return buildParcelsAnalytics(data || []);
  if (reportType === "rider_performance") {
    const riders =
      (data || []).find((s) => s?.section === "Riders")?.data || [];
    const parcels =
      (data || []).find((s) => s?.section === "Parcels")?.data || [];
    const violations =
      (data || []).find((s) => s?.section === "Violations")?.data || [];
    const floodAffected =
      (data || []).find((s) => s?.section === "Flood Affected Riders")?.data ||
      [];
    return buildRiderPerformanceAnalytics(
      riders,
      parcels,
      violations,
      floodAffected,
    );
  }
  return { summaryRows: [], charts: [] };
};

const buildChartImageFromSpec = async (spec, width = 900, height = 360) => {
  if (
    !spec ||
    !Array.isArray(spec.labels) ||
    !Array.isArray(spec.values) ||
    !spec.values.length
  )
    return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const palette =
    Array.isArray(spec.colors) && spec.colors.length
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
              ? spec.values.map((_, i) => palette[i % palette.length])
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
      plugins: { legend: { display: isCircular, position: "right" } },
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
  return {
    title: spec.title || "Chart",
    dataUrl,
    annotation: spec.annotation || "",
  };
};

const buildReportChartImages = async (chartSpecs = []) => {
  const images = [];
  for (const spec of (chartSpecs || []).slice(0, 8)) {
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
    const userId = user?.id;
    const userEmail = user?.email;

    // ── Priority 1: admin_profile table (most accurate for admins) ──
    if (userId) {
      const { data: adminRows } = await supabaseClient
        .from("admin_profile")
        .select("first_name, last_name")
        .eq("id", userId)
        .limit(1);

      const admin = adminRows?.[0];
      const adminName =
        `${admin?.first_name || ""} ${admin?.last_name || ""}`.trim();
      if (adminName) return adminName;
    }

    // ── Priority 2: try by email if user_id didn't match ──
    if (userEmail) {
      const { data: adminByEmail } = await supabaseClient
        .from("admin_profile")
        .select("first_name, last_name")
        .eq("email", userEmail)
        .limit(1);

      const admin = adminByEmail?.[0];
      const adminName =
        `${admin?.first_name || ""} ${admin?.last_name || ""}`.trim();
      if (adminName) return adminName;
    }

    // ── Priority 3: Supabase auth metadata fallback ──
    const metadata = user?.user_metadata || {};
    const metaName = String(
      metadata.full_name ||
        metadata.name ||
        [
          metadata.fname || metadata.first_name,
          metadata.lname || metadata.last_name,
        ]
          .filter(Boolean)
          .join(" "),
    ).trim();
    if (metaName) return metaName;

    // ── Priority 4: derive from email ──
    if (userEmail) {
      const localPart = String(userEmail)
        .split("@")[0]
        .replace(/[._-]+/g, " ");
      if (localPart.trim())
        return localPart
          .split(" ")
          .filter(Boolean)
          .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
          .join(" ");
    }

    return "Unknown User";
  } catch {
    return "Unknown User";
  }
};

const useAnimatedNumber = (target, duration = 420) => {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = null;

    const step = (timestamp) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
};

// â”€â”€â”€ Transition key hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const useTransitionKey = (dep) => {
  const [key, setKey] = useState(0);
  const prev = useRef(dep);
  useEffect(() => {
    if (prev.current !== dep) {
      setKey((k) => k + 1);
      prev.current = dep;
    }
  }, [dep]);
  return key;
};

// â”€â”€â”€ FloatSelect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FLOAT_SELECT_STYLE_ID = "float-select-injected-styles";
const injectFloatSelectStyles = () => {
  if (document.getElementById(FLOAT_SELECT_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = FLOAT_SELECT_STYLE_ID;
  s.textContent = `
    @keyframes fsMenuIn {
      from { opacity: 0; transform: translateY(-6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)   scale(1);    }
    }
    .fs-menu {
      position: fixed;
      z-index: 999999;
      background: #ffffff;
      border: 1px solid rgba(203,213,225,0.8);
      border-radius: 16px;
      box-shadow:
        0 4px 6px -1px rgba(15,23,42,0.06),
        0 20px 40px -8px rgba(15,23,42,0.18),
        0 0 0 1px rgba(203,213,225,0.4);
      padding: 6px;
      overflow-y: auto;
      overflow-x: hidden;
      animation: fsMenuIn 0.18s cubic-bezier(0.22,1,0.36,1) both;
    }
    .fs-option {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      border: none;
      background: transparent;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 0.875rem;
      font-weight: 500;
      color: #334155;
      font-family: inherit;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s;
      white-space: normal;
      word-break: break-word;
      box-sizing: border-box;
    }
    .fs-option:hover {
      background: #fef2f2;
      color: #9f1239;
    }
    .fs-option.fs-selected {
      background: linear-gradient(135deg,#c8102e,#9b0a22);
      color: #ffffff;
      font-weight: 700;
    }
    .fs-option.fs-selected:hover {
      background: linear-gradient(135deg,#b91c1c,#881320);
      color: #fff;
    }
    .fs-check {
      margin-left: auto;
      opacity: 0;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    .fs-option.fs-selected .fs-check { opacity: 1; }
  `;
  document.head.appendChild(s);
};

const FloatSelect = ({
  value,
  onChange,
  options = [],
  placeholder = "Select",
  variant = "field",
  id,
}) => {
  injectFloatSelectStyles();

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({});
  const triggerRef = useRef(null);
  const selected = (options || []).find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const down = (e) => {
      if (!triggerRef.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const calc = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const goUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxH = Math.min(320, Math.floor(goUp ? spaceAbove : spaceBelow));
      const menuW = Math.max(r.width, 180);
      const fitsRight = r.left + menuW <= window.innerWidth - 8;
      const xPos = fitsRight
        ? { left: r.left }
        : { right: window.innerWidth - r.right };
      setCoords(
        goUp
          ? {
              bottom: window.innerHeight - r.top + 6,
              top: "auto",
              minWidth: r.width,
              maxHeight: maxH,
              ...xPos,
            }
          : {
              top: r.bottom + 6,
              bottom: "auto",
              minWidth: r.width,
              maxHeight: maxH,
              ...xPos,
            },
      );
    };
    calc();
    window.addEventListener("resize", calc);
    window.addEventListener("scroll", calc, true);
    return () => {
      window.removeEventListener("resize", calc);
      window.removeEventListener("scroll", calc, true);
    };
  }, [open]);

  const isField = variant === "field";
  const isDark = document.body.classList.contains("dark");
  const triggerStyle = isField
    ? {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        minHeight: 46,
        padding: "0 14px",
        background: open ? "#fff8f8" : "#ffffff",
        border: `1.5px solid ${open ? "#c8102e" : "#e2e8f0"}`,
        borderRadius: 14,
        boxShadow: open
          ? "0 0 0 3.5px rgba(200,16,46,0.12), 0 2px 8px rgba(200,16,46,0.08)"
          : "0 1px 3px rgba(15,23,42,0.06)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.9rem",
        fontWeight: 600,
        color: "#0f172a",
        letterSpacing: "0.01em",
        transition: "border-color 0.18s, box-shadow 0.18s, background 0.18s",
        outline: "none",
      }
    : {
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: "var(--dash-header-pill-height, 38px)",
        padding: "0 4px 0 2px",
        background: "transparent",
        border: "none",
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.82rem",
        fontWeight: 800,
        color: isDark ? "#e2e8f0" : "#7f1d1d",
        letterSpacing: "0.01em",
        outline: "none",
      };

  const chevronColor = isField
    ? open
      ? "#c8102e"
      : "#94a3b8"
    : isDark
      ? "#94a3b8"
      : "#b91c1c";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        style={triggerStyle}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected?.label || placeholder}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={chevronColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        ReactDOM.createPortal(
          <div className="fs-menu" style={coords} role="listbox">
            {(options || []).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`fs-option${opt.value === value ? " fs-selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
                <svg
                  className="fs-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

// â”€â”€â”€ KPI Chart Modal Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NOTE: buildChartData now receives `selectedYear` as second arg so yearly tabs
// can be conditionally excluded when a specific year is selected.

const buildKpiChartConfig = (selectedYear) => {
  const isAllYears = selectedYear === "All";

  return {
    totalParcels: {
      label: "Total Parcels",
      icon: <FaBoxOpen />,
      color: "#0ea5e9",
      buildChartData: (dd) => {
        const tabs = isAllYears
          ? ["Monthly", "Yearly", "Status Mix"]
          : ["Monthly", "Status Mix"];
        return {
          tabs,
          monthly: {
            type: "bar",
            labels: MONTH_SHORT,
            values: dd.monthGrowth,
            color: "#0ea5e9",
            datasetLabel: "Parcels",
          },
          ...(isAllYears && {
            yearly: {
              type: "line",
              labels: dd.years,
              values: dd.yearGrowth,
              color: "#0ea5e9",
              datasetLabel: "Parcels",
            },
          }),
          statusMix: {
            type: "doughnut",
            labels: ["Delivered", "Cancelled", "In Progress"],
            values: [
              dd.parcelStatusMix.delivered,
              dd.parcelStatusMix.cancelled,
              dd.parcelStatusMix.inProgress,
            ],
            colors: ["#16a34a", "#ef4444", "#94a3b8"],
          },
        };
      },
      getSummary: (dd) => [
        { label: "Total", value: dd.totalParcels.toLocaleString() },
        { label: "Peak month", value: dd.topMonth },
        ...(isAllYears ? [{ label: "Peak year", value: dd.topYear }] : []),
      ],
    },

    delivered: {
      label: "Delivered",
      icon: <FaCheckCircle />,
      color: "#16a34a",
      buildChartData: (dd) => {
        const tabs = isAllYears ? ["Monthly", "Yearly"] : ["Monthly"];
        return {
          tabs,
          monthly: {
            type: "bar",
            labels: MONTH_SHORT,
            values: dd.monthGrowth,
            color: "#16a34a",
            datasetLabel: "Deliveries",
          },
          ...(isAllYears && {
            yearly: {
              type: "line",
              labels: dd.years,
              values: dd.yearGrowth,
              color: "#16a34a",
              datasetLabel: "Deliveries",
            },
          }),
        };
      },
      getSummary: (dd) => [
        { label: "Total", value: dd.delivered.toLocaleString() },
        { label: "Peak month", value: dd.topMonth },
        {
          label: "Delivery rate",
          value:
            dd.totalParcels > 0
              ? `${((dd.delivered / dd.totalParcels) * 100).toFixed(1)}%`
              : "0%",
        },
      ],
    },

    onGoing: {
      label: "On Going",
      icon: <FaChartLine />,
      color: "#f97316",
      buildChartData: (dd) => ({
        tabs: ["Status breakdown", "Monthly trend"],
        statusBreakdown: {
          type: "doughnut",
          labels: ["Delivered", "On Going", "Cancelled"],
          values: [
            dd.parcelStatusMix.delivered,
            dd.parcelStatusMix.inProgress,
            dd.parcelStatusMix.cancelled,
          ],
          colors: ["#16a34a", "#f97316", "#ef4444"],
        },
        monthlyTrend: {
          type: "bar",
          labels: MONTH_SHORT,
          values: dd.monthOnGoingGrowth || Array(12).fill(0),
          color: "#f97316",
          datasetLabel: "On Going",
        },
      }),
      getSummary: (dd) => [
        { label: "On going", value: dd.onGoing.toLocaleString() },
        {
          label: "On-going rate",
          value:
            dd.totalParcels > 0
              ? `${((dd.onGoing / dd.totalParcels) * 100).toFixed(1)}%`
              : "0%",
        },
        { label: "Total parcels", value: dd.totalParcels.toLocaleString() },
      ],
    },

    delayed: {
      label: "Delayed",
      icon: <FaExclamationTriangle />,
      color: "#f59e0b",
      buildChartData: (dd) => {
        const tabs = isAllYears
          ? ["Monthly delays", "Yearly delays"]
          : ["Monthly delays"];
        return {
          tabs,
          monthlyDelays: {
            type: "bar",
            labels: MONTH_SHORT,
            values: dd.monthDelayGrowth,
            color: "#f59e0b",
            datasetLabel: "Delays",
          },
          ...(isAllYears && {
            yearlyDelays: {
              type: "line",
              labels: dd.years,
              values: dd.yearDelayGrowth,
              color: "#f59e0b",
              datasetLabel: "Delays",
            },
          }),
        };
      },
      getSummary: (dd) => [
        { label: "Delayed", value: dd.delayed.toLocaleString() },
        {
          label: "Delay rate",
          value:
            dd.totalParcels > 0
              ? `${((dd.delayed / dd.totalParcels) * 100).toFixed(1)}%`
              : "0%",
        },
        {
          label: "Peak delay month",
          value: (() => {
            const maxVal = Math.max(...dd.monthDelayGrowth, 0);
            const idx = dd.monthDelayGrowth.indexOf(maxVal);
            return idx >= 0 && maxVal > 0 ? MONTH_SHORT[idx] : "--";
          })(),
        },
      ],
    },

    firstAttempt: {
      label: "1st Attempt",
      icon: <FaPercent />,
      color: "#14b8a6",
      buildChartData: (dd) => ({
        tabs: ["Attempt breakdown", "Top riders"],
        attemptBreakdown: {
          type: "doughnut",
          labels: ["1st Attempt Success", "2nd Attempt / Other"],
          values: [
            Math.round(dd.firstAttemptSuccessRate),
            Math.max(0, Math.round(100 - dd.firstAttemptSuccessRate)),
          ],
          colors: ["#14b8a6", "#e2e8f0"],
        },
        topRiders: {
          type: "bar",
          labels: dd.topRiders.slice(0, 6).map((r) => r.label),
          values: dd.topRiders.slice(0, 6).map((r) => r.value),
          color: "#14b8a6",
          datasetLabel: "Deliveries",
        },
      }),
      getSummary: (dd) => [
        {
          label: "Success rate",
          value: `${dd.firstAttemptSuccessRate.toFixed(1)}%`,
        },
        { label: "Delivered", value: dd.delivered.toLocaleString() },
        { label: "Top rider", value: dd.topRider },
      ],
    },

    topRider: {
      label: "Top Rider",
      icon: <FaMotorcycle />,
      color: "#8b5cf6",
      buildChartData: (dd) => ({
        tabs: ["Top 5 riders", "Most flagged"],
        top5Riders: {
          type: "bar",
          labels: dd.topRiders.map((r) => r.label),
          values: dd.topRiders.map((r) => r.value),
          color: "#8b5cf6",
          datasetLabel: "Deliveries",
        },
        mostFlagged: {
          type: "bar",
          labels: dd.topFlaggedRiders.map((r) => r.label),
          values: dd.topFlaggedRiders.map((r) => r.value),
          color: "#ef4444",
          datasetLabel: "Violations",
        },
      }),
      getSummary: (dd) => [
        { label: "Top rider", value: dd.topRider },
        { label: "Deliveries", value: dd.topRiderCount.toLocaleString() },
        { label: "Total riders", value: dd.totalRiders.toLocaleString() },
      ],
    },

    topMonth: {
      label: "Peak Month",
      icon: <FaCalendarAlt />,
      color: "#0ea5e9",
      buildChartData: (dd) => ({
        tabs: ["Monthly deliveries", "Monthly delays"],
        monthlyDeliveries: {
          type: "bar",
          labels: MONTH_SHORT,
          values: dd.monthGrowth,
          color: "#0ea5e9",
          datasetLabel: "Deliveries",
        },
        monthlyDelays: {
          type: "bar",
          labels: MONTH_SHORT,
          values: dd.monthDelayGrowth,
          color: "#f59e0b",
          datasetLabel: "Delays",
        },
      }),
      getSummary: (dd) => [
        { label: "Peak month", value: dd.topMonth },
        { label: "Deliveries", value: dd.topMonthCount.toLocaleString() },
        {
          label: "Avg / active month",
          value: (() => {
            const active = dd.monthGrowth.filter((v) => v > 0).length;
            return active > 0
              ? Math.round(dd.delivered / active).toLocaleString()
              : "0";
          })(),
        },
      ],
    },

    topYear: {
      label: "Peak Year",
      icon: <FaTrophy />,
      color: "#16a34a",
      buildChartData: (dd) => ({
        tabs: ["Yearly deliveries", "Yearly delays"],
        yearlyDeliveries: {
          type: "line",
          labels: dd.years,
          values: dd.yearGrowth,
          color: "#16a34a",
          datasetLabel: "Deliveries",
        },
        yearlyDelays: {
          type: "line",
          labels: dd.years,
          values: dd.yearDelayGrowth,
          color: "#f59e0b",
          datasetLabel: "Delays",
        },
      }),
      getSummary: (dd) => [
        { label: "Peak year", value: dd.topYear },
        { label: "Deliveries", value: dd.topYearCount.toLocaleString() },
        { label: "Years tracked", value: dd.years.length.toLocaleString() },
      ],
    },

    avgPerMonth: {
      label: "Avg / Month",
      icon: <FaChartLine />,
      color: "#16a34a",
      buildChartData: (dd) => ({
        tabs: ["Monthly deliveries", "Monthly delays"],
        monthlyDeliveries: {
          type: "bar",
          labels: MONTH_SHORT,
          values: dd.monthGrowth,
          color: "#16a34a",
          datasetLabel: "Deliveries",
        },
        monthlyDelays: {
          type: "bar",
          labels: MONTH_SHORT,
          values: dd.monthDelayGrowth,
          color: "#f59e0b",
          datasetLabel: "Delays",
        },
      }),
      getSummary: (dd) => {
        const active = dd.monthGrowth.filter((v) => v > 0).length;
        return [
          {
            label: "Avg / month",
            value: active > 0 ? (dd.delivered / active).toFixed(1) : "0",
          },
          { label: "Active months", value: active.toString() },
          { label: "Total delivered", value: dd.delivered.toLocaleString() },
        ];
      },
    },
  };
};

// â”€â”€â”€ KPI Chart Modal Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const KpiChartModal = ({ kpiKey, dashboardData, selectedYear, onClose }) => {
  // Build config dynamically based on currently selected year
  const KPI_CHART_CONFIG = buildKpiChartConfig(selectedYear);
  const config = KPI_CHART_CONFIG[kpiKey];
  const [activeTab, setActiveTab] = useState(0);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  if (!config) return null;

  const chartData = config.buildChartData(dashboardData);
  const tabKeys = Object.keys(chartData).filter((k) => k !== "tabs");
  const tabs = chartData.tabs || tabKeys;
  const currentKey = tabKeys[activeTab] || tabKeys[0];
  const currentSpec = chartData[currentKey];
  const summary = config.getSummary(dashboardData);

  // Reset to first tab whenever kpiKey or selectedYear changes
  // (prevents stale tab index pointing to a removed yearly tab)
  useEffect(() => {
    setActiveTab(0);
  }, [kpiKey, selectedYear]);

  useEffect(() => {
    if (!chartRef.current || !currentSpec) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    const ctx = chartRef.current.getContext("2d");
    const isDonut =
      currentSpec.type === "doughnut" || currentSpec.type === "pie";
    const maxVal = Array.isArray(currentSpec.values)
      ? Math.max(...currentSpec.values, 1)
      : 1;

    const bgColors = isDonut
      ? currentSpec.colors || ["#16a34a", "#ef4444", "#94a3b8"]
      : currentSpec.colors
        ? currentSpec.values.map(
            (_, i) => currentSpec.colors[i % currentSpec.colors.length],
          )
        : currentSpec.values.map((v) =>
            v === maxVal ? currentSpec.color : `${currentSpec.color}55`,
          );

    chartInstanceRef.current = new Chart(ctx, {
      type: currentSpec.type,
      data: {
        labels: currentSpec.labels,
        datasets: [
          {
            label: currentSpec.datasetLabel || config.label,
            data: currentSpec.values,
            backgroundColor: isDonut
              ? bgColors
              : currentSpec.type === "line"
                ? `${currentSpec.color}22`
                : bgColors,
            borderColor: isDonut
              ? bgColors
              : currentSpec.type === "line"
                ? currentSpec.color
                : "transparent",
            borderWidth: currentSpec.type === "line" ? 2.5 : 0,
            fill: currentSpec.type === "line",
            tension: 0.35,
            borderRadius: currentSpec.type === "bar" ? 7 : 0,
            pointBackgroundColor: currentSpec.color,
            pointRadius: currentSpec.type === "line" ? 3 : 0,
            pointHoverRadius: currentSpec.type === "line" ? 5 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: {
            display: isDonut,
            position: "right",
            labels: {
              font: { size: 11, family: "inherit" },
              boxWidth: 10,
              padding: 12,
              color: "#64748b",
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed?.y ?? ctx.parsed ?? ctx.raw;
                return ` ${val} ${(currentSpec.datasetLabel || config.label).toLowerCase()}`;
              },
            },
          },
        },
        scales: isDonut
          ? undefined
          : {
              x: {
                grid: { display: false },
                ticks: {
                  font: { size: 11 },
                  maxRotation: 45,
                  color: "#94a3b8",
                },
                border: { display: false },
              },
              y: {
                grid: { color: "rgba(148,163,184,0.12)" },
                ticks: { font: { size: 11 }, color: "#94a3b8" },
                border: { display: false },
                beginAtZero: true,
              },
            },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [activeTab, kpiKey, selectedYear]);

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.6)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 4000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 20,
          width: "min(600px, 96vw)",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          boxShadow:
            "0 34px 72px rgba(15,23,42,0.34), 0 12px 28px rgba(15,23,42,0.2)",
          animation: "kpiModalIn 0.3s cubic-bezier(0.22,1,0.36,1) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* â”€â”€ Modal Header â”€â”€ */}
        <div
          style={{
            background: `linear-gradient(135deg, ${config.color} 0%, ${config.color}cc 100%)`,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 14,
              }}
            >
              {config.icon}
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "-0.01em",
                }}
              >
                {config.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.65)",
                  marginTop: 1,
                }}
              >
                Analytics breakdown
                {selectedYear !== "All" && (
                  <span
                    style={{
                      marginLeft: 6,
                      background: "rgba(255,255,255,0.18)",
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 11,
                    }}
                  >
                    {selectedYear}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.18)",
              border: "none",
              borderRadius: 8,
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            <FaTimes />
          </button>
        </div>

        {/* â”€â”€ Modal Body â”€â”€ */}
        <div style={{ padding: 20, overflowY: "auto", background: "#f8fafc" }}>
          {/* Summary pills */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${summary.length}, 1fr)`,
              gap: 8,
              marginBottom: 16,
            }}
          >
            {summary.map((s, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  border: "0.5px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "10px 12px",
                  boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#94a3b8",
                    marginBottom: 3,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: i === 0 ? config.color : "#0f172a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          {tabs.length > 1 && (
            <div
              style={{
                display: "flex",
                gap: 3,
                background: "#e8ecf0",
                borderRadius: 10,
                padding: 3,
                marginBottom: 14,
              }}
            >
              {tabs.map((tab, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: 7,
                    padding: "7px 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                    background: activeTab === i ? "#fff" : "transparent",
                    color: activeTab === i ? config.color : "#64748b",
                    boxShadow:
                      activeTab === i ? "0 1px 4px rgba(15,23,42,0.1)" : "none",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          {/* Chart */}
          <div
            style={{
              background: "#fff",
              border: "0.5px solid #e2e8f0",
              borderRadius: 14,
              padding: "14px 14px 10px",
              height: 260,
              position: "relative",
              boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
            }}
          >
            <canvas ref={chartRef} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// â”€â”€â”€ REDESIGNED Stat Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const StatCard = ({
  icon,
  label,
  value,
  sub,
  accent = "emerald",
  trend,
  animKey,
  onChartClick,
}) => {
  const trendUp = trend && trend.startsWith("+");
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-inner">
        <div className="stat-header">
          <span className="stat-label">{label}</span>
          <div className="stat-icon">{icon}</div>
        </div>
        <div
          key={animKey}
          className={`stat-value${animKey !== undefined ? " stat-value-anim" : ""}`}
        >
          {value}
        </div>
        <div className="stat-footer">
          {sub && (
            <span
              key={`sub-${animKey}`}
              className={`stat-sub${animKey !== undefined ? " stat-sub-anim" : ""}`}
            >
              {sub}
            </span>
          )}
          {trend && (
            <span
              className={`stat-trend ${trendUp ? "stat-trend-up" : "stat-trend-down"}`}
            >
              {trendUp ? "Up" : "Down"} {trend.replace(/^[+-]/, "")}
            </span>
          )}
        </div>
      </div>
      {onChartClick && (
        <button
          type="button"
          onClick={onChartClick}
          className="stat-chart-btn"
          title={`View ${label} analytics`}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Analytics
        </button>
      )}
    </div>
  );
};

// â”€â”€â”€ Chart card wrapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ChartCard = ({ title, subtitle, children, className = "" }) => (
  <div className={`chart-card ${className}`.trim()}>
    <div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children}
  </div>
);

// â”€â”€â”€ Horizontal bar list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const HorizontalBarList = ({
  items,
  colorClass = "emerald",
  showAvatar = false,
}) => {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="hbar-list">
      {items.map((item, idx) => (
        <div key={idx} className="hbar-item">
          <div className="hbar-rank">{idx + 1}</div>
          {showAvatar && (
            <div className="hbar-avatar">
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt={item.label}
                  className="hbar-avatar-img"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.nextSibling.style.display = "flex";
                  }}
                />
              ) : null}
              <div
                className="hbar-avatar-fallback"
                style={{ display: item.avatarUrl ? "none" : "flex" }}
              >
                {String(item.label).trim().charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <div className="hbar-body">
            <div className="hbar-meta">
              <span className="hbar-label">{item.label}</span>
              <span className="hbar-value">{item.value}</span>
            </div>
            <div className="hbar-track">
              <div
                className={`hbar-fill hbar-fill-${colorClass}`}
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// â”€â”€â”€ Report Type SVG Icons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const IconParcel = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const IconRiderPerf = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="7" r="4" />
    <path d="M5.5 20a7 7 0 0 1 13 0" />
    <polyline points="17 10 19 12 23 8" />
  </svg>
);

const IconOverall = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 17V13" />
    <path d="M11 17V9" />
    <path d="M15 17v-4" />
    <path d="M19 17v-6" />
  </svg>
);

const REPORT_TYPE_OPTIONS = [
  { value: "parcels", label: "Parcels", Icon: IconParcel },
  {
    value: "rider_performance",
    label: "Rider Performance",
    Icon: IconRiderPerf,
  },
  { value: "overall", label: "Overall Reports", Icon: IconOverall },
];

// â”€â”€â”€ Recharts: Shared custom tooltip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const RcTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8eaf0",
        borderRadius: 10,
        padding: "10px 14px",
        boxShadow: "0 4px 20px rgba(30,40,80,0.12)",
        fontFamily: "inherit",
        fontSize: 13,
      }}
    >
      <p
        style={{
          margin: "0 0 6px",
          color: "#6b7280",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
        }}
      >
        {label}
      </p>
      {payload.map((entry, i) => (
        <p
          key={i}
          style={{
            margin: "3px 0",
            color: entry.color,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: entry.color,
              marginRight: 7,
              verticalAlign: "middle",
            }}
          />
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  );
};

// â”€â”€â”€ Recharts Chart 1: Deliveries vs Delays Line Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DeliveriesLineChart = ({
  monthGrowth = [],
  monthDelayGrowth = [],
  selectedYear = "All",
  years = [],
  yearGrowth = [],
  yearDelayGrowth = [],
}) => {
  const isAll = selectedYear === "All";
  const labels = isAll ? years : MONTH_SHORT;
  const delivData = isAll ? yearGrowth : monthGrowth;
  const delayData = isAll ? yearDelayGrowth : monthDelayGrowth;

  const data = labels.map((label, i) => ({
    label,
    Deliveries: delivData[i] || 0,
    Delays: delayData[i] || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={data}
        margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="4 4"
          stroke="#f0f2f7"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: "inherit" }}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: "inherit" }}
        />
        <Tooltip
          content={<RcTooltip />}
          cursor={{
            stroke: "#e8eaf0",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
          }}
        />
        <Legend
          wrapperStyle={{ paddingTop: 12, fontFamily: "inherit", fontSize: 12 }}
          formatter={(value) => (
            <span style={{ color: "#374151", fontSize: 12, fontWeight: 500 }}>
              {value}
            </span>
          )}
        />
        <Line
          type="monotone"
          dataKey="Deliveries"
          stroke="#16a34a"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: "#16a34a", stroke: "#fff", strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="Delays"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 4, fill: "#f59e0b", stroke: "#fff", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

// â”€â”€â”€ Recharts Chart 2: Status Breakdown Donut Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DONUT_COLORS = ["#16a34a", "#ef4444", "#94a3b8"];
const DONUT_LABELS = ["Delivered", "Cancelled", "In Progress"];

const StatusDonutChart = ({
  parcelStatusMix = { delivered: 0, cancelled: 0, inProgress: 0 },
}) => {
  const [activeIndex, setActiveIndex] = useState(null);
  const total =
    (parcelStatusMix.delivered || 0) +
    (parcelStatusMix.cancelled || 0) +
    (parcelStatusMix.inProgress || 0);
  const donutData = [
    { name: "Delivered", value: parcelStatusMix.delivered || 0 },
    { name: "Cancelled", value: parcelStatusMix.cancelled || 0 },
    { name: "In Progress", value: parcelStatusMix.inProgress || 0 },
  ];

  const isDarkMode = document.body.classList.contains("dark");
  const renderCenterLabel = ({ cx, cy }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan
        x={cx}
        dy="-6"
        fontSize="20"
        fontWeight="700"
        fill={isDarkMode ? "#e2e8f0" : "#1a1d2e"}
        fontFamily="inherit"
      >
        {total.toLocaleString()}
      </tspan>
      <tspan
        x={cx}
        dy="20"
        fontSize="11"
        fill={isDarkMode ? "#64748b" : "#9ca3af"}
        fontFamily="inherit"
        fontWeight="500"
      >
        Total
      </tspan>
    </text>
  );

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 16, height: 220 }}
    >
      <ResponsiveContainer width="55%" height="100%">
        <PieChart>
          <Pie
            data={donutData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={activeIndex !== null ? 88 : 82}
            paddingAngle={2}
            dataKey="value"
            labelLine={false}
            label={renderCenterLabel}
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {donutData.map((entry, index) => (
              <Cell
                key={index}
                fill={DONUT_COLORS[index]}
                opacity={
                  activeIndex === null || activeIndex === index ? 1 : 0.5
                }
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${value} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
              name,
            ]}
            contentStyle={{
              background: "#fff",
              border: "1px solid #e8eaf0",
              borderRadius: 10,
              fontFamily: "inherit",
              fontSize: 13,
              boxShadow: "0 4px 20px rgba(30,40,80,0.12)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div
        style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}
      >
        {donutData.map((entry, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: DONUT_COLORS[i],
                flexShrink: 0,
                boxShadow: `0 0 0 3px ${DONUT_COLORS[i]}22`,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#374151",
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                {DONUT_LABELS[i]}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#9ca3af",
                  fontFamily: "inherit",
                }}
              >
                {total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0}%
              </div>
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: DONUT_COLORS[i],
                fontFamily: "inherit",
              }}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Recharts Chart 3: Violations Trend Bar Chart

const ViolationsTrendChart = ({
  violationLogs = [],
  violationsByWeekday = [],
}) => {
  const [tab, setTab] = useState("month");

  const byMonth = useMemo(() => {
    const counts = Array(12).fill(0);
    (violationLogs || []).forEach((v) => {
      const d = new Date(v?.date);
      if (!Number.isNaN(d.getTime())) counts[d.getMonth()] += 1;
    });
    return MONTH_SHORT.map((label, i) => ({ label, Violations: counts[i] }));
  }, [violationLogs]);

  const byWeekday = useMemo(
    () =>
      WEEKDAY_LABELS.map((label, i) => ({
        label,
        Violations: violationsByWeekday[i] || 0,
      })),
    [violationsByWeekday],
  );

  const chartData = tab === "month" ? byMonth : byWeekday;
  const maxVal = Math.max(...chartData.map((d) => d.Violations), 1);

  const CustomBar = (props) => {
    const { x, y, width, height, value } = props;
    const isMax = value === maxVal;
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isMax ? "#ef4444" : "rgba(239,68,68,0.35)"}
        rx={5}
        ry={5}
        style={{ transition: "fill 0.2s" }}
      />
    );
  };

  return (
    <div style={{ height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div />
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "#f4f6fb",
            borderRadius: 8,
            padding: 3,
          }}
        >
          {["month", "weekday"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "inherit",
                background: tab === t ? "#ffffff" : "transparent",
                color: tab === t ? "#1a1d2e" : "#9ca3af",
                boxShadow: tab === t ? "0 1px 4px rgba(30,40,80,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >
              {t === "month" ? "By Month" : "By Weekday"}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={188}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="4 4"
            stroke="#f0f2f7"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: "inherit" }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: "inherit" }}
          />
          <Tooltip
            content={<RcTooltip />}
            cursor={{
              stroke: "#f0f2f7",
              strokeWidth: 1.5,
              strokeDasharray: "4 4",
            }}
          />
          <Line
            type="monotone"
            dataKey="Violations"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={(props) => {
              const { cx, cy, value } = props;
              if (value === 0) return null;
              const isMax = value === maxVal;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={isMax ? 5 : 3}
                  fill={isMax ? "#ef4444" : "#fca5a5"}
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            }}
            activeDot={{
              r: 5,
              fill: "#ef4444",
              stroke: "#fff",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// ─── Rider Efficiency Scorecard ──────────────────────────────────────────────

const RiderScorecardCard = ({
  topRiders,
  topFlaggedRiders,
  topCleanRiders,
}) => {
  // Build a merged rider list with delivery count, violation count, and avatar
  const riderMap = {};

  (topRiders || []).forEach((r) => {
    const key = r.label.toLowerCase();
    if (!riderMap[key])
      riderMap[key] = {
        name: r.label,
        deliveries: 0,
        violations: 0,
        avatarUrl: r.avatarUrl || null,
      };
    riderMap[key].deliveries = r.value;
    if (r.avatarUrl) riderMap[key].avatarUrl = r.avatarUrl;
  });

  (topFlaggedRiders || []).forEach((r) => {
    const key = r.label.toLowerCase();
    if (!riderMap[key])
      riderMap[key] = {
        name: r.label,
        deliveries: 0,
        violations: 0,
        avatarUrl: r.avatarUrl || null,
      };
    riderMap[key].violations = r.value;
    if (r.avatarUrl && !riderMap[key].avatarUrl)
      riderMap[key].avatarUrl = r.avatarUrl;
  });

  const allRiders = Object.values(riderMap);
  const maxDeliveries = Math.max(...allRiders.map((r) => r.deliveries), 1);
  const maxViolations = Math.max(...allRiders.map((r) => r.violations), 1);

  const scored = allRiders
    .map((r) => {
      // AFTER
      const deliveryScore = (r.deliveries / maxDeliveries) * 100;
      const complianceScore = Math.max(0, 100 - r.violations * 10);
      const score = Math.round(deliveryScore * 0.65 + complianceScore * 0.35);
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const STATUS_STYLES = {
    top: { label: "Top", bg: "#EAF3DE", color: "#3B6D11" },
    average: { label: "Average", bg: "#F1EFE8", color: "#5F5E5A" },
    risk: { label: "At risk", bg: "#FCEBEB", color: "#A32D2D" },
  };

  const SCORE_COLORS = {
    top: "#3B6D11",
    average: "#888780",
    risk: "#A32D2D",
  };

  if (!scored.length) {
    return (
      <p
        style={{
          textAlign: "center",
          color: "var(--dash-muted)",
          padding: "2rem 0",
          fontSize: "0.8rem",
        }}
      >
        No rider data
      </p>
    );
  }

  return (
    <div className="rsc-table">
      {/* Header */}
      <div className="rsc-header-row">
        <span className="rsc-th rsc-th-rider">Rider</span>
        <span className="rsc-th">Deliveries</span>
        <span className="rsc-th">Violations</span>
        <span className="rsc-th rsc-th-score">Score</span>
      </div>
      {/* Rows */}
      {scored.map((rider, idx) => {
        const initials = rider.name
          .trim()
          .split(" ")
          .slice(0, 2)
          .map((w) => w.charAt(0).toUpperCase())
          .join("");
        return (
          <div key={idx} className="rsc-row">
            {/* Avatar + Name */}
            <div className="rsc-cell rsc-cell-rider">
              <div className="rsc-avatar">
                {rider.avatarUrl ? (
                  <img
                    src={rider.avatarUrl}
                    alt={rider.name}
                    className="rsc-avatar-img"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextSibling.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  className="rsc-avatar-fallback"
                  style={{ display: rider.avatarUrl ? "none" : "flex" }}
                >
                  {initials}
                </div>
              </div>
              <div className="rsc-rider-info">
                <span className="rsc-rider-name">{rider.name}</span>
                <span className="rsc-rider-sub">
                  {rider.deliveries} deliveries
                </span>
              </div>
            </div>
            {/* Deliveries bar */}
            <div className="rsc-cell rsc-cell-bar">
              <span className="rsc-metric-val">{rider.deliveries}</span>
              <div className="rsc-bar-track">
                <div
                  className="rsc-bar-fill rsc-bar-green"
                  style={{
                    width: `${(rider.deliveries / maxDeliveries) * 100}%`,
                  }}
                />
              </div>
            </div>
            {/* Violations bar */}
            <div className="rsc-cell rsc-cell-bar">
              <span
                className="rsc-metric-val"
                style={{
                  color: rider.violations > 0 ? "#A32D2D" : "var(--dash-muted)",
                }}
              >
                {rider.violations}
              </span>
              <div className="rsc-bar-track">
                <div
                  className="rsc-bar-fill rsc-bar-red"
                  style={{
                    width: `${(rider.violations / maxViolations) * 100}%`,
                  }}
                />
              </div>
            </div>
            {/* Score */}
            <div
              className="rsc-cell rsc-cell-score"
              style={{
                color:
                  rider.score >= 60
                    ? "#3B6D11"
                    : rider.score >= 25
                      ? "#888780"
                      : "#A32D2D",
              }}
            >
              {rider.score}
            </div>
          </div>
        );
      })}
      {/* Formula footnote */}
      <div className="rsc-formula"></div>
    </div>
  );
};

// â”€â”€â”€ PDF Generation Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PDF_BRAND_RED = [153, 0, 0];
const PDF_BRAND_DARK = [17, 24, 39];
const PDF_SLATE_600 = [71, 85, 105];
const PDF_SLATE_400 = [148, 163, 184];
const PDF_SLATE_100 = [241, 245, 249];
const PDF_WHITE = [255, 255, 255];
const PDF_BORDER = [226, 232, 240];
const PDF_SUCCESS = [22, 163, 74];
const PDF_WARNING = [202, 138, 4];
const PDF_DANGER = [220, 38, 38];
const PDF_ALERT_BG = [254, 242, 242];
const PDF_WARN_BG = [254, 249, 195];
const PDF_COVER_BG = [248, 250, 252];
const PDF_ACCENT = [185, 28, 28];

const KPI_BENCHMARKS = {
  "Delivery Rate": { target: 90, warn: 80, higherIsBetter: true, unit: "%" },
  "1st Attempt Success Rate": {
    target: 70,
    warn: 60,
    higherIsBetter: true,
    unit: "%",
  },
  "1st Attempt Success": {
    target: 70,
    warn: 60,
    higherIsBetter: true,
    unit: "%",
  },
  "Delay Rate": {
    target: 5,
    warn: 10,
    higherIsBetter: false,
    unit: "%",
  },
};

const parsePercentValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const getKpiBenchmarkConfig = (label) => KPI_BENCHMARKS[label] || null;

const getKpiStatus = (label, value) => {
  const config = getKpiBenchmarkConfig(label);
  if (!config) return null;
  const numeric = parsePercentValue(value);
  if (numeric === null) return null;
  if (config.higherIsBetter) {
    if (numeric >= config.target) return "good";
    if (numeric >= config.warn) return "warn";
    return "bad";
  }
  if (numeric <= config.target) return "good";
  if (numeric <= config.warn) return "warn";
  return "bad";
};

const getKpiStatusColor = (status) => {
  if (status === "good") return PDF_SUCCESS;
  if (status === "warn") return PDF_WARNING;
  if (status === "bad") return PDF_DANGER;
  return PDF_BRAND_DARK;
};

const getBenchmarkLabel = (status, config) => {
  const bench = `${config.target}${config.unit || ""}`;
  if (!status) return `Bench: ${bench}`;
  if (config.higherIsBetter) {
    if (status === "good") return `Above ${bench} benchmark`;
    if (status === "warn") return `Near ${bench} benchmark`;
    return `Below ${bench} benchmark`;
  }
  if (status === "good") return `Below ${bench} benchmark`;
  if (status === "warn") return `Near ${bench} benchmark`;
  return `Above ${bench} benchmark`;
};

const buildSummaryValueMap = (rows = []) =>
  rows.reduce((acc, [label, value]) => {
    acc[label] = value;
    return acc;
  }, {});

const buildCriticalAlerts = (reportType, reportAnalytics) => {
  const alerts = [];
  const rows = reportAnalytics?.summaryRows || [];
  rows.forEach(([label, value]) => {
    const status = getKpiStatus(label, value);
    const config = getKpiBenchmarkConfig(label);
    if (!config || status !== "bad") return;
    alerts.push({
      level: "critical",
      text: `${label} is ${getBenchmarkLabel(status, config).toLowerCase()} (${value}).`,
    });
  });

  if (reportType === "rider_performance") {
    const totalViolations = reportAnalytics?.metrics?.totalViolations || 0;
    if (totalViolations > 0) {
      alerts.push({
        level: "warning",
        text: `Violations recorded: ${totalViolations}. Prioritize coaching for flagged riders.`,
      });
    }
    const floodAlerts = reportAnalytics?.metrics?.totalFloodAlerts || 0;
    if (floodAlerts > 0) {
      alerts.push({
        level: "warning",
        text: `Flood alerts recorded: ${floodAlerts}. Confirm rider safety and reassign routes.`,
      });
    }
  }
  if (reportType === "overall") {
    const totalViolations = reportAnalytics?.summaryRows?.find(
      ([k]) => k === "Total Violations",
    )?.[1];
    const numeric = parseInt(totalViolations, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
      alerts.push({
        level: "warning",
        text: `Total violations logged: ${numeric}. Reinforce compliance and safety.`,
      });
    }
    const floodAlerts = parseInt(
      reportAnalytics?.summaryRows?.find(([k]) => k === "Flood Alerts")?.[1],
      10,
    );
    if (Number.isFinite(floodAlerts) && floodAlerts > 0) {
      alerts.push({
        level: "warning",
        text: `Flood alerts recorded: ${floodAlerts}. Adjust routing and rider assignments.`,
      });
    }
  }

  return alerts;
};

const buildRecommendations = (reportType, reportAnalytics) => {
  const recs = [];
  const rows = reportAnalytics?.summaryRows || [];
  const map = buildSummaryValueMap(rows);
  const deliveryRate = parsePercentValue(map["Delivery Rate"]);
  const firstAttemptRate =
    parsePercentValue(map["1st Attempt Success Rate"]) ||
    parsePercentValue(map["1st Attempt Success"]);
  const delayRate = parsePercentValue(map["Delay Rate"]);

  if (Number.isFinite(deliveryRate) && deliveryRate < 90) {
    recs.push(
      "Improve routing and pickup scheduling to lift the delivery rate toward the 90% benchmark.",
    );
  }
  if (Number.isFinite(firstAttemptRate) && firstAttemptRate < 70) {
    recs.push(
      "Strengthen address validation and pre-delivery contact to raise first-attempt success.",
    );
  }
  if (Number.isFinite(delayRate) && delayRate > 5) {
    recs.push(
      "Add cut-off reminders and proactive status updates to curb delivery delays.",
    );
  }

  if (reportType === "rider_performance" || reportType === "overall") {
    const totalViolations =
      reportAnalytics?.metrics?.totalViolations ||
      parseInt(map["Total Violations"], 10) ||
      0;
    if (Number.isFinite(totalViolations) && totalViolations > 0) {
      recs.push(
        "Run refresher training for riders with repeated violations and track weekly improvements.",
      );
    }
    const floodAlerts =
      reportAnalytics?.metrics?.totalFloodAlerts ||
      parseInt(map["Flood Alerts"], 10) ||
      0;
    if (Number.isFinite(floodAlerts) && floodAlerts > 0) {
      recs.push(
        "Review flood-affected zones and update route plans to reduce rider exposure.",
      );
    }
    const topPerformer =
      reportAnalytics?.metrics?.topPerformer || map["Top Performer"];
    if (topPerformer) {
      recs.push(
        `Recognize ${topPerformer} and share best practices across the rider team.`,
      );
    }
  }

  if (!recs.length) {
    recs.push(
      "Maintain current operating cadence and continue monitoring KPI benchmarks.",
    );
  }

  return recs;
};

const buildExecutiveSummary = (
  reportType,
  reportAnalytics,
  dateRange = "All time",
) => {
  const rows = reportAnalytics?.summaryRows || [];
  const map = buildSummaryValueMap(rows);
  const totalParcels = map["Total Parcels"];
  const deliveryRate = map["Delivery Rate"];
  const firstAttempt =
    map["1st Attempt Success Rate"] || map["1st Attempt Success"];
  const delayRate = map["Delay Rate"];
  const totalRiders = map["Total Riders"];
  const totalDeliveries = map["Total Deliveries"];
  const totalViolations = map["Total Violations"];
  const floodAlerts = map["Flood Alerts"];
  const topPerformer = map["Top Performer"];
  const mostFlagged = map["Most Flagged Rider"];
  const paragraphs = [];

  if (reportType === "parcels") {
    paragraphs.push(
      `This parcels report covers ${dateRange} with ${totalParcels || "0"} parcels processed. Delivery rate is ${deliveryRate || "0%"} and first-attempt success is ${firstAttempt || "0%"}.`,
    );
    paragraphs.push(`Delays (attempt 2 failed) are ${delayRate || "0%"}.`);
  } else if (reportType === "rider_performance") {
    paragraphs.push(
      `Rider performance for ${dateRange} includes ${totalRiders || "0"} riders delivering ${totalDeliveries || "0"} parcels.`,
    );
    if (topPerformer) {
      paragraphs.push(`Top performer: ${topPerformer}.`);
    }
    if (mostFlagged) {
      paragraphs.push(`Most flagged rider: ${mostFlagged}.`);
    }
    if (totalViolations) {
      paragraphs.push(`Total violations logged: ${totalViolations}.`);
    }
    if (floodAlerts && String(floodAlerts) !== "0") {
      paragraphs.push(`Flood alerts recorded: ${floodAlerts}.`);
    }
  } else {
    paragraphs.push(
      `Overall operations summary for ${dateRange} shows ${totalParcels || "0"} parcels and ${totalRiders || "0"} riders.`,
    );
    paragraphs.push(
      `Delivery rate is ${deliveryRate || "0%"} with first-attempt success at ${firstAttempt || "0%"}.`,
    );
    if (topPerformer) {
      paragraphs.push(`Top performer: ${topPerformer}.`);
    }
    if (mostFlagged) {
      paragraphs.push(`Most flagged rider: ${mostFlagged}.`);
    }
    if (floodAlerts && String(floodAlerts) !== "0") {
      paragraphs.push(`Flood alerts recorded: ${floodAlerts}.`);
    }
  }

  return paragraphs;
};

const buildHighlightCards = (reportType, reportAnalytics) => {
  const rows = reportAnalytics?.summaryRows || [];
  const map = buildSummaryValueMap(rows);
  if (reportType === "parcels") {
    return [
      {
        label: "Total Parcels",
        value: map["Total Parcels"] || "0",
      },
      {
        label: "Delivery Rate",
        value: map["Delivery Rate"] || "0%",
        status: getKpiStatus("Delivery Rate", map["Delivery Rate"]),
      },
      {
        label: "1st Attempt Success",
        value: map["1st Attempt Success Rate"] || "0%",
        status: getKpiStatus(
          "1st Attempt Success Rate",
          map["1st Attempt Success Rate"],
        ),
      },
    ];
  }
  if (reportType === "rider_performance") {
    return [
      {
        label: "Total Riders",
        value: map["Total Riders"] || "0",
      },
      {
        label: "Total Deliveries",
        value: map["Total Deliveries"] || "0",
      },
      {
        label: "Total Violations",
        value: map["Total Violations"] || "0",
      },
    ];
  }
  return [
    {
      label: "Total Parcels",
      value: map["Total Parcels"] || "0",
    },
    {
      label: "Delivery Rate",
      value: map["Delivery Rate"] || "0%",
      status: getKpiStatus("Delivery Rate", map["Delivery Rate"]),
    },
    {
      label: "Total Riders",
      value: map["Total Riders"] || "0",
    },
  ];
};

const buildTocItems = (reportType) => {
  if (reportType === "parcels") {
    return [
      "Executive Summary",
      "Key Metrics",
      "Analytics Charts",
      "Raw Data",
      "Recommendations",
    ];
  }
  if (reportType === "rider_performance") {
    return [
      "Executive Summary",
      "Key Metrics",
      "Rider 1st Attempt Rates",
      "Analytics Charts",
      "Rider Performance Breakdown",
      "Raw Data",
      "Recommendations",
    ];
  }
  return [
    "Executive Summary",
    "Overview Metrics",
    "Parcels Section",
    "Rider Performance Section",
    "Flood-Affected Riders",
    "Raw Data",
    "Recommendations",
  ];
};

const pdfAddCoverHeader = (
  doc,
  pageWidth,
  reportTitle,
  dateRange,
  generatedBy,
  generatedAt,
  logoDataUrl,
) => {
  // Main red header bar - larger and more professional
  doc.setFillColor(...PDF_BRAND_RED);
  doc.rect(0, 0, pageWidth, 24, "F");

  // Header text - title on left
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...PDF_WHITE);
  doc.text(reportTitle, 14, 16);

  // Right side info - date range, generated by, timestamp (less crowded)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_WHITE);

  const headerRightX = pageWidth - 50;
  doc.text(dateRange, headerRightX, 8, { align: "right" });
  doc.text(`Generated by: ${generatedBy || "Admin"}`, headerRightX, 12, {
    align: "right",
  });
  doc.text(generatedAt, headerRightX, 16, { align: "right" });

  // Light gray section below header for breathing room
  doc.setFillColor(...PDF_COVER_BG);
  doc.rect(0, 24, pageWidth, 20, "F");

  doc.setTextColor(...PDF_BRAND_DARK);
};

const loadLogoDataUrl = () =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (_) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = "/logo.png";
  });

const pdfAddRunningHeader = (doc, pageWidth, reportTitle) => {
  doc.setFillColor(...PDF_BRAND_RED);
  doc.rect(0, 0, pageWidth, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_WHITE);
  doc.text(reportTitle.toUpperCase(), pageWidth / 2, 5.5, { align: "center" });
  doc.setTextColor(...PDF_BRAND_DARK);
};

const pdfAddPageFooter = (
  doc,
  pageNum,
  totalPages,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  doc.setFillColor(...PDF_SLATE_100);
  doc.rect(0, pageHeight - 10, pageWidth, 10, "F");
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.25);
  doc.line(0, pageHeight - 10, pageWidth, pageHeight - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_SLATE_400);
  doc.text(`${reportTitle} · Confidential`, 12, pageHeight - 4);
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - 12, pageHeight - 4, {
    align: "right",
  });
};

const pdfSectionHeading = (doc, text, y, pageWidth) => {
  doc.setFillColor(...PDF_SLATE_100);
  doc.roundedRect(10, y - 5, pageWidth - 20, 9, 2, 2, "F");
  doc.setFillColor(...PDF_BRAND_RED);
  doc.roundedRect(10, y - 5, 3, 9, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_BRAND_DARK);
  doc.text(text.toUpperCase(), 17, y);
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.4);
  doc.line(10, y + 3.5, pageWidth - 10, y + 3.5);
  doc.setTextColor(...PDF_BRAND_DARK);
  return y + 7;
};

const pdfAddParagraphs = (
  doc,
  paragraphs,
  x,
  y,
  maxWidth,
  lineHeight = 4.2,
) => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_BRAND_DARK);
  (paragraphs || []).forEach((para) => {
    if (!para) return;
    const lines = doc.splitTextToSize(String(para), maxWidth);
    doc.text(lines, x, y);
    y += lines.length * lineHeight + 3;
  });
  return y;
};

const pdfAddHighlights = (doc, highlights, startY, pageWidth) => {
  if (!highlights?.length) return startY;
  const cards = highlights.slice(0, 3);
  const gap = 6;
  const cardW = (pageWidth - 20 - gap * 2) / 3;
  const cardH = 20;
  let x = 10;
  let y = startY;
  cards.forEach((card) => {
    doc.setFillColor(...PDF_WHITE);
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...PDF_SLATE_400);
    doc.text(String(card.label), x + 4, y + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...getKpiStatusColor(card.status));
    doc.text(String(card.value), x + 4, y + 14);
    x += cardW + gap;
  });
  return y + cardH + 6;
};

const pdfAddBulletList = (doc, items, x, y, maxWidth) => {
  if (!items?.length) return y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_BRAND_DARK);
  items.forEach((item) => {
    const lines = doc.splitTextToSize(String(item), maxWidth - 6);
    if (!lines.length) return;
    doc.text(`- ${lines[0]}`, x, y);
    y += 4.2;
    for (let i = 1; i < lines.length; i += 1) {
      doc.text(lines[i], x + 4, y);
      y += 4.2;
    }
    y += 2;
  });
  return y;
};

const pdfAddAlertBoxes = (doc, alerts, x, y, maxWidth) => {
  if (!alerts?.length) return y;
  alerts.forEach((alert) => {
    const isCritical = alert.level === "critical";
    const bg = isCritical ? PDF_ALERT_BG : PDF_WARN_BG;
    const stroke = isCritical ? PDF_DANGER : PDF_WARNING;
    const lines = doc.splitTextToSize(alert.text, maxWidth - 10);
    const boxH = lines.length * 4.2 + 6;
    doc.setFillColor(...bg);
    doc.setDrawColor(...stroke);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, maxWidth, boxH, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...stroke);
    doc.text(isCritical ? "ALERT" : "NOTICE", x + 4, y + 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(lines, x + 4, y + 9);
    y += boxH + 4;
  });
  doc.setTextColor(...PDF_BRAND_DARK);
  return y;
};

const pdfAddTableOfContents = (doc, items, pageWidth) => {
  let y = 18;
  y = pdfSectionHeading(doc, "Table of Contents", y, pageWidth);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_BRAND_DARK);
  const listX = 14;
  const listW = pageWidth - 28;
  doc.setFillColor(...PDF_WHITE);
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.3);
  const boxH = (items?.length || 0) * 6 + 8;
  doc.roundedRect(listX - 2, y - 3, listW + 4, boxH, 2, 2, "FD");
  (items || []).forEach((item, idx) => {
    doc.text(`${idx + 1}. ${item}`, listX, y + 2);
    y += 6;
  });
  return y;
};

const pdfDrawCallout = (doc, text, x, y, maxW) => {
  if (!text) return;
  const lines = doc.splitTextToSize(text, maxW - 6);
  const boxH = lines.length * 4 + 4;
  doc.setFillColor(...PDF_WARN_BG);
  doc.setDrawColor(...PDF_WARNING);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, maxW, boxH, 2, 2, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(120, 53, 15);
  doc.text(lines, x + 3, y + 3.5);
  doc.setTextColor(...PDF_BRAND_DARK);
};

const pdfFailureAnalysisTable = (
  doc,
  failureReasons,
  startY,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  if (!failureReasons?.length) return startY;
  if (startY + 30 > pageHeight - 14) {
    doc.addPage();
    pdfAddRunningHeader(doc, pageWidth, reportTitle);
    startY = 16;
  }
  startY = pdfSectionHeading(
    doc,
    "Failure / Attempt Analysis",
    startY,
    pageWidth,
  );
  startY += 2;
  autoTable(doc, {
    startY,
    margin: { left: 10, right: 10 },
    head: [["Reason (Attempt 1)", "Count", "Share of Failures"]],
    body: failureReasons.map((r) => [r.reason, String(r.count), `${r.share}%`]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [31, 41, 55],
      lineColor: PDF_BORDER,
      lineWidth: 0.18,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: PDF_BRAND_RED,
      textColor: PDF_WHITE,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "center" },
      2: { halign: "center" },
    },
  });
  return doc.lastAutoTable.finalY + 8;
};

const pdfRiderFirstAttemptTable = (
  doc,
  riderFirstAttemptRows,
  startY,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  if (!riderFirstAttemptRows?.length) return startY;
  if (startY + 30 > pageHeight - 14) {
    doc.addPage();
    pdfAddRunningHeader(doc, pageWidth, reportTitle);
    startY = 16;
  }
  startY = pdfSectionHeading(doc, "Rider 1st Attempt Rates", startY, pageWidth);
  startY += 2;
  autoTable(doc, {
    startY,
    margin: { left: 10, right: 10 },
    head: [["Rider", "1st Attempt Success", "2nd Attempt Success"]],
    body: riderFirstAttemptRows.map((r) => [
      r.name,
      `${r.rate}%`,
      `${r.secondRate}%`,
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [31, 41, 55],
      lineColor: PDF_BORDER,
      lineWidth: 0.18,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: PDF_BRAND_RED,
      textColor: PDF_WHITE,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "center" },
      2: { halign: "center" },
    },
    didParseCell: (tableData) => {
      if (tableData.section !== "body") return;
      if (tableData.column.index === 1 || tableData.column.index === 2) {
        const val = parseInt(tableData.cell.raw, 10);
        if (val >= 80) tableData.cell.styles.textColor = PDF_SUCCESS;
        else if (val >= 60) tableData.cell.styles.textColor = PDF_WARNING;
        else tableData.cell.styles.textColor = PDF_DANGER;
        tableData.cell.styles.fontStyle = "bold";
      }
    },
  });
  return doc.lastAutoTable.finalY + 8;
};

const pdfFloodAffectedTable = (
  doc,
  floodAffectedRows,
  startY,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  if (!floodAffectedRows?.length) return startY;
  if (startY + 30 > pageHeight - 14) {
    doc.addPage();
    pdfAddRunningHeader(doc, pageWidth, reportTitle);
    startY = 16;
  }
  startY = pdfSectionHeading(doc, "Flood-Affected Riders", startY, pageWidth);
  startY += 2;
  autoTable(doc, {
    startY,
    margin: { left: 10, right: 10 },
    head: [["Rider", "Date", "Location"]],
    body: floodAffectedRows.map((r) => [
      r.name || "Unknown",
      formatPdfDate(r.date),
      r.address || `${r.lat}, ${r.lng}` || "-",
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [31, 41, 55],
      lineColor: PDF_BORDER,
      lineWidth: 0.18,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: PDF_BRAND_RED,
      textColor: PDF_WHITE,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      1: { halign: "center" },
    },
  });
  return doc.lastAutoTable.finalY + 8;
};

const pdfKpiGrid = (doc, rows, startY, pageWidth) => {
  const cols = 3;
  const boxW = (pageWidth - 20 - (cols - 1) * 5) / cols;
  const boxH = 18;
  const gap = 5;
  let x = 10,
    y = startY;

  rows.forEach(([label, value], i) => {
    if (i > 0 && i % cols === 0) {
      x = 10;
      y += boxH + gap;
    }
    doc.setFillColor(252, 252, 253);
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_SLATE_400);
    doc.text(String(label), x + 4, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const status = getKpiStatus(label, value);
    const valueColor = getKpiStatusColor(status);
    doc.setTextColor(...valueColor);
    doc.text(String(value), x + 4, y + 12);
    x += boxW + gap;
  });

  const totalRows = Math.ceil(rows.length / cols);
  return startY + totalRows * (boxH + gap) + 3;
};

const pdfChartGrid = (
  doc,
  chartImages,
  startY,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  const cols = 2;
  const marginX = 10;
  const gap = 6;
  const chartW = (pageWidth - marginX * 2 - gap) / cols;
  const chartH = 62;
  const labelH = 7;
  const rowH = labelH + chartH + gap + 2;
  let y = startY;

  chartImages.forEach((ci, i) => {
    const col = i % cols;
    if (col === 0) {
      if (i > 0) y += rowH;
      if (y + rowH > pageHeight - 14) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }
    }
    const x = marginX + col * (chartW + gap);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_SLATE_600);
    doc.text(ci.title || "Chart", x, y + labelH - 1);
    doc.setFillColor(252, 252, 253);
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y + labelH, chartW, chartH, 2, 2, "FD");
    doc.addImage(
      ci.dataUrl,
      "PNG",
      x + 1,
      y + labelH + 1,
      chartW - 2,
      chartH - 2,
    );
    if (ci.annotation) {
      const calloutW = Math.min(70, chartW - 6);
      pdfDrawCallout(
        doc,
        ci.annotation,
        x + chartW - calloutW - 3,
        y + labelH + 3,
        calloutW,
      );
    }
  });

  const lastRow = Math.floor((chartImages.length - 1) / cols);
  return y + (lastRow >= 0 ? rowH : 0) + 6;
};

const pdfRiderPerfTable = (
  doc,
  riderPerfRows,
  startY,
  pageWidth,
  pageHeight,
  reportTitle,
) => {
  if (!riderPerfRows?.length) return startY;

  if (startY + 30 > pageHeight - 14) {
    doc.addPage();
    pdfAddRunningHeader(doc, pageWidth, reportTitle);
    startY = 16;
  }

  startY = pdfSectionHeading(
    doc,
    "Rider Performance Breakdown",
    startY,
    pageWidth,
  );
  startY += 2;

  const head = [
    [
      "Rider Name",
      "Delivered",
      "Delayed (Attempt 2 Failed)",
      "Violations",
      "Delivery Rate",
    ],
  ];
  const body = riderPerfRows.map((r) => [
    r.name,
    String(r.delivered),
    String(r.delayed),
    String(r.violations),
    `${r.deliveryRate}%`,
  ]);

  autoTable(doc, {
    startY,
    margin: { left: 10, right: 10 },
    head,
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [31, 41, 55],
      lineColor: PDF_BORDER,
      lineWidth: 0.18,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: PDF_BRAND_RED,
      textColor: PDF_WHITE,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "center" },
      2: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
    },
    didParseCell: (tableData) => {
      if (tableData.section !== "body") return;
      const col = tableData.column.index;
      if (col === 4) {
        const val = parseInt(tableData.cell.raw, 10);
        if (val >= 80) tableData.cell.styles.textColor = [22, 163, 74];
        else if (val >= 50) tableData.cell.styles.textColor = [202, 138, 4];
        else tableData.cell.styles.textColor = [220, 38, 38];
        tableData.cell.styles.fontStyle = "bold";
      }
      if (col === 3 && parseInt(tableData.cell.raw, 10) > 0) {
        tableData.cell.styles.textColor = [220, 38, 38];
        tableData.cell.styles.fontStyle = "bold";
      }
    },
  });

  return doc.lastAutoTable.finalY + 8;
};

const buildPdfDoc = async (
  selType,
  selStart,
  selEnd,
  selCol,
  data,
  columns,
  reportAnalytics,
  reportChartImages,
  generatedBy,
  logoDataUrl,
) => {
  const doc = new jsPDF("landscape");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const reportTitleMap = {
    parcels: "Parcels Report",
    rider_performance: "Rider Performance Report",
    overall: "Overall Operations Report",
  };
  const reportTitle = reportTitleMap[selType] || "Operations Report";
  const generatedAt = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const dateRange =
    selStart && selEnd
      ? `${formatPdfDate(selStart)} - ${formatPdfDate(selEnd)}`
      : "All time";

  pdfAddCoverHeader(
    doc,
    pageWidth,
    reportTitle,
    dateRange,
    generatedBy,
    generatedAt,
    logoDataUrl,
  );
  let y = 46;
  const executiveSummary = buildExecutiveSummary(
    selType,
    reportAnalytics,
    dateRange,
  );
  const alerts = buildCriticalAlerts(selType, reportAnalytics);
  const recommendations = buildRecommendations(selType, reportAnalytics);

  y = pdfSectionHeading(doc, "Executive Summary", y, pageWidth);
  y += 3;
  y = pdfAddHighlights(
    doc,
    buildHighlightCards(selType, reportAnalytics),
    y,
    pageWidth,
  );
  y = pdfAddParagraphs(doc, executiveSummary, 14, y, pageWidth - 28);
  y = pdfAddAlertBoxes(doc, alerts, 14, y, pageWidth - 28);

  doc.addPage();
  pdfAddRunningHeader(doc, pageWidth, reportTitle);
  pdfAddTableOfContents(doc, buildTocItems(selType), pageWidth);

  doc.addPage();
  pdfAddRunningHeader(doc, pageWidth, reportTitle);
  y = 16;

  if (selType === "overall" && reportAnalytics?.sections?.length) {
    for (const section of reportAnalytics.sections) {
      if (y > pageHeight - 40) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }
      y = pdfSectionHeading(doc, section.title, y, pageWidth);
      y += 3;
      if (section.summaryRows?.length) {
        y = pdfKpiGrid(doc, section.summaryRows, y, pageWidth);
        y += 4;
      }
      if (section.title === "Parcels" && section.failureReasons?.length) {
        // Failure analysis removed
      }
      if (
        section.title === "Rider Performance" &&
        section.riderFirstAttemptRows?.length
      ) {
        y = pdfRiderFirstAttemptTable(
          doc,
          section.riderFirstAttemptRows,
          y,
          pageWidth,
          pageHeight,
          reportTitle,
        );
      }
      if (section.charts?.length) {
        const sectionImages = [];
        for (const spec of section.charts.slice(0, 4)) {
          const img = await buildChartImageFromSpec(spec, 900, 360);
          if (img) sectionImages.push(img);
        }
        if (sectionImages.length) {
          if (y + 78 > pageHeight - 14) {
            doc.addPage();
            pdfAddRunningHeader(doc, pageWidth, reportTitle);
            y = 16;
          }
          y = pdfChartGrid(
            doc,
            sectionImages,
            y,
            pageWidth,
            pageHeight,
            reportTitle,
          );
        }
      }
      if (section.riderPerfRows?.length) {
        y = pdfRiderPerfTable(
          doc,
          section.riderPerfRows,
          y,
          pageWidth,
          pageHeight,
          reportTitle,
        );
      }
      y += 6;
    }
  } else {
    if (reportAnalytics?.summaryRows?.length) {
      y = pdfSectionHeading(doc, "Key Metrics", y, pageWidth);
      y += 3;
      y = pdfKpiGrid(doc, reportAnalytics.summaryRows, y, pageWidth);
      y += 6;
    }
    if (
      selType === "rider_performance" &&
      reportAnalytics?.riderFirstAttemptRows?.length
    ) {
      y = pdfRiderFirstAttemptTable(
        doc,
        reportAnalytics.riderFirstAttemptRows,
        y,
        pageWidth,
        pageHeight,
        reportTitle,
      );
    }
    if (reportChartImages?.length) {
      if (y + 78 > pageHeight - 14) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }
      y = pdfSectionHeading(doc, "Analytics Charts", y, pageWidth);
      y += 3;
      y = pdfChartGrid(
        doc,
        reportChartImages,
        y,
        pageWidth,
        pageHeight,
        reportTitle,
      );
    }
    if (
      selType === "rider_performance" &&
      reportAnalytics?.riderPerfRows?.length
    ) {
      y = pdfRiderPerfTable(
        doc,
        reportAnalytics.riderPerfRows,
        y,
        pageWidth,
        pageHeight,
        reportTitle,
      );
    }
  }

  if (y + 30 > pageHeight - 14) {
    doc.addPage();
    pdfAddRunningHeader(doc, pageWidth, reportTitle);
    y = 16;
  }
  y = pdfSectionHeading(doc, "Raw Data", y, pageWidth);
  y += 3;

  const tableStyles = {
    font: "helvetica",
    fontSize: 7.8,
    textColor: [31, 41, 55],
    lineColor: PDF_BORDER,
    lineWidth: 0.18,
    cellPadding: 2.2,
    overflow: "linebreak",
  };
  const tableHeadStyles = {
    fillColor: PDF_BRAND_RED,
    textColor: PDF_WHITE,
    fontStyle: "bold",
    halign: "left",
    fontSize: 8,
  };

  if (selType === "overall") {
    data.forEach((section) => {
      // Skip Flood Affected Riders in overall report (shown in Rider Performance section)
      if (section.section === "Flood Affected Riders") return;

      if (y > pageHeight - 28) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }
      doc.setFillColor(...PDF_SLATE_100);
      doc.setDrawColor(...PDF_BORDER);
      doc.setLineWidth(0.3);
      doc.roundedRect(10, y - 1, pageWidth - 20, 8, 1, 1, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...PDF_SLATE_600);
      doc.text(section.section, 14, y + 4.5);
      y += 10;

      const head =
        section.section === "Riders"
          ? [
              [
                "Username",
                "Email",
                "First Name",
                "Last Name",
                "Gender",
                "Joined",
                "Phone",
              ],
            ]
          : section.section === "Violations"
            ? [["Name", "Violation", "Date"]]
            : section.section === "Flood Affected Riders"
              ? [["Name", "Date", "Lat", "Lng"]]
              : [
                  [
                    "Parcel ID",
                    "Recipient",
                    "Phone",
                    "Address",
                    "Rider",
                    "Status",
                    "Att.1 Status",
                    "Att.1 Date",
                    "Att.2 Status",
                    "Att.2 Date",
                    "Created",
                  ],
                ];

      const body = section.data.map((row) =>
        section.section === "Riders"
          ? [
              formatPdfCellValue(row.username, "username"),
              formatPdfCellValue(row.email, "email"),
              formatPdfCellValue(row.fname, "fname"),
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
            : section.section === "Flood Affected Riders"
              ? [
                  formatPdfCellValue(getFloodRiderName(row), "name"),
                  formatPdfCellValue(row.date || row.created_at, "date"),
                  formatPdfCellValue(row.lat, "lat"),
                  formatPdfCellValue(row.lng, "lng"),
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
        startY: y,
        margin: { left: 10, right: 10 },
        head,
        body,
        theme: "grid",
        styles: tableStyles,
        headStyles: tableHeadStyles,
        alternateRowStyles: { fillColor: [249, 250, 251] },
        didParseCell: applyPdfStatusCellColor,
      });
      y = doc.lastAutoTable.finalY + 10;
    });
  } else if (selType === "rider_performance") {
    const ridersData = Array.isArray(data)
      ? data.find?.((s) => s?.section === "Riders")?.data || []
      : [];
    const violationsData = Array.isArray(data)
      ? data.find?.((s) => s?.section === "Violations")?.data || []
      : [];

    if (ridersData.length) {
      doc.setFillColor(...PDF_SLATE_100);
      doc.setDrawColor(...PDF_BORDER);
      doc.setLineWidth(0.3);
      doc.roundedRect(10, y - 1, pageWidth - 20, 8, 1, 1, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...PDF_SLATE_600);
      doc.text("Riders", 14, y + 4.5);
      y += 10;
      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        head: [
          [
            "Username",
            "Email",
            "First Name",
            "Last Name",
            "Gender",
            "Date Joined",
            "Phone",
          ],
        ],
        body: ridersData.map((row) => [
          formatPdfCellValue(row.username, "username"),
          formatPdfCellValue(row.email, "email"),
          formatPdfCellValue(row.fname, "fname"),
          formatPdfCellValue(row.lname, "lname"),
          formatPdfCellValue(row.gender, "gender"),
          formatPdfCellValue(row.doj, "doj"),
          formatPdfCellValue(row.pnumber, "pnumber"),
        ]),
        theme: "grid",
        styles: tableStyles,
        headStyles: tableHeadStyles,
        alternateRowStyles: { fillColor: [249, 250, 251] },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    if (violationsData.length) {
      if (y + 30 > pageHeight - 14) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }
      doc.setFillColor(...PDF_SLATE_100);
      doc.setDrawColor(...PDF_BORDER);
      doc.setLineWidth(0.3);
      doc.roundedRect(10, y - 1, pageWidth - 20, 8, 1, 1, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...PDF_SLATE_600);
      doc.text("Violations", 14, y + 4.5);
      y += 10;
      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        head: [["Name", "Violation", "Date"]],
        body: violationsData.map((row) => [
          formatPdfCellValue(row.name, "name"),
          formatPdfCellValue(row.violation, "violation"),
          formatPdfCellValue(row.date, "date"),
        ]),
        theme: "grid",
        styles: tableStyles,
        headStyles: tableHeadStyles,
        alternateRowStyles: { fillColor: [249, 250, 251] },
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  } else {
    const head = columns.map(humanizeLabel);
    const body = data.map((row) =>
      columns.map((c) => formatPdfCellValue(row[c], c)),
    );
    autoTable(doc, {
      startY: y,
      margin: { left: 10, right: 10 },
      head: [head],
      body,
      theme: "grid",
      styles: tableStyles,
      headStyles: tableHeadStyles,
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: applyPdfStatusCellColor,
    });
  }

  doc.addPage();
  pdfAddRunningHeader(doc, pageWidth, reportTitle);
  y = 16;
  y = pdfSectionHeading(doc, "Recommendations", y, pageWidth);
  y += 3;
  pdfAddBulletList(doc, recommendations, 14, y, pageWidth - 28);

  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    pdfAddPageFooter(doc, p, totalPages, pageWidth, pageHeight, reportTitle);
  }

  return doc;
};

// â”€â”€â”€ Main Dashboard Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const Dashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    totalParcels: 0,
    delivered: 0,
    cancelled: 0,
    delayed: 0,
    onGoing: 0,
    monthOnGoingGrowth: Array(12).fill(0),
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
    topRiders: [],
    topCleanRiders: [],
    topViolationTypes: [],
    topFlaggedRiders: [],
    violationsByWeekday: Array(7).fill(0),
    parcelStatusMix: { delivered: 0, cancelled: 0, inProgress: 0 },
    firstAttemptSuccessRate: 0,
    avgDeliveriesPerDay: 0,
    totalViolations: 0,
    totalRiders: 0,
  });
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("All");
  const [isYearSwitching, setIsYearSwitching] = useState(false);
  const [yearFilterReady, setYearFilterReady] = useState(false);
  const [violationMapModalOpen, setViolationMapModalOpen] = useState(false);
  const [fullscreenMapSearchRider, setFullscreenMapSearchRider] = useState("");
  const [selectedViolationRider, setSelectedViolationRider] = useState(null);
  const [violationRiderSearchResults, setViolationRiderSearchResults] =
    useState([]);
  const [violationRiderAvatars, setViolationRiderAvatars] = useState({});
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
  const [flaggedRiderAvatars, setFlaggedRiderAvatars] = useState({});
  const [topRiderAvatars, setTopRiderAvatars] = useState({});
  const [cleanRiderAvatars, setCleanRiderAvatars] = useState({});
  const [kpiModalKey, setKpiModalKey] = useState(null);

  // â”€â”€ Refs â”€â”€
  const yearFilterRef = useRef(null);
  const violationMapRef = useRef(null);
  const violationLeafletMapRef = useRef(null);
  const violationFullMapRef = useRef(null);
  const violationFullLeafletMapRef = useRef(null);
  const violationLayerGroupRef = useRef(null);
  const violationFullLayerGroupRef = useRef(null);
  const hasLoadedAnalyticsRef = useRef(false);

  const todayLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // â”€â”€ Inject animation + popup styles once â”€â”€
  useEffect(() => {
    const styleId = "dash-value-anim-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes statValueIn {
        0%   { opacity: 0; transform: translateY(8px); filter: blur(2px); }
        60%  { opacity: 1; filter: blur(0); }
        100% { opacity: 1; transform: translateY(0); filter: blur(0); }
      }
      @keyframes statSubIn {
        0%   { opacity: 0; transform: translateY(5px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      .stat-value-anim {
        animation: statValueIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .stat-sub-anim {
        animation: statSubIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both;
      }
      @keyframes kpiModalIn {
        from { opacity: 0; transform: scale(0.94) translateY(20px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }

      .violation-hotspot-popup .leaflet-popup-content-wrapper {
        padding: 0 !important;
        border-radius: 14px !important;
        background: transparent !important;
        box-shadow: none !important;
        border: none !important;
      }
      .violation-hotspot-popup .leaflet-popup-content {
        margin: 0 !important;
        width: auto !important;
        line-height: normal !important;
      }
      .violation-hotspot-popup .leaflet-popup-tip-container {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }, []);

  // â”€â”€ Animated values â”€â”€
  const transitionKey = useTransitionKey(selectedYear);
  const animTotalParcels = useAnimatedNumber(dashboardData.totalParcels);
  const animDelivered = useAnimatedNumber(dashboardData.delivered);
  const animOnGoing = useAnimatedNumber(dashboardData.onGoing);
  const animDelayed = useAnimatedNumber(dashboardData.delayed);
  const animFirstAttempt = useAnimatedNumber(
    dashboardData.firstAttemptSuccessRate,
  );
  const animTopRiderCount = useAnimatedNumber(dashboardData.topRiderCount);
  const animTopMonthCount = useAnimatedNumber(dashboardData.topMonthCount);
  const animTopYearCount = useAnimatedNumber(dashboardData.topYearCount);

  const buildViolationPopup = useCallback(
    (
      location,
      _level,
      _incidents,
      _note,
      violationType,
      date,
      riderName,
      profileUrl,
    ) => {
      const violationLabel = violationType
        ? violationType.trim().replace(/\b\w/g, (c) => c.toUpperCase())
        : "Unknown Violation";

      const displayName =
        riderName && riderName.trim()
          ? riderName.trim().replace(/\b\w/g, (c) => c.toUpperCase())
          : location
            ? location.trim().replace(/\b\w/g, (c) => c.toUpperCase())
            : "Unknown Rider";

      const formattedDate = date
        ? new Date(date).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : null;

      const initials = displayName
        .split(" ")
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join("");

      const avatarHtml = profileUrl
        ? `<img
            src="${profileUrl}"
            alt="${displayName}"
            style="
              width: 38px; height: 38px; border-radius: 50%;
              object-fit: cover; border: 2px solid rgba(255,255,255,0.8);
              flex-shrink: 0; display: block;
            "
            onerror="this.style.display='none'; this.nextSibling.style.display='flex';"
          />
          <div style="
            display: none; width: 38px; height: 38px; border-radius: 50%;
            background: linear-gradient(135deg,#c8102e,#8b0000);
            align-items: center; justify-content: center;
            font-size: 14px; font-weight: 800; color: #fff;
            flex-shrink: 0; border: 2px solid rgba(255,255,255,0.25);
          ">${initials}</div>`
        : `<div style="
            display: flex; width: 38px; height: 38px; border-radius: 50%;
            background: linear-gradient(135deg,#c8102e,#8b0000);
            align-items: center; justify-content: center;
            font-size: 14px; font-weight: 800; color: #fff;
            flex-shrink: 0; border: 2px solid rgba(255,255,255,0.25);
          ">${initials}</div>`;

      return `
        <div style="
          font-family: inherit;
          min-width: 220px;
          max-width: 270px;
          border-radius: 14px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 8px 28px rgba(15,23,42,0.16), 0 2px 8px rgba(15,23,42,0.08);
        ">
          <div style="
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            padding: 11px 14px 10px;
            display: flex;
            align-items: center;
            gap: 10px;
          ">
            ${avatarHtml}
            <span style="
              font-size: 13px; font-weight: 700; color: #f1f5f9;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
              letter-spacing: -0.01em; flex: 1; min-width: 0;
            ">${displayName}</span>
          </div>

          <div style="padding: 11px 14px 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: flex-start; gap: 9px;">
              <div style="
                width: 26px; height: 26px; border-radius: 8px;
                background: rgba(239,68,68,0.08);
                border: 1px solid rgba(239,68,68,0.18);
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="#ef4444" stroke-width="2.5" stroke-linecap="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <div style="font-size: 10px; color: #94a3b8; font-weight: 600;
                  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;">
                  Violation
                </div>
                <div style="font-size: 12.5px; font-weight: 700; color: #dc2626;">
                  ${violationLabel}
                </div>
              </div>
            </div>

            ${
              formattedDate
                ? `
            <div style="height: 1px; background: #f1f5f9; margin: 0 -2px;"></div>
            <div style="display: flex; align-items: center; gap: 9px;">
              <div style="
                width: 26px; height: 26px; border-radius: 8px;
                background: rgba(99,102,241,0.08);
                border: 1px solid rgba(99,102,241,0.18);
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="#6366f1" stroke-width="2.5" stroke-linecap="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <div style="font-size: 10px; color: #94a3b8; font-weight: 600;
                  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;">
                  Date &amp; Time
                </div>
                <div style="font-size: 12px; font-weight: 600; color: #334155;">
                  ${formattedDate}
                </div>
              </div>
            </div>
            `
                : ""
            }
          </div>
        </div>
      `;
    },
    [],
  );

  const violationPointIndicators = useMemo(
    () => buildViolationPointIndicatorsFromLogs(violationLogs),
    [violationLogs],
  );

  const yearSelectOptions = useMemo(
    () => [
      { value: "All", label: "All Years" },
      ...availableYears.map((year) => ({ value: year, label: year })),
    ],
    [availableYears],
  );

  const formatOptions = useMemo(
    () => [
      { value: "pdf", label: "PDF" },
      { value: "xlsx", label: "Excel" },
    ],
    [],
  );

  const currentYear = new Date().getFullYear();

  const analyticsSummary = useMemo(() => {
    const totalParcels = Number(dashboardData.totalParcels) || 0;
    const delivered = Number(dashboardData.delivered) || 0;
    const cancelled = Number(dashboardData.cancelled) || 0;
    const delayed = Number(dashboardData.delayed) || 0;
    const safeTotal = totalParcels > 0 ? totalParcels : 1;
    return {
      totalParcels,
      deliveryRate: (delivered / safeTotal) * 100,
      cancellationRate: (cancelled / safeTotal) * 100,
      delayRate: (delayed / safeTotal) * 100,
      inProgressRate:
        ((totalParcels - delivered - cancelled) / safeTotal) * 100,
    };
  }, [dashboardData]);

  const renderViolationHotspots = useCallback(
    (map, points, layerGroupRef, options = {}) => {
      if (!map) return;
      const { autoCenter = true } = options;
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }

      const warningIcon = L.divIcon({
        className: "violation-warning-marker-wrap",
        html: `<span class="violation-warning-pulse" aria-hidden="true"></span><span class="violation-warning-marker" aria-hidden="true">&#9888;</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -34],
      });

      const layerGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 18,
        maxClusterRadius: 48,
        spiderfyDistanceMultiplier: 3,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            className: "violation-cluster-wrap",
            html: `<span class="violation-cluster-pulse" aria-hidden="true"></span><span class="violation-cluster-ring" aria-hidden="true"></span><span class="violation-cluster-core"><strong class="violation-cluster-count">${count}</strong></span>`,
            iconSize: [56, 56],
            iconAnchor: [28, 28],
            popupAnchor: [0, -30],
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
              point.date,
              point.rider_name,
              point.profile_url,
            ),
            {
              className: "violation-hotspot-popup",
              closeButton: false,
              autoPan: true,
              keepInView: true,
              maxWidth: 300,
            },
          );
      });

      layerGroup.addTo(map);
      layerGroupRef.current = layerGroup;

      if (!autoCenter) return;
      const plottedLayers = layerGroup.getLayers();
      if (plottedLayers.length > 1) {
        map.fitBounds(
          L.featureGroup(layerGroup.getLayers()).getBounds().pad(0.2),
        );
      } else if (plottedLayers.length === 1) {
        const first = plottedLayers[0];
        const c = first?.getLatLng
          ? first.getLatLng()
          : first?.getBounds?.().getCenter();
        if (c) map.setView([c.lat, c.lng], 14);
      } else {
        map.setView([14.676, 121.0437], 13);
      }
    },
    [buildViolationPopup],
  );

  const createLeafletMap = useCallback((container) => {
    const map = L.map(container, {
      minZoom: 3,
      maxZoom: 21,
      zoomSnap: 0.5,
      zoomDelta: 1,
    }).setView([14.676, 121.0437], 13);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 21,
        maxNativeZoom: 21,
        noWrap: true,
      },
    ).addTo(map);

    return map;
  }, []);

  // Effects
  useEffect(() => {
    if (reportType === "parcels") setColumnsOptions(parcelColumns);
    else if (reportType === "rider_performance")
      setColumnsOptions(riderPerfColumns);
    else setColumnsOptions([]);
    setColumn("All");
  }, [reportType]);

  useEffect(() => {
    async function loadAvailableYears() {
      try {
        const { data: oldestRows } = await supabaseClient
          .from("parcels")
          .select("created_at")
          .not("created_at", "is", null)
          .order("created_at", { ascending: true })
          .limit(1);
        const { data: newestRows } = await supabaseClient
          .from("parcels")
          .select("created_at")
          .not("created_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);
        const oldestYear = Number(extractYearKey(oldestRows?.[0]?.created_at));
        const newestYear = Number(extractYearKey(newestRows?.[0]?.created_at));
        const minYear = Number.isFinite(oldestYear) ? oldestYear : currentYear;
        const maxYear = Number.isFinite(newestYear) ? newestYear : currentYear;
        const startYear = Math.min(minYear, maxYear, currentYear);
        const endYear = Math.max(minYear, maxYear, currentYear);
        const years = [];
        for (let y = endYear; y >= startYear; y--) years.push(String(y));
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
      if (!hasLoadedAnalyticsRef.current) setLoading(true);
      try {
        const analyticsYears =
          selectedYear === "All"
            ? [...availableYears].reverse()
            : [selectedYear];
        const safeYears = analyticsYears.length
          ? analyticsYears
          : [String(currentYear)];
        const allParcels = [];
        for (const year of safeYears) {
          const yr = getYearDateRange(year);
          if (!yr) continue;
          const yearParcels = await fetchAllPages(() =>
            supabaseClient
              .from("parcels")
              .select(
                `*, assigned_rider:users!parcels_assigned_rider_id_fkey(user_id,username,fname,lname)`,
              )
              .gte("created_at", yr.start)
              .lt("created_at", yr.endExclusive),
          );
          allParcels.push(...yearParcels);
        }

        const allViolations = [];
        try {
          for (const year of safeYears) {
            const yr = getYearDateRange(year);
            if (!yr) continue;
            const yv = await fetchAllPages(() =>
              supabaseClient
                .from("violation_logs")
                .select(
                  "*, rider:users!violation_logs_user_id_fkey(fname, lname, profile_url)",
                )
                .gte("date", yr.start)
                .lt("date", yr.endExclusive)
                .order("date", { ascending: false }),
            );
            const enriched = yv.map((v) => ({
              ...v,
              profile_url: v?.rider?.profile_url || null,
              name:
                v?.name ||
                (v?.rider
                  ? `${v.rider.fname || ""} ${v.rider.lname || ""}`.trim()
                  : null),
            }));
            allViolations.push(...enriched);
          }
          allViolations.sort(
            (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0),
          );
          setViolationLogsError("");
          setViolationLogs(allViolations);
        } catch (ve) {
          try {
            const allViolationsFallback = [];
            for (const year of safeYears) {
              const yr = getYearDateRange(year);
              if (!yr) continue;
              const yv = await fetchAllPages(() =>
                supabaseClient
                  .from("violation_logs")
                  .select("*")
                  .gte("date", yr.start)
                  .lt("date", yr.endExclusive)
                  .order("date", { ascending: false }),
              );
              allViolationsFallback.push(...yv);
            }
            allViolationsFallback.sort(
              (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0),
            );
            setViolationLogsError("");
            setViolationLogs(allViolationsFallback);
            try {
              const { data: allUsers } = await supabaseClient
                .from("users")
                .select("user_id, fname, lname, username, profile_url");
              if (allUsers?.length) {
                const userMap = {};
                allUsers.forEach((u) => {
                  if (u.user_id) userMap[String(u.user_id)] = u;
                  const fullName = `${u.fname || ""} ${u.lname || ""}`
                    .trim()
                    .toLowerCase();
                  if (fullName) userMap[fullName] = u;
                  if (u.username) userMap[u.username.toLowerCase()] = u;
                });
                setViolationLogs((prev) =>
                  prev.map((v) => {
                    if (v.profile_url) return v;
                    const nameKey = String(v?.name || "")
                      .trim()
                      .toLowerCase();
                    const idKey = String(v?.user_id || "");
                    const match = userMap[idKey] || userMap[nameKey];
                    return match
                      ? { ...v, profile_url: match.profile_url || null }
                      : v;
                  }),
                );
              }
            } catch (_) {}
          } catch (ve2) {
            setViolationLogsError(ve2?.message || "Unknown error");
            setViolationLogs([]);
          }
        }

        let totalRiders = 0;
        const nameNormalizeMap = {};
        try {
          const { data: allUsers, count } = await supabaseClient
            .from("users")
            .select("fname, mname, lname, username", { count: "exact" });
          totalRiders = count || 0;
          (allUsers || []).forEach((u) => {
            const firstLast = `${u.fname || ""} ${u.lname || ""}`.trim();
            if (!firstLast) return;
            nameNormalizeMap[firstLast.toLowerCase()] = firstLast;
            if (u.mname) {
              const withMiddle =
                `${u.fname || ""} ${u.mname} ${u.lname || ""}`.trim();
              nameNormalizeMap[withMiddle.toLowerCase()] = firstLast;
            }
            if (u.username) {
              nameNormalizeMap[String(u.username).toLowerCase()] = firstLast;
            }
          });
        } catch {
          try {
            const { count } = await supabaseClient
              .from("users")
              .select("*", { count: "exact", head: true });
            totalRiders = count || 0;
          } catch {}
        }

        const normalizeRiderName = (raw) => {
          if (!raw) return "Unknown";
          const key = String(raw).trim().toLowerCase();
          return nameNormalizeMap[key] || String(raw).trim();
        };

        const delivered = allParcels.filter((p) =>
          isDeliveredStatus(p.status),
        ).length;
        const cancelled = allParcels.filter((p) =>
          isCancelledStatus(p.status),
        ).length;
        const onGoing = Math.max(allParcels.length - delivered - cancelled, 0);
        const isDelayed = (p) =>
          normalizeStatus(p?.attempt2_status) === "failed";
        const delayed = allParcels.filter(isDelayed).length;
        const inProgress = onGoing;
        const deliveredRows = allParcels.filter((p) =>
          isDeliveredStatus(p.status),
        );
        const firstAttemptOk = deliveredRows.filter(
          (p) =>
            normalizeStatus(p?.attempt1_status) === "success" ||
            normalizeStatus(p?.attempt1_status) === "successfully delivered",
        ).length;

        // Build monthly on-going counts
        const monthOnGoingCounts = Array(12).fill(0);
        allParcels.forEach((p) => {
          if (isDeliveredStatus(p.status) || isCancelledStatus(p.status))
            return;
          if (!p.created_at) return;
          const d = new Date(p.created_at);
          if (Number.isNaN(d.getTime())) return;
          monthOnGoingCounts[d.getMonth()] += 1;
        });

        const monthCounts = Array(12).fill(0);
        const monthDelayCounts = Array(12).fill(0);
        const yearsCount = {};
        const yearsDelayCount = {};
        const riderCountsById = {};
        const riderNameById = {};
        let topMonth = "";
        let topMonthCount = 0;
        let topYear = "";
        let topYearCount = 0;
        let topRiderId = "";
        let topRiderCount = 0;
        const violationTypeCount = {};
        const flaggedRiderCount = {};

        allParcels.forEach((p) => {
          if (p.created_at) {
            const d = new Date(p.created_at);
            const ys = extractYearKey(p.created_at);
            if (!Number.isNaN(d.getTime()) && ys && isDelayed(p)) {
              monthDelayCounts[d.getMonth()] =
                (monthDelayCounts[d.getMonth()] || 0) + 1;
              yearsDelayCount[ys] = (yearsDelayCount[ys] || 0) + 1;
            }
          }
          if (!isDeliveredStatus(p.status)) return;
          const riderId = p.assigned_rider_id;
          if (riderId) {
            if (!riderNameById[riderId]) {
              const fn =
                `${p?.assigned_rider?.fname || ""} ${p?.assigned_rider?.lname || ""}`.trim();
              riderNameById[riderId] =
                fn || p?.assigned_rider?.username || String(riderId);
            }
            riderCountsById[riderId] = (riderCountsById[riderId] || 0) + 1;
            if (riderCountsById[riderId] > topRiderCount) {
              topRiderId = riderId;
              topRiderCount = riderCountsById[riderId];
            }
          }
          if (!p.created_at) return;
          const date = new Date(p.created_at);
          const ys = extractYearKey(p.created_at);
          if (!ys || Number.isNaN(date.getTime())) return;
          const mi = date.getMonth();
          const ms = MONTH_LABELS[mi];
          monthCounts[mi] = (monthCounts[mi] || 0) + 1;
          if (monthCounts[mi] > topMonthCount) {
            topMonth = ms;
            topMonthCount = monthCounts[mi];
          }
          if (!yearsCount[ys]) yearsCount[ys] = 0;
          yearsCount[ys] += 1;
          if (yearsCount[ys] > topYearCount) {
            topYear = ys;
            topYearCount = yearsCount[ys];
          }
        });

        allViolations.forEach((v) => {
          const vt = String(v?.violation || "Unknown");
          violationTypeCount[vt] = (violationTypeCount[vt] || 0) + 1;
          const rn = normalizeRiderName(v?.name);
          flaggedRiderCount[rn] = (flaggedRiderCount[rn] || 0) + 1;
        });

        const topRiders = topEntries(riderCountsById, 5).map(([id, count]) => ({
          label: riderNameById[id] || id,
          value: count,
        }));
        const topViolationTypes = topEntries(violationTypeCount, 5).map(
          ([l, v]) => ({ label: l, value: v }),
        );
        const topFlaggedRiders = topEntries(flaggedRiderCount, 5).map(
          ([l, v]) => ({ label: l, value: v }),
        );
        const cleanRiderCount = {};
        Object.entries(riderCountsById).forEach(([_id, count]) => {
          const riderName = riderNameById[_id] || _id;
          const violationCount = flaggedRiderCount[riderName] || 0;
          if (violationCount === 0 && count > 0) {
            cleanRiderCount[riderName] = count;
          }
        });
        const topCleanRiders = topEntries(cleanRiderCount, 5).map(([l, v]) => ({
          label: l,
          value: v,
        }));
        const violationsByWeekday = Array(7).fill(0);
        allViolations.forEach((v) => {
          const d = new Date(v?.date);
          if (!Number.isNaN(d.getTime())) violationsByWeekday[d.getDay()] += 1;
        });

        const sortedYears = Object.keys(yearsCount).sort(
          (a, b) => Number(a) - Number(b),
        );
        const chartYears =
          selectedYear === "All" ? sortedYears : [selectedYear];
        const yearGrowthData =
          selectedYear === "All"
            ? chartYears.map((y) => yearsCount[y] || 0)
            : [yearsCount[selectedYear] || 0];
        const yearDelayGrowthData =
          selectedYear === "All"
            ? chartYears.map((y) => yearsDelayCount[y] || 0)
            : [yearsDelayCount[selectedYear] || 0];
        const activeDaySet = new Set(
          deliveredRows
            .map((p) => {
              const d = new Date(p?.created_at);
              return Number.isNaN(d.getTime())
                ? null
                : d.toISOString().slice(0, 10);
            })
            .filter(Boolean),
        );

        setDashboardData({
          totalParcels: allParcels.length || 0,
          delivered: delivered || 0,
          cancelled: cancelled || 0,
          delayed: delayed || 0,
          onGoing: onGoing || 0,
          monthOnGoingGrowth: monthOnGoingCounts,
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
          topRiders,
          topCleanRiders,
          topViolationTypes,
          topFlaggedRiders,
          violationsByWeekday,
          parcelStatusMix: { delivered, cancelled, inProgress },
          firstAttemptSuccessRate:
            delivered > 0 ? (firstAttemptOk / delivered) * 100 : 0,
          avgDeliveriesPerDay:
            activeDaySet.size > 0 ? delivered / activeDaySet.size : 0,
          totalViolations: allViolations.length,
          totalRiders,
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

  // â”€â”€ Fetch profile pictures for most flagged riders â”€â”€
  useEffect(() => {
    if (!dashboardData.topFlaggedRiders.length) return;
    async function fetchFlaggedRiderAvatars() {
      try {
        const { data: allUsers, error } = await supabaseClient
          .from("users")
          .select("user_id, username, fname, lname, profile_url");
        if (error) throw error;
        const avatarMap = {};
        (allUsers || []).forEach((u) => {
          const profileUrl = u.profile_url || null;
          if (u.username) avatarMap[u.username.toLowerCase()] = profileUrl;
          const fullName = `${u.fname || ""} ${u.lname || ""}`
            .trim()
            .toLowerCase();
          if (fullName) avatarMap[fullName] = profileUrl;
          if (u.fname) avatarMap[u.fname.toLowerCase()] = profileUrl;
        });
        setFlaggedRiderAvatars(avatarMap);
      } catch (err) {
        console.error("Failed to fetch rider avatars:", err);
      }
    }
    fetchFlaggedRiderAvatars();
  }, [dashboardData.topFlaggedRiders]);

  // â”€â”€ Fetch profile pictures for top riders â”€â”€
  useEffect(() => {
    if (!dashboardData.topRiders.length) return;
    async function fetchTopRiderAvatars() {
      try {
        const { data: allUsers, error } = await supabaseClient
          .from("users")
          .select("user_id, username, fname, lname, profile_url");
        if (error) throw error;
        const avatarMap = {};
        (allUsers || []).forEach((u) => {
          const profileUrl = u.profile_url || null;
          if (u.username) avatarMap[u.username.toLowerCase()] = profileUrl;
          const fullName = `${u.fname || ""} ${u.lname || ""}`
            .trim()
            .toLowerCase();
          if (fullName) avatarMap[fullName] = profileUrl;
          if (u.fname) avatarMap[u.fname.toLowerCase()] = profileUrl;
        });
        setTopRiderAvatars(avatarMap);
      } catch (err) {
        console.error("Failed to fetch top rider avatars:", err);
      }
    }
    fetchTopRiderAvatars();
  }, [dashboardData.topRiders]);

  // â"€â"€ Fetch profile pictures for clean riders â"€â"€
  useEffect(() => {
    if (!dashboardData.topCleanRiders.length) return;
    async function fetchCleanRiderAvatars() {
      try {
        const { data: allUsers, error } = await supabaseClient
          .from("users")
          .select("user_id, username, fname, lname, profile_url");
        if (error) throw error;
        const avatarMap = {};
        (allUsers || []).forEach((u) => {
          const profileUrl = u.profile_url || null;
          if (u.username) avatarMap[u.username.toLowerCase()] = profileUrl;
          const fullName = `${u.fname || ""} ${u.lname || ""}`
            .trim()
            .toLowerCase();
          if (fullName) avatarMap[fullName] = profileUrl;
          if (u.fname) avatarMap[u.fname.toLowerCase()] = profileUrl;
        });
        setCleanRiderAvatars(avatarMap);
      } catch (err) {
        console.error("Failed to fetch clean rider avatars:", err);
      }
    }
    fetchCleanRiderAvatars();
  }, [dashboardData.topCleanRiders]);

  const topFlaggedRidersWithAvatars = useMemo(
    () =>
      dashboardData.topFlaggedRiders.map((r) => {
        const label = r.label || "";
        const exactKey = label.toLowerCase();
        if (flaggedRiderAvatars[exactKey] !== undefined)
          return { ...r, avatarUrl: flaggedRiderAvatars[exactKey] };
        const stripped = label
          .replace(/\s+[A-Z]\.\s+/g, " ")
          .replace(/\s+[A-Z]\s+/g, " ")
          .trim()
          .toLowerCase();
        if (flaggedRiderAvatars[stripped] !== undefined)
          return { ...r, avatarUrl: flaggedRiderAvatars[stripped] };
        const firstName = label.split(" ")[0].toLowerCase();
        return { ...r, avatarUrl: flaggedRiderAvatars[firstName] || null };
      }),
    [dashboardData.topFlaggedRiders, flaggedRiderAvatars],
  );

  const topRidersWithAvatars = useMemo(
    () =>
      dashboardData.topRiders.map((r) => {
        const label = r.label || "";
        const exactKey = label.toLowerCase();
        if (topRiderAvatars[exactKey] !== undefined)
          return { ...r, avatarUrl: topRiderAvatars[exactKey] };
        const stripped = label
          .replace(/\s+[A-Z]\.\s+/g, " ")
          .replace(/\s+[A-Z]\s+/g, " ")
          .trim()
          .toLowerCase();
        if (topRiderAvatars[stripped] !== undefined)
          return { ...r, avatarUrl: topRiderAvatars[stripped] };
        const firstName = label.split(" ")[0].toLowerCase();
        return { ...r, avatarUrl: topRiderAvatars[firstName] || null };
      }),
    [dashboardData.topRiders, topRiderAvatars],
  );

  const topCleanRidersWithAvatars = useMemo(
    () =>
      dashboardData.topCleanRiders.map((r) => {
        const label = r.label || "";
        const exactKey = label.toLowerCase();
        if (cleanRiderAvatars[exactKey] !== undefined)
          return { ...r, avatarUrl: cleanRiderAvatars[exactKey] };
        const stripped = label
          .replace(/\s+[A-Z]\.\s+/g, " ")
          .replace(/\s+[A-Z]\s+/g, " ")
          .trim()
          .toLowerCase();
        if (cleanRiderAvatars[stripped] !== undefined)
          return { ...r, avatarUrl: cleanRiderAvatars[stripped] };
        const firstName = label.split(" ")[0].toLowerCase();
        return { ...r, avatarUrl: cleanRiderAvatars[firstName] || null };
      }),
    [dashboardData.topCleanRiders, cleanRiderAvatars],
  );

  const filteredViolationPointIndicators = useMemo(() => {
    let filtered = violationPointIndicators;

    // Filter by search term if provided
    if (fullscreenMapSearchRider.trim()) {
      const searchTerm = fullscreenMapSearchRider.toLowerCase().trim();
      filtered = filtered.filter((point) => {
        const riderName = (point.rider_name || "").toLowerCase();
        const location = (point.location || "").toLowerCase();
        return riderName.includes(searchTerm) || location.includes(searchTerm);
      });
    }

    // Filter by selected rider if provided
    if (selectedViolationRider) {
      filtered = filtered.filter(
        (point) =>
          (point.rider_name || "").toLowerCase() ===
          selectedViolationRider.toLowerCase(),
      );
    }

    return filtered;
  }, [
    violationPointIndicators,
    fullscreenMapSearchRider,
    selectedViolationRider,
  ]);

  // Get unique rider names for search results
  const violationRiderSearchDropdown = useMemo(() => {
    if (!fullscreenMapSearchRider.trim()) return [];
    const searchTerm = fullscreenMapSearchRider.toLowerCase().trim();
    const uniqueRiders = new Map();

    violationPointIndicators.forEach((point) => {
      const riderName = point.rider_name || "";
      if (
        riderName.toLowerCase().includes(searchTerm) &&
        !uniqueRiders.has(riderName)
      ) {
        uniqueRiders.set(riderName, {
          name: riderName,
          violationCount: 0,
          profile_url: point.profile_url || null, // ← already there, just confirm
        });
      }
    });

    const riderArray = Array.from(uniqueRiders.values());
    riderArray.forEach((rider) => {
      rider.violationCount = violationPointIndicators.filter(
        (p) => (p.rider_name || "").toLowerCase() === rider.name.toLowerCase(),
      ).length;
    });

    return riderArray.sort((a, b) => b.violationCount - a.violationCount);
  }, [violationPointIndicators, fullscreenMapSearchRider]);

  // â”€â”€ Map effects â”€â”€
  useEffect(() => {
    if (loading || !violationMapRef.current) return;
    const existing = violationLeafletMapRef.current;
    if (
      existing &&
      typeof existing.getContainer === "function" &&
      existing.getContainer() !== violationMapRef.current
    ) {
      existing.remove();
      violationLeafletMapRef.current = null;
      violationLayerGroupRef.current = null;
    }
    if (!violationLeafletMapRef.current) {
      violationLeafletMapRef.current = createLeafletMap(
        violationMapRef.current,
      );
    }
    renderViolationHotspots(
      violationLeafletMapRef.current,
      violationPointIndicators,
      violationLayerGroupRef,
      { autoCenter: true },
    );
    setTimeout(() => violationLeafletMapRef.current?.invalidateSize(), 120);
  }, [
    loading,
    violationPointIndicators,
    renderViolationHotspots,
    createLeafletMap,
  ]);

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
      violationFullLeafletMapRef.current = createLeafletMap(
        violationFullMapRef.current,
      );
    }
    renderViolationHotspots(
      violationFullLeafletMapRef.current,
      filteredViolationPointIndicators,
      violationFullLayerGroupRef,
      { autoCenter: true },
    );
    setTimeout(() => violationFullLeafletMapRef.current?.invalidateSize(), 120);
  }, [
    violationMapModalOpen,
    filteredViolationPointIndicators,
    renderViolationHotspots,
    createLeafletMap,
  ]);

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

  // â”€â”€ Report logic â”€â”€
  const fetchReportData = async (selType, selStart, selEnd, selCol) => {
    let data = [],
      columns = [];

    if (selType === "parcels") {
      const parcels = await fetchAllPages(() => {
        let q = supabaseClient
          .from("parcels")
          .select(
            `*, assigned_rider:users!parcels_assigned_rider_id_fkey(fname,lname,username)`,
          )
          .order("parcel_id", { ascending: true });
        if (selStart) q = q.gte("created_at", selStart);
        if (selEnd) q = q.lte("created_at", `${selEnd}T23:59:59`);
        return q;
      });
      data = normalizeParcelsForReport(parcels);
      columns =
        selCol === "All"
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
          : selCol === "delivery_attempt"
            ? ["parcel_id", ...DELIVERY_ATTEMPT_COLUMNS]
            : ["parcel_id", selCol];
    } else if (selType === "rider_performance") {
      const { data: riders, error: rErr } = await supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      if (rErr) throw rErr;
      const parcels = await fetchAllPages(() => {
        let q = supabaseClient
          .from("parcels")
          .select(
            `*, assigned_rider:users!parcels_assigned_rider_id_fkey(fname,lname,username)`,
          )
          .order("parcel_id", { ascending: true });
        if (selStart) q = q.gte("created_at", selStart);
        if (selEnd) q = q.lte("created_at", `${selEnd}T23:59:59`);
        return q;
      });
      let vq = supabaseClient
        .from("violation_logs")
        .select("violation,name,date")
        .order("date", { ascending: false });
      if (selStart) vq = vq.gte("date", selStart);
      if (selEnd) vq = vq.lte("date", `${selEnd}T23:59:59`);
      const { data: violations, error: vErr } = await vq;
      if (vErr) throw vErr;
      let fq = supabaseClient
        .from("rider_flood_affected")
        .select("*")
        .order("date", { ascending: false });
      if (selStart) fq = fq.gte("date", selStart);
      if (selEnd) fq = fq.lte("date", `${selEnd}T23:59:59`);
      const { data: floodAffected, error: fErr } = await fq;
      if (fErr) throw fErr;
      data = [
        { section: "Riders", data: riders || [] },
        { section: "Parcels", data: normalizeParcelsForReport(parcels) },
        { section: "Violations", data: violations || [] },
        { section: "Flood Affected Riders", data: floodAffected || [] },
      ];
      columns = null;
    } else if (selType === "overall") {
      const pq = () => {
        let q = supabaseClient
          .from("parcels")
          .select(
            `*, assigned_rider:users!parcels_assigned_rider_id_fkey(fname,lname,username)`,
          )
          .order("parcel_id", { ascending: true });
        if (selStart) q = q.gte("created_at", selStart);
        if (selEnd) q = q.lte("created_at", `${selEnd}T23:59:59`);
        return q;
      };
      let rq = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      let vq = supabaseClient
        .from("violation_logs")
        .select("violation,name,date")
        .order("date", { ascending: false });
      if (selStart) vq = vq.gte("date", selStart);
      if (selEnd) vq = vq.lte("date", `${selEnd}T23:59:59`);
      let fq = supabaseClient
        .from("rider_flood_affected")
        .select("*")
        .order("date", { ascending: false });
      if (selStart) fq = fq.gte("date", selStart);
      if (selEnd) fq = fq.lte("date", `${selEnd}T23:59:59`);
      const [parcels, ridersRes, violationsRes, floodRes] = await Promise.all([
        fetchAllPages(pq),
        rq,
        vq,
        fq,
      ]);
      if (ridersRes.error) throw ridersRes.error;
      if (violationsRes.error) throw violationsRes.error;
      if (floodRes.error) throw floodRes.error;
      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: normalizeParcelsForReport(parcels) },
        { section: "Violations", data: violationsRes.data || [] },
        { section: "Flood Affected Riders", data: floodRes.data || [] },
      ];
      columns = null;
    }

    return { data, columns };
  };

  const resolveOverallSectionColumns = (sectionName) => {
    if (sectionName === "Riders")
      return [
        "username",
        "email",
        "fname",
        "mname",
        "lname",
        "gender",
        "doj",
        "pnumber",
      ];
    if (sectionName === "Violations") return ["name", "violation", "date"];
    if (sectionName === "Flood Affected Riders")
      return ["name", "date", "lat", "lng", "user_id"];
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

  const generateExcelReport = async (selType, selStart, selEnd, selCol) => {
    const { data, columns } = await fetchReportData(
      selType,
      selStart,
      selEnd,
      selCol,
    );
    const reportAnalytics = buildReportAnalyticsBundle(selType, data);
    const reportChartImages = await buildReportChartImages(
      reportAnalytics.charts || [],
    );
    const generatedBy = await resolveReportGeneratedBy();
    await exportReportAsWorkbook({
      reportType: selType,
      selectedColumn: selCol,
      startDate: selStart,
      endDate: selEnd,
      data,
      columns,
      reportAnalytics,
      reportChartImages,
      generatedBy,
      humanizeLabel,
      resolveSectionColumns: resolveOverallSectionColumns,
      fileName: `${selType}_report.xlsx`,
    });
  };

  const validateReportInput = () => {
    const needsDate =
      reportType === "parcels" ||
      reportType === "overall" ||
      reportType === "rider_performance";
    if (!reportType || !format || (needsDate && (!startDate || !endDate))) {
      setShowReportValidation(true);
      return false;
    }
    return true;
  };

  const handleDownloadReport = async () => {
    if (!validateReportInput()) return;
    try {
      setIsGeneratingReport(true);
      if (format === "pdf") {
        const { data, columns } = await fetchReportData(
          reportType,
          startDate,
          endDate,
          column,
        );
        const reportAnalytics = buildReportAnalyticsBundle(reportType, data);
        const reportChartImages = await buildReportChartImages(
          reportAnalytics.charts || [],
        );
        const generatedBy = await resolveReportGeneratedBy();
        const logoDataUrl = await loadLogoDataUrl();
        const doc = await buildPdfDoc(
          reportType,
          startDate,
          endDate,
          column,
          data,
          columns,
          reportAnalytics,
          reportChartImages,
          generatedBy,
          logoDataUrl,
        );
        const pdfBlob = doc.output("blob");
        const blobUrl = URL.createObjectURL(pdfBlob);
        const newTab = window.open(blobUrl, "_blank");
        if (newTab) {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        } else {
          doc.save(`${reportType}_report.pdf`);
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        await generateExcelReport(reportType, startDate, endDate, column);
      }
      setReportModalOpen(false);
    } catch (error) {
      console.error("Error generating report:", error);
      alert("Failed to generate report. Check console for details.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const trendYoY = useMemo(() => {
    const yg = dashboardData.yearGrowth;
    if (yg.length < 2) return null;
    const prev = yg[yg.length - 2];
    const curr = yg[yg.length - 1];
    if (!prev) return null;
    const pct = ((curr - prev) / prev) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY`;
  }, [dashboardData.yearGrowth]);

  // â”€â”€ Derived animated display values â”€â”€
  const animDeliveryRate =
    analyticsSummary.totalParcels > 0
      ? (animDelivered / analyticsSummary.totalParcels) * 100
      : 0;
  const animOnGoingRate =
    analyticsSummary.totalParcels > 0
      ? (animOnGoing / analyticsSummary.totalParcels) * 100
      : 0;
  const animDelayRate =
    analyticsSummary.totalParcels > 0
      ? (animDelayed / analyticsSummary.totalParcels) * 100
      : 0;

  const reportSummaryType = reportType
    ? REPORT_TYPE_OPTIONS.find((o) => o.value === reportType)?.label || null
    : null;
  const reportSummaryStart = startDate
    ? new Date(startDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const reportSummaryEnd = endDate
    ? new Date(endDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      <Sidebar />

      <div className="dashboard-page">
        {loading ? (
          <PageSpinner fullScreen label="Loading dashboard..." />
        ) : (
          <>
            {/* â”€â”€ Header â”€â”€ */}
            <div className="dash-header">
              <div className="dash-header-copy">
                <h1 className="page-title">Dashboard</h1>
                <p>{todayLabel}</p>
              </div>
              <div className="dash-header-actions">
                <button
                  type="button"
                  className="dash-generate-report-btn"
                  onClick={() => setReportModalOpen(true)}
                >
                  <FaDownload /> Generate Report
                </button>
                <div className="dash-year-filter" ref={yearFilterRef}>
                  <FaCalendarAlt />
                  <FloatSelect
                    id="dashboard-year-filter"
                    variant="pill"
                    value={selectedYear}
                    options={yearSelectOptions}
                    onChange={(nextValue) => {
                      if (nextValue === selectedYear) return;
                      setIsYearSwitching(true);
                      setSelectedYear(nextValue);
                    }}
                  />
                </div>
              </div>
            </div>

            <div
              className={`analytics-dashboard-grid ${isYearSwitching ? "year-switching" : ""}`}
            >
              {/* â”€â”€ Row 1: KPI Cards â”€â”€ */}
              <div className="kpi-row">
                <StatCard
                  icon={<FaBoxOpen />}
                  label="Parcels"
                  value={Math.round(animTotalParcels).toLocaleString()}
                  sub={selectedYear === "All" ? "All time" : selectedYear}
                  accent="sky"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("totalParcels")}
                />
                <StatCard
                  icon={<FaCheckCircle />}
                  label="Delivered"
                  value={Math.round(animDelivered).toLocaleString()}
                  sub={`${animDeliveryRate.toFixed(1)}% delivered`}
                  trend={trendYoY}
                  accent="emerald"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("delivered")}
                />
                <StatCard
                  icon={<FaChartLine />}
                  label="On Going"
                  value={Math.round(animOnGoing).toLocaleString()}
                  sub={`${animOnGoingRate.toFixed(1)}% of total`}
                  accent="orange"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("onGoing")}
                />
                <StatCard
                  icon={<FaExclamationTriangle />}
                  label="Delayed"
                  value={Math.round(animDelayed).toLocaleString()}
                  sub={`${animDelayRate.toFixed(1)}% of total`}
                  accent="amber"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("delayed")}
                />
              </div>

              {/* â”€â”€ Row 2: Secondary KPIs â”€â”€ */}
              <div className="kpi-row">
                <StatCard
                  icon={<FaPercent />}
                  label="1st Attempt"
                  value={`${animFirstAttempt.toFixed(1)}%`}
                  sub="first-try success"
                  accent="teal"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("firstAttempt")}
                />
                <StatCard
                  icon={<FaMotorcycle />}
                  label="Top Rider"
                  value={dashboardData.topRider}
                  sub={`${Math.round(animTopRiderCount)} deliveries`}
                  accent="violet"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("topRider")}
                />
                <StatCard
                  icon={<FaCalendarAlt />}
                  label="Peak Month"
                  value={dashboardData.topMonth}
                  sub={`${Math.round(animTopMonthCount)} deliveries`}
                  accent="sky"
                  animKey={transitionKey}
                  onChartClick={() => setKpiModalKey("topMonth")}
                />
                {selectedYear === "All" ? (
                  <StatCard
                    icon={<FaTrophy />}
                    label="Peak Year"
                    value={dashboardData.topYear}
                    sub={`${Math.round(animTopYearCount)} deliveries`}
                    accent="emerald"
                    animKey={transitionKey}
                    onChartClick={() => setKpiModalKey("topYear")}
                  />
                ) : (
                  <StatCard
                    icon={<FaChartLine />}
                    label="Avg / Month"
                    value={(() => {
                      const active = dashboardData.monthGrowth.filter(
                        (v) => v > 0,
                      ).length;
                      return active > 0
                        ? (dashboardData.delivered / active).toFixed(1)
                        : "0";
                    })()}
                    sub="per active month"
                    accent="emerald"
                    animKey={transitionKey}
                    onChartClick={() => setKpiModalKey("avgPerMonth")}
                  />
                )}
              </div>

              {/* â”€â”€ Row 3: Delivery trend + Status mix â”€â”€ */}
              <div className="charts-row-main">
                <ChartCard
                  title="Deliveries vs. Delays"
                  subtitle={
                    selectedYear === "All"
                      ? "by year"
                      : `by month - ${selectedYear}`
                  }
                >
                  <DeliveriesLineChart
                    monthGrowth={dashboardData.monthGrowth}
                    monthDelayGrowth={dashboardData.monthDelayGrowth}
                    selectedYear={selectedYear}
                    years={dashboardData.years}
                    yearGrowth={dashboardData.yearGrowth}
                    yearDelayGrowth={dashboardData.yearDelayGrowth}
                  />
                </ChartCard>
                <ChartCard title="Status Breakdown" subtitle="">
                  <StatusDonutChart
                    parcelStatusMix={dashboardData.parcelStatusMix}
                  />
                </ChartCard>
              </div>

              {/* Row: Three Rider Analytics and Rate Overview */}
              <div className="charts-row-three-riders">
                <ChartCard title="Top Riders" subtitle="By Deliveries">
                  {topRidersWithAvatars.length > 0 ? (
                    <HorizontalBarList
                      items={topRidersWithAvatars.slice(0, 5)}
                      colorClass="emerald"
                      showAvatar={true}
                    />
                  ) : (
                    <p
                      style={{
                        textAlign: "center",
                        color: "var(--dash-muted)",
                        padding: "2rem 0",
                        fontSize: "0.8rem",
                      }}
                    >
                      No rider data
                    </p>
                  )}
                </ChartCard>
                <ChartCard title="Top Performers" subtitle="No Violations">
                  {topCleanRidersWithAvatars.length > 0 ? (
                    <HorizontalBarList
                      items={topCleanRidersWithAvatars.slice(0, 5)}
                      colorClass="sky"
                      showAvatar={true}
                    />
                  ) : (
                    <p
                      style={{
                        textAlign: "center",
                        color: "var(--dash-muted)",
                        padding: "2rem 0",
                        fontSize: "0.8rem",
                      }}
                    >
                      No performer data
                    </p>
                  )}
                </ChartCard>
                <ChartCard title="Most Flagged" subtitle="By Violations">
                  {topFlaggedRidersWithAvatars.length > 0 ? (
                    <HorizontalBarList
                      items={topFlaggedRidersWithAvatars.slice(0, 5)}
                      colorClass="rose"
                      showAvatar={true}
                    />
                  ) : (
                    <p
                      style={{
                        textAlign: "center",
                        color: "var(--dash-muted)",
                        padding: "2rem 0",
                        fontSize: "0.8rem",
                      }}
                    >
                      No violation data
                    </p>
                  )}
                </ChartCard>
              </div>

              <div className="charts-row-violations">
                <ChartCard
                  title="Rider efficiency scorecard"
                  subtitle="Delivery share · violations · composite score"
                >
                  <RiderScorecardCard
                    topRiders={topRidersWithAvatars}
                    topFlaggedRiders={topFlaggedRidersWithAvatars}
                    topCleanRiders={topCleanRidersWithAvatars}
                  />
                </ChartCard>
                <div className="chart-card">
                  <div className="violation-toggle-header">
                    <h3>Violations Trend</h3>
                  </div>
                  <ViolationsTrendChart
                    violationLogs={violationLogs}
                    violationsByWeekday={dashboardData.violationsByWeekday}
                  />
                </div>
              </div>

              {/* â”€â”€ Row 6: Map â”€â”€ */}
              <div className="charts-row-map-solo">
                <div className="chart-card">
                  <div className="analytics-map-header">
                    <div>
                      <h3>Violation Heat Map</h3>
                    </div>
                    <button
                      type="button"
                      className="violation-map-size-btn"
                      onClick={() => setViolationMapModalOpen(true)}
                    >
                      Fullscreen
                    </button>
                  </div>
                  {violationLogsError && (
                    <p
                      style={{
                        color: "#ef4444",
                        fontSize: "0.75rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      Unable to load violation logs: {violationLogsError}
                    </p>
                  )}
                  <div
                    className="violation-map-canvas"
                    ref={violationMapRef}
                    style={{ height: 300 }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* â”€â”€ KPI Chart Modal â€” now passes selectedYear so tabs update reactively â”€â”€ */}
      {kpiModalKey && (
        <KpiChartModal
          kpiKey={kpiModalKey}
          dashboardData={dashboardData}
          selectedYear={selectedYear}
          onClose={() => setKpiModalKey(null)}
        />
      )}

      {/* â”€â”€ Fullscreen Map Modal â”€â”€ */}
      {violationMapModalOpen && (
        <div
          className="dashboard-modal-overlay violation-fullscreen-overlay"
          onClick={() => setViolationMapModalOpen(false)}
        >
          <div
            className="dashboard-modal-content violation-full-map-modal violation-fullscreen-map"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="violation-full-map-header">
              <div className="violation-map-header-left">
                <h2>Violation Heat Map</h2>
                <div className="violation-search-container">
                  <div className="violation-search-wrapper">
                    <FaSearch className="violation-search-icon" />
                    <input
                      type="text"
                      placeholder="Search by rider name or location..."
                      value={fullscreenMapSearchRider}
                      onChange={(e) =>
                        setFullscreenMapSearchRider(e.target.value)
                      }
                      className="violation-map-search-input"
                    />
                  </div>
                  {/* Rider search results dropdown */}
                  {/* Rider search results dropdown */}
                  {violationRiderSearchDropdown.length > 0 &&
                    ReactDOM.createPortal(
                      <div
                        className="violation-rider-dropdown"
                        style={{
                          position: "fixed",
                          top: (() => {
                            const el = document.querySelector(
                              ".violation-search-container",
                            );
                            return el
                              ? el.getBoundingClientRect().bottom + 6 + "px"
                              : "60px";
                          })(),
                          left: (() => {
                            const el = document.querySelector(
                              ".violation-search-container",
                            );
                            return el
                              ? el.getBoundingClientRect().left + "px"
                              : "200px";
                          })(),
                          width: (() => {
                            const el = document.querySelector(
                              ".violation-search-container",
                            );
                            return el
                              ? el.getBoundingClientRect().width + "px"
                              : "300px";
                          })(),
                          zIndex: 999999,
                        }}
                      >
                        {violationRiderSearchDropdown.map((rider) => {
                          const isSelected =
                            selectedViolationRider === rider.name;
                          const initials = rider.name
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((w) => w.charAt(0).toUpperCase())
                            .join("");
                          const avatarUrl = rider.profile_url || null;

                          return (
                            <button
                              key={rider.name}
                              type="button"
                              className={`violation-rider-option${isSelected ? " is-selected" : ""}`}
                              onClick={() => {
                                setSelectedViolationRider(
                                  isSelected ? null : rider.name,
                                );
                                setFullscreenMapSearchRider("");
                              }}
                            >
                              {/* Avatar */}
                              <div className="violation-rider-avatar-wrap">
                                {avatarUrl ? (
                                  <img
                                    src={avatarUrl}
                                    alt={rider.name}
                                    className="violation-rider-avatar-img"
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                      e.currentTarget.nextSibling.style.display =
                                        "flex";
                                    }}
                                  />
                                ) : null}
                                <span
                                  className="violation-rider-avatar-initials"
                                  style={{
                                    display: avatarUrl ? "none" : "flex",
                                  }}
                                >
                                  {initials}
                                </span>
                              </div>

                              {/* Info */}
                              <div className="violation-rider-info">
                                <span
                                  className="violation-rider-name"
                                  style={{ fontWeight: isSelected ? 700 : 600 }}
                                >
                                  {rider.name}
                                </span>
                                <span className="violation-rider-count">
                                  {rider.violationCount} violation
                                  {rider.violationCount !== 1 ? "s" : ""}
                                </span>
                              </div>

                              {/* Selected badge */}
                              {isSelected && (
                                <span className="violation-rider-selected-badge">
                                  Selected
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>,
                      document.body,
                    )}
                </div>
                {selectedViolationRider && (
                  <span className="violation-map-search-info is-selected">
                    {selectedViolationRider}:{" "}
                    {filteredViolationPointIndicators.length} violations
                  </span>
                )}
                {!selectedViolationRider && fullscreenMapSearchRider && (
                  <span className="violation-map-search-info">
                    {filteredViolationPointIndicators.length} violations
                  </span>
                )}
              </div>
              <button
                type="button"
                className="violation-full-map-close"
                onClick={() => {
                  setViolationMapModalOpen(false);
                  setFullscreenMapSearchRider("");
                  setSelectedViolationRider(null);
                }}
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

      {/* â”€â”€ Report Modal â”€â”€ */}
      {reportModalOpen && (
        <div
          className="dashboard-modal-overlay"
          onClick={() => setReportModalOpen(false)}
        >
          <div
            className="dashboard-modal-content rpt-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rpt-modal-header">
              <div className="rpt-header-top">
                <div className="rpt-header-icon">
                  <FaDownload />
                </div>
                <div className="rpt-header-text">
                  <h2>Generate Reports</h2>
                  <p>Export your logistics data as PDF or Excel</p>
                </div>
              </div>
              <button
                type="button"
                className="rpt-modal-close"
                onClick={() => setReportModalOpen(false)}
                aria-label="Close report modal"
              >
                <FaTimes />
              </button>
            </div>
            <div className="rpt-modal-body">
              <div className="rpt-form-col">
                <div className="rpt-section-card">
                  <div className="rpt-section-label">Date Range *</div>
                  <div className="rpt-date-row">
                    <div className="rpt-field">
                      <label>Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="rpt-field">
                      <label>End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="rpt-section-card">
                  <div className="rpt-section-label">Report Type *</div>
                  <div className="rpt-type-grid">
                    {REPORT_TYPE_OPTIONS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        className={`rpt-type-tile ${reportType === value ? "rpt-type-tile-active" : ""}`}
                        onClick={() => setReportType(value)}
                      >
                        <span className="rpt-tile-icon">
                          <Icon />
                        </span>
                        <span className="rpt-tile-label">{label}</span>
                      </button>
                    ))}
                  </div>
                  {reportType === "parcels" && (
                    <div className="rpt-col-field">
                      <div className="rpt-col-field-label">Column Filter</div>
                      <FloatSelect
                        variant="field"
                        value={column}
                        options={columnsOptions}
                        onChange={(v) => setColumn(v)}
                        placeholder="Select column"
                      />
                    </div>
                  )}
                </div>
                <div className="rpt-section-card">
                  <div className="rpt-section-label">Export Format *</div>
                  <div className="rpt-format-pills">
                    <button
                      type="button"
                      className={`rpt-format-pill ${format === "pdf" ? "rpt-format-pill-active" : ""}`}
                      onClick={() => setFormat("pdf")}
                    >
                      <span className="rpt-pill-icon">
                        <FaFilePdf />
                      </span>
                      <span className="rpt-pill-label">PDF</span>
                      <span className="rpt-pill-desc">Print-ready</span>
                    </button>
                    <button
                      type="button"
                      className={`rpt-format-pill ${format === "xlsx" ? "rpt-format-pill-active" : ""}`}
                      onClick={() => setFormat("xlsx")}
                    >
                      <span className="rpt-pill-icon">
                        <FaFileExcel />
                      </span>
                      <span className="rpt-pill-label">Excel</span>
                      <span className="rpt-pill-desc">Spreadsheet</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="rpt-side-col">
                <div className="rpt-summary-card">
                  <div className="rpt-summary-title">Export Summary</div>
                  <div className="rpt-summary-items">
                    <div className="rpt-summary-row">
                      <span className="rpt-summary-key">Type</span>
                      <span
                        className={`rpt-summary-val ${!reportSummaryType ? "rpt-summary-placeholder" : ""}`}
                      >
                        {reportSummaryType || "Not set"}
                      </span>
                    </div>
                    <div className="rpt-summary-divider" />
                    <div className="rpt-summary-row">
                      <span className="rpt-summary-key">From</span>
                      <span
                        className={`rpt-summary-val ${!reportSummaryStart ? "rpt-summary-placeholder" : ""}`}
                      >
                        {reportSummaryStart || "-"}
                      </span>
                    </div>
                    <div className="rpt-summary-row">
                      <span className="rpt-summary-key">To</span>
                      <span
                        className={`rpt-summary-val ${!reportSummaryEnd ? "rpt-summary-placeholder" : ""}`}
                      >
                        {reportSummaryEnd || "-"}
                      </span>
                    </div>
                    <div className="rpt-summary-divider" />
                    <div className="rpt-summary-row">
                      <span className="rpt-summary-key">Format</span>
                      <span className="rpt-summary-val">
                        <span
                          className={`rpt-format-badge ${format === "pdf" ? "rpt-badge-red" : "rpt-badge-blue"}`}
                        >
                          {format.toUpperCase()}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                {reportType && (
                  <div className="rpt-type-desc-card">
                    {reportType === "parcels" && (
                      <>
                        <div className="rpt-type-desc-title">
                          Parcels Report
                        </div>
                        <p>
                          Delivery statistics, status breakdown, delay &
                          cancellation rates, and full parcel data.
                        </p>
                      </>
                    )}
                    {reportType === "rider_performance" && (
                      <>
                        <div className="rpt-type-desc-title">
                          Rider Performance
                        </div>
                        <p>
                          Rider delivery counts, 1st-attempt success, violation
                          history, and performance breakdown per rider.
                        </p>
                      </>
                    )}
                    {reportType === "overall" && (
                      <>
                        <div className="rpt-type-desc-title">
                          Overall Report
                        </div>
                        <p>
                          Comprehensive view of parcels and rider performance -
                          all metrics in one document.
                        </p>
                      </>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="rpt-download-btn"
                  onClick={handleDownloadReport}
                  disabled={isGeneratingReport}
                >
                  {isGeneratingReport ? (
                    <>
                      <span className="rpt-btn-spinner" /> Generating...
                    </>
                  ) : (
                    <>
                      <FaDownload /> Download
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Validation Modal â”€â”€ */}
      {showReportValidation && (
        <div
          className="dashboard-modal-overlay"
          onClick={() => setShowReportValidation(false)}
        >
          <div
            className="dashboard-modal-content dashboard-report-validation"
            onClick={(e) => e.stopPropagation()}
          >
            <p>All required fields must be filled in.</p>
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
