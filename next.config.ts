import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Saving the units & monsters list sends whole stat blocks.
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
