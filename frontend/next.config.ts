import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Drug page sub-version stubs → canonical drug page
      { source: "/drugs/:id/v2",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/v3",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/v4",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/classic", destination: "/drugs/:id", permanent: true },
      // Standalone pages consolidated into /account
      { source: "/alerts",    destination: "/account", permanent: true },
      { source: "/watchlist", destination: "/account", permanent: true },
    ];
  },
};

export default nextConfig;
