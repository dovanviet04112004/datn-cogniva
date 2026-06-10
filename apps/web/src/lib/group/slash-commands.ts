/**
 * slash-commands — V2 G7.3 (2026-05-21).
 *
 * Discord-style slash command client-side. Composer phát hiện `/cmd <args>`
 * trước khi POST → transform content thành message bình thường.
 *
 * Supported (V1):
 *   - /me <text>        → "* tên-bạn <text>" italic, indicate emote
 *   - /shrug [text]     → "<text> ¯\_(ツ)_/¯"
 *   - /tableflip [text] → "<text> (╯°□°)╯︵ ┻━┻"
 *   - /unflip [text]    → "<text> ┬─┬ ノ( ゜-゜ノ)"
 *   - /spoiler <text>   → "||<text>||"  (markdown spoiler)
 *
 * Discord-style "/" autocomplete picker được implement riêng trong composer
 * khi user gõ "/" ở đầu input — dropdown match command + description.
 *
 * Note: KHÔNG server-side execute (như Slack `/giphy`). Tất cả là client text
 * transform → fire POST /messages bình thường, server vẫn coi như text input.
 */

export type SlashCommand = {
  name: string;
  description: string;
  /** Có cần argument không. */
  requiresArg?: boolean;
  /** Transform raw `/cmd args` text → output message content. */
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

/**
 * Detect + execute slash command. Returns transformed content nếu match,
 * `null` nếu input KHÔNG phải slash command (caller fallback gửi nguyên).
 */
export function executeSlash(
  input: string,
  ctx: { userName: string },
): string | null {
  const match = input.match(COMMAND_RE);
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  if (!name) return null;
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) return null;
  const args = match[2] ?? '';
  if (cmd.requiresArg && !args.trim()) return null; // thiếu arg → coi như plain text
  return cmd.transform(args, ctx);
}

/**
 * Match slash command theo prefix user đang gõ (sau dấu `/`).
 * Trả mảng filter sort theo độ match — composer render dropdown.
 */
export function matchSlash(prefix: string): SlashCommand[] {
  const p = prefix.toLowerCase();
  if (!p) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(p));
}
