'use client';

import * as React from 'react';
import { FileText, BrainCircuit, ClipboardList } from 'lucide-react';

type ResourceItem = { id: string; title: string; type: 'doc' | 'flashcard' | 'exam' };

const COMMANDS = [
  { key: 'doc', label: '/doc', desc: 'Đính kèm document', icon: FileText, route: 'documents' },
  {
    key: 'flashcard',
    label: '/flashcard',
    desc: 'Đính kèm flashcard',
    icon: BrainCircuit,
    route: 'flashcards',
  },
  { key: 'exam', label: '/exam', desc: 'Đính kèm exam', icon: ClipboardList, route: 'exams' },
] as const;

type CmdKey = (typeof COMMANDS)[number]['key'];

type Props = {
  content: string;
  onPick: (markdownLink: string) => void;
};

function parseSlash(content: string): { cmd: CmdKey | null; query: string } | null {
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

  if (!parsed.cmd) {
    return (
      <div className="bg-popover absolute bottom-full left-0 right-0 mb-2 max-h-[200px] overflow-auto rounded-md border shadow-xl">
        <div className="text-muted-foreground border-b px-3 py-1 text-[10px] uppercase">
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
              className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
            >
              <Icon className="text-muted-foreground h-4 w-4" />
              <span className="font-mono text-xs">{c.label}</span>
              <span className="text-muted-foreground text-xs">{c.desc}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const command = COMMANDS.find((c) => c.key === parsed.cmd)!;
  return (
    <div className="bg-popover absolute bottom-full left-0 right-0 mb-2 max-h-[260px] overflow-auto rounded-md border shadow-xl">
      <div className="text-muted-foreground border-b px-3 py-1 text-[10px] uppercase">
        {command.label} — {parsed.query ? `tìm "${parsed.query}"` : 'recent items'}
      </div>
      {loading ? (
        <p className="text-muted-foreground p-3 text-xs">Đang tìm...</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground p-3 text-xs">Không tìm thấy</p>
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
              className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
            >
              <command.icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{it.title}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
