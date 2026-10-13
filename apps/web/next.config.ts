import type { NextConfig } from 'next';

// The browser only ever talks to its own origin (<tenant>.localhost:3000); /api is proxied to the
// API. That keeps cookies host-scoped per tenant and avoids CORS. Evaluated at build time.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@crew-deck/shared'],
  allowedDevOrigins: ['*.localhost', 'localhost'],
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      // Only the framing, base and form-target directives: a full script policy needs per-request
      // nonces and is tracked for the deployment phase.
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    ];
    const hsts =
      process.env.NODE_ENV === 'production'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
        : [];
    return [{ source: '/:path*', headers: [...common, ...hsts] }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
};

export default config;
