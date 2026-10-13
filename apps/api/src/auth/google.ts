import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Injectable so tests can fake Google. */
export interface GoogleClient {
  authUrl(opts: { state: string; nonce: string; domainHint?: string }): string;
  exchange(code: string, nonce: string): Promise<GoogleProfile>;
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function createGoogleClient(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleClient {
  return {
    authUrl({ state, nonce, domainHint }) {
      const p = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        prompt: 'select_account',
      });
      if (domainHint) p.set('hd', domainHint);
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async exchange(code, nonce) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
      const { id_token } = (await res.json()) as { id_token: string };
      const { payload } = await jwtVerify(id_token, JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: opts.clientId,
      });
      if (payload.nonce !== nonce) throw new Error('nonce mismatch');
      return {
        email: String(payload.email ?? ''),
        emailVerified: payload.email_verified === true,
        name: payload.name as string | undefined,
        picture: payload.picture as string | undefined,
      };
    },
  };
}
