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

/** One GPS breadcrumb (proxy /api/event-track). */
export interface TrackPoint {
  t: string; // ISO timestamp
  lat: number;
  lon: number;
  speedKph?: number;
}

export interface EventTrackResponse {
  points: TrackPoint[];
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

/** Camera Rules (proxy /api/rules). */
export interface CameraRule {
  id: string;
  geotabDatabase: string;
  name: string;
  eventTypes: number[];
  groupIds: string[];
  recipients: string[];
  listIds: string[];
  enabled: boolean;
  cooldownMinutes: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  id?: string;
  name: string;
  eventTypes: number[];
  groupIds: string[];
  recipients: string[];
  listIds: string[];
  enabled: boolean;
  cooldownMinutes: number;
}

export interface DistributionList {
  id: string;
  geotabDatabase: string;
  name: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DistListInput {
  id?: string;
  name: string;
  members: string[];
}

export interface RulesResponse {
  rules: CameraRule[];
  distLists: DistributionList[];
  emailConfigured: boolean;
  ingestionConfigured: boolean;
  /** Full Administrator — sees all recipients + may add external emails. */
  isAdmin: boolean;
  /** GPSFMS - Manage Camera Rules: may flip alerts on/off + delete. */
  canManageRules: boolean;
  /** GPSFMS - Manage Camera Recipients: may edit recipients (scoped). */
  canManageRecipients: boolean;
}

export interface PickerUser {
  email: string;
  name: string;
}

export interface DeviceChannel {
  channel: number;
  label: string;
}

export interface WatchdogRow {
  geotabDeviceName: string;
  vrn?: string;
  geotabGroups: string;
  hardwareId?: string;
  geotabLastComm: string | null;
  cameraLastReported: string | null;
}

export interface WatchdogResponse {
  rows: WatchdogRow[];
  generatedAt: string;
}

// ---- Safety Scorecard ----
export type ScoreFactorKind = "geotab" | "camera";
export type ScoreFormula = "uniform" | "speeding" | "seatbelt";

export interface ScoreFactor {
  kind: ScoreFactorKind;
  key: string;
  label: string;
  weight: number;
  formula: ScoreFormula;
}

export interface ScorecardConfig {
  factors: ScoreFactor[];
  bands: { low: number; mild: number; medium: number };
}

export interface ScoredFactor {
  key: string;
  label: string;
  count: number;
  subScore: number | null;
}

export interface ScoredSubject {
  id: string;
  name: string;
  group: string;
  distance: number;
  totalScore: number | null;
  classification: string;
  factors: ScoredFactor[];
  totalOccurrences: number;
}

export interface ScorecardRunResponse {
  rows: ScoredSubject[];
  config: ScorecardConfig;
  unit: "km" | "miles";
  runBy: "vehicle" | "driver";
  generatedAt: string;
}

export interface GeotabRuleOption {
  id: string;
  name: string;
}

/** A submitted custom video request + its status. */
export interface VideoRequest {
  id: string;
  vehicleLabel?: string;
  hardwareId: string;
  startIso: string;
  duration: number;
  channels: number[];
  /** DeviceCommandState 0-7. */
  state?: number;
  media?: VtMedia[];
  error?: string;
  createdAt: string;
}

/** A scoped vehicle for the Dashboard vehicle picker. */
export interface ScopedVehicle {
  vehicleId?: string;
  hardwareId?: string;
  vrn?: string;
  geotabDeviceId: string;
  geotabDeviceName: string;
  geotabGroups: string;
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
