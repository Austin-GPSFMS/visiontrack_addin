/** ExcelJS export for the Watchdog report (GPSFMS-branded). */

import ExcelJS from "exceljs";
import type { WatchdogRow } from "../types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF25477B" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };

function fmt(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export async function exportWatchdog(
  rows: WatchdogRow[],
  opts: {
    database: string;
    thresholdLabel: string;
    generatedAt: string;
    isOffline: (r: WatchdogRow) => boolean;
  }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const meta = wb.addWorksheet("Report Metadata");
  meta.addRows([
    ["Report", "VisionTrack Watchdog (offline cameras)"],
    ["Database", opts.database],
    ["Offline threshold", opts.thresholdLabel],
    ["Generated at", new Date(opts.generatedAt).toLocaleString()],
    ["Rows", rows.length],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.getColumn(1).width = 24;
  meta.getColumn(2).width = 44;

  const sheet = wb.addWorksheet("Watchdog");
  sheet.columns = [
    { header: "Vehicle", key: "name" },
    { header: "VRN", key: "vrn" },
    { header: "Group(s)", key: "groups" },
    { header: "Camera last reported", key: "cam" },
    { header: "GO last comm", key: "go" },
    { header: "Status", key: "status" },
  ];
  for (const r of rows) {
    sheet.addRow({
      name: r.geotabDeviceName,
      vrn: r.vrn ?? "",
      groups: r.geotabGroups,
      cam: fmt(r.cameraLastReported),
      go: fmt(r.geotabLastComm),
      status: opts.isOffline(r) ? "Offline" : "Online",
    });
  }
  sheet.getRow(1).eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "F1" };
  // Open on the data sheet (index 1), not the metadata sheet.
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 16000, firstSheet: 0, activeTab: 1, visibility: "visible" },
  ];
  sheet.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const s = cell.value == null ? "" : String(cell.value);
      if (s.length > max) max = s.length;
    });
    col.width = Math.min(max + 2, 50);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `watchdog-${opts.database}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
