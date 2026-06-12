/**
 * VIN normalization helpers — kept in sync with the proxy's pairing logic and
 * the original watchdog Python script.
 *
 * The Geotab <-> VisionTrack pairing is done on the LAST 6 CHARACTERS of the
 * VIN (not the full VIN), because the two platforms frequently disagree on the
 * full string but reliably agree on the tail. This module exists on the client
 * only for display/diagnostic parity; the authoritative match runs server-side
 * in the proxy.
 */

/** Uppercase + trim a VIN-ish value; empty-ish values become "". */
export function normalizeVin(value: unknown): string {
  if (value == null) return "";
  const s = String(value).toUpperCase().trim();
  if (["", "NAN", "NONE", "NULL"].includes(s)) return "";
  return s;
}

/** Last 6 characters of a normalized VIN, or "" when there is no usable VIN. */
export function vinLast6(value: unknown): string {
  const v = normalizeVin(value);
  return v ? v.slice(-6) : "";
}
