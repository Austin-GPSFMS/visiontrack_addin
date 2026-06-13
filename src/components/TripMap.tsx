/**
 * Trip map for the clip modal: draws the vehicle's GPS path (Geotab
 * breadcrumbs) on an OpenStreetMap Leaflet map and moves a directional arrow
 * along it, synced to video playback.
 *
 * Leaflet (+ its CSS) is imported here only; this whole module is lazy-loaded
 * by VideoModal, so it ships as its own chunk and never touches the grid.
 *
 * The marker position is driven imperatively from `playheadMs` (milliseconds
 * since `clipStartMs`) so video timeupdate events don't re-render the map.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint } from "../types";

export interface TripMapProps {
  points: TrackPoint[];
  /** Epoch ms corresponding to the video's currentTime = 0. */
  clipStartMs: number;
  /** Current playhead in ms since clipStartMs (drives the arrow). */
  playheadMs: number;
}

interface TimedPoint {
  ms: number;
  lat: number;
  lon: number;
}

function bearing(a: TimedPoint, b: TimedPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Position + heading at time `ms`, interpolating between breadcrumbs. */
function sampleAt(pts: TimedPoint[], ms: number): { lat: number; lon: number; heading: number } {
  if (pts.length === 1) return { lat: pts[0].lat, lon: pts[0].lon, heading: 0 };
  if (ms <= pts[0].ms) return { lat: pts[0].lat, lon: pts[0].lon, heading: bearing(pts[0], pts[1]) };
  const last = pts[pts.length - 1];
  if (ms >= last.ms) {
    return { lat: last.lat, lon: last.lon, heading: bearing(pts[pts.length - 2], last) };
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (ms >= a.ms && ms <= b.ms) {
      const f = b.ms === a.ms ? 0 : (ms - a.ms) / (b.ms - a.ms);
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        heading: bearing(a, b),
      };
    }
  }
  return { lat: last.lat, lon: last.lon, heading: 0 };
}

function arrowIcon(headingDeg: number): L.DivIcon {
  return L.divIcon({
    className: "vt-arrow-icon",
    html: `<div class="vt-arrow" style="transform: rotate(${headingDeg}deg)">▲</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function TripMap({ points, clipStartMs, playheadMs }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const timedRef = useRef<TimedPoint[]>([]);

  // Build the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const timed = points
      .map((p) => ({ ms: new Date(p.t).getTime(), lat: p.lat, lon: p.lon }))
      .filter((p) => Number.isFinite(p.ms))
      .sort((a, b) => a.ms - b.ms);
    timedRef.current = timed;
    if (timed.length === 0) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const latlngs = timed.map((p) => [p.lat, p.lon] as [number, number]);
    L.polyline(latlngs, { color: "#25477b", weight: 4, opacity: 0.85 }).addTo(map);
    if (latlngs.length === 1) map.setView(latlngs[0], 16);
    else map.fitBounds(L.latLngBounds(latlngs).pad(0.2));

    const start = sampleAt(timed, clipStartMs + playheadMs);
    markerRef.current = L.marker([start.lat, start.lon], {
      icon: arrowIcon(start.heading),
    }).addTo(map);

    mapRef.current = map;
    // Leaflet needs a size recalc once its container is laid out.
    setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Move the marker as the playhead advances (no re-render).
  useEffect(() => {
    const timed = timedRef.current;
    const marker = markerRef.current;
    if (!marker || timed.length === 0) return;
    const pos = sampleAt(timed, clipStartMs + playheadMs);
    marker.setLatLng([pos.lat, pos.lon]);
    marker.setIcon(arrowIcon(pos.heading));
  }, [playheadMs, clipStartMs]);

  if (points.length === 0) {
    return <div className="vt-map-empty">No GPS track available for this clip.</div>;
  }
  return <div ref={containerRef} className="vt-map" />;
}
