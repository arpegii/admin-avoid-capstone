import { useState, useEffect, useRef } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App";
import Chart from "chart.js/auto";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { FaDownload, FaPaperPlane } from "react-icons/fa";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

const VIOLATION_HOTSPOTS = [
  {
    location: "Quezon Memorial Circle, Quezon City",
    incidents: 19,
    violation_type: "Overspeeding",
    created_at: "2026-01-12T09:40:00",
    note: "Frequent overspeed alerts during rush hours.",
    coords: [14.6509, 121.0494],
    radius: 260,
  },
  {
    location: "Aurora Blvd, Cubao, Quezon City",
    incidents: 11,
    violation_type: "Route Deviation",
    created_at: "2026-01-15T14:18:00",
    note: "Repeated abrupt-stop events near intersections.",
    coords: [14.6206, 121.0541],
    radius: 190,
  },
  {
    location: "Commonwealth Ave, Batasan Hills, Quezon City",
    incidents: 6,
    violation_type: "Long Idle Stop",
    created_at: "2026-01-17T11:25:00",
    note: "Occasional route-deviation reports.",
    coords: [14.6838, 121.0952],
    radius: 160,
  },
  {
    location: "Katipunan Ave, Loyola Heights, Quezon City",
    incidents: 10,
    violation_type: "Harsh Braking",
    created_at: "2026-01-19T16:02:00",
    note: "Frequent lane-change alerts near school zones.",
    coords: [14.6381, 121.0743],
    radius: 175,
  },
  {
    location: "Espana Blvd, Sampaloc, Manila",
    incidents: 15,
    violation_type: "Overspeeding",
    created_at: "2026-01-20T08:51:00",
    note: "Dense rider traffic with repeated speed violations.",
    coords: [14.6112, 120.9896],
    radius: 240,
  },
  {
    location: "Ortigas Ave, Pasig City",
    incidents: 5,
    violation_type: "Long Idle Stop",
    created_at: "2026-01-24T13:10:00",
    note: "Isolated stop-duration anomalies.",
    coords: [14.5876, 121.0614],
    radius: 145,
  },
];

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
  { value: "rider_name", label: "Rider" },
  { value: "violation_type", label: "Violation type" },
  { value: "location", label: "Location" },
  { value: "severity", label: "Severity" },
  { value: "created_at", label: "Created at" },
];

const buildViolationReportRows = () =>
  VIOLATION_HOTSPOTS.map((item, index) => ({
    rider_name: `Rider ${index + 1}`,
    violation_type: item.violation_type,
    location: item.location,
    severity: getViolationDensityLevel(item.incidents).toUpperCase(),
    created_at: item.created_at,
  }));

const filterByDateRange = (items, startDate, endDate) =>
  (items || []).filter((item) => {
    const itemDate = new Date(item.created_at);
    const afterStart = !startDate || itemDate >= new Date(`${startDate}T00:00:00`);
    const beforeEnd = !endDate || itemDate <= new Date(`${endDate}T23:59:59`);
    return afterStart && beforeEnd;
  });

const toBase64FromArrayBuffer = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const Dashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    delivered: "--",
    cancelled: "--",
    topMonth: "--",
    topMonthCount: "--",
    topYear: "--",
    topYearCount: "--",
    topRider: "--",
    topRiderCount: "--",
    riders: [],
    years: [],
    yearGrowth: [],
  });
  const [loading, setLoading] = useState(true);
  const [violationMapModalOpen, setViolationMapModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportType, setReportType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reportRecipientEmail, setReportRecipientEmail] = useState("");
  const [sendReportModalOpen, setSendReportModalOpen] = useState(false);
  const [column, setColumn] = useState("All");
  const [columnsOptions, setColumnsOptions] = useState([]);
  const [format, setFormat] = useState("pdf");
  const [showReportValidation, setShowReportValidation] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const growthChartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const violationMapRef = useRef(null);
  const violationLeafletMapRef = useRef(null);
  const violationFullMapRef = useRef(null);
  const violationFullLeafletMapRef = useRef(null);
  const todayLabel = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const buildViolationPopup = (location, level, incidents, note) => `
    <div class="violation-hotspot-popup-card">
      <div class="violation-hotspot-popup-top">
        <span class="violation-hotspot-dot ${level}"></span>
        <strong>${location}</strong>
      </div>
      <span class="violation-hotspot-badge ${level}">${level.toUpperCase()} DENSITY</span>
      <p>${incidents} recent incidents (placeholder)</p>
      <small>${note}</small>
    </div>
  `;

  useEffect(() => {
    if (reportType === "riders") setColumnsOptions(riderColumns);
    else if (reportType === "violations") setColumnsOptions(violationColumns);
    else setColumnsOptions(parcelColumns);
    setColumn("All");
  }, [reportType]);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        const { data: parcels } = await supabaseClient.from("parcels").select("*");
        const { data: riders } = await supabaseClient
          .from("users")
          .select("username")
          .order("created_at", { ascending: false });

        if (!parcels || !riders) {
          setLoading(false);
          return;
        }

        const delivered = parcels.filter(
          (p) => p.status?.toLowerCase() === "successfully delivered"
        ).length;
        const cancelled = parcels.filter((p) => p.status?.toLowerCase() === "cancelled").length;
        const months = {};
        const yearsCount = {};
        const riderCounts = {};
        let topMonth = "";
        let topMonthCount = 0;
        let topYear = "";
        let topYearCount = 0;
        let topRider = "";
        let topRiderCount = 0;

        parcels.forEach((p) => {
          if (p.status?.toLowerCase() === "successfully delivered") {
            const date = new Date(p.created_at);
            const monthStr = date.toLocaleString("default", { month: "long" });
            const yearStr = date.getFullYear();

            months[monthStr] = (months[monthStr] || 0) + 1;
            if (months[monthStr] > topMonthCount) {
              topMonth = monthStr;
              topMonthCount = months[monthStr];
            }

            yearsCount[yearStr] = (yearsCount[yearStr] || 0) + 1;
            if (yearsCount[yearStr] > topYearCount) {
              topYear = yearStr;
              topYearCount = yearsCount[yearStr];
            }

            if (p.assigned_rider) {
              riderCounts[p.assigned_rider] = (riderCounts[p.assigned_rider] || 0) + 1;
              if (riderCounts[p.assigned_rider] > topRiderCount) {
                topRider = p.assigned_rider;
                topRiderCount = riderCounts[p.assigned_rider];
              }
            }
          }
        });

        const sortedYears = Object.keys(yearsCount).sort((a, b) => a - b);
        const yearGrowthData = sortedYears.map((y) => yearsCount[y]);

        setDashboardData({
          delivered,
          cancelled,
          topMonth,
          topMonthCount,
          topYear,
          topYearCount,
          topRider,
          topRiderCount,
          riders: riders.slice(0, 5),
          years: sortedYears,
          yearGrowth: yearGrowthData,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, []);

  const fetchReportData = async (selectedReportType, selectedStartDate, selectedEndDate, selectedColumn) => {
    let data = [];
    let columns = [];

    if (selectedReportType === "parcels") {
      let query = supabaseClient
        .from("parcels")
        .select("*")
        .order("parcel_id", { ascending: true });
      if (selectedStartDate) query = query.gte("created_at", selectedStartDate);
      if (selectedEndDate) query = query.lte("created_at", `${selectedEndDate}T23:59:59`);
      const { data: parcels, error } = await query;
      if (error) throw error;
      data = parcels;
      columns =
        selectedColumn === "All"
          ? ["recipient_name", "recipient_phone", "address", "assigned_rider", "status", "created_at"]
          : [selectedColumn];
    } else if (selectedReportType === "riders") {
      let query = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      if (selectedStartDate) query = query.gte("created_at", selectedStartDate);
      if (selectedEndDate) query = query.lte("created_at", `${selectedEndDate}T23:59:59`);
      const { data: riders, error } = await query;
      if (error) throw error;
      data = riders;
      columns = selectedColumn === "All" ? ["email", "status", "created_at"] : [selectedColumn];
    } else if (selectedReportType === "violations") {
      data = filterByDateRange(buildViolationReportRows(), selectedStartDate, selectedEndDate);
      columns =
        selectedColumn === "All"
          ? ["rider_name", "violation_type", "location", "severity", "created_at"]
          : [selectedColumn];
    } else if (selectedReportType === "overall") {
      let parcelQuery = supabaseClient
        .from("parcels")
        .select("*")
        .order("parcel_id", { ascending: true });
      let riderQuery = supabaseClient
        .from("users")
        .select("*")
        .order("username", { ascending: true });
      if (selectedStartDate) parcelQuery = parcelQuery.gte("created_at", selectedStartDate);
      if (selectedEndDate) parcelQuery = parcelQuery.lte("created_at", `${selectedEndDate}T23:59:59`);

      const [parcelsRes, ridersRes] = await Promise.all([parcelQuery, riderQuery]);
      if (parcelsRes.error) throw parcelsRes.error;
      if (ridersRes.error) throw ridersRes.error;

      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: parcelsRes.data },
        {
          section: "Violations",
          data: filterByDateRange(buildViolationReportRows(), selectedStartDate, selectedEndDate),
        },
      ];
      columns = null;
    }

    return { data, columns };
  };

  const buildPdfDoc = (selectedReportType, selectedStartDate, selectedEndDate, selectedColumn, data, columns) => {
    const doc = new jsPDF("landscape");
    const pageWidth = doc.internal.pageSize.getWidth();
    const headerHeight = 35;

    doc.setFillColor(163, 0, 0);
    doc.rect(0, 0, pageWidth, headerHeight, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("CAPSTONE Report", pageWidth / 2, 18, { align: "center" });
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(12);
    const infoTexts = [
      `Report Type: ${humanizeLabel(selectedReportType)}`,
      `Start: ${selectedStartDate || "-"}`,
      `End: ${selectedEndDate || "-"}`,
      `Column: ${humanizeLabel(selectedColumn)}`,
    ];
    const spacing = 20;
    let totalWidth = infoTexts.reduce((sum, text) => sum + doc.getTextWidth(text), 0);
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
              ? ["Rider", "Violation Type", "Location", "Severity", "Created At"]
              : ["Parcel ID", "Recipient Name", "Phone", "Address", "Rider", "Status", "Created At"];
        const body = section.data.map((row) =>
          section.section === "Riders"
            ? [row.username, row.email, row.status, row.created_at]
            : section.section === "Violations"
              ? [row.rider_name, row.violation_type, row.location, row.severity, row.created_at]
              : [
                  row.parcel_id,
                  row.recipient_name,
                  row.recipient_phone,
                  row.address,
                  row.assigned_rider,
                  row.status,
                  row.created_at,
                ]
        );
        autoTable(doc, { startY: yOffset + 4, head: [head], body, styles: { fontSize: 9 } });
        yOffset = doc.lastAutoTable.finalY + 10;
      });
    } else {
      const head = columns.map(humanizeLabel);
      const body = data.map((row) => columns.map((c) => row[c] || "-"));
      autoTable(doc, { startY: infoY + 10, head: [head], body, styles: { fontSize: 9 } });
    }

    return doc;
  };

  const buildCsvContent = (selectedReportType, selectedColumn, data) => {
    let csv = "";
    if (selectedReportType === "overall") {
      data.forEach((section) => {
        csv += `\n## ${section.section}\n`;
        const cols =
          section.section === "Riders"
            ? ["username", "email", "status", "created_at"]
            : section.section === "Violations"
              ? ["rider_name", "violation_type", "location", "severity", "created_at"]
              : selectedColumn === "All"
                ? [
                    "parcel_id",
                    "recipient_name",
                    "recipient_phone",
                    "address",
                    "assigned_rider",
                    "status",
                    "created_at",
                  ]
                : ["parcel_id", selectedColumn];
        csv += cols.join(",") + "\n";
        section.data.forEach((row) => {
          csv += cols.map((c) => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`).join(",") + "\n";
        });
      });
    } else {
      const reportCols =
        selectedColumn === "All"
          ? selectedReportType === "riders"
            ? ["username", "email", "status", "created_at"]
            : selectedReportType === "violations"
              ? ["rider_name", "violation_type", "location", "severity", "created_at"]
              : [
                  "parcel_id",
                  "recipient_name",
                  "recipient_phone",
                  "address",
                  "assigned_rider",
                  "status",
                  "created_at",
                ]
          : [selectedColumn];
      csv += reportCols.join(",") + "\n";
      data.forEach((row) => {
        csv += reportCols.map((c) => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`).join(",") + "\n";
      });
    }
    return csv;
  };

  const buildAttachmentPayload = async (selectedReportType, selectedStartDate, selectedEndDate, selectedColumn, selectedFormat) => {
    const { data, columns } = await fetchReportData(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn
    );

    if (selectedFormat === "pdf") {
      const doc = buildPdfDoc(
        selectedReportType,
        selectedStartDate,
        selectedEndDate,
        selectedColumn,
        data,
        columns
      );
      const pdfArrayBuffer = doc.output("arraybuffer");
      return {
        fileName: `${selectedReportType}_report.pdf`,
        mimeType: "application/pdf",
        contentBase64: toBase64FromArrayBuffer(pdfArrayBuffer),
      };
    }

    const csv = buildCsvContent(selectedReportType, selectedColumn, data);
    return {
      fileName: `${selectedReportType}_report.csv`,
      mimeType: "text/csv",
      contentBase64: btoa(unescape(encodeURIComponent(csv))),
    };
  };

  const generatePdfReport = async (selectedReportType, selectedStartDate, selectedEndDate, selectedColumn) => {
    const { data, columns } = await fetchReportData(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn
    );
    const doc = buildPdfDoc(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn,
      data,
      columns
    );
    doc.save(`${selectedReportType}_report.pdf`);
  };

  const generateCsvReport = async (selectedReportType, selectedStartDate, selectedEndDate, selectedColumn) => {
    const { data } = await fetchReportData(
      selectedReportType,
      selectedStartDate,
      selectedEndDate,
      selectedColumn
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
    if (!reportType || !column || !format || !startDate || !endDate) {
      setShowReportValidation(true);
      return false;
    }
    return true;
  };

  const handleDownloadReport = async () => {
    if (!validateReportInput()) return;
    try {
      setIsGeneratingReport(true);
      if (format === "pdf") await generatePdfReport(reportType, startDate, endDate, column);
      else await generateCsvReport(reportType, startDate, endDate, column);
      setReportModalOpen(false);
    } catch (error) {
      console.error("Error generating report:", error);
      alert("Failed to generate report. Check console for details.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const openSendReportModal = () => {
    if (!validateReportInput()) return;
    setSendReportModalOpen(true);
  };

  const handleSendReport = async () => {
    const email = reportRecipientEmail.trim();
    if (!email || !validateReportInput()) return;

    try {
      setIsSendingReport(true);
      const attachment = await buildAttachmentPayload(
        reportType,
        startDate,
        endDate,
        column,
        format
      );

      const { error } = await supabaseClient.functions.invoke("send-report-email", {
        body: {
          to: email,
          reportType,
          startDate,
          endDate,
          detailMode: "standard",
          format,
          column,
          attachment,
        },
      });

      if (error) throw error;

      setSendReportModalOpen(false);
      setReportRecipientEmail("");
      alert("Report email sent successfully.");
    } catch (error) {
      console.error("Failed to send report email:", error);
      const details =
        error?.context?.error ||
        error?.message ||
        "Make sure the Edge Function is deployed and SMTP secrets are set.";
      alert(`Failed to send report email: ${details}`);
    } finally {
      setIsSendingReport(false);
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
        plugins: { legend: { display: false } },
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
      const map = L.map(violationMapRef.current).setView([14.676, 121.0437], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

      // Placeholder hotspots until violation coordinates are available in DB.
      VIOLATION_HOTSPOTS.forEach((hotspot) => {
        const level = getViolationDensityLevel(hotspot.incidents);
        const circleStyle = HOTSPOT_CIRCLE_STYLE[level] || HOTSPOT_CIRCLE_STYLE.high;

        L.circle(hotspot.coords, {
          ...circleStyle,
          radius: hotspot.radius,
        })
          .addTo(map)
          .bindPopup(
            buildViolationPopup(hotspot.location, level, hotspot.incidents, hotspot.note),
            { className: "violation-hotspot-popup", closeButton: false }
          );
      });

      violationLeafletMapRef.current = map;
    }

    setTimeout(() => {
      violationLeafletMapRef.current?.invalidateSize();
    }, 120);
  }, [loading]);

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
      const map = L.map(violationFullMapRef.current).setView([14.676, 121.0437], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

      VIOLATION_HOTSPOTS.forEach((hotspot) => {
        const level = getViolationDensityLevel(hotspot.incidents);
        const circleStyle = HOTSPOT_CIRCLE_STYLE[level] || HOTSPOT_CIRCLE_STYLE.high;

        L.circle(hotspot.coords, {
          ...circleStyle,
          radius: hotspot.radius,
        })
          .addTo(map)
          .bindPopup(
            buildViolationPopup(hotspot.location, level, hotspot.incidents, hotspot.note),
            { className: "violation-hotspot-popup", closeButton: false }
          );
      });
      violationFullLeafletMapRef.current = map;
    }

    setTimeout(() => {
      violationFullLeafletMapRef.current?.invalidateSize();
    }, 120);
  }, [violationMapModalOpen]);

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
    };
  }, []);

  return (
    <div className="dashboard-container">
      <Sidebar />

      <div className="dashboard-page">
        {loading ? (
          <PageSpinner fullScreen label="Loading dashboard..." />
        ) : (
          <>
            <div className="dash-header">
              <div className="dash-header-copy">
                <h1 className="page-title">Dashboard</h1>
              </div>
              <div className="dash-header-actions">
                <button
                  type="button"
                  className="dash-generate-report-btn"
                  onClick={() => setReportModalOpen(true)}
                >
                  Generate Report
                </button>
                <span className="date-range">{todayLabel}</span>
              </div>
            </div>

            <div className="dash-grid two-rows">
              <div className="dash-card top-card metric-card delivered-card">
                <div className="metric-pill success">Delivered</div>
                <div className="card-value delivered">{dashboardData.delivered}</div>
                <div className="card-desc">Successful deliveries completed</div>
              </div>

              <div className="dash-card top-card metric-card cancelled-card">
                <div className="metric-pill warning">Cancelled</div>
                <div className="card-value delayed">{dashboardData.cancelled}</div>
                <div className="card-desc">Orders cancelled by customer/system</div>
              </div>

              <div className="dash-card bottom-card growth">
                <div className="card-label">Delivery Growth by Year</div>
                <div className="growth-canvas-shell">
                  <canvas ref={growthChartRef}></canvas>
                </div>
              </div>

              <div className="dash-card bottom-card small-card top-month">
                <div className="card-label">Top Month</div>
                <div className="card-value">{dashboardData.topMonth}</div>
                <div className="card-desc">{dashboardData.topMonthCount} deliveries</div>
              </div>

              <div className="dash-card bottom-card small-card top-year">
                <div className="card-label">Top Year</div>
                <div className="card-value">{dashboardData.topYear}</div>
                <div className="card-desc">{dashboardData.topYearCount} deliveries</div>
              </div>

              <div className="dash-card bottom-card top-rider-card">
                <div className="card-label">Top Rider</div>
                <div className="card-value">{dashboardData.topRider || "--"}</div>
                <div className="card-desc">{dashboardData.topRiderCount} deliveries</div>
              </div>

              <div className="dash-card bottom-card violation-map-card">
                <div className="violation-map-header">
                  <div className="violation-map-header-top">
                    <h2>Violation Heat Map</h2>
                    <button
                      type="button"
                      className="violation-map-size-btn"
                      onClick={() => setViolationMapModalOpen(true)}
                    >
                      View Fullscreen Map
                    </button>
                  </div>
                  <p>Showing hotspot placeholders where rider violations can appear.</p>
                </div>
                <div className="violation-map-body">
                  <div className="violation-map-stack">
                    <div ref={violationMapRef} className="violation-map-canvas" />
                    <div className="violation-map-placeholder-panel">
                      <strong>Heat Maps Indicator</strong>
                      <p>Hotspots shown are sample overlays while violation GPS events are not yet available.</p>
                      <div className="violation-map-legend">
                        <span><i className="legend-dot high" />High</span>
                        <span><i className="legend-dot medium" />Medium</span>
                        <span><i className="legend-dot low" />Low</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {violationMapModalOpen && (
        <div className="dashboard-modal-overlay" onClick={() => setViolationMapModalOpen(false)}>
          <div className="dashboard-modal-content violation-full-map-modal" onClick={(event) => event.stopPropagation()}>
            <div className="violation-full-map-header">
              <h2>Violation Heat Map</h2>
              <button type="button" className="violation-full-map-close" onClick={() => setViolationMapModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="violation-full-map-body">
              <div className="violation-full-map-stack">
                <div ref={violationFullMapRef} className="violation-full-map-canvas" />
                <div className="violation-map-placeholder-panel violation-map-placeholder-panel-full">
                  <strong>Heat Maps Indicator</strong>
                  <p>Hotspots shown are sample overlays while violation GPS events are not yet available.</p>
                  <div className="violation-map-legend">
                    <span><i className="legend-dot high" />High</span>
                    <span><i className="legend-dot medium" />Medium</span>
                    <span><i className="legend-dot low" />Low</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportModalOpen && (
        <div className="dashboard-modal-overlay" onClick={() => setReportModalOpen(false)}>
          <div className="dashboard-modal-content dashboard-report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="dashboard-report-modal-header">
              <h2>Generate Reports</h2>
            </div>
            <div className="dashboard-report-modal-body">
              <div className="dashboard-report-layout">
                <div className="dashboard-report-main">
                  <div className="dashboard-report-date-header">
                    <div className="dashboard-report-field">
                      <label>Start Date</label>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="dashboard-report-field">
                      <label>End Date</label>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="dashboard-report-field full">
                    <label>Report Type</label>
                    <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                      <option value="">-- Select Report Type --</option>
                      <option value="parcels">Parcels</option>
                      <option value="riders">Riders</option>
                      <option value="violations">Violations</option>
                      <option value="overall">Overall Reports</option>
                    </select>
                  </div>

                  <div className="dashboard-report-meta">
                    <div className="dashboard-report-field">
                      <label>Column</label>
                      <select value={column} onChange={(e) => setColumn(e.target.value)}>
                        {columnsOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="dashboard-report-field">
                      <label>Format</label>
                      <select value={format} onChange={(e) => setFormat(e.target.value)}>
                        <option value="pdf">PDF</option>
                        <option value="csv">CSV</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="dashboard-report-actions-panel">
                  <button
                    type="button"
                    className="dashboard-report-send-btn"
                    onClick={openSendReportModal}
                    disabled={isGeneratingReport || isSendingReport}
                  >
                    <FaPaperPlane aria-hidden="true" />
                    <span>Send</span>
                  </button>
                  <button
                    type="button"
                    className="dashboard-report-download-btn"
                    onClick={handleDownloadReport}
                    disabled={isGeneratingReport || isSendingReport}
                  >
                    <FaDownload aria-hidden="true" />
                    <span>{isGeneratingReport ? "Downloading..." : "Download"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {sendReportModalOpen && (
        <div className="dashboard-modal-overlay" onClick={() => setSendReportModalOpen(false)}>
          <div className="dashboard-modal-content dashboard-send-modal" onClick={(event) => event.stopPropagation()}>
            <div className="dashboard-send-modal-header">
              <h2>Send Report</h2>
            </div>
            <div className="dashboard-send-modal-body">
              <div className="dashboard-send-field">
                <label>Recipient Email</label>
                <input
                  type="email"
                  value={reportRecipientEmail}
                  onChange={(e) => setReportRecipientEmail(e.target.value)}
                  placeholder="name@example.com"
                />
                <small>Email will be sent via Supabase Edge Function using your configured SMTP.</small>
              </div>
              <div className="dashboard-send-actions">
                <button type="button" className="dashboard-send-cancel-btn" onClick={() => setSendReportModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="dashboard-send-confirm-btn"
                  onClick={handleSendReport}
                  disabled={!reportRecipientEmail.trim() || isSendingReport}
                >
                  <FaPaperPlane aria-hidden="true" />
                  <span>{isSendingReport ? "Sending..." : "Send"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReportValidation && (
        <div className="dashboard-modal-overlay" onClick={() => setShowReportValidation(false)}>
          <div className="dashboard-modal-content dashboard-report-validation" onClick={(event) => event.stopPropagation()}>
            <p>All fields are required.</p>
            <button type="button" onClick={() => setShowReportValidation(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
