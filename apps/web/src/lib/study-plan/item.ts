export type ItemStatus = 'PENDING' | 'DONE' | 'SKIPPED';
export type ItemKind = 'manual' | 'review' | 'new' | 'practice';

export type ProposalMetadata = {
  atomDomain?: string;
  atomDifficulty?: number | null;
  masteryScore?: number | null;
  flashcardCount?: number;
  questionCount?: number;
  previewQuestion?: string | null;
  previewAnswer?: string | null;
  earliestDue?: string | null;
  estimatedMinutes?: number;
};

export type Item = {
  id: string;
  title: string;
  description: string | null;
  status: ItemStatus;
  kind: ItemKind;
  conceptId: string | null;
  metadata: ProposalMetadata;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function normalizeItem(raw: unknown): Item {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    status: (r.status as ItemStatus) ?? 'PENDING',
    kind: (r.kind as ItemKind) ?? 'manual',
    conceptId: (r.conceptId as string | null) ?? null,
    metadata: (r.metadata as ProposalMetadata) ?? {},
    dueDate: (r.dueDate as string | null) ?? null,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    completedAt: (r.completedAt as string | null) ?? null,
  };
}
