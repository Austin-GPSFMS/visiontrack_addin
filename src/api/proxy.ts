/**
 * Client for the GPSFMS VisionTrack proxy.
 *
 * The proxy is the ONLY thing that talks to api.autonomise.ai. It holds the
 * Autonomise OAuth client credentials and, on every request, re-derives the
 * caller's allowed vehicle set from their MyGeotab session before returning
 * any VisionTrack data. The browser sends its session credentials; it never
 * sees the Autonomise token and cannot bypass the scope filter.
 *
 * Configure the proxy base URL at build time via VITE_PROXY_BASE_URL, or it
 * falls back to the value below.
 */

import type {
  AssociationsResponse,
  CameraRule,
  DistListInput,
  DistributionList,
  EventMediaResponse,
  EventTrackResponse,
  EventsResponse,
  GeotabSession,
  PickerUser,
  RuleInput,
  RulesResponse,
  ScopedVehicle,
  DeviceChannel,
  VideoRequest,
  WatchdogResponse,
  ScorecardConfig,
  ScorecardRunResponse,
  GeotabRuleOption,
  PairOptionsResponse,
  PairRunResponse,
  CollisionsResponse,
  CollisionStatus,
  CollisionConfigResponse,
  CollisionMediaResponse,
  CollisionDetailResponse,
} from "../types";

const PROXY_BASE_URL: string =
  (import.meta.env.VITE_PROXY_BASE_URL as string | undefined) ??
  "https://visiontrack-proxy.gpsfms.com";

export interface EventsQuery {
  session: GeotabSession;
  /** Selected group IDs from the picker (subset of the user's scope). */
  groupIds: string[];
  fromDate: string; // ISO 8601 UTC
  toDate: string; // ISO 8601 UTC
  /** Optional VisionTrack EventType integer filters. */
  eventTypes?: number[];
  /** Optional EventClassification integer filters. */
  classifications?: number[];
  /** Optional: narrow to a single camera within scope. */
  hardwareId?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${PROXY_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const data = (await resp.json()) as { error?: string };
      detail = data.error ? `: ${data.error}` : "";
    } catch {
      /* ignore parse error */
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `Not authorized${detail}. Your MyGeotab session may have expired — refresh the page.`
      );
    }
    throw new Error(`Proxy request failed (${resp.status})${detail}`);
  }
  return (await resp.json()) as T;
}

/** Fetch group-scoped VisionTrack safety events via the proxy. */
export function fetchEvents(query: EventsQuery): Promise<EventsResponse> {
  return postJson<EventsResponse>("/api/events", query);
}

/** Vehicles within the caller's scope (Dashboard vehicle picker). */
export function fetchScopedVehicles(
  session: GeotabSession,
  groupIds?: string[]
): Promise<{ vehicles: ScopedVehicle[] }> {
  return postJson<{ vehicles: ScopedVehicle[] }>("/api/vehicles", { session, groupIds });
}

/** Watchdog: scoped vehicles with last Geotab + camera contact. */
export function fetchWatchdog(
  session: GeotabSession,
  groupIds?: string[]
): Promise<WatchdogResponse> {
  return postJson<WatchdogResponse>("/api/watchdog", { session, groupIds });
}

/** Scorecard: config + manage rights, save config, list Geotab rules, run. */
export function fetchScorecardConfig(
  session: GeotabSession
): Promise<{ config: ScorecardConfig; canManage: boolean }> {
  return postJson("/api/scorecard/config", { session });
}

export function saveScorecardConfig(
  session: GeotabSession,
  config: ScorecardConfig
): Promise<{ config: ScorecardConfig }> {
  return postJson("/api/scorecard/config/save", { session, config });
}

export function fetchScorecardRules(
  session: GeotabSession
): Promise<{ rules: GeotabRuleOption[] }> {
  return postJson("/api/scorecard/rules", { session });
}

export function runScorecard(params: {
  session: GeotabSession;
  fromDate: string;
  toDate: string;
  runBy: "vehicle" | "driver";
  unit: "km" | "miles";
  groupIds?: string[];
}): Promise<ScorecardRunResponse> {
  return postJson("/api/scorecard/run", params);
}

/** Camera channels for a scoped device (video-request form). */
export function fetchDeviceChannels(params: {
  session: GeotabSession;
  hardwareId: string;
  vehicleId?: string;
}): Promise<{ channels: DeviceChannel[] }> {
  return postJson<{ channels: DeviceChannel[] }>("/api/device-channels", params);
}

/** Submit an on-demand video clip request. */
export function requestVideo(params: {
  session: GeotabSession;
  hardwareId: string;
  vehicleId?: string;
  startDateTime: string;
  duration: number;
  channels: number[];
}): Promise<{ request: VideoRequest }> {
  return postJson<{ request: VideoRequest }>("/api/request-video", params);
}

/** List the caller's in-scope video requests (with refreshed status). */
export function fetchVideoRequests(
  session: GeotabSession
): Promise<{ requests: VideoRequest[] }> {
  return postJson<{ requests: VideoRequest[] }>("/api/video-requests", { session });
}

/** Fetch media (thumbnail/preview/video URLs) for one event. The proxy
 *  403s if the camera is outside the caller's group scope. */
/** Read-only camera↔vehicle association report, scoped to the caller. */
export function fetchAssociations(
  session: GeotabSession,
  groupIds?: string[]
): Promise<AssociationsResponse> {
  return postJson<AssociationsResponse>("/api/associations", { session, groupIds });
}

/** Collision Center: list scoped collisions (camera-equipped vehicles only). */
export function fetchCollisions(params: {
  session: GeotabSession;
  groupIds?: string[];
  fromDate?: string;
  toDate?: string;
}): Promise<CollisionsResponse> {
  return postJson<CollisionsResponse>("/api/collisions", params);
}

/** Set triage status on a collision (new/confirmed/dismissed). Gated. */
export function setCollisionTriage(params: {
  session: GeotabSession;
  collisionId: string;
  status: CollisionStatus;
  note?: string;
}): Promise<{ ok: true }> {
  return postJson("/api/collisions/triage", params);
}

/** Footage near a collision (VT events on the camera within ±windowSec). */
export function fetchCollisionMedia(params: {
  session: GeotabSession;
  hardwareId: string;
  vehicleId?: string;
  time: string;
  windowSec?: number;
}): Promise<CollisionMediaResponse> {
  return postJson<CollisionMediaResponse>("/api/collision-media", params);
}

/** Telematics detail around a collision: GPS track (speed/path) + ignition. */
export function fetchCollisionDetail(params: {
  session: GeotabSession;
  geotabDeviceId: string;
  time: string;
  beforeSec?: number;
  afterSec?: number;
}): Promise<CollisionDetailResponse> {
  return postJson<CollisionDetailResponse>("/api/collision-detail", params);
}

/** Collision sources config: which Geotab rules feed the Collision Center. */
export function fetchCollisionConfig(
  session: GeotabSession
): Promise<CollisionConfigResponse> {
  return postJson<CollisionConfigResponse>("/api/collisions/config", { session });
}

export function saveCollisionConfig(
  session: GeotabSession,
  ruleIds: string[]
): Promise<{ ok: true }> {
  return postJson("/api/collisions/config/save", { session, ruleIds });
}

/** Pairing tool: searchable Geotab units + VT cameras, and run a pairing. */
export function fetchPairOptions(
  session: GeotabSession
): Promise<PairOptionsResponse> {
  return postJson<PairOptionsResponse>("/api/pair/options", { session });
}

export function runPair(params: {
  session: GeotabSession;
  geotabDeviceId: string;
  cameraHardwareId: string;
  fuelType: string;
}): Promise<PairRunResponse> {
  return postJson<PairRunResponse>("/api/pair/run", params);
}

/** Detach a camera from its vehicle (back to the unassigned pool). */
export function runUnpair(params: {
  session: GeotabSession;
  cameraHardwareId: string;
}): Promise<{ ok: true; alreadyUnassigned: boolean }> {
  return postJson("/api/pair/unpair", params);
}

/** Camera Rules: list / save / delete (all scoped to the caller's database). */
export function fetchRules(session: GeotabSession): Promise<RulesResponse> {
  return postJson<RulesResponse>("/api/rules", { session });
}

export function saveRule(
  session: GeotabSession,
  rule: RuleInput
): Promise<{ rule: CameraRule }> {
  return postJson<{ rule: CameraRule }>("/api/rules/save", { session, rule });
}

export function deleteRule(
  session: GeotabSession,
  id: string
): Promise<{ deleted: boolean }> {
  return postJson<{ deleted: boolean }>("/api/rules/delete", { session, id });
}

/** Geotab users the caller can see, for the recipient picker. */
export function fetchRuleUsers(
  session: GeotabSession
): Promise<{ users: PickerUser[] }> {
  return postJson<{ users: PickerUser[] }>("/api/rules/users", { session });
}

/** Distribution list create/update + delete (admin-gated server-side). */
export function saveDistList(
  session: GeotabSession,
  list: DistListInput
): Promise<{ list: DistributionList }> {
  return postJson<{ list: DistributionList }>("/api/dist-lists/save", { session, list });
}

export function deleteDistList(
  session: GeotabSession,
  id: string
): Promise<{ deleted: boolean }> {
  return postJson<{ deleted: boolean }>("/api/dist-lists/delete", { session, id });
}

export function fetchEventMedia(params: {
  session: GeotabSession;
  eventId: string;
  hardwareId: string;
  vehicleId?: string;
}): Promise<EventMediaResponse> {
  return postJson<EventMediaResponse>("/api/event-media", params);
}

/** GPS breadcrumbs for a clip window (for the animated trip map). */
export function fetchEventTrack(params: {
  session: GeotabSession;
  hardwareId: string;
  vehicleId?: string;
  fromDate: string;
  toDate: string;
}): Promise<EventTrackResponse> {
  return postJson<EventTrackResponse>("/api/event-track", params);
}
