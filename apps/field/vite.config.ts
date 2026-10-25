import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The field app is served at /app/ by the Swen server (built into
 * apps/server/public/app), so one deployment serves both the dashboard and
 * the tablet app from the same origin.
 */
export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      filename: "sw.js",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Swen — siy vital ak materyèl",
        short_name: "Swen",
        description: "Offline-first vitals (MEWS) and supply inventory",
        lang: "ht",
        start_url: "/app/index.html",
        scope: "/app/",
        display: "standalone",
        orientation: "any",
        background_color: "#f4f6f9",
        theme_color: "#12357a",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/app/index.html",
        navigateFallbackAllowlist: [/^\/app\//],
        // Never cache the API: data lives in IndexedDB and sync handles offline.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    outDir: fileURLToPath(new URL("../server/public/app", import.meta.url)),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    // During development, forward the API to the Next.js server.
    proxy: { "/api": "http://localhost:3000" },
  },
});
