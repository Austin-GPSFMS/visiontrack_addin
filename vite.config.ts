import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the GPSFMS VisionTrack MyGeotab add-in.
 *
 * Hosted at:
 *   https://austin-gpsfms.github.io/visiontrack_addin/dist/index.html
 *
 * `base` MUST be the absolute Pages URL: MyGeotab does not iframe the
 * add-in — it fetches index.html and injects it into the my.geotab.com page,
 * so relative asset paths resolve against my.geotab.com and 404 (observed:
 * zenith's en.json + icon.svg failing, page rendering unstyled). An absolute
 * base makes every emitted asset URL self-contained.
 */
export default defineConfig({
  base: "https://austin-gpsfms.github.io/visiontrack_addin/dist/",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    assetsInlineLimit: 20480,
    rollupOptions: {
      input: {
        index: "index.html",
        association: "association.html",
      },
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
