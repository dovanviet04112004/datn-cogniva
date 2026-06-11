export async function getTraceId(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-trace-id') ?? 'no-trace';
  } catch {
    return 'no-trace';
  }
}

export async function getRegion(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-cogniva-region') ?? 'us';
  } catch {
    return 'us';
  }
}

export { logger } from '@cogniva/server-core/logger';
