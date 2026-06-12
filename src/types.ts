/**
 * Domain types for the VisionTrack add-in.
 *
 * The MyGeotab add-in API has no official TypeScript types, so we type the
 * surface we actually use and narrow at the boundaries.
 */

/** Callback-style MyGeotab API handed to the add-in by the host page. */
export interface GeotabApi {
  call: (
    method: string,
    params: unknown,
    success: (result: unknown) => void,
    failure: (err: unknown) => void
  ) => void;
  /**
   * Returns the active session. MyGeotab exposes this as
   * api.getSession(callback) where callback receives (credentials, server).
   */
  getSession: (
    callback: (
      credentials: GeotabCredentials,
      server: string
    ) => void
  ) => void;
}

/** The session credentials MyGeotab hands back from getSession. */
export interface GeotabCredentials {
  database: string;
  userName: string;
  sessionId: string;
}

/** Everything the proxy needs to re-derive the caller's scope server-side. */
export interface GeotabSession {
  server: string;
  database: string;
  userName: string;
  sessionId: string;
}

export interface GeotabPageState {
  getGroupFilter?: (cb: (groups: unknown) => void) => void;
  setGroupFilter?: (groups: unknown) => void;
  getState?: (cb: (state: unknown) => void) => void;
  setState?: (state: unknown) => void;
  translate?: (key: string) => string;
}

export interface GeotabGroup {
  id: string;
  name?: string;
  children?: Array<{ id: string }>;
}

export interface GeotabDevice {
  id: string;
  name?: string;
  serialNumber?: string;
  vehicleIdentificationNumber?: string;
  engineVehicleIdentificationNumber?: string;
  licensePlate?: string;
  activeFrom?: string;
  activeTo?: string;
  groups?: Array<{ id: string }>;
}

/**
 * A safety event as returned by the proxy. This is the VisionTrack /events
 * (and /eventNotes) shape, already filtered to the caller's group scope and
 * enriched with the matched Geotab device/group on the server.
 */
export interface VtEvent {
  id: string;
  triggerTime: string;
  receivedTime?: string;
  eventTypes: number[];
  eventTypeLabels?: string[];
  classification: number;
  classificationLabel?: string;
  status?: number;
  statusLabel?: string;
  hardwareId?: string;
  vehicleId?: string;
  vrn?: string;
  location?: string;
  speedKph?: number;
  speedLimitKph?: number;
  driverNote?: string;
  fleetManagerNote?: string;
  /** Enrichment added by the proxy from the matched Geotab device. */
  geotabDeviceId?: string;
  geotabDeviceName?: string;
  geotabGroups?: string;
}

/** Response envelope from the proxy /api/events endpoint. */
export interface EventsResponse {
  events: VtEvent[];
  /** How many in-scope vehicles the caller is allowed to see. */
  allowedVehicleCount: number;
  /** How many Geotab devices were in the caller's scope. */
  scopedDeviceCount: number;
  /** Total events before group filtering (for transparency / debugging). */
  totalBeforeFilter?: number;
  truncated?: boolean;
}
