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
          <p className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 mb-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider">
            {t('library.voice.demo_badge')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t('library.voice.title')}</h1>
          <p className="text-muted-foreground mt-1 text-[13px]">{t('library.voice.subtitle')}</p>
        </div>
        <VoiceSearchClient />
      </div>
    </PageShell>
  );
}
