import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3000';
    const routingUrl = process.env.ROUTING_API_URL || 'http://localhost:3100';
    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/api/routing/:path*',
        destination: `${routingUrl}/:path*`,
      },
      {
        source: '/api/auth/:path*',
        destination: `${backendUrl}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
