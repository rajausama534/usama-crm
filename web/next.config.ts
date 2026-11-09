import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge covered the user's name in the sidebar; it only exists in local dev.
  devIndicators: false,
  // Addresses from the old CRM that people have saved or that the Chrome extension opens.
  async redirects() {
    return [
      { source: "/unit-finder.html", destination: "/unit-finder", permanent: true },
      { source: "/owner-finder", destination: "/market/owner-finder", permanent: true },
      { source: "/owner-finder.html", destination: "/market/owner-finder", permanent: true },
      { source: "/cluster-guide", destination: "/market/cluster-guide", permanent: true },
      { source: "/cluster-guide.html", destination: "/market/cluster-guide", permanent: true },
    ];
  },
  // Client links already sent on WhatsApp must keep working, without a login.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/breakdown.html", destination: "/share/breakdown" },
        { source: "/breakdown", has: [{ type: "query", key: "d" }], destination: "/share/breakdown" },
        { source: "/breakdown", has: [{ type: "query", key: "data" }], destination: "/share/breakdown" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
