/** ExcelJS export for the Watchdog report (GPSFMS-branded). */

import ExcelJS from "exceljs";
import type { WatchdogRowView } from "../reports/WatchdogReport";
import { DIAGNOSIS_META } from "../reports/WatchdogReport";

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

function daysSince(iso: string | null): number | "" {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  return Number.isNaN(d) ? "" : Math.round(((Date.now() - d) / 86_400_000) * 10) / 10;
}

export async function exportWatchdog(
  rows: WatchdogRowView[],
  opts: {
    database: string;
    thresholdLabel: string;
    goStaleHours: number;
    siteFilter: string;
    diagnosisFilter: string;
    generatedAt: string;
  }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const counts = { camera: 0, go: 0, both: 0, ok: 0 };
  for (const r of rows) counts[r.diagnosis]++;

  const meta = wb.addWorksheet("Report Metadata");
  meta.addRows([
    ["Report", "VisionTrack Watchdog (camera / GO device health)"],
    ["Database", opts.database],
    ["Camera offline threshold", opts.thresholdLabel],
    ["GO stale threshold", `${opts.goStaleHours} hours`],
    ["Site filter", opts.siteFilter],
    ["Diagnosis filter", opts.diagnosisFilter],
    ["Generated at", new Date(opts.generatedAt).toLocaleString()],
    ["Rows", rows.length],
    [],
    ["Camera issue", counts.camera, DIAGNOSIS_META.camera.hint],
    ["GO issue", counts.go, DIAGNOSIS_META.go.hint],
    ["Both silent", counts.both, DIAGNOSIS_META.both.hint],
    ["OK", counts.ok, DIAGNOSIS_META.ok.hint],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.getColumn(1).width = 26;
  meta.getColumn(2).width = 44;
  meta.getColumn(3).width = 90;

  const sheet = wb.addWorksheet("Watchdog");
  sheet.columns = [
    { header: "Vehicle", key: "name" },
    { header: "VRN", key: "vrn" },
    { header: "Site / district", key: "site" },
    { header: "Group(s)", key: "groups" },
    { header: "Camera serial", key: "camera" },
    { header: "Camera last reported", key: "cam" },
    { header: "Camera days silent", key: "camDays" },
    { header: "GO last comm", key: "go" },
    { header: "GO days silent", key: "goDays" },
    { header: "Diagnosis", key: "diagnosis" },
  ];
  for (const r of rows) {
    sheet.addRow({
      name: r.geotabDeviceName,
      vrn: r.vrn ?? "",
      site: r.site === "—" ? "" : r.site,
      groups: r.geotabGroups,
      camera: r.hardwareId ?? "",
      cam: fmt(r.cameraLastReported),
      camDays: daysSince(r.cameraLastReported),
      go: fmt(r.geotabLastComm),
      goDays: daysSince(r.geotabLastComm),
      diagnosis: DIAGNOSIS_META[r.diagnosis].label,
    });
  }
  sheet.getRow(1).eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "J1" };
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
