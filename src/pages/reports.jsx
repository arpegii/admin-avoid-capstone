// Reports.jsx
import React, { useState, useEffect } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App"; // ✅ Import from App.jsx
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import "../styles/global.css";
import "../styles/reports.css";
import { exportReportAsWorkbook } from "../utils/reportExcel";
import {
  buildFloodAnalytics,
  filterFloodIncidentsByDate,
} from "../utils/floodAnalytics";
import { cachedReverseGeocode } from "../utils/geocoding";

// ================= HELPER =================
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

const properCapitalize = (value) => {
  if (!value) return "-";
  const str = String(value).trim();
  if (!str) return "-";
  if (/^[a-z0-9@.]+$/.test(str)) return str; // Keep emails, IDs lowercase
  // Handle status values with proper case
  const normalized = str.toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "successfully delivered") return "Successfully Delivered";
  if (normalized === "on going") return "On Going";
  if (normalized === "in progress") return "In Progress";
  // General title case
  return str
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
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
    return raw;
  if (/phone|_id$|^id$/i.test(columnKey)) return raw;
  // Use proper capitalization for other values
  return properCapitalize(raw);
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

const REPORT_BRAND_RED = [153, 0, 0];
const REPORT_BRAND_DARK = [17, 24, 39];
const REPORT_SLATE_600 = [71, 85, 105];
const REPORT_SLATE_400 = [148, 163, 184];
const REPORT_SLATE_100 = [241, 245, 249];
const REPORT_WHITE = [255, 255, 255];
const REPORT_BORDER = [226, 232, 240];
const REPORT_GREEN_SUCCESS = [22, 163, 74];
const REPORT_RED_DANGER = [220, 38, 38];
const REPORT_YELLOW_WARN = [202, 138, 4];

const pdfDrawEnhancedHeader = (
  doc,
  pageWidth,
  pageHeight,
  title,
  dateRange,
  generatedBy,
) => {
  // Main header bar with red background
  doc.setFillColor(...REPORT_BRAND_RED);
  doc.rect(0, 0, pageWidth, 20, "F");

  // Header text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...REPORT_WHITE);
  doc.text(title, 14, 13);

  // Right side info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...REPORT_WHITE);

  const headerRightX = pageWidth - 14;
  doc.text(dateRange, headerRightX, 7, { align: "right" });
  doc.text(`Generated by: ${generatedBy || "Admin"}`, headerRightX, 11, {
    align: "right",
  });
  doc.text(
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    headerRightX,
    15,
    { align: "right" },
  );

  // CONFIDENTIAL badge
  doc.setFillColor(...REPORT_BRAND_RED);
  doc.rect(pageWidth - 40, 2, 26, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("CONFIDENTIAL", pageWidth - 27, 6, { align: "center" });

  doc.setTextColor(...REPORT_BRAND_DARK);
};

const pdfDrawReportsHeader = (doc, pageWidth, title) => {
  doc.setFillColor(...REPORT_BRAND_RED);
  doc.rect(0, 0, pageWidth, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...REPORT_WHITE);
  doc.text(title.toUpperCase(), pageWidth / 2, 5.3, { align: "center" });
  doc.setTextColor(...REPORT_BRAND_DARK);
};

const pdfDrawReportsFooter = (doc, pageWidth, pageHeight) => {
  const pageNum = doc.internal.getCurrentPageInfo().pageNumber;
  const total = doc.internal.getNumberOfPages();
  doc.setDrawColor(...REPORT_BORDER);
  doc.setLineWidth(0.3);
  doc.line(10, pageHeight - 10, pageWidth - 10, pageHeight - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...REPORT_SLATE_400);
  doc.text("Confidential", 10, pageHeight - 4);
  doc.text(`Page ${pageNum} of ${total}`, pageWidth - 10, pageHeight - 4, {
    align: "right",
  });
  doc.setTextColor(...REPORT_BRAND_DARK);
};

const pdfDrawSectionHeader = (doc, x, y, text) => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...REPORT_BRAND_DARK);
  const sidebarWidth = 3;
  doc.setFillColor(...REPORT_BRAND_RED);
  doc.rect(x, y, sidebarWidth, 7, "F");
  doc.text(text, x + 5, y + 5);
  return y + 8;
};

const pdfDrawKPICard = (
  doc,
  x,
  y,
  w,
  h,
  label,
  value,
  color = REPORT_BRAND_RED,
) => {
  // Background
  doc.setFillColor(...REPORT_SLATE_100);
  doc.rect(x, y, w, h, "F");

  // Border
  doc.setDrawColor(...color);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);

  // Label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...REPORT_SLATE_600);
  doc.text(label, x + 3, y + 4);

  // Value
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...color);
  doc.text(String(value), x + 3, y + 12);
};

const pdfDrawMetaBox = (doc, x, y, w, rows = []) => {
  doc.setFillColor(...REPORT_WHITE);
  doc.setDrawColor(...REPORT_BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, rows.length * 6 + 6, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...REPORT_BRAND_DARK);
  let yPos = y + 6;
  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x + 4, yPos);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...REPORT_SLATE_600);
    doc.text(String(value), x + 36, yPos);
    doc.setTextColor(...REPORT_BRAND_DARK);
    yPos += 6;
  });
  return yPos + 2;
};

const VIOLATION_PREVIEW_TEMPLATE = [
  {
    violation_type: "Overspeeding",
    location: "Quezon Memorial Circle, Quezon City",
    severity: "High",
    created_at: "2026-01-12T09:40:00",
  },
  {
    violation_type: "Route Deviation",
    location: "Aurora Blvd, Cubao, Quezon City",
    severity: "Medium",
    created_at: "2026-01-15T14:18:00",
  },
  {
    violation_type: "Long Idle Stop",
    location: "Espana Blvd, Sampaloc, Manila",
    severity: "Low",
    created_at: "2026-01-17T11:25:00",
  },
  {
    violation_type: "Harsh Braking",
    location: "Ortigas Ave, Pasig City",
    severity: "Medium",
    created_at: "2026-01-19T16:02:00",
  },
  {
    violation_type: "Overspeeding",
    location: "Commonwealth Ave, Batasan Hills, Quezon City",
    severity: "High",
    created_at: "2026-01-20T08:51:00",
  },
];

const buildViolationPreviewFromRiders = (riders = []) =>
  VIOLATION_PREVIEW_TEMPLATE.map((item, index) => {
    const rider = riders.length ? riders[index % riders.length] : null;
    const fullName = [rider?.fname, rider?.lname]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      ...item,
      rider_name: fullName || rider?.username || `Rider ${index + 1}`,
    };
  });

const filterViolationsByDate = (items, startDate, endDate) =>
  (items || []).filter((item) => {
    const itemDate = new Date(item.created_at);
    const afterStart =
      !startDate || itemDate >= new Date(`${startDate}T00:00:00`);
    const beforeEnd = !endDate || itemDate <= new Date(`${endDate}T23:59:59`);
    return afterStart && beforeEnd;
  });

const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_MAX_PAGES = 25;

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

const DELIVERY_ATTEMPT_COLUMNS = [
  "attempt1_status",
  "attempt1_date",
  "attempt2_status",
  "attempt2_date",
];

// ================= COMPONENT =================
const Reports = () => {
  const [reportType, setReportType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [column, setColumn] = useState("All");
  const [columnsOptions, setColumnsOptions] = useState([]);
  const [format, setFormat] = useState("pdf");
  const [showValidation, setShowValidation] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [parcelPreview, setParcelPreview] = useState([]);
  const [riderPreview, setRiderPreview] = useState([]);
  const [violationPreview, setViolationPreview] = useState(() =>
    buildViolationPreviewFromRiders([]),
  );
  const [floodIncidents, setFloodIncidents] = useState([]);

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

  const riderColumns = [
    { value: "All", label: "All" },
    { value: "username", label: "Username" },
    { value: "email", label: "Email" },
    { value: "fname", label: "First name" },
    { value: "mname", label: "Middle name" },
    { value: "lname", label: "Last name" },
    { value: "doj", label: "Date of join" },
    { value: "pnumber", label: "Phone number" },
  ];

  const violationColumns = [
    { value: "All", label: "All" },
    { value: "rider_name", label: "Rider" },
    { value: "violation_type", label: "Violation type" },
    { value: "location", label: "Location" },
    { value: "severity", label: "Severity" },
    { value: "created_at", label: "Created at" },
  ];

  useEffect(() => {
    async function loadPreviewData() {
      try {
        const [parcelsRes, ridersRes, floodRes] = await Promise.all([
          supabaseClient
            .from("parcels")
            .select("parcel_id, recipient_name, assigned_rider, status")
            .order("parcel_id", { ascending: false })
            .limit(7),
          supabaseClient
            .from("users")
            .select("username, fname, lname, status, created_at")
            .order("created_at", { ascending: false })
            .limit(7),
          supabaseClient
            .from("rider_flood_affected")
            .select("*")
            .order("date", { ascending: false })
            .limit(10),
        ]);

        if (!parcelsRes.error) setParcelPreview(parcelsRes.data || []);
        if (!ridersRes.error) {
          const ridersData = ridersRes.data || [];
          setRiderPreview(ridersData);
          setViolationPreview(buildViolationPreviewFromRiders(ridersData));
        }
        if (!floodRes.error) setFloodIncidents(floodRes.data || []);
      } catch (error) {
        console.error("Failed to load report previews:", error);
      }
    }

    loadPreviewData();
  }, []);

  // ================= DYNAMIC COLUMNS =================
  useEffect(() => {
    if (reportType === "riders") setColumnsOptions(riderColumns);
    else if (reportType === "violations") setColumnsOptions(violationColumns);
    else setColumnsOptions(parcelColumns);
    setColumn("All");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  // ================= VALIDATION MODAL =================
  const showValidationModal = () => setShowValidation(true);
  const hideValidationModal = () => setShowValidation(false);

  // ================= FETCH DATA =================
  const fetchReportData = async (reportType, startDate, endDate, column) => {
    let data = [];
    let columns = [];

    if (reportType === "parcels") {
      const parcels = await fetchAllPages(() => {
        let query = supabaseClient
          .from("parcels")
          .select("*")
          .order("parcel_id", { ascending: true });
        if (startDate) query = query.gte("created_at", startDate);
        if (endDate) query = query.lte("created_at", `${endDate}T23:59:59`);
        return query;
      });
      data = parcels;
      columns =
        column === "All"
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
          : column === "delivery_attempt"
            ? ["parcel_id", ...DELIVERY_ATTEMPT_COLUMNS]
            : ["parcel_id", column];
    } else if (reportType === "riders") {
      const { data: riders, error } = await supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      if (error) throw error;
      data = riders;
      columns =
        column === "All"
          ? ["username", "email", "fname", "mname", "lname", "doj", "pnumber"]
          : [column];
    } else if (reportType === "violations") {
      data = filterViolationsByDate(violationPreview, startDate, endDate);
      columns =
        column === "All"
          ? [
              "rider_name",
              "violation_type",
              "location",
              "severity",
              "created_at",
            ]
          : [column];
    } else if (reportType === "overall") {
      const parcelQueryBuilder = () => {
        let query = supabaseClient
          .from("parcels")
          .select("*")
          .order("parcel_id", { ascending: true });
        if (startDate) query = query.gte("created_at", startDate);
        if (endDate) query = query.lte("created_at", `${endDate}T23:59:59`);
        return query;
      };
      let riderQuery = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      let floodQuery = supabaseClient
        .from("rider_flood_affected")
        .select("*")
        .order("date", { ascending: false });
      if (startDate) floodQuery = floodQuery.gte("date", startDate);
      if (endDate) floodQuery = floodQuery.lte("date", `${endDate}T23:59:59`);

      const [parcels, ridersRes, floodRes] = await Promise.all([
        fetchAllPages(parcelQueryBuilder),
        riderQuery,
        floodQuery,
      ]);
      if (ridersRes.error) throw ridersRes.error;
      if (floodRes.error) throw floodRes.error;

      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: parcels },
        {
          section: "Violations",
          data: filterViolationsByDate(violationPreview, startDate, endDate),
        },
        {
          section: "Flood Affected Riders",
          data: floodRes.data || [],
        },
      ];
      columns = null;
    }

    return { data, columns };
  };

  // ================= PDF GENERATION =================
  const generatePdfReport = async (reportType, startDate, endDate, column) => {
    const { data, columns } = await fetchReportData(
      reportType,
      startDate,
      endDate,
      column,
    );
    const doc = new jsPDF("landscape");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Logo
    const logo = new Image();
    logo.src = "/images/logo.png";

    function finalizePDF() {
      const reportTitle = `${humanizeLabel(reportType)} Report`;
      const generatedAt = new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const dateRange =
        startDate && endDate
          ? `${formatPdfDate(startDate)} to ${formatPdfDate(endDate)}`
          : "All time";
      const columnScope = column ? humanizeLabel(column) : "All";

      // Use enhanced header instead of the old one
      pdfDrawEnhancedHeader(
        doc,
        pageWidth,
        pageHeight,
        reportTitle,
        dateRange,
        "Admin",
      );

      let y = 24;
      doc.setTextColor(...REPORT_BRAND_DARK);

      // Report information section with better spacing
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      y = pdfDrawSectionHeader(doc, 14, y, "REPORT INFORMATION");

      const metaRows = [
        ["Report Type", humanizeLabel(reportType)],
        ["Date Range", dateRange],
        ["Column Scope", columnScope],
        ["Generated", generatedAt],
      ];

      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      let metaY = y;
      metaRows.forEach(([label, value], idx) => {
        if (idx % 2 === 0) {
          doc.setFillColor(...REPORT_SLATE_100);
          doc.rect(14, metaY, (pageWidth - 28) / 2 - 2, 6.5, "F");
        }
        doc.setTextColor(...REPORT_BRAND_DARK);
        doc.setFont("helvetica", "bold");
        doc.text(`${label}:`, 16, metaY + 3.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...REPORT_SLATE_600);
        doc.text(String(value), 50, metaY + 3.5);

        if (idx % 2 === 0) {
          metaY += 7;
        }
      });

      y = metaY + 3;

      // Generate table content with improved formatting
      if (reportType === "overall") {
        let tableY = y + 4;
        data.forEach((section) => {
          // Section header with red accent bar
          tableY = pdfDrawSectionHeader(
            doc,
            14,
            tableY,
            section.section.toUpperCase(),
          );
          tableY += 3;

          const head =
            section.section === "Riders"
              ? [
                  "Username",
                  "Email",
                  "First Name",
                  "Middle Name",
                  "Last Name",
                  "Date of Join",
                  "Phone Number",
                ]
              : section.section === "Violations"
                ? [
                    "Rider",
                    "Violation Type",
                    "Location",
                    "Severity",
                    "Created At",
                  ]
                : section.section === "Flood Affected Riders"
                  ? ["Rider Name", "Latitude", "Longitude", "Date", "Status"]
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
                  formatPdfCellValue(row.doj, "doj"),
                  formatPdfCellValue(row.pnumber, "pnumber"),
                ]
              : section.section === "Violations"
                ? [
                    formatPdfCellValue(row.rider_name, "rider_name"),
                    formatPdfCellValue(row.violation_type, "violation_type"),
                    formatPdfCellValue(row.location, "location"),
                    formatPdfCellValue(row.severity, "severity"),
                    formatPdfCellValue(row.created_at, "created_at"),
                  ]
                : section.section === "Flood Affected Riders"
                  ? [
                      formatPdfCellValue(row.rider_name, "rider_name"),
                      formatPdfCellValue(row.latitude, "latitude"),
                      formatPdfCellValue(row.longitude, "longitude"),
                      formatPdfCellValue(row.date, "date"),
                      formatPdfCellValue(row.status, "status"),
                    ]
                  : [
                      formatPdfCellValue(row.parcel_id, "parcel_id"),
                      formatPdfCellValue(row.recipient_name, "recipient_name"),
                      formatPdfCellValue(
                        row.recipient_phone,
                        "recipient_phone",
                      ),
                      formatPdfCellValue(row.address, "address"),
                      formatPdfCellValue(row.assigned_rider, "assigned_rider"),
                      formatPdfCellValue(row.status, "status"),
                      formatPdfCellValue(
                        row.attempt1_status,
                        "attempt1_status",
                      ),
                      formatPdfCellValue(row.attempt1_date, "attempt1_date"),
                      formatPdfCellValue(
                        row.attempt2_status,
                        "attempt2_status",
                      ),
                      formatPdfCellValue(row.attempt2_date, "attempt2_date"),
                      formatPdfCellValue(row.created_at, "created_at"),
                    ],
          );
          autoTable(doc, {
            startY: tableY,
            margin: { left: 14, right: 14 },
            head: [head],
            body,
            theme: "grid",
            styles: {
              font: "helvetica",
              fontSize: 8,
              textColor: REPORT_BRAND_DARK,
              lineColor: REPORT_BORDER,
              lineWidth: 0.2,
              cellPadding: 3,
              overflow: "linebreak",
            },
            headStyles: {
              fillColor: REPORT_BRAND_RED,
              textColor: REPORT_WHITE,
              fontStyle: "bold",
              halign: "left",
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
            didParseCell: applyPdfStatusCellColor,
            didDrawPage: () => {
              pdfDrawEnhancedHeader(
                doc,
                pageWidth,
                pageHeight,
                reportTitle,
                dateRange,
                "Admin",
              );
              pdfDrawReportsFooter(doc, pageWidth, pageHeight);
            },
          });
          tableY = doc.lastAutoTable.finalY + 10;
          if (tableY > pageHeight - 18) tableY = doc.lastAutoTable.finalY + 8;
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
          startY: y + 4,
          margin: { left: 14, right: 14 },
          head: [head],
          body,
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 8,
            textColor: REPORT_BRAND_DARK,
            lineColor: REPORT_BORDER,
            lineWidth: 0.2,
            cellPadding: 3,
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: REPORT_BRAND_RED,
            textColor: REPORT_WHITE,
            fontStyle: "bold",
            halign: "left",
          },
          alternateRowStyles: { fillColor: [252, 252, 252] },
          didParseCell: applyPdfStatusCellColor,
          didDrawPage: () => {
            pdfDrawEnhancedHeader(
              doc,
              pageWidth,
              pageHeight,
              reportTitle,
              dateRange,
              "Admin",
            );
            pdfDrawReportsFooter(doc, pageWidth, pageHeight);
          },
        });
      }

      doc.save(`${reportType}_report.pdf`);
    }

    logo.onload = () => {
      const logoWidth = 18;
      const logoHeight = 18;
      const logoX = 10;
      const logoY = 10;
      doc.addImage(logo, "PNG", logoX, logoY, logoWidth, logoHeight);
      finalizePDF();
    };
    logo.onerror = finalizePDF;
  };

  const resolveOverallSectionColumns = (sectionName) => {
    if (sectionName === "Riders") {
      return ["username", "email", "fname", "mname", "lname", "doj", "pnumber"];
    }
    if (sectionName === "Violations") {
      return [
        "rider_name",
        "violation_type",
        "location",
        "severity",
        "created_at",
      ];
    }
    if (sectionName === "Flood Affected Riders") {
      return ["rider_name", "latitude", "longitude", "date", "status"];
    }
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
    reportType,
    startDate,
    endDate,
    column,
  ) => {
    const { data, columns } = await fetchReportData(
      reportType,
      startDate,
      endDate,
      column,
    );
    await exportReportAsWorkbook({
      reportType,
      selectedColumn: column,
      startDate,
      endDate,
      data,
      columns,
      humanizeLabel,
      resolveSectionColumns: resolveOverallSectionColumns,
      fileName: `${reportType}_report.xlsx`,
    });
  };

  // ================= GENERATE BUTTON =================
  const handleGenerateReport = async () => {
    const needsDate = reportType === "parcels" || reportType === "overall";
    if (
      !reportType ||
      !column ||
      !format ||
      (needsDate && (!startDate || !endDate))
    ) {
      showValidationModal();
      return;
    }

    try {
      setIsGenerating(true);
      if (format === "pdf")
        await generatePdfReport(reportType, startDate, endDate, column);
      else await generateExcelReport(reportType, startDate, endDate, column);
    } catch (error) {
      console.error("Error generating report:", error);
      alert("Failed to generate report. Check console for details.");
    } finally {
      setIsGenerating(false);
    }
  };

  const reportNeedsDate = reportType === "parcels" || reportType === "overall";

  // ================= RENDER =================
  return (
    <div className="dashboard-container bg-slate-100 dark:bg-slate-950">
      {/* ✅ No props needed - Sidebar gets everything from AuthContext */}
      <Sidebar currentPage="reports.html" />

      <div className="reports-page page-with-topnav ui-page-shell p-6">
        <div className="reports-layout gap-6">
          <div className="reports-card reports-preview-card ui-card-surface">
            <div className="reports-header">
              <h1 className="reports-page-title">Data Lists</h1>
            </div>
            <div className="reports-preview-body">
              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Parcel List</h2>
                  <span className="reports-preview-count">
                    {parcelPreview.length}
                  </span>
                </div>
                <ul>
                  {parcelPreview.length ? (
                    parcelPreview.map((parcel) => (
                      <li key={parcel.parcel_id}>
                        <strong>#{parcel.parcel_id}</strong>
                        <span>
                          {parcel.recipient_name || "Unnamed recipient"}
                        </span>
                        <small>
                          {parcel.assigned_rider || "Unassigned"} |{" "}
                          {parcel.status || "Unknown"}
                        </small>
                      </li>
                    ))
                  ) : (
                    <li className="reports-preview-empty">
                      No parcel data available.
                    </li>
                  )}
                </ul>
              </section>

              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Rider List</h2>
                  <span className="reports-preview-count">
                    {riderPreview.length}
                  </span>
                </div>
                <ul>
                  {riderPreview.length ? (
                    riderPreview.map((rider) => (
                      <li key={rider.username}>
                        <strong>
                          {[rider.fname, rider.lname]
                            .filter(Boolean)
                            .join(" ")
                            .trim() || rider.username}
                        </strong>
                        <span>@{rider.username}</span>
                        <small>{rider.status || "Unknown status"}</small>
                      </li>
                    ))
                  ) : (
                    <li className="reports-preview-empty">
                      No rider data available.
                    </li>
                  )}
                </ul>
              </section>

              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Violation List</h2>
                  <span className="reports-preview-count">
                    {violationPreview.length}
                  </span>
                </div>
                <ul>
                  {violationPreview.map((violation) => (
                    <li
                      key={`${violation.rider_name}-${violation.created_at}-${violation.violation_type}`}
                    >
                      <strong>{violation.rider_name}</strong>
                      <span>{violation.violation_type}</span>
                      <small>
                        {violation.location} | {violation.severity}
                      </small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          <div className="reports-card reports-card-modern ui-card-surface">
            <div className="reports-header">
              <h1 className="reports-page-title">Generate Reports</h1>
            </div>
            <div className="reports-form">
              <div className="reports-form-row full">
                <label>Report Type *</label>
                <select
                  id="reportType"
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

              {reportNeedsDate && (
                <>
                  <div className="reports-form-row">
                    <label>Start Date *</label>
                    <input
                      type="date"
                      id="startDate"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="reports-form-row">
                    <label>End Date *</label>
                    <input
                      type="date"
                      id="endDate"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="reports-form-row">
                <label>Column *</label>
                <select
                  id="column"
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

              <div className="reports-form-row">
                <label>Format *</label>
                <select
                  id="reportFormat"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="pdf">PDF</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                </select>
              </div>

              <div className="reports-form-buttons">
                <button
                  className="reports-btn-generate ui-btn-primary"
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <span className="inline-spinner" aria-hidden="true" />
                      Generating...
                    </>
                  ) : (
                    "Generate"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showValidation && (
        <div className="reports-validation-modal bg-slate-950/60 backdrop-blur-sm">
          <div className="reports-validation-content ui-modal-panel p-6">
            <p>All fields are required.</p>
            <button onClick={hideValidationModal}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
