// Reports.jsx
import React, { useState, useEffect } from "react";
import Sidebar from "../components/sidebar";
import { supabaseClient } from "../App"; // ✅ Import from App.jsx
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import "../styles/global.css";
import "../styles/reports.css";

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
    const fullName = [rider?.fname, rider?.lname].filter(Boolean).join(" ").trim();
    return {
      ...item,
      rider_name: fullName || rider?.username || `Rider ${index + 1}`,
    };
  });

const filterViolationsByDate = (items, startDate, endDate) =>
  (items || []).filter((item) => {
    const itemDate = new Date(item.created_at);
    const afterStart = !startDate || itemDate >= new Date(`${startDate}T00:00:00`);
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
  const [violationPreview, setViolationPreview] = useState(() => buildViolationPreviewFromRiders([]));

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
    { value: "gender", label: "Gender" },
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
        const [parcelsRes, ridersRes] = await Promise.all([
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
        ]);

        if (!parcelsRes.error) setParcelPreview(parcelsRes.data || []);
        if (!ridersRes.error) {
          const ridersData = ridersRes.data || [];
          setRiderPreview(ridersData);
          setViolationPreview(buildViolationPreviewFromRiders(ridersData));
        }
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
      columns = column === "All"
        ? ["username", "email", "fname", "mname", "lname", "gender", "doj", "pnumber"]
        : [column];

    } else if (reportType === "violations") {
      data = filterViolationsByDate(violationPreview, startDate, endDate);
      columns =
        column === "All"
          ? ["rider_name", "violation_type", "location", "severity", "created_at"]
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
      let riderQuery = supabaseClient.from("users").select("*").order("username", { ascending: true });

      const [parcels, ridersRes] = await Promise.all([fetchAllPages(parcelQueryBuilder), riderQuery]);
      if (ridersRes.error) throw ridersRes.error;

      data = [
        { section: "Riders", data: ridersRes.data },
        { section: "Parcels", data: parcels },
        { section: "Violations", data: filterViolationsByDate(violationPreview, startDate, endDate) },
      ];
      columns = null;
    }

    return { data, columns };
  };

  // ================= PDF GENERATION =================
  const generatePdfReport = async (reportType, startDate, endDate, column) => {
    const { data, columns } = await fetchReportData(reportType, startDate, endDate, column);
    const doc = new jsPDF("landscape");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const headerHeight = 35;

    // Keep red header for white logo visibility
    doc.setFillColor(163, 0, 0);
    doc.rect(0, 0, pageWidth, headerHeight, "F");
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.3);
    doc.line(10, headerHeight + 1, pageWidth - 10, headerHeight + 1);

    // Logo
    const logo = new Image();
    logo.src = "/images/logo.png";

    function finalizePDF() {
      doc.setTextColor(33, 37, 41);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(`${humanizeLabel(reportType)} Report`, 14, headerHeight + 10);

      const generatedAt = new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const metaRows = [
        ["Report Type", humanizeLabel(reportType)],
        ["Date Range", `${formatPdfDate(startDate)} to ${formatPdfDate(endDate)}`],
        ["Column Scope", humanizeLabel(column)],
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

      // Generate table content
      if (reportType === "overall") {
        let yOffset = infoY + 4;
        data.forEach(section => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11.5);
          doc.setTextColor(17, 24, 39);
          doc.text(section.section, 10, yOffset);
          const head = section.section === "Riders"
            ? ["Username", "Email", "First Name", "Middle Name", "Last Name", "Gender", "Date of Join", "Phone Number"]
            : section.section === "Violations"
              ? ["Rider", "Violation Type", "Location", "Severity", "Created At"]
              : ["Parcel ID", "Recipient Name", "Phone", "Address", "Rider", "Status", "Attempt 1 Status", "Attempt 1 Date", "Attempt 2 Status", "Attempt 2 Date", "Created At"];
          const body = section.data.map(row => section.section === "Riders"
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
                formatPdfCellValue(row.rider_name, "rider_name"),
                formatPdfCellValue(row.violation_type, "violation_type"),
                formatPdfCellValue(row.location, "location"),
                formatPdfCellValue(row.severity, "severity"),
                formatPdfCellValue(row.created_at, "created_at"),
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
              ]
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

      doc.save(`${reportType}_report.pdf`);
    }

    logo.onload = () => {
      const logoWidth = 40;
      const logoHeight = 40;
      const logoX = pageWidth / 2 - logoWidth / 2;
      const logoY = 3;
      doc.addImage(logo, "PNG", logoX, logoY, logoWidth, logoHeight);
      finalizePDF();
    };
    logo.onerror = finalizePDF;
  };

  // ================= CSV GENERATION =================
  const generateCsvReport = async (reportType, startDate, endDate, column) => {
    const { data } = await fetchReportData(reportType, startDate, endDate, column);
    let csv = "";

    if (reportType === "overall") {
      data.forEach(section => {
        csv += `\n## ${section.section}\n`;
        const cols = section.section === "Riders"
          ? ["username", "email", "fname", "mname", "lname", "gender", "doj", "pnumber"]
          : section.section === "Violations"
            ? ["rider_name", "violation_type", "location", "severity", "created_at"]
          : column === "All"
            ? ["parcel_id", "recipient_name", "recipient_phone", "address", "assigned_rider", "status", ...DELIVERY_ATTEMPT_COLUMNS, "created_at"]
            : column === "delivery_attempt"
              ? ["parcel_id", ...DELIVERY_ATTEMPT_COLUMNS]
              : ["parcel_id", column];
        csv += cols.join(",") + "\n";
        section.data.forEach(row => {
          csv += cols.map(c => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`).join(",") + "\n";
        });
      });
    } else {
      const reportCols = column === "All"
        ? reportType === "riders"
          ? ["username", "email", "fname", "mname", "lname", "gender", "doj", "pnumber"]
          : reportType === "violations"
            ? ["rider_name", "violation_type", "location", "severity", "created_at"]
          : ["parcel_id", "recipient_name", "recipient_phone", "address", "assigned_rider", "status", ...DELIVERY_ATTEMPT_COLUMNS, "created_at"]
        : reportType === "parcels"
          ? column === "delivery_attempt"
            ? ["parcel_id", ...DELIVERY_ATTEMPT_COLUMNS]
            : ["parcel_id", column]
          : [column];
      csv += reportCols.join(",") + "\n";
      data.forEach(row => {
        csv += reportCols.map(c => `"${(row[c] ?? "").toString().replace(/"/g, '""')}"`).join(",") + "\n";
      });
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reportType}_report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ================= GENERATE BUTTON =================
  const handleGenerateReport = async () => {
    const needsDate = reportType === "parcels" || reportType === "overall";
    if (!reportType || !column || !format || (needsDate && (!startDate || !endDate))) {
      showValidationModal();
      return;
    }

    try {
      setIsGenerating(true);
      if (format === "pdf") await generatePdfReport(reportType, startDate, endDate, column);
      else await generateCsvReport(reportType, startDate, endDate, column);
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

      <div className="reports-page bg-gradient-to-br from-red-50 via-slate-50 to-slate-100 p-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="reports-layout gap-6">
          <div className="reports-card reports-preview-card rounded-2xl border border-slate-200 bg-white/95 shadow-xl dark:border-slate-700 dark:bg-slate-900/90">
            <div className="reports-header"><h1 className="reports-page-title">Data Lists</h1></div>
            <div className="reports-preview-body">
              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Parcel List</h2>
                  <span className="reports-preview-count">{parcelPreview.length}</span>
                </div>
                <ul>
                  {parcelPreview.length ? parcelPreview.map((parcel) => (
                    <li key={parcel.parcel_id}>
                      <strong>#{parcel.parcel_id}</strong>
                      <span>{parcel.recipient_name || "Unnamed recipient"}</span>
                      <small>{parcel.assigned_rider || "Unassigned"} | {parcel.status || "Unknown"}</small>
                    </li>
                  )) : <li className="reports-preview-empty">No parcel data available.</li>}
                </ul>
              </section>

              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Rider List</h2>
                  <span className="reports-preview-count">{riderPreview.length}</span>
                </div>
                <ul>
                  {riderPreview.length ? riderPreview.map((rider) => (
                    <li key={rider.username}>
                      <strong>{[rider.fname, rider.lname].filter(Boolean).join(" ").trim() || rider.username}</strong>
                      <span>@{rider.username}</span>
                      <small>{rider.status || "Unknown status"}</small>
                    </li>
                  )) : <li className="reports-preview-empty">No rider data available.</li>}
                </ul>
              </section>

              <section className="reports-preview-section">
                <div className="reports-preview-section-head">
                  <h2>Violation List</h2>
                  <span className="reports-preview-count">{violationPreview.length}</span>
                </div>
                <ul>
                  {violationPreview.map((violation) => (
                    <li key={`${violation.rider_name}-${violation.created_at}-${violation.violation_type}`}>
                      <strong>{violation.rider_name}</strong>
                      <span>{violation.violation_type}</span>
                      <small>{violation.location} | {violation.severity}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          <div className="reports-card reports-card-modern rounded-2xl border border-slate-200 bg-white/95 shadow-xl dark:border-slate-700 dark:bg-slate-900/90">
            <div className="reports-header"><h1 className="reports-page-title">Generate Reports</h1></div>
            <div className="reports-form">
            <div className="reports-form-row full">
              <label>Report Type *</label>
              <select id="reportType" value={reportType} onChange={e => setReportType(e.target.value)}>
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
                  <input type="date" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="reports-form-row">
                  <label>End Date *</label>
                  <input type="date" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            <div className="reports-form-row">
              <label>Column *</label>
              <select id="column" value={column} onChange={e => setColumn(e.target.value)}>
                {columnsOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="reports-form-row">
              <label>Format *</label>
              <select id="reportFormat" value={format} onChange={e => setFormat(e.target.value)}>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </select>
            </div>

            <div className="reports-form-buttons">
              <button className="reports-btn-generate rounded-xl bg-gradient-to-r from-red-600 to-red-800 px-4 py-2 font-semibold text-white shadow-lg shadow-red-700/25 transition hover:brightness-110 disabled:opacity-60" onClick={handleGenerateReport} disabled={isGenerating}>
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
          <div className="reports-validation-content rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <p>All fields are required.</p>
            <button onClick={hideValidationModal}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
