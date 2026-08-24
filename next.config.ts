import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2"],
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "null",
    "**.localhost",
    "**.cursor.com",
    "**.cursor.sh",
  ],
};

export default nextConfig;
