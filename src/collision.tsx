/**
 * Entry point for the Collision Center page (collision.html).
 * Mirrors the other page entries; registers its own MyGeotab add-in factory.
 */

import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import CollisionApp from "./CollisionApp";
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
    console.error("[VT-collision] #root element not found");
    return;
  }
  if (!root) root = createRoot(container);
  root.render(
    <StrictMode>
      <CollisionApp api={currentApi} />
    </StrictMode>
  );
}

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};
window.geotab.addin.visionTrackCollision = function () {
  return {
    initialize(api, _state, callback) {
      currentApi = api;
      try {
        mount();
      } catch (e) {
        console.error("[VT-collision] initialize failed:", e);
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
      console.warn("[VT-collision] No MyGeotab initialize() detected — standalone preview.");
      mount();
    }
  }, 500);

  const origInit = window.geotab!.addin!.visionTrackCollision;
  window.geotab!.addin!.visionTrackCollision = function () {
    window.clearTimeout(standaloneTimer);
    return origInit();
  };
}
