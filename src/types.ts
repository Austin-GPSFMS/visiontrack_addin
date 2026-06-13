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

/** One media entry for an event (proxy /api/event-media). `uri` is a
 *  pre-signed VisionTrack blob URL the browser loads directly.
 *  mediaType: 3=Video(mp4) 4=Preview(jpg) 5=Thumbnail(jpg). */
export interface VtMedia {
  id: string;
  uri: string;
  mimeType?: string;
  channel?: number;
  channelLabel?: string;
  dateCaptured?: string;
  hasAudio?: boolean;
  mediaType: number;
  firstFrameDateTime?: string;
  lastFrameDateTime?: string;
}

export interface EventMediaResponse {
  media: VtMedia[];
}

/** Device Association report (read-only) from /api/associations. */
export type AssociationStatus = "paired" | "no_camera" | "no_vt_match" | "no_vin";

export interface AssociationRow {
  geotabDeviceId: string;
  geotabDeviceName: string;
  geotabGroups: string;
  vinLast6: string;
  vtVehicleId?: string;
  vtVrn?: string;
  vtVin?: string;
  cameraHardwareId?: string;
  status: AssociationStatus;
}

export interface UnpairedCamera {
  id: string;
  hardwareId?: string;
  model?: number;
  enabled?: boolean;
}

export interface AssociationsResponse {
  rows: AssociationRow[];
  unpairedCameras: UnpairedCamera[];
  summary: {
    scopedDevices: number;
    paired: number;
    noCamera: number;
    noVtMatch: number;
    noVin: number;
    unpairedCameras: number;
  };
}

/** Notifications page (proxy /api/notifications-status). */
export interface NotificationItem {
  eventType: number;
  label: string;
  diagnosticId: string | null;
  diagnosticName: string;
  rules: Array<{ id: string; name: string }>;
}

export interface NotificationsStatusResponse {
  ingestionConfigured: boolean;
  items: NotificationItem[];
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
