/** VisionTrack.Domain.Enums.EventType — transcribed from the live Swagger UI
 *  (api.autonomise.ai/docs, captured 2026-06-12). Mirrors proxy/src/enums.ts. */

export const EVENT_TYPE_LABELS: Record<number, string> = {
  0: "Undefined",
  1: "Unknown",
  2: "Speed",
  3: "Brake",
  4: "Accelerate",
  5: "Shock",
  6: "Turn",
  7: "Panic",
  8: "System",
  9: "Diagnostics",
  10: "Ignition On",
  11: "Ignition Off",
  12: "Video Request",
  13: "Fixed Speed",
  14: "GPS Fault",
  15: "Video Loss",
  16: "Storage Abnormal",
  17: "Camera Covered",
  18: "Fatigue",
  19: "Smoking",
  20: "Distraction",
  21: "No Driver",
  22: "Lane Departure",
  23: "Forward Collision Warning",
  24: "Left Hand Indicator",
  25: "Right Hand Indicator",
  26: "Vehicle Reversing",
  27: "Mobile Phone Warning",
  28: "Following Distance Warning",
  29: "Seatbelt Unfastened",
  30: "Pedestrian Collision",
  31: "Blind Spot Detection",
  32: "Black Event",
  33: "Blind Spot Detection Rear",
  34: "Blind Spot Detection Left",
  35: "Blind Spot Detection Front",
  36: "Blind Spot Detection Right",
  37: "Pedestrian Detection Rear",
  38: "Pedestrian Detection Left",
  39: "Pedestrian Detection Front",
  40: "Pedestrian Detection Right",
  41: "Pedestrian Detection",
  42: "Illegal Shutdown",
  43: "Solid Line Violation",
  44: "Privacy Glasses Detected",
  45: "Stop Sign Violation",
  46: "Right Side Intrusion",
  47: "Frequent Lane Changes",
  48: "Drowsy Eyes Detected",
  49: "Low Bridge Warning",
  50: "Physiological Fatigue",
};

/**
 * Driver-safety event types worth showing in filters/rules — mirrors the
 * VisionTrack portal's event list. Excludes housekeeping/system types
 * (Undefined, Unknown, System, Diagnostics, Ignition On/Off, Video Request,
 * Fixed Speed, GPS Fault, Video Loss, Storage Abnormal, Camera Covered,
 * Black Event).
 */
export const SAFETY_EVENT_TYPES: number[] = [
  2, 3, 4, 5, 6, 7, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
];

/** {id,name} entries for the safety types, alphabetised by label. */
export const SAFETY_EVENT_ENTRIES = SAFETY_EVENT_TYPES.map((id) => ({
  id,
  name: EVENT_TYPE_LABELS[id],
})).sort((a, b) => a.name.localeCompare(b.name));
