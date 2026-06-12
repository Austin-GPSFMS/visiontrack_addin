import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the GPSFMS VisionTrack MyGeotab add-in.
 *
 * Hosted at:
 *   https://austin-gpsfms.github.io/visiontrack_addin/dist/index.html
 *
 * `base: ""` produces CLEAN relative asset paths in the built index.html
 * — the safest choice for MyGeotab add-ins, which load the page inside an
 * iframe whose document URL already carries the repo/dist prefix. Absolute
 * (`/`) paths get duplicated by the iframe loader; `./` paths can survive as
 * literal `/./` segments that GitHub Pages 404s on. Bare relative paths
 * resolve naturally against the document URL with no artifacts.
 */
export default defineConfig({
  base: "",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    assetsInlineLimit: 20480,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});
