import path from "node:path";
import type { NextConfig } from "next";

const apiUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const repoRoot = path.join(__dirname, "../..");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  // next dev would otherwise write an AGENTS.md whose generated text breaks the repo's copy rules.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@docent/api-client"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
    // Next buffers request bodies on the /api rewrite and cuts them off at 10 MB by
    // default, which breaks knowledge uploads. The API allows 20 MB files; the extra
    // room covers multipart overhead, and the API still rejects anything larger.
    proxyClientMaxBodySize: "21mb",
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The browser only talks to /api on this origin, so the session cookie stays first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
