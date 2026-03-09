import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
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
  FaBoxOpen,
  FaExclamationTriangle,
  FaPercent,
  FaTrophy,
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

// ─── Utility helpers ──────────────────────────────────────────────────────────

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
  // Always return email as-is (lowercase), never title-case it
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
  { value: "gender", label: "Gender" },
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

// ─── Analytics Builders ────────────────────────────────────────────────────────

const buildParcelsAnalytics = (parcels = []) => {
  const deliveredRows = parcels.filter((p) => isDeliveredStatus(p?.status));
  const delivered = deliveredRows.length;
  const cancelled = parcels.filter((p) => isCancelledStatus(p?.status)).length;
  const delayed = parcels.filter(
    (p) =>
      normalizeStatus(p?.attempt1_status) === "failed" ||
      normalizeStatus(p?.attempt2_status) === "failed" ||
      isCancelledStatus(p?.status),
  ).length;
  const undelivered = Math.max(parcels.length - delivered - cancelled, 0);
  const firstAttemptSuccessCount = deliveredRows.filter(
    (p) =>
      normalizeStatus(p?.attempt1_status) === "success" ||
      normalizeStatus(p?.attempt1_status) === "successfully delivered",
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

  return {
    summaryRows: [
      ["Total Parcels", String(parcels.length)],
      ["Delivered", String(delivered)],
      ["Cancelled", String(cancelled)],
      ["In Progress / Other", String(undelivered)],
      ["Delayed", String(delayed)],
      [
        "Delivery Rate",
        `${getSafePercent(delivered, parcels.length).toFixed(1)}%`,
      ],
      [
        "Cancellation Rate",
        `${getSafePercent(cancelled, parcels.length).toFixed(1)}%`,
      ],
      ["Delay Rate", `${getSafePercent(delayed, parcels.length).toFixed(1)}%`],
      [
        "1st Attempt Success Rate",
        `${getSafePercent(firstAttemptSuccessCount, delivered).toFixed(1)}%`,
      ],
      ["Avg Deliveries / Active Day", avgPerActiveDay.toFixed(2)],
    ],
    charts: [
      {
        title: "Parcel Status Distribution",
        type: "doughnut",
        labels: ["Delivered", "Cancelled", "In Progress / Other"],
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
        title: "Delay vs Cancellation Rate (%)",
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
    ],
  };
};

// ─── Rider Performance Analytics ──────────────────────────────────────────────

const buildRiderPerformanceAnalytics = (
  riders = [],
  parcels = [],
  violations = [],
) => {
  // Deliveries per rider
  const deliveredParcels = parcels.filter((p) => isDeliveredStatus(p?.status));
  const riderDeliveryMap = countBy(
    deliveredParcels,
    (p) => getAssignedRiderDisplay(p) || "Unassigned",
  );
  const riderTotalMap = countBy(
    parcels,
    (p) => getAssignedRiderDisplay(p) || "Unassigned",
  );
  const riderCancelMap = countBy(
    parcels.filter((p) => isCancelledStatus(p?.status)),
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

  // Violations per rider
  const violationByRider = countBy(violations, (v) =>
    String(v?.name || "Unknown"),
  );
  const topFlaggedRiders = topEntries(violationByRider, 8);

  // Violation type breakdown
  const violationByType = countBy(violations, (v) =>
    String(v?.violation || "Unknown"),
  );
  const topViolationTypes = topEntries(violationByType, 8);

  // Monthly violations trend
  const monthlyViolations = buildMonthlyCounts(violations, "date");
  const weekdayViolations = buildWeekdayCounts(violations, "date");

  // Monthly joins
  const monthlyJoins = buildMonthlyCounts(riders, "created_at");
  const yearlyJoins = buildYearlyCounts(riders, "created_at");

  const genderMap = countBy(riders, (r) => String(r?.gender || "Unknown"));
  const activeRiders = riders.filter(
    (r) => r?.status === "active" || r?.status === "Active",
  ).length;

  // Avg deliveries per rider
  const riderNames = Object.keys(riderDeliveryMap);
  const avgDeliveriesPerRider = riderNames.length
    ? Object.values(riderDeliveryMap).reduce((a, b) => a + b, 0) /
      riderNames.length
    : 0;

  // First attempt success per rider (top 5)
  const firstAttemptByRider = {};
  deliveredParcels.forEach((p) => {
    const name = getAssignedRiderDisplay(p);
    if (!name) return;
    if (!firstAttemptByRider[name])
      firstAttemptByRider[name] = { success: 0, total: 0 };
    firstAttemptByRider[name].total += 1;
    if (
      normalizeStatus(p?.attempt1_status) === "success" ||
      normalizeStatus(p?.attempt1_status) === "successfully delivered"
    ) {
      firstAttemptByRider[name].success += 1;
    }
  });
  const topRiderFirstAttempt = Object.entries(firstAttemptByRider)
    .map(([name, { success, total }]) => [
      name,
      total > 0 ? Math.round((success / total) * 100) : 0,
    ])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const topRider = topDeliverers[0];
  const mostFlagged = topFlaggedRiders[0];

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
      [
        "Gender Breakdown",
        Object.entries(genderMap)
          .map(([g, c]) => `${g}: ${c}`)
          .join(" · ") || "N/A",
      ],
    ],
    riderPerfRows: topEntries(riderTotalMap, 20).map(([name]) => ({
      name,
      delivered: riderDeliveryMap[name] || 0,
      cancelled: riderCancelMap[name] || 0,
      delayed: riderDelayMap[name] || 0,
      violations: violationByRider[name] || 0,
      deliveryRate: riderTotalMap[name]
        ? Math.round(
            ((riderDeliveryMap[name] || 0) / riderTotalMap[name]) * 100,
          )
        : 0,
    })),
    charts: [
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
        title: "Top Violation Types",
        type: "bar",
        labels: topViolationTypes.map(([l]) => l),
        values: topViolationTypes.map(([, c]) => c),
        datasetLabel: "Incidents",
        colors: ["#f59e0b"],
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
        title: "Gender Distribution",
        type: "doughnut",
        labels: Object.keys(genderMap),
        values: Object.values(genderMap),
        colors: ["#3b82f6", "#ec4899", "#22c55e", "#f59e0b"],
      },
      {
        title: "Monthly Rider Joins",
        type: "line",
        labels: monthlyJoins.labels,
        values: monthlyJoins.values,
        colors: ["#14b8a6"],
        datasetLabel: "New Riders",
      },
    ],
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
    const parcelAnalytics = buildParcelsAnalytics(parcels);
    const riderPerfAnalytics = buildRiderPerformanceAnalytics(
      riders,
      parcels,
      violations,
    );
    return {
      sections: [
        {
          title: "Parcels",
          summaryRows: parcelAnalytics.summaryRows,
          charts: parcelAnalytics.charts,
        },
        {
          title: "Rider Performance",
          summaryRows: riderPerfAnalytics.summaryRows,
          charts: riderPerfAnalytics.charts.slice(0, 4),
          riderPerfRows: riderPerfAnalytics.riderPerfRows,
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
          "Cancelled",
          parcelAnalytics.summaryRows.find(([k]) => k === "Cancelled")?.[1] ||
            "0",
        ],
        [
          "Delayed",
          parcelAnalytics.summaryRows.find(([k]) => k === "Delayed")?.[1] ||
            "0",
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
      ],
      charts: [
        ...parcelAnalytics.charts.slice(0, 2),
        ...riderPerfAnalytics.charts.slice(0, 3),
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
    return buildRiderPerformanceAnalytics(riders, parcels, violations);
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
  return { title: spec.title || "Chart", dataUrl };
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
    const metadata = user?.user_metadata || {};
    const explicitName = String(
      metadata.full_name ||
        metadata.name ||
        [
          metadata.fname || metadata.first_name,
          metadata.lname || metadata.last_name,
        ]
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
      const profileName = String(
        `${profile?.fname || ""} ${profile?.lname || ""}`,
      ).trim();
      if (profileName) return profileName;
      if (profile?.username) return String(profile.username);
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

// ─── Animated number hook ─────────────────────────────────────────────────────

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

// ─── Transition key hook ──────────────────────────────────────────────────────

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

// ─── FloatSelect ──────────────────────────────────────────────────────────────

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
        color: "#7f1d1d",
        letterSpacing: "0.01em",
        outline: "none",
      };

  const chevronColor = isField ? (open ? "#c8102e" : "#94a3b8") : "#b91c1c";

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

// ─── Mini stat card ───────────────────────────────────────────────────────────

const StatCard = ({
  icon,
  label,
  value,
  sub,
  accent = "emerald",
  trend,
  animKey,
}) => {
  const trendUp = trend && trend.startsWith("+");
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-accent-bar" />
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
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
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Chart card wrapper ───────────────────────────────────────────────────────

const ChartCard = ({ title, subtitle, children, className = "" }) => (
  <div className={`chart-card ${className}`.trim()}>
    <div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children}
  </div>
);

// ─── Horizontal bar list ──────────────────────────────────────────────────────

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

// ─── Report Type SVG Icons ────────────────────────────────────────────────────

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

// ─── Report type options ───────────────────────────────────────────────────────

const REPORT_TYPE_OPTIONS = [
  { value: "parcels", label: "Parcels", Icon: IconParcel },
  {
    value: "rider_performance",
    label: "Rider Performance",
    Icon: IconRiderPerf,
  },
  { value: "overall", label: "Overall Reports", Icon: IconOverall },
];

// ─── PDF Generation Helpers ───────────────────────────────────────────────────

const PDF_BRAND_RED = [163, 0, 0];
const PDF_BRAND_DARK = [15, 23, 42];
const PDF_SLATE_600 = [71, 85, 105];
const PDF_SLATE_400 = [148, 163, 184];
const PDF_SLATE_100 = [241, 245, 249];
const PDF_WHITE = [255, 255, 255];
const PDF_BORDER = [226, 232, 240];

const pdfAddCoverHeader = (
  doc,
  pageWidth,
  reportTitle,
  dateRange,
  generatedBy,
  generatedAt,
  logoDataUrl,
) => {
  // Top red band
  doc.setFillColor(...PDF_BRAND_RED);
  doc.rect(0, 0, pageWidth, 38, "F");

  // Decorative accent stripe
  doc.setFillColor(200, 16, 46);
  doc.rect(0, 34, pageWidth, 4, "F");

  // Logo
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", 10, 7, 24, 24);
    } catch (_) {
      /* skip if logo fails */
    }
  }

  const textX = logoDataUrl ? 40 : 14;

  // Report title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF_WHITE);
  doc.text(reportTitle, textX, 20);

  // Sub-info line
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 200, 200);
  doc.text(
    `${dateRange}   ·   Generated by: ${generatedBy || "Unknown"}   ·   ${generatedAt}`,
    textX,
    28,
  );

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
  doc.rect(0, 0, pageWidth, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_WHITE);
  doc.text(reportTitle.toUpperCase(), pageWidth / 2, 6, { align: "center" });
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
  // Bottom bar
  doc.setFillColor(...PDF_SLATE_100);
  doc.rect(0, pageHeight - 10, pageWidth, 10, "F");
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.3);
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
  // Left accent bar + dark bg
  doc.setFillColor(...PDF_BRAND_DARK);
  doc.roundedRect(10, y - 5, pageWidth - 20, 9, 1, 1, "F");

  // Red left accent
  doc.setFillColor(...PDF_BRAND_RED);
  doc.roundedRect(10, y - 5, 3, 9, 1, 1, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_WHITE);
  doc.text(text.toUpperCase(), 17, y);
  doc.setTextColor(...PDF_BRAND_DARK);
  return y + 6;
};

const pdfKpiGrid = (doc, rows, startY, pageWidth) => {
  const cols = 3;
  const boxW = (pageWidth - 20 - (cols - 1) * 5) / cols;
  const boxH = 16;
  const gap = 5;
  let x = 10,
    y = startY;

  rows.forEach(([label, value], i) => {
    if (i > 0 && i % cols === 0) {
      x = 10;
      y += boxH + gap;
    }

    // Card background
    doc.setFillColor(252, 252, 253);
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, "FD");

    // Label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_SLATE_400);
    doc.text(String(label), x + 4, y + 6);

    // Value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...PDF_BRAND_DARK);
    doc.text(String(value), x + 4, y + 13);

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

    // Chart label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_SLATE_600);
    doc.text(ci.title || "Chart", x, y + labelH - 1);

    // Chart border + bg
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
  });

  const lastRow = Math.floor((chartImages.length - 1) / cols);
  return y + (lastRow >= 0 ? rowH : 0) + 6;
};

// ─── PDF: Rider Performance Table ─────────────────────────────────────────────

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
      "Cancelled",
      "Delayed",
      "Violations",
      "Delivery Rate",
    ],
  ];
  const body = riderPerfRows.map((r) => [
    r.name,
    String(r.delivered),
    String(r.cancelled),
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
      fillColor: PDF_BRAND_DARK,
      textColor: PDF_WHITE,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
    },
    didParseCell: (tableData) => {
      if (tableData.section !== "body") return;
      const col = tableData.column.index;
      if (col === 5) {
        const val = parseInt(tableData.cell.raw, 10);
        if (val >= 80) tableData.cell.styles.textColor = [22, 163, 74];
        else if (val >= 50) tableData.cell.styles.textColor = [202, 138, 4];
        else tableData.cell.styles.textColor = [220, 38, 38];
        tableData.cell.styles.fontStyle = "bold";
      }
      if (col === 4 && parseInt(tableData.cell.raw, 10) > 0) {
        tableData.cell.styles.textColor = [220, 38, 38];
        tableData.cell.styles.fontStyle = "bold";
      }
    },
  });

  return doc.lastAutoTable.finalY + 8;
};

// ─── Main PDF Builder ──────────────────────────────────────────────────────────

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
      ? `${formatPdfDate(selStart)} – ${formatPdfDate(selEnd)}`
      : "All time";

  // ── Cover header ──
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

  // ── OVERALL: multi-section layout ──
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

      // Rider perf table for the "Rider Performance" section in overall
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
    // ── SINGLE REPORT TYPE ──

    // KPIs
    if (reportAnalytics?.summaryRows?.length) {
      y = pdfSectionHeading(doc, "Key Metrics", y, pageWidth);
      y += 3;
      y = pdfKpiGrid(doc, reportAnalytics.summaryRows, y, pageWidth);
      y += 6;
    }

    // Charts
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

    // Rider Performance breakdown table (rider_performance report only)
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

  // ── DATA TABLE ──
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
    fillColor: PDF_BRAND_DARK,
    textColor: PDF_WHITE,
    fontStyle: "bold",
    halign: "left",
    fontSize: 8,
  };

  if (selType === "overall") {
    data.forEach((section) => {
      if (y > pageHeight - 28) {
        doc.addPage();
        pdfAddRunningHeader(doc, pageWidth, reportTitle);
        y = 16;
      }

      // Section sub-label
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
    // For rider_performance raw data: show riders list + violations list
    const ridersData = Array.isArray(data)
      ? data.find?.((s) => s?.section === "Riders")?.data || []
      : [];
    const violationsData = Array.isArray(data)
      ? data.find?.((s) => s?.section === "Violations")?.data || []
      : [];

    // Riders table
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

    // Violations table
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

  // ── Page footers ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    pdfAddPageFooter(doc, p, totalPages, pageWidth, pageHeight, reportTitle);
  }

  return doc;
};

// ─── Main Dashboard Component ─────────────────────────────────────────────────

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
    topRiders: [],
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
  const [violationChartTab, setViolationChartTab] = useState("month");

  // ── Refs ──
  const yearFilterRef = useRef(null);
  const violationMapRef = useRef(null);
  const violationLeafletMapRef = useRef(null);
  const violationFullMapRef = useRef(null);
  const violationFullLeafletMapRef = useRef(null);
  const violationLayerGroupRef = useRef(null);
  const violationFullLayerGroupRef = useRef(null);
  const hasLoadedAnalyticsRef = useRef(false);

  // Chart refs
  const deliveryTrendChartRef = useRef(null);
  const deliveryTrendInstanceRef = useRef(null);
  const statusMixChartRef = useRef(null);
  const statusMixInstanceRef = useRef(null);
  const violationTrendChartRef = useRef(null);
  const violationTrendInstanceRef = useRef(null);
  const weekdayViolationChartRef = useRef(null);
  const weekdayViolationInstanceRef = useRef(null);
  const delayRiskChartRef = useRef(null);
  const delayRiskInstanceRef = useRef(null);

  const todayLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // ── Inject animation styles once ──
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
    `;
    document.head.appendChild(style);
  }, []);

  // ── Animated values ──
  const transitionKey = useTransitionKey(selectedYear);
  const animTotalParcels = useAnimatedNumber(dashboardData.totalParcels);
  const animDelivered = useAnimatedNumber(dashboardData.delivered);
  const animCancelled = useAnimatedNumber(dashboardData.cancelled);
  const animDelayed = useAnimatedNumber(dashboardData.delayed);
  const animFirstAttempt = useAnimatedNumber(
    dashboardData.firstAttemptSuccessRate,
  );
  const animTopRiderCount = useAnimatedNumber(dashboardData.topRiderCount);
  const animTopMonthCount = useAnimatedNumber(dashboardData.topMonthCount);
  const animTopYearCount = useAnimatedNumber(dashboardData.topYearCount);

  const buildViolationPopup = useCallback(
    (location, level, incidents, _note, violationType) => `
    <div class="violation-hotspot-popup-card">
      <div class="violation-hotspot-popup-top">
        <span class="violation-hotspot-dot ${level}"></span>
        <strong>${location}</strong>
      </div>
      <small style="color: #dc2626; font-weight: 700;">Violation: ${violationType || "Unknown violation"}</small>
    </div>
  `,
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
        maxClusterRadius: 52,
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
                .select("*")
                .gte("date", yr.start)
                .lt("date", yr.endExclusive)
                .order("date", { ascending: false }),
            );
            allViolations.push(...yv);
          }
          allViolations.sort(
            (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0),
          );
          setViolationLogsError("");
          setViolationLogs(allViolations);
        } catch (ve) {
          setViolationLogsError(ve?.message || "Unknown error");
          setViolationLogs([]);
        }

        let totalRiders = 0;
        // Build a map from any name variant → "fname lname" (no middle name)
        // so violation_logs.name (which may include mname) matches riderNameById format
        const nameNormalizeMap = {};
        try {
          const { data: allUsers, count } = await supabaseClient
            .from("users")
            .select("fname, mname, lname, username", { count: "exact" });
          totalRiders = count || 0;
          (allUsers || []).forEach((u) => {
            const firstLast = `${u.fname || ""} ${u.lname || ""}`.trim();
            if (!firstLast) return;
            // Map "fname lname" → itself
            nameNormalizeMap[firstLast.toLowerCase()] = firstLast;
            // Map "fname mname lname" → "fname lname"
            if (u.mname) {
              const withMiddle =
                `${u.fname || ""} ${u.mname} ${u.lname || ""}`.trim();
              nameNormalizeMap[withMiddle.toLowerCase()] = firstLast;
            }
            // Map username → "fname lname"
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

        // Helper: normalize a raw name from violation_logs to fname+lname format
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
        const isDelayed = (p) =>
          normalizeStatus(p?.attempt1_status) === "failed" ||
          normalizeStatus(p?.attempt2_status) === "failed" ||
          isCancelledStatus(p?.status);
        const delayed = allParcels.filter(isDelayed).length;
        const inProgress = Math.max(
          allParcels.length - delivered - cancelled,
          0,
        );
        const deliveredRows = allParcels.filter((p) =>
          isDeliveredStatus(p.status),
        );
        const firstAttemptOk = deliveredRows.filter(
          (p) =>
            normalizeStatus(p?.attempt1_status) === "success" ||
            normalizeStatus(p?.attempt1_status) === "successfully delivered",
        ).length;

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
          // Normalize the name to fname+lname to match riderNameById format
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

  // ── Fetch profile pictures for most flagged riders ──
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

  // ── Fetch profile pictures for top riders ──
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

  // ── Charts ──
  useEffect(() => {
    if (!deliveryTrendChartRef.current) return;
    const labels = selectedYear === "All" ? dashboardData.years : MONTH_SHORT;
    const data =
      selectedYear === "All"
        ? dashboardData.yearGrowth
        : dashboardData.monthGrowth;
    const delayData =
      selectedYear === "All"
        ? dashboardData.yearDelayGrowth
        : dashboardData.monthDelayGrowth;
    if (!labels.length) return;
    if (deliveryTrendInstanceRef.current) {
      const c = deliveryTrendInstanceRef.current;
      c.data.labels = labels;
      c.data.datasets[0].data = data;
      c.data.datasets[1].data = delayData;
      c.update("active");
      return;
    }
    deliveryTrendInstanceRef.current = new Chart(
      deliveryTrendChartRef.current,
      {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Deliveries",
              data,
              borderColor: "#16a34a",
              backgroundColor: "rgba(22,163,74,0.10)",
              borderWidth: 2.5,
              tension: 0.38,
              fill: true,
              pointRadius: 3,
              pointHoverRadius: 5,
            },
            {
              label: "Delays",
              data: delayData,
              borderColor: "#f59e0b",
              backgroundColor: "rgba(245,158,11,0.08)",
              borderWidth: 2,
              tension: 0.38,
              fill: true,
              pointRadius: 2,
              borderDash: [5, 3],
            },
          ],
        },
        options: {
          animation: { duration: 900, easing: "easeInOutQuart" },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: { boxWidth: 10, font: { size: 11 }, usePointStyle: true },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148,163,184,0.15)" },
              ticks: { precision: 0 },
            },
          },
        },
      },
    );
    return () => {
      if (deliveryTrendInstanceRef.current) {
        deliveryTrendInstanceRef.current.destroy();
        deliveryTrendInstanceRef.current = null;
      }
    };
  }, [
    dashboardData.years,
    dashboardData.yearGrowth,
    dashboardData.yearDelayGrowth,
    dashboardData.monthGrowth,
    dashboardData.monthDelayGrowth,
    selectedYear,
  ]);

  useEffect(() => {
    if (!statusMixChartRef.current) return;
    const { delivered, cancelled, inProgress } = dashboardData.parcelStatusMix;
    if (statusMixInstanceRef.current) {
      const c = statusMixInstanceRef.current;
      c.data.datasets[0].data = [delivered, cancelled, inProgress];
      c.update("active");
      return;
    }
    statusMixInstanceRef.current = new Chart(statusMixChartRef.current, {
      type: "doughnut",
      data: {
        labels: ["Delivered", "Cancelled", "In Progress"],
        datasets: [
          {
            data: [delivered, cancelled, inProgress],
            backgroundColor: ["#16a34a", "#ef4444", "#94a3b8"],
            borderWidth: 0,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 800,
          easing: "easeInOutQuart",
        },
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: {
              boxWidth: 10,
              font: { size: 11 },
              usePointStyle: true,
              padding: 12,
            },
          },
        },
      },
    });
    return () => {
      if (statusMixInstanceRef.current) {
        statusMixInstanceRef.current.destroy();
        statusMixInstanceRef.current = null;
      }
    };
  }, [dashboardData.parcelStatusMix]);

  useEffect(() => {
    if (!violationTrendChartRef.current) return;
    const byMonth = Array(12).fill(0);
    violationLogs.forEach((v) => {
      const d = new Date(v?.date);
      if (!Number.isNaN(d.getTime())) byMonth[d.getMonth()] += 1;
    });
    if (violationTrendInstanceRef.current) {
      const c = violationTrendInstanceRef.current;
      c.data.datasets[0].data = byMonth;
      c.update("active");
      return;
    }
    violationTrendInstanceRef.current = new Chart(
      violationTrendChartRef.current,
      {
        type: "bar",
        data: {
          labels: MONTH_SHORT,
          datasets: [
            {
              label: "Violations",
              data: byMonth,
              backgroundColor: "rgba(239,68,68,0.75)",
              borderRadius: 5,
              borderSkipped: false,
            },
          ],
        },
        options: {
          animation: { duration: 750, easing: "easeOutQuart" },
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148,163,184,0.15)" },
              ticks: { precision: 0 },
            },
          },
        },
      },
    );
    setTimeout(() => {
      violationTrendInstanceRef.current?.resize();
    }, 50);
    return () => {
      if (violationTrendInstanceRef.current) {
        violationTrendInstanceRef.current.destroy();
        violationTrendInstanceRef.current = null;
      }
    };
  }, [violationLogs]);

  useEffect(() => {
    if (!weekdayViolationChartRef.current) return;
    const newColors = dashboardData.violationsByWeekday.map((v) => {
      const max = Math.max(...dashboardData.violationsByWeekday, 1);
      return v === max ? "#ef4444" : "rgba(239,68,68,0.35)";
    });
    if (weekdayViolationInstanceRef.current) {
      const c = weekdayViolationInstanceRef.current;
      c.data.datasets[0].data = dashboardData.violationsByWeekday;
      c.data.datasets[0].backgroundColor = newColors;
      c.update("active");
      return;
    }
    weekdayViolationInstanceRef.current = new Chart(
      weekdayViolationChartRef.current,
      {
        type: "bar",
        data: {
          labels: WEEKDAY_LABELS,
          datasets: [
            {
              label: "Violations",
              data: dashboardData.violationsByWeekday,
              backgroundColor: newColors,
              borderRadius: 5,
            },
          ],
        },
        options: {
          animation: { duration: 750, easing: "easeOutQuart" },
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148,163,184,0.15)" },
              ticks: { precision: 0 },
            },
          },
        },
      },
    );
    setTimeout(() => {
      weekdayViolationInstanceRef.current?.resize();
    }, 50);
    return () => {
      if (weekdayViolationInstanceRef.current) {
        weekdayViolationInstanceRef.current.destroy();
        weekdayViolationInstanceRef.current = null;
      }
    };
  }, [dashboardData.violationsByWeekday]);

  useEffect(() => {
    if (!delayRiskChartRef.current) return;
    if (delayRiskInstanceRef.current) {
      const c = delayRiskInstanceRef.current;
      c.data.datasets[0].data = [
        analyticsSummary.deliveryRate,
        analyticsSummary.delayRate,
        analyticsSummary.cancellationRate,
      ];
      c.update("active");
      return;
    }
    delayRiskInstanceRef.current = new Chart(delayRiskChartRef.current, {
      type: "bar",
      data: {
        labels: ["Delivery Rate", "Delay Rate", "Cancel Rate"],
        datasets: [
          {
            data: [
              analyticsSummary.deliveryRate,
              analyticsSummary.delayRate,
              analyticsSummary.cancellationRate,
            ],
            backgroundColor: [
              "rgba(22,163,74,0.8)",
              "rgba(245,158,11,0.8)",
              "rgba(239,68,68,0.8)",
            ],
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        animation: { duration: 750, easing: "easeOutBounce" },
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: "rgba(148,163,184,0.15)" },
            ticks: { callback: (v) => `${v}%` },
          },
        },
      },
    });
    return () => {
      if (delayRiskInstanceRef.current) {
        delayRiskInstanceRef.current.destroy();
        delayRiskInstanceRef.current = null;
      }
    };
  }, [
    analyticsSummary.deliveryRate,
    analyticsSummary.delayRate,
    analyticsSummary.cancellationRate,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (violationChartTab === "month")
        violationTrendInstanceRef.current?.resize();
      else weekdayViolationInstanceRef.current?.resize();
    }, 30);
    return () => clearTimeout(timer);
  }, [violationChartTab]);

  useEffect(() => {
    if (!violationLogs.length) return;
    const timer = setTimeout(() => {
      violationTrendInstanceRef.current?.resize();
      weekdayViolationInstanceRef.current?.resize();
    }, 150);
    return () => clearTimeout(timer);
  }, [violationLogs]);

  // ── Map ──
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
      const map = L.map(violationMapRef.current, { minZoom: 11 }).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
      violationLeafletMapRef.current = map;
    }
    renderViolationHotspots(
      violationLeafletMapRef.current,
      violationPointIndicators,
      violationLayerGroupRef,
      { autoCenter: true },
    );
    setTimeout(() => violationLeafletMapRef.current?.invalidateSize(), 120);
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
      const map = L.map(violationFullMapRef.current, { minZoom: 11 }).setView(
        [14.676, 121.0437],
        13,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
      violationFullLeafletMapRef.current = map;
    }
    renderViolationHotspots(
      violationFullLeafletMapRef.current,
      violationPointIndicators,
      violationFullLayerGroupRef,
      { autoCenter: true },
    );
    setTimeout(() => violationFullLeafletMapRef.current?.invalidateSize(), 120);
  }, [
    violationMapModalOpen,
    violationPointIndicators,
    renderViolationHotspots,
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

  // ── Report logic ──
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
      // Note: no date filter on users — filter by parcel/violation dates instead
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

      data = [
        { section: "Riders", data: riders || [] },
        { section: "Parcels", data: normalizeParcelsForReport(parcels) },
        { section: "Violations", data: violations || [] },
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
      const [parcels, ridersRes, violationsRes] = await Promise.all([
        fetchAllPages(pq),
        rq,
        vq,
      ]);
      if (ridersRes.error) throw ridersRes.error;
      if (violationsRes.error) throw violationsRes.error;
      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: normalizeParcelsForReport(parcels) },
        { section: "Violations", data: violationsRes.data || [] },
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

  const reportNeedsDate = true; // All report types now require date

  const trendYoY = useMemo(() => {
    const yg = dashboardData.yearGrowth;
    if (yg.length < 2) return null;
    const prev = yg[yg.length - 2];
    const curr = yg[yg.length - 1];
    if (!prev) return null;
    const pct = ((curr - prev) / prev) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY`;
  }, [dashboardData.yearGrowth]);

  // ── Derived animated display values ──
  const animDeliveryRate =
    analyticsSummary.totalParcels > 0
      ? (animDelivered / analyticsSummary.totalParcels) * 100
      : 0;
  const animCancellationRate =
    analyticsSummary.totalParcels > 0
      ? (animCancelled / analyticsSummary.totalParcels) * 100
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
            {/* ── Header ── */}
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
              {/* ── Row 1: KPI Cards ── */}
              <div className="kpi-row">
                <StatCard
                  icon={<FaBoxOpen />}
                  label="Parcels"
                  value={Math.round(animTotalParcels).toLocaleString()}
                  sub={selectedYear === "All" ? "all time" : selectedYear}
                  accent="sky"
                  animKey={transitionKey}
                />
                <StatCard
                  icon={<FaCheckCircle />}
                  label="Delivered"
                  value={Math.round(animDelivered).toLocaleString()}
                  sub={`${animDeliveryRate.toFixed(1)}% delivered`}
                  trend={trendYoY}
                  accent="emerald"
                  animKey={transitionKey}
                />
                <StatCard
                  icon={<FaTimesCircle />}
                  label="Cancelled"
                  value={Math.round(animCancelled).toLocaleString()}
                  sub={`${animCancellationRate.toFixed(1)}% of total`}
                  accent="rose"
                  animKey={transitionKey}
                />
                <StatCard
                  icon={<FaExclamationTriangle />}
                  label="Delayed"
                  value={Math.round(animDelayed).toLocaleString()}
                  sub={`${animDelayRate.toFixed(1)}% of total`}
                  accent="amber"
                  animKey={transitionKey}
                />
              </div>

              {/* ── Row 2: Secondary KPIs ── */}
              <div className="kpi-row">
                <StatCard
                  icon={<FaPercent />}
                  label="1st Attempt"
                  value={`${animFirstAttempt.toFixed(1)}%`}
                  sub="first-try success"
                  accent="teal"
                  animKey={transitionKey}
                />
                <StatCard
                  icon={<FaMotorcycle />}
                  label="Top Rider"
                  value={dashboardData.topRider}
                  sub={`${Math.round(animTopRiderCount)} deliveries`}
                  accent="violet"
                  animKey={transitionKey}
                />
                <StatCard
                  icon={<FaCalendarAlt />}
                  label="Peak Month"
                  value={dashboardData.topMonth}
                  sub={`${Math.round(animTopMonthCount)} deliveries`}
                  accent="sky"
                  animKey={transitionKey}
                />
                {selectedYear === "All" ? (
                  <StatCard
                    icon={<FaTrophy />}
                    label="Peak Year"
                    value={dashboardData.topYear}
                    sub={`${Math.round(animTopYearCount)} deliveries`}
                    accent="emerald"
                    animKey={transitionKey}
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
                  />
                )}
              </div>

              {/* ── Row 3: Delivery trend + Status mix ── */}
              <div className="charts-row-main">
                <ChartCard
                  title="Deliveries vs. Delays"
                  subtitle={
                    selectedYear === "All"
                      ? "by year"
                      : `by month · ${selectedYear}`
                  }
                >
                  <div style={{ height: 220 }}>
                    <canvas ref={deliveryTrendChartRef} />
                  </div>
                </ChartCard>
                <ChartCard title="Status Breakdown" subtitle="">
                  <div style={{ height: 220 }}>
                    <canvas ref={statusMixChartRef} />
                  </div>
                </ChartCard>
              </div>

              {/* ── Row 4: Top Riders + Most Flagged ── */}
              <div className="charts-row-riders">
                <ChartCard title="Top Riders" subtitle="">
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
                <ChartCard title="Most Flagged" subtitle="">
                  {topFlaggedRidersWithAvatars.length > 0 ? (
                    <HorizontalBarList
                      items={topFlaggedRidersWithAvatars.slice(0, 5)}
                      colorClass="violet"
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

              {/* ── Row 5: Rate Overview + Violations Trend ── */}
              <div className="charts-row-violations">
                <ChartCard title="Rate Overview" subtitle="">
                  <div style={{ height: 220 }}>
                    <canvas ref={delayRiskChartRef} />
                  </div>
                </ChartCard>
                <div className="chart-card violation-toggled-card">
                  <div className="violation-toggle-header">
                    <h3>Violations Trend</h3>
                    <div className="violation-tab-toggle">
                      <button
                        type="button"
                        className={`vtab-btn${violationChartTab === "month" ? " vtab-active" : ""}`}
                        onClick={() => setViolationChartTab("month")}
                      >
                        By Month
                      </button>
                      <button
                        type="button"
                        className={`vtab-btn${violationChartTab === "weekday" ? " vtab-active" : ""}`}
                        onClick={() => setViolationChartTab("weekday")}
                      >
                        By Weekday
                      </button>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 220 }}>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        opacity: violationChartTab === "month" ? 1 : 0,
                        pointerEvents:
                          violationChartTab === "month" ? "auto" : "none",
                        transition: "opacity 0.2s ease",
                      }}
                    >
                      <canvas ref={violationTrendChartRef} />
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        opacity: violationChartTab === "weekday" ? 1 : 0,
                        pointerEvents:
                          violationChartTab === "weekday" ? "auto" : "none",
                        transition: "opacity 0.2s ease",
                      }}
                    >
                      <canvas ref={weekdayViolationChartRef} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Row 6: Map (full width) ── */}
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

      {/* ── Fullscreen Map Modal ── */}
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

      {/* ── Report Modal ── */}
      {reportModalOpen && (
        <div
          className="dashboard-modal-overlay"
          onClick={() => setReportModalOpen(false)}
        >
          <div
            className="dashboard-modal-content rpt-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
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
            </div>

            {/* Body */}
            <div className="rpt-modal-body">
              {/* Left: form */}
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
                      <span className="rpt-pill-icon">📄</span>
                      <span className="rpt-pill-label">PDF</span>
                      <span className="rpt-pill-desc">Print-ready</span>
                    </button>
                    <button
                      type="button"
                      className={`rpt-format-pill ${format === "xlsx" ? "rpt-format-pill-active" : ""}`}
                      onClick={() => setFormat("xlsx")}
                    >
                      <span className="rpt-pill-icon">📊</span>
                      <span className="rpt-pill-label">Excel</span>
                      <span className="rpt-pill-desc">Spreadsheet</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: summary + actions */}
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
                        {reportSummaryStart || "—"}
                      </span>
                    </div>
                    <div className="rpt-summary-row">
                      <span className="rpt-summary-key">To</span>
                      <span
                        className={`rpt-summary-val ${!reportSummaryEnd ? "rpt-summary-placeholder" : ""}`}
                      >
                        {reportSummaryEnd || "—"}
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

                {/* Report type description */}
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
                          Comprehensive view of parcels and rider performance —
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
                      <span className="rpt-btn-spinner" /> Generating…
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

      {/* ── Validation Modal ── */}
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
