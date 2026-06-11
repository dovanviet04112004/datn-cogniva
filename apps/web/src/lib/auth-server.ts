import { cache } from 'react';
import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const NEST_ORIGIN = process.env.NEST_API_ORIGIN ?? 'http://localhost:4000';

const JWKS = createRemoteJWKSet(new URL(`${NEST_ORIGIN}/api/auth/jwks`));

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: string | null;
  role: string | null;
};

export type ServerSession = { user: SessionUser };

export const getServerSession = cache(async (): Promise<ServerSession | null> => {
  const token = (await cookies()).get('cg_at')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ['ES256'],
      issuer: 'cogniva',
      audience: 'cogniva-app',
    });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      user: {
        id: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : null,
        image: typeof payload.picture === 'string' ? payload.picture : null,
        plan: typeof payload.plan === 'string' ? payload.plan : null,
        role: typeof payload.role === 'string' ? payload.role : null,
      },
    };
  } catch {
    return null;
  }
});
