import { importSPKI, jwtVerify, type KeyLike } from 'jose';

import { cfg } from './config';

export type Identity = { id: string; name: string; image: string | null };

type Handshake = {
  headers: { cookie?: string; authorization?: string };
  auth?: { token?: string };
};

const JWT_ALG = 'ES256';
const JWT_ISSUER = 'cogniva';
const JWT_AUDIENCE = 'cogniva-app';

let publicKeyPromise: Promise<KeyLike | null> | null = null;
function getPublicKey(): Promise<KeyLike | null> {
  if (!publicKeyPromise) {
    publicKeyPromise = cfg.authJwtPublicKey
      ? importSPKI(cfg.authJwtPublicKey, JWT_ALG).catch((err) => {
          console.error(
            '[realtime/auth] AUTH_JWT_PUBLIC_KEY không hợp lệ — tắt local verify:',
            err instanceof Error ? err.message : err,
          );
          return null;
        })
      : Promise.resolve(null);
  }
  return publicKeyPromise;
}

function extractJwt(handshake: Handshake): string | null {
  const token = handshake.auth?.token;
  if (token && token.split('.').length === 3) return token;
  const m = (handshake.headers.cookie ?? '').match(/(?:^|;\s*)cg_at=([^;]+)/);
  return m?.[1] ?? null;
}

async function verifyLocal(handshake: Handshake): Promise<Identity | null> {
  const jwt = extractJwt(handshake);
  if (!jwt) return null;
  const key = await getPublicKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(jwt, key, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      name: typeof payload.name === 'string' ? payload.name : '',
      image: typeof payload.picture === 'string' ? payload.picture : null,
    };
  } catch {
    return null;
  }
}

async function callAuth(handshake: Handshake, channel?: string): Promise<Identity | null> {
  const cookie = handshake.headers.cookie ?? '';
  const token = handshake.auth?.token;
  const authorization = token ? `Bearer ${token}` : (handshake.headers.authorization ?? '');

  try {
    const res = await fetch(`${cfg.authOrigin}/api/realtime/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, authorization },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: Identity };
    return data.user ?? null;
  } catch (err) {
    console.error('[realtime/auth] call API fail:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function verifySession(handshake: Handshake): Promise<Identity | null> {
  return (await verifyLocal(handshake)) ?? callAuth(handshake);
}

export function authorizeChannel(handshake: Handshake, channel: string): Promise<boolean> {
  return callAuth(handshake, channel).then(Boolean);
}
