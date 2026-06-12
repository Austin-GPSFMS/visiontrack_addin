/**
 * Zenith Table of VisionTrack safety events, already group-filtered by the
 * proxy. Same sortable + flexible-columns pattern as the report builder so
 * the list feels native to MyGeotab.
 */

import { useMemo, useState } from "react";
import { Table, ColumnSortDirection, type IListColumn } from "@geotab/zenith";
import type { VtEvent } from "../types";

interface ISortableValue {
  sortColumn: string;
  sortDirection: ColumnSortDirection;
}

interface EventEntity extends VtEvent {
  // VtEvent already has a string `id`.
  _trigger: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sortEntities(
  rows: EventEntity[],
  sort: ISortableValue | undefined
): EventEntity[] {
  if (!sort) return rows;
  const { sortColumn, sortDirection } = sort;
  const dir = sortDirection === ColumnSortDirection.Descending ? -1 : 1;
  const cmp = (a: EventEntity, b: EventEntity): number => {
    const av = (a as unknown as Record<string, unknown>)[sortColumn];
    const bv = (b as unknown as Record<string, unknown>)[sortColumn];
    const aEmpty = av == null || av === "";
    const bEmpty = bv == null || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  };
  return [...rows].sort(cmp);
}

const COLUMNS: Array<{ id: keyof EventEntity | string; title: string; width?: number }> = [
  { id: "_trigger", title: "Trigger time", width: 170 },
  { id: "geotabDeviceName", title: "Vehicle (Geotab)", width: 170 },
  { id: "vrn", title: "Reg / VRN", width: 110 },
  { id: "geotabGroups", title: "Group(s)", width: 180 },
  { id: "eventTypeLabel", title: "Event type", width: 150 },
  { id: "classificationLabel", title: "Classification", width: 130 },
  { id: "statusLabel", title: "Status", width: 110 },
  { id: "location", title: "Location", width: 220 },
  { id: "speedKph", title: "Speed (kph)", width: 100 },
];

function buildColumns(): IListColumn<EventEntity>[] {
  return COLUMNS.map((c) => ({
    id: String(c.id),
    title: c.title,
    sortable: true,
    meta: { defaultWidth: c.width ?? 140 },
    columnComponent: {
      render: (e: EventEntity) => {
        const rec = e as unknown as Record<string, unknown>;
        if (c.id === "eventTypeLabel") {
          return (e.eventTypeLabels ?? []).join(", ") || e.eventTypes.join(", ");
        }
        const v = rec[String(c.id)];
        return v == null ? "" : String(v);
      },
    },
  }));
}

export interface EventsTableProps {
  events: VtEvent[];
  pageName?: string;
}

export function EventsTable({ events, pageName = "vt-events" }: EventsTableProps) {
  const entities = useMemo<EventEntity[]>(
    () =>
      events.map((e) => ({
        ...e,
        _trigger: fmtDate(e.triggerTime),
      })),
    [events]
  );

  const columns = useMemo(() => buildColumns(), []);
  const [sortValue, setSortValue] = useState<ISortableValue | undefined>(undefined);
  const sorted = useMemo(() => sortEntities(entities, sortValue), [entities, sortValue]);

  return (
    <Table
      entities={sorted}
      columns={columns}
      sortable={{
        pageName: pageName + "-sort",
        value: sortValue,
        onChange: setSortValue,
      }}
      flexible={{
        pageName: pageName + "-columns",
        columnsPopup: true,
      }}
      height="60vh"
    >
      <Table.Empty>No events for the selected groups and date range.</Table.Empty>
    </Table>
  );
}
