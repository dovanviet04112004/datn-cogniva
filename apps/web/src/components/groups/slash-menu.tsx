/**
 * SlashMenu — popover trigger khi user gõ `/` đầu dòng composer.
 *
 * Commands:
 *   - /doc <query>       → search Cogniva documents
 *   - /flashcard <query> → search flashcards
 *   - /exam <query>      → search exams
 *
 * Khi user pick item → callback `onPick(text)` với markdown link để
 * MessageComposer thay thế phần `/cmd query` bằng `[title](/route/id)`.
 * Client UrlPreview sau đó render rich card cho link Cogniva.
 */
'use client';

import * as React from 'react';
import { FileText, BrainCircuit, ClipboardList } from 'lucide-react';

type ResourceItem = { id: string; title: string; type: 'doc' | 'flashcard' | 'exam' };

const COMMANDS = [
  { key: 'doc', label: '/doc', desc: 'Đính kèm document', icon: FileText, route: 'documents' },
  { key: 'flashcard', label: '/flashcard', desc: 'Đính kèm flashcard', icon: BrainCircuit, route: 'flashcards' },
  { key: 'exam', label: '/exam', desc: 'Đính kèm exam', icon: ClipboardList, route: 'exams' },
] as const;

type CmdKey = (typeof COMMANDS)[number]['key'];

type Props = {
  /** Toàn bộ content của composer — slash menu parse `/<cmd> <q>`. */
  content: string;
  /** Khi user pick item → trả về markdown link để composer replace. */
  onPick: (markdownLink: string) => void;
};

/** Detect "/cmd query" ở đầu hoặc cuối dòng cuối — return { cmd, query } hoặc null. */
function parseSlash(content: string): { cmd: CmdKey | null; query: string } | null {
  // Lấy line cuối cùng (nơi cursor đang gõ)
  const lines = content.split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (!last.startsWith('/')) return null;
  const m = last.match(/^\/(\w*)(\s+(.*))?$/);
  if (!m) return null;
  const rawCmd = m[1] ?? '';
  const query = m[3] ?? '';
  const cmd = COMMANDS.find((c) => c.key.startsWith(rawCmd) || rawCmd.startsWith(c.key))?.key;
  return { cmd: cmd ?? null, query };
}

export function SlashMenu({ content, onPick }: Props) {
  const parsed = parseSlash(content);
  const [items, setItems] = React.useState<ResourceItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!parsed?.cmd) {
      setItems([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      const url = `/api/groups/resource-search?type=${parsed.cmd}${
        parsed.query ? '&q=' + encodeURIComponent(parsed.query) : ''
      }`;
      fetch(url)
        .then((r) => r.json())
        .then((d: { items?: ResourceItem[]; error?: unknown }) => {
          setItems(d.items ?? []);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.cmd, parsed?.query]);

  if (!parsed) return null;

  // Stage 1: hiện list commands khi user mới gõ "/" hoặc gõ sai cmd
  if (!parsed.cmd) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[200px] overflow-auto rounded-md border bg-popover shadow-xl">
        <div className="border-b px-3 py-1 text-[10px] uppercase text-muted-foreground">
          Slash commands
        </div>
        {COMMANDS.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c.label + ' ');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-xs">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.desc}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Stage 2: hiện kết quả search
  const command = COMMANDS.find((c) => c.key === parsed.cmd)!;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[260px] overflow-auto rounded-md border bg-popover shadow-xl">
      <div className="border-b px-3 py-1 text-[10px] uppercase text-muted-foreground">
        {command.label} — {parsed.query ? `tìm "${parsed.query}"` : 'recent items'}
      </div>
      {loading ? (
        <p className="p-3 text-xs text-muted-foreground">Đang tìm...</p>
      ) : items.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">Không tìm thấy</p>
      ) : (
        items.map((it) => {
          const url = `/${command.route}/${it.id}`;
          const markdown = `[${it.title}](${url})`;
          return (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(markdown);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <command.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{it.title}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
