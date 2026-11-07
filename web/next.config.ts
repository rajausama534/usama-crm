import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge covered the user's name in the sidebar; it only exists in local dev.
  devIndicators: false,
};

export default nextConfig;
