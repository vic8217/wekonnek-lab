import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // The workspace lockfile and shared node_modules live one directory above
    // the frontend package. Pinning this prevents Next.js from selecting an
    // unrelated lockfile in /home/victor as the workspace root.
    root: path.resolve(__dirname, '..'),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: '**.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: 'lab-media.wekonnek.biz',
      },
    ],
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3000';
    const routingUrl = process.env.ROUTING_API_URL || 'http://localhost:3100';
    return [
      // Legacy media may be stored with either historical path. Keep both
      // same-origin shapes working for every view while new uploads use Spaces.
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
      {
        source: '/api/uploads/:path*',
        destination: `${backendUrl}/api/uploads/:path*`,
      },
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
