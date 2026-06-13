/**
 * Entry point for the Camera Rules page (notifications.html — filename kept for
 * deploy continuity; the page is "Camera Rules").
 */

import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import CameraRulesApp from "./NotificationsApp";
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
    console.error("[VT-rules] #root element not found");
    return;
  }
  if (!root) root = createRoot(container);
  root.render(
    <StrictMode>
      <CameraRulesApp api={currentApi} />
    </StrictMode>
  );
}

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};
window.geotab.addin.visionTrackCameraRules = function () {
  return {
    initialize(api, _state, callback) {
      currentApi = api;
      try {
        mount();
      } catch (e) {
        console.error("[VT-rules] initialize failed:", e);
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

if (typeof window !== "undefined") {
  const standaloneTimer = window.setTimeout(() => {
    if (!root) {
      console.warn("[VT-rules] No MyGeotab initialize() detected — standalone preview.");
      mount();
    }
  }, 500);

  const origInit = window.geotab!.addin!.visionTrackCameraRules;
  window.geotab!.addin!.visionTrackCameraRules = function () {
    window.clearTimeout(standaloneTimer);
    return origInit();
  };
}
