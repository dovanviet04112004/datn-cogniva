/**
 * MasteryPanel — hiển thị danh sách concept kèm bar progress mastery.
 *
 * Layout: list dọc — mỗi dòng:
 *   [bar 60%]  Concept name (domain) — N câu, M đúng
 *
 * Color theo score:
 *   < 0.4 đỏ, < 0.7 vàng, ≥ 0.7 xanh — match với ConceptNode trong /graph.
 *
 * Header: "Mastery — N concepts đã ôn".
 */
'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Card } from '@/components/ui/card';

type MasteryRow = {
  conceptId: string;
  conceptName: string;
  domain: string;
  score: number;
  attempts: number;
  correct: number;
  lastSeenAt: string | null;
};

function masteryColor(score: number): string {
  if (score < 0.4) return 'bg-red-500';
  if (score < 0.7) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function MasteryPanel({ limit = 20 }: { limit?: number }) {
  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: qk.mastery(limit),
    queryFn: () =>
      apiGet<{ mastery: MasteryRow[] }>(`/api/mastery?limit=${limit}`).then(
        (d) => d.mastery,
      ),
  });

  if (loading) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">Đang tải mastery...</Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Chưa có dữ liệu mastery. Làm 1 quiz để bắt đầu tracking.
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">
        Mastery ({rows.length} concept{rows.length > 1 ? 's' : ''})
      </h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.conceptId} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate font-medium">
                {r.conceptName}{' '}
                <span className="text-muted-foreground">({r.domain})</span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {r.correct}/{r.attempts} · {(r.score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${masteryColor(r.score)} transition-all`}
                style={{ width: `${Math.max(2, r.score * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
