/**
 * Entry point for the Device Association page (association.html).
 * Mirrors main.tsx but registers its own MyGeotab add-in factory.
 */

import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import AssociationApp from "./AssociationApp";
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

function mount() {
  const container = document.getElementById("root");
  if (!container) {
    console.error("[VT-assoc] #root element not found");
    return;
  }
  if (!root) {
    root = createRoot(container);
  }
  root.render(
    <StrictMode>
      <AssociationApp api={currentApi} />
    </StrictMode>
  );
}

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};
window.geotab.addin.visionTrackAssociation = function () {
  return {
    initialize(api, _state, callback) {
      currentApi = api;
      try {
        mount();
      } catch (e) {
        console.error("[VT-assoc] initialize failed:", e);
      }
      callback();
    },
    focus(api) {
      currentApi = api;
      mount();
    },
    blur() {
      // No-op.
    },
  };
};

// Standalone fallback for local dev outside MyGeotab.
if (typeof window !== "undefined") {
  const standaloneTimer = window.setTimeout(() => {
    if (!root) {
      console.warn("[VT-assoc] No MyGeotab initialize() detected — standalone preview.");
      mount();
    }
  }, 500);

  const origInit = window.geotab!.addin!.visionTrackAssociation;
  window.geotab!.addin!.visionTrackAssociation = function () {
    window.clearTimeout(standaloneTimer);
    return origInit();
  };
}
