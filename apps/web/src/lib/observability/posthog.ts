/**
 * PostHog server-side helper — track event từ route handler.
 *
 * Client-side: dùng `PosthogProvider` component (components/posthog-provider.tsx).
 *
 * Pattern:
 *   trackEvent('quiz_completed', userId, { quizId, score })
 *
 * Disabled khi NEXT_PUBLIC_POSTHOG_KEY trống → log warn only. Production
 * set env trên Vercel.
 */
import { PostHog } from 'posthog-node';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';

let client: PostHog | null = null;
function getClient(): PostHog | null {
  if (!KEY) return null;
  if (!client) {
    client = new PostHog(KEY, {
      host: HOST,
      flushAt: 1, // flush ngay từng event — dev/server-side đơn giản
      flushInterval: 0,
    });
  }
  return client;
}

/** Track event server-side với userId làm distinct_id. */
export async function trackEvent(
  event: string,
  userId: string,
  properties?: Record<string, unknown>,
) {
  const c = getClient();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event,
    properties,
  });
  // Flush ngay để event không mất khi serverless instance shutdown
  try {
    await c.flush();
  } catch {
    /* ignore */
  }
}

/** Identify user trong Posthog (set traits). */
export async function identifyUser(
  userId: string,
  traits?: Record<string, unknown>,
) {
  const c = getClient();
  if (!c) return;
  c.identify({ distinctId: userId, properties: traits });
  try {
    await c.flush();
  } catch {
    /* ignore */
  }
}
