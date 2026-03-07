let cachedExcelJs = null;

const getExcelJs = async () => {
  if (cachedExcelJs) return cachedExcelJs;
  const mod = await import("exceljs");
  cachedExcelJs = mod.default || mod;
  return cachedExcelJs;
};

const FONT_FAMILY = "Calibri";
const STATUS_COLUMNS = new Set(["status", "attempt1_status", "attempt2_status"]);

const COLORS = {
  brand: "FFB91C1C",
  brandDark: "FF7F1D1D",
  white: "FFFFFFFF",
  slate900: "FF0F172A",
  slate700: "FF334155",
  slate500: "FF64748B",
  slate300: "FFCBD5E1",
  slate200: "FFE2E8F0",
  slate100: "FFF1F5F9",
  rowAlt: "FFF8FAFC",
  successBg: "FFDCFCE7",
  successText: "FF166534",
  dangerBg: "FFFEE2E2",
  dangerText: "FF991B1B",
  warnBg: "FFFEF3C7",
  warnText: "FF92400E",
  infoBg: "FFDBEAFE",
  infoText: "FF1E40AF",
};

const fillSolid = (argb) => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

const borderThin = (argb = COLORS.slate200) => ({
  top: { style: "thin", color: { argb } },
  left: { style: "thin", color: { argb } },
  bottom: { style: "thin", color: { argb } },
  right: { style: "thin", color: { argb } },
});

const styles = {
  banner: {
    fill: fillSolid(COLORS.brand),
    font: { name: FONT_FAMILY, bold: true, size: 15, color: { argb: COLORS.white } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: borderThin(COLORS.brandDark),
  },
  sectionHeading: {
    fill: fillSolid(COLORS.slate900),
    font: { name: FONT_FAMILY, bold: true, size: 10.5, color: { argb: COLORS.white } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: borderThin(COLORS.slate900),
  },
  metaLabel: {
    fill: fillSolid(COLORS.slate100),
    font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.slate700 } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: borderThin(COLORS.slate200),
  },
  metaValue: {
    fill: fillSolid(COLORS.white),
    font: { name: FONT_FAMILY, size: 9, color: { argb: COLORS.slate900 } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: borderThin(COLORS.slate200),
  },
  kpiLabel: {
    fill: fillSolid(COLORS.slate100),
    font: { name: FONT_FAMILY, bold: true, size: 8.5, color: { argb: COLORS.slate500 } },
    alignment: { horizontal: "left", vertical: "bottom" },
    border: borderThin(COLORS.slate200),
  },
  kpiValue: {
    fill: fillSolid(COLORS.white),
    font: { name: FONT_FAMILY, bold: true, size: 13, color: { argb: COLORS.slate900 } },
    alignment: { horizontal: "left", vertical: "top" },
    border: borderThin(COLORS.slate200),
  },
  tableHeader: {
    fill: fillSolid(COLORS.brand),
    font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.white } },
    alignment: { horizontal: "left", vertical: "middle", wrapText: true },
    border: borderThin(COLORS.brandDark),
  },
  tableRow: {
    fill: fillSolid(COLORS.white),
    font: { name: FONT_FAMILY, size: 9, color: { argb: COLORS.slate900 } },
    alignment: { horizontal: "left", vertical: "middle", wrapText: true },
    border: borderThin(COLORS.slate200),
  },
  tableRowAlt: {
    fill: fillSolid(COLORS.rowAlt),
    font: { name: FONT_FAMILY, size: 9, color: { argb: COLORS.slate900 } },
    alignment: { horizontal: "left", vertical: "middle", wrapText: true },
    border: borderThin(COLORS.slate200),
  },
  emptyState: {
    fill: fillSolid(COLORS.rowAlt),
    font: { name: FONT_FAMILY, italic: true, size: 9, color: { argb: COLORS.slate500 } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: borderThin(COLORS.slate200),
  },
};

const applyStyle = (cell, style) => {
  if (!style) return;
  if (style.fill) cell.fill = style.fill;
  if (style.font) cell.font = style.font;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
  if (style.numFmt) cell.numFmt = style.numFmt;
};

const setCell = (worksheet, row, col, value, style) => {
  const cell = worksheet.getCell(row, col);
  cell.value = value == null ? "" : value;
  applyStyle(cell, style);
  return cell;
};

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

const formatDateRange = (start, end) => {
  if (!start && !end) return "All time";
  const fmt = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };
  return `${fmt(start)} - ${fmt(end)}`;
};

const statusStyleFor = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.includes("deliver") || normalized.includes("success")) {
    return {
      fill: fillSolid(COLORS.successBg),
      font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.successText } },
    };
  }
  if (normalized.includes("cancel")) {
    return {
      fill: fillSolid(COLORS.dangerBg),
      font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.dangerText } },
    };
  }
  if (normalized.includes("fail")) {
    return {
      fill: fillSolid(COLORS.warnBg),
      font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.warnText } },
    };
  }
  if (normalized.includes("pending") || normalized.includes("progress")) {
    return {
      fill: fillSolid(COLORS.infoBg),
      font: { name: FONT_FAMILY, bold: true, size: 9, color: { argb: COLORS.infoText } },
    };
  }
  return null;
};

const getColumnWidth = (rows, columnKey, humanizeLabel) => {
  const header = String(humanizeLabel(columnKey) || columnKey || "").length;
  const maxData = rows.reduce(
    (max, row) => Math.max(max, String(formatCellValue(row[columnKey], columnKey) || "").length),
    0,
  );
  return Math.min(Math.max(header, maxData) + 3, 45);
};

const sanitizeSheetName = (name, fallback = "Sheet") => {
  const text = String(name || fallback)
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 31);
};

const writeKpiGrid = (worksheet, startRow, summaryRows) => {
  const cardsPerRow = 3;
  let row = startRow;

  for (let index = 0; index < summaryRows.length; index += cardsPerRow) {
    const chunk = summaryRows.slice(index, index + cardsPerRow);

    chunk.forEach(([label], chunkIndex) => {
      const col = chunkIndex * 2 + 1;
      worksheet.mergeCells(row, col, row, col + 1);
      setCell(worksheet, row, col, label, styles.kpiLabel);
    });
    worksheet.getRow(row).height = 16;
    row += 1;

    chunk.forEach(([, value], chunkIndex) => {
      const col = chunkIndex * 2 + 1;
      worksheet.mergeCells(row, col, row, col + 1);
      setCell(worksheet, row, col, String(value ?? ""), styles.kpiValue);
    });
    worksheet.getRow(row).height = 24;
    row += 1;
  }

  return row;
};

const buildSummarySheet = (workbook, options) => {
  const {
    reportType,
    selectedColumn,
    startDate,
    endDate,
    generatedBy,
    humanizeLabel,
    reportAnalytics,
  } = options;

  const worksheet = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  worksheet.columns = Array.from({ length: 6 }, () => ({ width: 22 }));

  worksheet.mergeCells(1, 1, 1, 6);
  setCell(worksheet, 1, 1, `${humanizeLabel(reportType)} Report`, styles.banner);
  worksheet.getRow(1).height = 30;

  const metaRows = [
    ["Report Type", humanizeLabel(reportType)],
    ["Date Range", formatDateRange(startDate, endDate)],
    ...(reportType === "parcels" ? [["Column Scope", humanizeLabel(selectedColumn || "all")]] : []),
    ["Generated By", generatedBy || "Unknown User"],
    [
      "Generated At",
      new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    ],
  ];

  let row = 3;
  metaRows.forEach(([label, value]) => {
    setCell(worksheet, row, 1, label, styles.metaLabel);
    worksheet.mergeCells(row, 2, row, 6);
    setCell(worksheet, row, 2, value, styles.metaValue);
    worksheet.getRow(row).height = 20;
    row += 1;
  });

  row += 1;
  worksheet.mergeCells(row, 1, row, 6);
  setCell(worksheet, row, 1, "Key Metrics", styles.sectionHeading);
  worksheet.getRow(row).height = 22;
  row += 1;

  if (reportType === "overall" && reportAnalytics?.sections?.length) {
    reportAnalytics.sections.forEach((section) => {
      worksheet.mergeCells(row, 1, row, 6);
      setCell(worksheet, row, 1, `${section.title} Summary`, styles.metaLabel);
      worksheet.getRow(row).height = 20;
      row += 1;

      if (section.summaryRows?.length) {
        row = writeKpiGrid(worksheet, row, section.summaryRows);
        row += 1;
      }
    });
  } else if (reportAnalytics?.summaryRows?.length) {
    row = writeKpiGrid(worksheet, row, reportAnalytics.summaryRows);
  }
};

const writeChartDataTable = (worksheet, startRow, chart) => {
  if (!chart?.labels?.length) return startRow;

  let row = startRow;
  worksheet.mergeCells(row, 1, row, 4);
  setCell(worksheet, row, 1, chart.title || "Chart Data", styles.metaLabel);
  worksheet.getRow(row).height = 20;
  row += 1;

  setCell(worksheet, row, 1, "Label", styles.tableHeader);
  setCell(worksheet, row, 2, chart.datasetLabel || "Value", styles.tableHeader);
  worksheet.getRow(row).height = 18;
  row += 1;

  chart.labels.forEach((label, index) => {
    const baseStyle = index % 2 === 0 ? styles.tableRow : styles.tableRowAlt;
    setCell(worksheet, row, 1, String(label), baseStyle);
    setCell(worksheet, row, 2, String(chart.values?.[index] ?? 0), {
      ...baseStyle,
      font: { ...baseStyle.font, bold: true },
    });
    worksheet.getRow(row).height = 17;
    row += 1;
  });

  return row + 1;
};

const buildChartsSheet = (workbook, reportChartImages, reportAnalytics) => {
  const worksheet = workbook.addWorksheet("Charts");
  worksheet.columns = Array.from({ length: 8 }, () => ({ width: 16 }));

  worksheet.mergeCells(1, 1, 1, 8);
  setCell(worksheet, 1, 1, "Charts and Visualizations", styles.banner);
  worksheet.getRow(1).height = 28;

  let row = 3;
  (reportChartImages || []).slice(0, 8).forEach((chartImage, index) => {
    worksheet.mergeCells(row, 1, row, 8);
    setCell(worksheet, row, 1, chartImage.title || `Chart ${index + 1}`, styles.sectionHeading);
    worksheet.getRow(row).height = 20;
    row += 1;

    if (chartImage?.dataUrl) {
      try {
        const imageId = workbook.addImage({
          base64: chartImage.dataUrl,
          extension: "png",
        });
        worksheet.addImage(imageId, {
          tl: { col: 0.2, row: row - 0.85 },
          br: { col: 7.8, row: row + 14.5 },
        });

        for (let offset = 0; offset < 15; offset += 1) {
          worksheet.getRow(row + offset).height = 20;
        }
        row += 15;
      } catch {
        worksheet.mergeCells(row, 1, row, 8);
        setCell(worksheet, row, 1, "Unable to render chart image.", styles.emptyState);
        worksheet.getRow(row).height = 20;
        row += 1;
      }
    } else {
      worksheet.mergeCells(row, 1, row, 8);
      setCell(worksheet, row, 1, "No chart image available.", styles.emptyState);
      worksheet.getRow(row).height = 20;
      row += 1;
    }

    row += 1;
  });

  const allCharts = reportAnalytics?.sections
    ? reportAnalytics.sections.flatMap((section) => section?.charts || [])
    : reportAnalytics?.charts || [];

  if (allCharts.length) {
    worksheet.mergeCells(row, 1, row, 8);
    setCell(worksheet, row, 1, "Chart Data Tables", styles.sectionHeading);
    worksheet.getRow(row).height = 22;
    row += 2;

    allCharts.slice(0, 10).forEach((chart) => {
      row = writeChartDataTable(worksheet, row, chart);
    });
  }
};

const buildDataSheet = (workbook, rows, columns, humanizeLabel, sheetTitle) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const resolvedColumns =
    Array.isArray(columns) && columns.length
      ? columns
      : Object.keys(safeRows[0] || {});
  const columnsToUse = resolvedColumns.length ? resolvedColumns : ["value"];
  const totalColumns = columnsToUse.length;

  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetTitle, "Data"), {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  worksheet.columns = columnsToUse.map((columnKey) => ({
    key: columnKey,
    width: getColumnWidth(safeRows, columnKey, humanizeLabel),
  }));

  worksheet.mergeCells(1, 1, 1, totalColumns);
  setCell(worksheet, 1, 1, sheetTitle, styles.banner);
  worksheet.getRow(1).height = 26;

  columnsToUse.forEach((columnKey, columnIndex) => {
    setCell(worksheet, 2, columnIndex + 1, humanizeLabel(columnKey), styles.tableHeader);
  });
  worksheet.getRow(2).height = 20;

  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: totalColumns },
  };

  if (!safeRows.length) {
    worksheet.mergeCells(3, 1, 3, totalColumns);
    setCell(worksheet, 3, 1, "No rows found for the selected filters.", styles.emptyState);
    worksheet.getRow(3).height = 20;
    return;
  }

  safeRows.forEach((record, rowIndex) => {
    const targetRow = rowIndex + 3;
    const baseRowStyle = rowIndex % 2 === 0 ? styles.tableRow : styles.tableRowAlt;

    columnsToUse.forEach((columnKey, columnIndex) => {
      const formattedValue = formatCellValue(record[columnKey], columnKey);
      const cell = setCell(worksheet, targetRow, columnIndex + 1, formattedValue, baseRowStyle);

      if (STATUS_COLUMNS.has(columnKey)) {
        const tone = statusStyleFor(formattedValue);
        if (tone) {
          applyStyle(cell, {
            ...baseRowStyle,
            fill: tone.fill,
            font: tone.font,
            alignment: { horizontal: "center", vertical: "middle", wrapText: true },
          });
        }
      }
    });

    worksheet.getRow(targetRow).height = 18;
  });
};

const downloadWorkbook = async (workbook, fileName) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportReportAsWorkbook = async ({
  reportType,
  selectedColumn,
  startDate,
  endDate,
  data,
  columns,
  reportAnalytics,
  reportChartImages,
  generatedBy,
  humanizeLabel,
  resolveSectionColumns,
  fileName = "report.xlsx",
}) => {
  const ExcelJS = await getExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy || "AVID Logistics";
  workbook.created = new Date();
  workbook.modified = new Date();

  buildSummarySheet(workbook, {
    reportType,
    selectedColumn,
    startDate,
    endDate,
    generatedBy,
    humanizeLabel,
    reportAnalytics,
  });

  if (
    (reportChartImages && reportChartImages.length) ||
    reportAnalytics?.charts?.length ||
    reportAnalytics?.sections?.length
  ) {
    buildChartsSheet(workbook, reportChartImages || [], reportAnalytics);
  }

  if (reportType === "overall" && Array.isArray(data)) {
    data.forEach((section) => {
      if (!section?.data?.length) return;
      const sectionColumns = resolveSectionColumns(section.section);
      buildDataSheet(
        workbook,
        section.data,
        sectionColumns,
        humanizeLabel,
        section.section || "Section Data",
      );
    });
  } else if (Array.isArray(data)) {
    buildDataSheet(
      workbook,
      data,
      columns,
      humanizeLabel,
      humanizeLabel(reportType),
    );
  }

  await downloadWorkbook(workbook, fileName);
};
