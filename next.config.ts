import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that should NOT be bundled by Turbopack and instead resolved
  // at runtime via Node's CommonJS loader. Both pi-ai packages use dynamic
  // require() for provider modules (e.g. OpenRouter, Anthropic) that
  // Turbopack's static analyzer can't resolve — this manifests as an
  // "Expression is too dynamic" MODULE_NOT_FOUND that silently kills SSE
  // streams on chat turns (the runAgentStream path). The non-streaming
  // runAgent path tolerates it; streaming does not.
  serverExternalPackages: [
    "ws",
    "@mariozechner/pi-ai",
    "@mariozechner/pi-agent-core",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // HSTS only on API/page routes, not static assets
        source: "/((?!_next/static|_next/image).*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
