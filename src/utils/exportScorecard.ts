/** ExcelJS export for the Safety Scorecard (GPSFMS-branded). */

import ExcelJS from "exceljs";
import type { ScorecardConfig, ScoredSubject } from "../types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF25477B" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };

export async function exportScorecard(
  rows: ScoredSubject[],
  config: ScorecardConfig,
  opts: {
    database: string;
    runBy: "vehicle" | "driver";
    unit: "km" | "miles";
    fromIso: string;
    toIso: string;
    generatedAt: string;
  }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const meta = wb.addWorksheet("Report Metadata");
  meta.addRows([
    ["Report", "VisionTrack Safety Scorecard"],
    ["Database", opts.database],
    ["Run by", opts.runBy],
    ["Distance unit", opts.unit],
    ["From", new Date(opts.fromIso).toLocaleString()],
    ["To", new Date(opts.toIso).toLocaleString()],
    ["Generated at", new Date(opts.generatedAt).toLocaleString()],
    [],
    ["Factor", "Weight", "Formula"],
    ...config.factors.map((f) => [f.label, `${Math.round(f.weight * 100)}%`, f.formula]),
    [],
    ["Bands", `Low ≥ ${config.bands.low}`, `Mild ≥ ${config.bands.mild}`, `Medium ≥ ${config.bands.medium}`],
  ]);
  meta.getColumn(1).width = 28;
  meta.getColumn(2).width = 20;
  meta.getColumn(3).width = 16;

  const sheet = wb.addWorksheet("Scorecard");
  const cols: Partial<ExcelJS.Column>[] = [
    { header: opts.runBy === "driver" ? "Driver" : "Vehicle", key: "name" },
    { header: "Group(s)", key: "group" },
    { header: `Distance (${opts.unit})`, key: "distance" },
    { header: "Total Score", key: "score" },
    { header: "Classification", key: "class" },
  ];
  config.factors.forEach((f) => {
    cols.push({ header: `${f.label} (#)`, key: `c_${f.key}` });
    cols.push({ header: `${f.label} (score)`, key: `s_${f.key}` });
  });
  sheet.columns = cols;

  for (const r of rows) {
    const row: Record<string, unknown> = {
      name: r.name,
      group: r.group,
      distance: r.distance,
      score: r.totalScore ?? "—",
      class: r.classification,
    };
    for (const f of r.factors) {
      row[`c_${f.key}`] = f.count;
      row[`s_${f.key}`] = f.subScore == null ? "—" : Math.round(f.subScore * 10) / 10;
    }
    sheet.addRow(row);
  }
  sheet.getRow(1).eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  // Open on the Scorecard sheet (index 1), not the metadata sheet.
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 16000, firstSheet: 0, activeTab: 1, visibility: "visible" },
  ];
  sheet.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = (cell.value == null ? "" : String(cell.value)).length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `safety-scorecard-${opts.database}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
