/**
 * VisionTrack Events — group-scoped safety event viewer.
 *
 * Flow:
 *   1. On mount, read the MyGeotab session and the groups within the user's
 *      data scope (Geotab restricts both to what the user may see).
 *   2. The user picks a date range and a subset of their groups.
 *   3. We POST the session + selection to the proxy. The proxy re-derives the
 *      allowed vehicle set from the same session server-side, queries
 *      VisionTrack, filters to in-scope vehicles, and returns enriched events.
 *
 * The browser never holds the Autonomise token and cannot widen its own scope.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  DateRange,
  Dropdown,
  GET_LAST_SEVEN_DAYS_OPTION,
  GET_LAST_THIRTY_DAYS_OPTION,
  GET_LAST_MONTH_OPTION,
  GET_LAST_WEEK_OPTION,
  GET_THIS_MONTH_OPTION,
  GET_THIS_WEEK_OPTION,
  GET_TODAY_OPTION,
  GET_YESTERDAY_OPTION,
  type IDateRangeValue,
  type ISelectionItem,
} from "@geotab/zenith";
import type {
  EventsResponse,
  GeotabApi,
  GeotabGroup,
  GeotabPageState,
  GeotabSession,
} from "./types";
import { fetchScopedGroups, friendlyError, getSession } from "./api/geotab";
import { fetchEvents } from "./api/proxy";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { EventsTable } from "./components/EventsTable";
import { VideoGrid } from "./components/VideoGrid";
import { SAFETY_EVENT_ENTRIES } from "./utils/eventTypes";

interface AppProps {
  api: GeotabApi | null;
  pageState: GeotabPageState | null;
}

const dateRangeOptions = [
  GET_TODAY_OPTION(),
  GET_YESTERDAY_OPTION(),
  GET_THIS_WEEK_OPTION(),
  GET_LAST_WEEK_OPTION(),
  GET_THIS_MONTH_OPTION(),
  GET_LAST_MONTH_OPTION(),
  GET_LAST_SEVEN_DAYS_OPTION(),
  GET_LAST_THIRTY_DAYS_OPTION(),
];

// VisionTrack EventClassification (0-5) from the API reference.
const classificationItems: ISelectionItem[] = [
  { id: "all", name: "Classification: All" },
  { id: "1", name: "Classification: Incident" },
  { id: "2", name: "Classification: Near Miss" },
  { id: "3", name: "Classification: Coaching" },
  { id: "4", name: "Classification: False Positive" },
  { id: "5", name: "Classification: Exoneration" },
];

// Curated driver-safety event types (mirrors the VisionTrack portal).
// Empty selection = no type filter (all types).
const eventTypeItems: ISelectionItem[] = SAFETY_EVENT_ENTRIES.map((e) => ({
  id: String(e.id),
  name: e.name,
}));

function defaultRange(): IDateRangeValue {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return { from, to, label: "Last 7 Days" };
}

export default function App({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(new Map());
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(["GroupCompanyId"]);
  const [range, setRange] = useState<IDateRangeValue>(defaultRange);
  const [classification, setClassification] = useState<string>("all");
  const [eventTypes, setEventTypes] = useState<string[]>([]);

  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventsResponse | null>(null);
  const [view, setView] = useState<"videos" | "table">("videos");

  // Deep link from notification emails: #addin-…,eventId:<id> → auto-open clip.
  const deepLinkEventId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const m = window.location.hash.match(/eventId:([^,&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, []);

  // ---- Bootstrap: session + scoped groups -------------------------------
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const [sess, groups] = await Promise.all([
          getSession(api),
          fetchScopedGroups(api),
        ]);
        if (cancelled) return;
        setSession(sess);
        setGroupsById(groups);
      } catch (e) {
        if (!cancelled) setBootError(friendlyError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleRun = useCallback(async () => {
    if (!session) {
      setError("No MyGeotab session yet — open this add-in from within MyGeotab.");
      return;
    }
    if (!range.from || !range.to) {
      setError("Pick a date range first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const classifications =
        classification === "all" ? undefined : [Number(classification)];
      const resp = await fetchEvents({
        session,
        groupIds: selectedGroupIds,
        fromDate: range.from.toISOString(),
        toDate: range.to.toISOString(),
        eventTypes: eventTypes.length > 0 ? eventTypes.map(Number) : undefined,
        classifications,
      });
      setResult(resp);
    } catch (e) {
      setError(friendlyError(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [session, range, selectedGroupIds, classification, eventTypes]);

  // Arriving from a notification email → auto-load so the clip can open.
  useEffect(() => {
    if (session && deepLinkEventId && !result && !loading) {
      setView("videos");
      void handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deepLinkEventId]);

  // ---- Standalone (no MyGeotab) -----------------------------------------
  if (!api) {
    return (
      <div className="vt-empty">
        <h1>VisionTrack Dashboard</h1>
        <p>
          This add-in must be opened from within MyGeotab so it can read your
          session and group scope.
        </p>
      </div>
    );
  }

  if (bootError) {
    return (
      <Banner type="error">
        {bootError}
      </Banner>
    );
  }

  return (
    <div>
      <div className="vt-header">
        <h1>VisionTrack Dashboard</h1>
      </div>

      <p className="vt-scope-note">
        Showing only vehicles within your group scope
        {result
          ? ` — ${result.allowedVehicleCount} VisionTrack vehicle(s) matched across ${result.scopedDeviceCount} in-scope Geotab device(s).`
          : "."}
      </p>

      <div className="vt-toolbar">
        <GroupFilterPicker
          groupsById={groupsById}
          initialGroupIds={selectedGroupIds}
          onChange={setSelectedGroupIds}
          onError={(e) => setError(friendlyError(e))}
        />

        <DateRange
          value={range}
          onChange={setRange}
          withCalendar
          options={dateRangeOptions}
        />

        <Dropdown
          width={300}
          multiselect
          placeholder="Event type: All"
          dataItems={eventTypeItems}
          value={eventTypes}
          onChange={(selected: ISelectionItem[]) =>
            setEventTypes(selected.map((s) => String(s.id)))
          }
          errorHandler={(e) => setError(friendlyError(e))}
        />

        <Dropdown
          width={280}
          dataItems={classificationItems}
          value={[classification]}
          onChange={(selected: ISelectionItem[]) =>
            setClassification(String(selected[0]?.id ?? "all"))
          }
          errorHandler={(e) => setError(friendlyError(e))}
        />

        <div className="vt-spacer" />

        <Button type="primary" onClick={handleRun} disabled={loading}>
          {loading ? "Loading…" : "Load events"}
        </Button>
      </div>

      {error && (
        <Banner type="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {result && (
        <>
          <div className="vt-viewtoggle">
            <button
              className={view === "videos" ? "vt-viewbtn vt-viewbtn--active" : "vt-viewbtn"}
              onClick={() => setView("videos")}
            >
              Videos
            </button>
            <button
              className={view === "table" ? "vt-viewbtn vt-viewbtn--active" : "vt-viewbtn"}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          {view === "videos" && session ? (
            <VideoGrid
              session={session}
              events={result.events}
              autoOpenEventId={deepLinkEventId}
            />
          ) : (
            <EventsTable events={result.events} />
          )}
        </>
      )}
    </div>
  );
}
