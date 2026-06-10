/**
 * /library/voice — Voice Q&A demo (Phase 5, 2026-05-27).
 *
 * Web client demo cho /api/library/voice-search:
 *   - MediaRecorder thu âm giọng nói (mic permission)
 *   - Upload Blob multipart → backend Whisper → cross-doc search
 *   - Hiển thị transcript + top 5 chunk hits + link tới doc detail
 *
 * Mobile app sẽ implement riêng (AVAudioRecorder iOS / MediaRecorder Android +
 * cùng endpoint).
 */
import { PageShell } from '@/components/layout/page-shell';
import { VoiceSearchClient } from '@/components/library/voice-search-client';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function LibraryVoicePage() {
  const t = await getServerT();
  return (
    <PageShell>
      <div className="mx-auto max-w-2xl py-8">
        <div className="mb-6">
          <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-discovery-500/15 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-discovery-700 dark:text-discovery-300">
            {t('library.voice.demo_badge')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t('library.voice.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('library.voice.subtitle')}
          </p>
        </div>
        <VoiceSearchClient />
      </div>
    </PageShell>
  );
}
