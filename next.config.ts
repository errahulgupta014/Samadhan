import type { NextConfig } from "next";

/**
 * Address layout (see docs/DEPLOYMENT.md):
 *   test.smadhan.com/      the administrator portal (sign-in, then the portal)
 *   test.smadhan.com/app/  the resident app in the browser (static export in public/app)
 * Older addresses keep working by forwarding.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/admin", destination: "/", permanent: true },
      { source: "/citizen", destination: "/app/", permanent: true },
      { source: "/mobile-app", destination: "/app/", permanent: true },
      { source: "/mobile-app/:path*", destination: "/app/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
