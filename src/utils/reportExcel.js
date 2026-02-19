import ExcelJS from "exceljs";

const BASE_HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } };
const ALT_ROW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
const META_LABEL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const formatDateTime = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const toDisplayCase = (value) =>
  String(value || "")
    .trim()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);

const toStatusCase = (value) => {
  const normalized = normalizeText(value);
  if (normalized === "on going") return "On-Going";
  if (normalized === "pending") return "Pending";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "failed") return "Failed";
  if (normalized === "successfully delivered") return "Successfully Delivered";
  if (normalized === "success") return "Success";
  if (normalized === "received") return "Received";
  return toDisplayCase(value);
};

const formatCellValue = (value, columnKey) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "object" && value !== null) {
    const fullName = [value.fname, value.lname].filter(Boolean).join(" ").trim();
    if (fullName) return fullName;
    if (value.username) return String(value.username);
    return "";
  }

  if (
    columnKey === "created_at" ||
    columnKey === "date" ||
    columnKey === "doj" ||
    /_date$/i.test(columnKey)
  ) {
    return formatDateTime(value);
  }

  const raw = String(value).trim();
  if (!raw) return "";
  if (/email/i.test(columnKey) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  if (/status/i.test(columnKey)) return toStatusCase(raw);
  if (/(^id$|_id$|phone)/i.test(columnKey)) return raw;
  if (columnKey === "username") return raw;
  return toDisplayCase(raw);
};

const applyStatusColor = (cell, value) => {
  const normalized = normalizeText(value);
  if (!normalized) return;

  const isYellow = normalized === "on going" || normalized === "pending";
  const isRed = normalized === "cancelled" || normalized === "canceled" || normalized === "failed";
  const isGreen = normalized === "successfully delivered" || normalized === "success";

  if (isYellow) cell.font = { color: { argb: "FFD97706" }, bold: true };
  if (isRed) cell.font = { color: { argb: "FFB91C1C" }, bold: true };
  if (isGreen) cell.font = { color: { argb: "FF047857" }, bold: true };
};

const applyThinBorder = (cell) => {
  cell.border = {
    top: { style: "thin", color: { argb: "FFD1D5DB" } },
    left: { style: "thin", color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    right: { style: "thin", color: { argb: "FFD1D5DB" } },
  };
};

const buildTableDescriptor = ({ reportType, selectedColumn, data, columns, resolveSectionColumns }) => {
  if (reportType === "overall") {
    return (data || []).map((section) => ({
      title: section.section,
      columns: resolveSectionColumns(section.section, selectedColumn),
      rows: section.data || [],
    }));
  }

  return [
    {
      title: null,
      columns: columns || [],
      rows: data || [],
    },
  ];
};

const setColumnWidths = (worksheet, widthHints) => {
  widthHints.forEach((hint, index) => {
    worksheet.getColumn(index + 1).width = Math.min(48, Math.max(10, hint + 3));
  });
};

export const exportReportAsWorkbook = async ({
  reportType,
  selectedColumn,
  startDate,
  endDate,
  data,
  columns,
  humanizeLabel,
  resolveSectionColumns,
  fileName,
}) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Document Report");

  const sections = buildTableDescriptor({
    reportType,
    selectedColumn,
    data,
    columns,
    resolveSectionColumns,
  });
  const maxDataColumns = Math.max(1, ...sections.map((section) => section.columns.length + 1));
  const totalColumns = Math.max(8, maxDataColumns);
  const totalRows = sections.reduce((count, section) => count + section.rows.length, 0);
  const reportPeriod = startDate && endDate ? `${startDate} to ${endDate}` : "All available dates";

  worksheet.mergeCells(1, 1, 1, totalColumns);
  worksheet.mergeCells(2, 1, 2, totalColumns);
  worksheet.getCell(1, 1).value = "AVOID";
  worksheet.getCell(2, 1).value = `${humanizeLabel(reportType)} Report`;
  worksheet.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell(2, 1).alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell(1, 1).font = { bold: true, size: 20, color: { argb: "FF0F172A" } };
  worksheet.getCell(2, 1).font = { bold: true, size: 14, color: { argb: "FF334155" } };

  const metaRows = [
    ["Report Period:", reportPeriod],
    ["Filter:", reportType === "overall" ? "All Documents" : humanizeLabel(reportType)],
    ["Total Documents:", String(totalRows)],
  ];
  metaRows.forEach(([label, value], index) => {
    const rowNumber = 4 + index;
    worksheet.getCell(rowNumber, 1).value = label;
    worksheet.getCell(rowNumber, 2).value = value;
    worksheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: "FF1E293B" } };
    worksheet.getCell(rowNumber, 2).font = { color: { argb: "FF334155" } };
    worksheet.getCell(rowNumber, 1).fill = META_LABEL_FILL;
    applyThinBorder(worksheet.getCell(rowNumber, 1));
    applyThinBorder(worksheet.getCell(rowNumber, 2));
  });

  const widthHints = Array.from({ length: totalColumns }, () => 10);
  let rowPointer = 8;
  sections.forEach((section, sectionIndex) => {
    if (section.title) {
      worksheet.mergeCells(rowPointer, 1, rowPointer, totalColumns);
      worksheet.getCell(rowPointer, 1).value = `${section.title} Section`;
      worksheet.getCell(rowPointer, 1).font = { bold: true, color: { argb: "FF0F172A" }, size: 12 };
      worksheet.getCell(rowPointer, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      worksheet.getCell(rowPointer, 1).alignment = { horizontal: "left", vertical: "middle" };
      applyThinBorder(worksheet.getCell(rowPointer, 1));
      rowPointer += 1;
    }

    const headerValues = ["No.", ...section.columns.map((columnKey) => humanizeLabel(columnKey))];
    const headerRow = worksheet.getRow(rowPointer);
    headerValues.forEach((value, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = value;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = BASE_HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      applyThinBorder(cell);
      widthHints[index] = Math.max(widthHints[index], String(value).length);
    });
    rowPointer += 1;

    section.rows.forEach((record, recordIndex) => {
      const row = worksheet.getRow(rowPointer);
      row.getCell(1).value = recordIndex + 1;
      row.getCell(1).alignment = { horizontal: "center" };
      applyThinBorder(row.getCell(1));
      widthHints[0] = Math.max(widthHints[0], 3);

      section.columns.forEach((columnKey, columnIndex) => {
        const rendered = formatCellValue(record[columnKey], columnKey);
        const cell = row.getCell(columnIndex + 2);
        cell.value = rendered;
        cell.alignment = { vertical: "middle", horizontal: columnKey === "status" ? "center" : "left" };
        applyThinBorder(cell);

        if (/status/i.test(columnKey)) applyStatusColor(cell, rendered);

        widthHints[columnIndex + 1] = Math.max(
          widthHints[columnIndex + 1],
          String(rendered || "").length,
        );
      });

      if (recordIndex % 2 === 1) {
        row.eachCell((cell) => {
          if (!cell.fill) cell.fill = ALT_ROW_FILL;
        });
      }
      rowPointer += 1;
    });

    if (sectionIndex < sections.length - 1) rowPointer += 1;
  });

  worksheet.views = [{ state: "frozen", ySplit: 8 }];
  setColumnWidths(worksheet, widthHints);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};
