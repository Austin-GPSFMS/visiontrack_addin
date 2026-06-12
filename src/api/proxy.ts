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
  EventMediaResponse,
  EventsResponse,
  GeotabSession,
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

/** Fetch media (thumbnail/preview/video URLs) for one event. The proxy
 *  403s if the camera is outside the caller's group scope. */
/** Read-only camera↔vehicle association report, scoped to the caller. */
export function fetchAssociations(
  session: GeotabSession,
  groupIds?: string[]
): Promise<AssociationsResponse> {
  return postJson<AssociationsResponse>("/api/associations", { session, groupIds });
}

export function fetchEventMedia(params: {
  session: GeotabSession;
  eventId: string;
  hardwareId: string;
  vehicleId?: string;
}): Promise<EventMediaResponse> {
  return postJson<EventMediaResponse>("/api/event-media", params);
}
