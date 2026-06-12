/**
 * Promise wrappers around the callback-style MyGeotab Add-In API, plus the
 * session helper used to authenticate the proxy.
 *
 * IMPORTANT (grouping): we never trust the browser to enforce scope. We fetch
 * groups only to *render* a picker that matches what the user can see; the
 * proxy independently re-derives the allowed device/vehicle set from the
 * user's own MyGeotab session on every request. Geotab itself restricts
 * Get<Device> results to the caller's data scope, so a user can never widen
 * their view by tampering with the client.
 */

import type {
  GeotabApi,
  GeotabGroup,
  GeotabSession,
} from "../types";

const INTER_CALL_DELAY_MS = 50;

export function apiCall<T = unknown>(
  api: GeotabApi,
  method: string,
  params: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      api.call(
        method,
        params,
        (result) => setTimeout(() => resolve(result as T), INTER_CALL_DELAY_MS),
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function friendlyError(err: unknown): string {
  if (err == null) return "Unknown error.";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "InvalidUserException" || /InvalidUser/i.test(String(err))) {
      return "Session expired — refresh the MyGeotab page to re-authenticate.";
    }
    if (e.message) return e.message;
  }
  return String(err);
}

/**
 * Read the active MyGeotab session. The proxy needs { server, database,
 * userName, sessionId } so it can call the Geotab API *as this user* and let
 * Geotab enforce the user's group scope server-side.
 */
export function getSession(api: GeotabApi): Promise<GeotabSession> {
  return new Promise((resolve, reject) => {
    try {
      api.getSession((credentials, server) => {
        if (!credentials || !credentials.sessionId) {
          reject(new Error("No active MyGeotab session."));
          return;
        }
        resolve({
          server,
          database: credentials.database,
          userName: credentials.userName,
          sessionId: credentials.sessionId,
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fetch the groups visible to the current user, keyed by id. Because the call
 * runs under the user's session, Geotab only returns groups within their data
 * scope — exactly the set we want to offer in the picker.
 */
export async function fetchScopedGroups(
  api: GeotabApi
): Promise<Map<string, GeotabGroup>> {
  const groups = await apiCall<GeotabGroup[]>(api, "Get", {
    typeName: "Group",
    resultsLimit: 5000,
  });
  return new Map(groups.map((g) => [g.id, g]));
}
