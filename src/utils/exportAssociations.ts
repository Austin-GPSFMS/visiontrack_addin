/**
 * ExcelJS export for the Device Association report — same conventions as the
 * advanced_report_builder export (navy GPSFMS header, frozen header row,
 * autoFilter, autosized columns, metadata sheet).
 */

import ExcelJS from "exceljs";
import type { AssociationRow, AssociationsResponse } from "../types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF25477B" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFFFFFFF" },
  bold: true,
};

const STATUS_LABELS: Record<AssociationRow["status"], string> = {
  paired: "Camera paired",
  no_camera: "No camera on VT vehicle",
  no_vt_match: "No VisionTrack match",
  no_vin: "No usable VIN in Geotab",
};

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function autosize(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const s = cell.value == null ? "" : String(cell.value);
      if (s.length > max) max = s.length;
    });
    col.width = Math.min(max + 2, 60);
  });
}

export async function exportAssociations(
  data: AssociationsResponse,
  opts: { database: string; userName: string; groupNames?: string }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // ---- Metadata ----
  const meta = wb.addWorksheet("Report Metadata");
  meta.addRows([
    ["Report", "VisionTrack Device Association"],
    ["Database", opts.database],
    ["Run by", opts.userName],
    ["Group filter", opts.groupNames || "All groups in scope"],
    ["Generated at", new Date().toLocaleString()],
    [],
    ["Vehicles in scope", data.summary.scopedDevices],
    ["Camera paired", data.summary.paired],
    ["No camera on VT vehicle", data.summary.noCamera],
    ["No VisionTrack match", data.summary.noVtMatch],
    ["No usable VIN", data.summary.noVin],
    ["Unassigned cameras (org-wide)", data.summary.unpairedCameras],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.getColumn(1).width = 30;
  meta.getColumn(2).width = 40;

  // ---- Associations ----
  const sheet = wb.addWorksheet("Associations");
  sheet.columns = [
    { header: "Geotab vehicle", key: "geotabDeviceName" },
    { header: "Group(s)", key: "geotabGroups" },
    { header: "VIN tail", key: "vinLast6" },
    { header: "VT vehicle (VRN)", key: "vtVrn" },
    { header: "VT VIN", key: "vtVin" },
    { header: "Camera hardware ID", key: "cameraHardwareId" },
    { header: "Status", key: "status" },
  ];
  for (const r of data.rows) {
    sheet.addRow({
      geotabDeviceName: r.geotabDeviceName,
      geotabGroups: r.geotabGroups,
      vinLast6: r.vinLast6 || "",
      vtVrn: r.vtVrn ?? "",
      vtVin: r.vtVin ?? "",
      cameraHardwareId: r.cameraHardwareId ?? "",
      status: STATUS_LABELS[r.status],
    });
  }
  styleHeader(sheet);
  sheet.autoFilter = { from: "A1", to: "G1" };
  autosize(sheet);

  // ---- Unassigned cameras ----
  const cams = wb.addWorksheet("Unassigned Cameras");
  cams.columns = [
    { header: "Hardware ID", key: "hardwareId" },
    { header: "Model", key: "model" },
    { header: "Enabled", key: "enabled" },
  ];
  for (const c of data.unpairedCameras) {
    cams.addRow({
      hardwareId: c.hardwareId ?? c.id,
      model: c.model != null ? `Model ${c.model}` : "",
      enabled: c.enabled === false ? "No" : "Yes",
    });
  }
  styleHeader(cams);
  cams.autoFilter = { from: "A1", to: "C1" };
  autosize(cams);

  // Open on the Associations data sheet (index 1), not the metadata sheet.
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 16000, firstSheet: 0, activeTab: 1, visibility: "visible" },
  ];

  // ---- Download ----
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `device-association-${opts.database}-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
