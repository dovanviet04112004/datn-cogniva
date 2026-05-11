/**
 * RecommendationsPanel — gợi ý concept user nên học tiếp.
 *
 * Mỗi item: tên concept + domain + lý do + bar mastery.
 * Bấm vào → mở /graph (focus vào concept đó qua hash) — Phase sau có thể
 * mở quiz/flashcard tập trung concept đó.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/card';

type Recommendation = {
  conceptId: string;
  conceptName: string;
  domain: string;
  mastery: number;
  prereqsFor: number;
  priority: number;
  reason: string;
};

export function RecommendationsPanel({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = React.useState<Recommendation[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/mastery/recommendations?limit=${limit}`)
      .then((r) => r.json())
      .then((d: { recommendations: Recommendation[] }) => setItems(d.recommendations))
      .finally(() => setLoading(false));
  }, [limit]);

  if (loading) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">Đang phân tích...</Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Chưa có gợi ý — upload tài liệu để Cogniva trích concepts trước.
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-primary" />
        Nên ôn tiếp
      </h3>
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.conceptId}
            className="space-y-1 rounded-md border bg-card p-2 text-sm"
          >
            <Link
              href={`/graph#${it.conceptId}`}
              className="block font-medium hover:underline"
            >
              {it.conceptName}{' '}
              <span className="text-xs text-muted-foreground">({it.domain})</span>
            </Link>
            <p className="text-xs text-muted-foreground">{it.reason}</p>
            <p className="text-xs text-muted-foreground">
              Mastery: <strong>{(it.mastery * 100).toFixed(0)}%</strong>
              {it.prereqsFor > 0 && (
                <> · tiền đề cho {it.prereqsFor} concept khác</>
              )}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
