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
