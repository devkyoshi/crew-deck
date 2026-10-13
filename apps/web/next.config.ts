import type { NextConfig } from 'next';

// The browser only ever talks to its own origin (<tenant>.localhost:3000); /api is proxied to the
// API. That keeps cookies host-scoped per tenant and avoids CORS. Evaluated at build time.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@crew-deck/shared'],
  allowedDevOrigins: ['*.localhost', 'localhost'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
};

export default config;
