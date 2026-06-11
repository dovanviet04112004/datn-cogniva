import { initSentry } from '@/lib/observability/sentry';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    initSentry();
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    initSentry();
  }
}
