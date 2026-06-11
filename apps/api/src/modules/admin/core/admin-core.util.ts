export const MAX_LIMIT = 100;

export function parseLimit(raw: string | undefined, fallback = 50): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(n))) : fallback;
}

export function parseDateParam(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const isoOrNull = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;
