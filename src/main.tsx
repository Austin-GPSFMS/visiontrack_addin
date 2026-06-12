/**
 * Entry point.
 *
 * MyGeotab calls a factory registered at
 *   window.geotab.addin.visionTrackEvents
 * which returns { initialize, focus, blur }.
 *
 *   initialize(api, state, callback) — page mounts; we create the React root.
 *   focus(api, state)                — page gains focus; re-render with fresh api/state.
 *   blur()                           — page loses focus; no-op.
 *
 * Standalone load (opening dist/index.html directly, outside MyGeotab) paints
 * a stub App so the page still renders during local development.
 */

import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import App from "./App";
import type { GeotabApi, GeotabPageState } from "./types";
import "./styles.css";

declare global {
  interface Window {
    geotab?: {
      addin?: Record<string, () => {
        initialize: (
          api: GeotabApi,
          state: GeotabPageState,
          callback: () => void
        ) => void;
        focus: (api: GeotabApi, state: GeotabPageState) => void;
        blur: () => void;
      }>;
    };
  }
}

let root: Root | null = null;
let currentApi: GeotabApi | null = null;
let currentState: GeotabPageState | null = null;

function mount() {
  const container = document.getElementById("root");
  if (!container) {
    console.error("[VT] #root element not found");
    return;
  }
  if (!root) {
    root = createRoot(container);
  }
  root.render(
    <StrictMode>
      <App api={currentApi} pageState={currentState} />
    </StrictMode>
  );
}

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};
window.geotab.addin.visionTrackEvents = function () {
  return {
    initialize(api, state, callback) {
      currentApi = api;
      currentState = state;
      try {
        mount();
      } catch (e) {
        console.error("[VT] initialize failed:", e);
      }
      callback();
    },
    focus(api, state) {
      currentApi = api;
      currentState = state;
      mount();
    },
    blur() {
      // No-op. Hook here if we ever need to cancel inflight requests.
    },
  };
};

// Standalone fallback for local dev outside MyGeotab.
if (typeof window !== "undefined") {
  const standaloneTimer = window.setTimeout(() => {
    if (!root) {
      console.warn("[VT] No MyGeotab initialize() detected — standalone preview.");
      mount();
    }
  }, 500);

  const origInit = window.geotab!.addin!.visionTrackEvents;
  window.geotab!.addin!.visionTrackEvents = function () {
    window.clearTimeout(standaloneTimer);
    return origInit();
  };
}
