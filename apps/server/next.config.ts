import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(process.cwd(), "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@swen/core"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  // The field app lives under /app/ (a PWA scope must end with a slash).
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // The field app (apps/field) is built into public/app as a single-page PWA.
    return [
      { source: "/app", destination: "/app/index.html" },
      { source: "/app/", destination: "/app/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The service worker must never be cached, or devices miss updates.
        source: "/app/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
