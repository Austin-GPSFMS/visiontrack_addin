/** Entry point for the Watchdog report page (watchdog.html). */

import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import ReportingApp from "./ReportingApp";
import type { GeotabApi, GeotabPageState } from "./types";
import "./styles.css";

declare global {
  interface Window {
    geotab?: {
      addin?: Record<string, () => {
        initialize: (api: GeotabApi, state: GeotabPageState, callback: () => void) => void;
        focus: (api: GeotabApi, state: GeotabPageState) => void;
        blur: () => void;
      }>;
    };
  }
}

let root: Root | null = null;
let currentApi: GeotabApi | null = null;

function mount() {
  const container = document.getElementById("root");
  if (!container) return;
  if (!root) root = createRoot(container);
  root.render(
    <StrictMode>
      <ReportingApp api={currentApi} />
    </StrictMode>
  );
}

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};
window.geotab.addin.visionTrackWatchdog = function () {
  return {
    initialize(api, _state, callback) {
      currentApi = api;
      try {
        mount();
      } catch (e) {
        console.error("[VT-watchdog] initialize failed:", e);
      }
      callback();
    },
    focus(api) {
      currentApi = api;
      mount();
    },
    blur() {},
  };
};

if (typeof window !== "undefined") {
  const t = window.setTimeout(() => {
    if (!root) mount();
  }, 500);
  const orig = window.geotab!.addin!.visionTrackWatchdog;
  window.geotab!.addin!.visionTrackWatchdog = function () {
    window.clearTimeout(t);
    return orig();
  };
}
