export const CRON_JOBS_V2 = [
  { id: 'health-monitor', pattern: '*/5 * * * *' },
  { id: 'reconcile-leaderboard', pattern: '*/30 * * * *' },
  { id: 'thread-archive-stale', pattern: '0 2 * * *' },
  { id: 'flashcard-due-reminder', pattern: '0 13 * * *' },
  { id: 'library-pro-downgrade', pattern: '0 3 * * *' },
  { id: 'library-pro-expiry-warn', pattern: '0 9 * * *' },
  { id: 'library-saved-search-notify', pattern: '0 14 * * *' },
  { id: 'tutoring-auto-complete', pattern: '5 * * * *' },
  { id: 'tutoring-recurring-rollout', pattern: '30 2 * * *' },
  { id: 'process-gdpr-deletion', pattern: '0 3 * * *' },
  { id: 'tutoring-refresh-embeddings', pattern: '0 3 * * *' },
] as const;

export type CronV2Id = (typeof CRON_JOBS_V2)[number]['id'];
