/**
 * Cookie consent banner — GDPR Article 7 + ePrivacy Directive.
 *
 * Plan v2 §10.5 + §15.1 W9-10.
 *
 * 3 category cookies (theo ePrivacy):
 *   1. Essential   — luôn ON (auth session, CSRF). Không cần consent.
 *   2. Functional  — preferences, language. Opt-in.
 *   3. Analytics   — PostHog, GA. Opt-in (EU strict).
 *   4. Marketing   — ad tracking. Opt-in (rarely use cho Cogniva).
 *
 * Cogniva chỉ dùng Essential + Analytics. Banner show 2 option:
 *   - Accept all (analytics ON)
 *   - Essential only (analytics OFF)
 *   - Manage (modal chi tiết — Stage 2)
 *
 * Persist consent vào localStorage `cogniva.cookie-consent` + cookie ngắn hạn
 * (server-side check khi cần gate PostHog SDK).
 *
 * Show lại banner sau 12 tháng (EU recommended re-consent).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';

import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'cogniva.cookie-consent';
const CONSENT_VERSION = '1.0';
const RECONSENT_DAYS = 365; // re-prompt sau 1 năm

type ConsentChoice = 'all' | 'essential';

type StoredConsent = {
  version: string;
  choice: ConsentChoice;
  acceptedAt: string;
  /** Cho tracking opt-out detect — server có thể check. */
  analytics: boolean;
  functional: boolean;
};

function loadConsent(): StoredConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (parsed.version !== CONSENT_VERSION) return null;
    // Check stale (> 1 year)
    const acceptedDate = new Date(parsed.acceptedAt);
    const ageDays = (Date.now() - acceptedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > RECONSENT_DAYS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveConsent(choice: ConsentChoice): StoredConsent {
  const consent: StoredConsent = {
    version: CONSENT_VERSION,
    choice,
    acceptedAt: new Date().toISOString(),
    analytics: choice === 'all',
    functional: choice === 'all',
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    // Cookie 1-year cho server-side gate (vd tắt PostHog server)
    const maxAge = RECONSENT_DAYS * 24 * 60 * 60;
    document.cookie = `cogniva-consent=${choice}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch (err) {
    console.warn('[cookie-banner] save fail:', err);
  }
  return consent;
}

/**
 * Hook đọc consent state — dùng để gate analytics SDK init.
 *
 *   const { analytics } = useCookieConsent();
 *   if (analytics) posthog.init(...);
 */
export function useCookieConsent(): {
  loaded: boolean;
  analytics: boolean;
  functional: boolean;
  choice: ConsentChoice | null;
} {
  const [consent, setConsent] = React.useState<StoredConsent | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setConsent(loadConsent());
    setLoaded(true);
    // Listen storage event (other tab update)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setConsent(loadConsent());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    loaded,
    analytics: consent?.analytics ?? false,
    functional: consent?.functional ?? false,
    choice: consent?.choice ?? null,
  };
}

export function CookieBanner() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Check sau khi mount để tránh SSR mismatch
    const existing = loadConsent();
    if (!existing) {
      // Delay 1s để không hiện ngay khi user landing — UX softer
      const t = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(t);
    }
  }, []);

  const handleChoice = (choice: ConsentChoice) => {
    saveConsent(choice);
    setVisible(false);
    // Dispatch storage event manually để analytics SDK re-init nếu cần
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border bg-background p-4 shadow-lg sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-md"
    >
      <div className="flex items-start gap-3">
        <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="flex-1">
          <h3 id="cookie-banner-title" className="text-sm font-semibold">
            Cogniva dùng cookie
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cookie cần thiết (auth session) luôn bật. Phân tích sử dụng (PostHog,
            Sentry) chỉ bật khi bạn đồng ý — giúp cải thiện app, không gửi data
            cho marketing.{' '}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => handleChoice('all')}>
              Chấp nhận tất cả
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleChoice('essential')}
            >
              Chỉ essential
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
