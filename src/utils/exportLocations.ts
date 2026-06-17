/** ExcelJS export for the GPS vs Camera Location report (GPSFMS-branded). */

import ExcelJS from "exceljs";
import type { LatLon, PositionRow } from "../types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF25477B" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function keyOf(p: LatLon): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

export async function exportLocations(
  rows: PositionRow[],
  addresses: Map<string, string>,
  opts: { database: string; generatedAt: string }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const meta = wb.addWorksheet("Report Metadata");
  meta.addRows([
    ["Report", "VisionTrack GPS vs Camera Location"],
    ["Database", opts.database],
    ["Generated at", new Date(opts.generatedAt).toLocaleString()],
    ["Rows", rows.length],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.getColumn(1).width = 24;
  meta.getColumn(2).width = 44;

  const sheet = wb.addWorksheet("Locations");
  sheet.columns = [
    { header: "Vehicle", key: "name" },
    { header: "VRN", key: "vrn" },
    { header: "Group(s)", key: "groups" },
    { header: "Geotab Serial", key: "gserial" },
    { header: "Camera Serial", key: "cserial" },
    { header: "GPS Address", key: "gaddr" },
    { header: "GPS Lat", key: "glat" },
    { header: "GPS Lon", key: "glon" },
    { header: "GPS Time", key: "gtime" },
    { header: "Camera Address", key: "caddr" },
    { header: "Camera Lat", key: "clat" },
    { header: "Camera Lon", key: "clon" },
    { header: "Camera Time", key: "ctime" },
    { header: "Drift (ft)", key: "drift" },
  ];

  for (const r of rows) {
    sheet.addRow({
      name: r.geotabDeviceName,
      vrn: r.vrn ?? "",
      groups: r.geotabGroups,
      gserial: r.geotabSerial,
      cserial: r.cameraSerial,
      gaddr: r.gps ? addresses.get(keyOf(r.gps)) ?? "" : "",
      glat: r.gps?.lat ?? "",
      glon: r.gps?.lon ?? "",
      gtime: fmt(r.gps?.t ?? null),
      caddr: r.camera ? addresses.get(keyOf(r.camera)) ?? "" : "",
      clat: r.camera?.lat ?? "",
      clon: r.camera?.lon ?? "",
      ctime: fmt(r.camera?.t ?? null),
      drift: r.driftMeters == null ? "" : Math.round(r.driftMeters * 3.28084),
    });
  }

  sheet.getRow(1).eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "N1" };
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
  a.download = `gps-vs-camera-${opts.database}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
