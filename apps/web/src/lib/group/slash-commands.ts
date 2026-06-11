export type SlashCommand = {
  name: string;
  description: string;
  requiresArg?: boolean;
  transform: (args: string, ctx: { userName: string }) => string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'me',
    description: 'Hành động — "* tên-bạn ..."',
    requiresArg: true,
    transform: (args, ctx) => `_* ${ctx.userName} ${args.trim()}_`,
  },
  {
    name: 'shrug',
    description: 'Append shrug ¯\\_(ツ)_/¯',
    transform: (args) => {
      const t = args.trim();
      return t ? `${t} ¯\\_(ツ)_/¯` : `¯\\_(ツ)_/¯`;
    },
  },
  {
    name: 'tableflip',
    description: 'Lật bàn (╯°□°)╯︵ ┻━┻',
    transform: (args) => {
      const t = args.trim();
      return t ? `${t} (╯°□°)╯︵ ┻━┻` : `(╯°□°)╯︵ ┻━┻`;
    },
  },
  {
    name: 'unflip',
    description: 'Dựng bàn ┬─┬ ノ( ゜-゜ノ)',
    transform: (args) => {
      const t = args.trim();
      return t ? `${t} ┬─┬ ノ( ゜-゜ノ)` : `┬─┬ ノ( ゜-゜ノ)`;
    },
  },
  {
    name: 'spoiler',
    description: 'Markdown spoiler ||hidden text||',
    requiresArg: true,
    transform: (args) => `||${args.trim()}||`,
  },
];

const COMMAND_RE = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i;

export function executeSlash(input: string, ctx: { userName: string }): string | null {
  const match = input.match(COMMAND_RE);
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  if (!name) return null;
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) return null;
  const args = match[2] ?? '';
  if (cmd.requiresArg && !args.trim()) return null;
  return cmd.transform(args, ctx);
}

export function matchSlash(prefix: string): SlashCommand[] {
  const p = prefix.toLowerCase();
  if (!p) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(p));
}
