const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const CURRENT_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const REDACT_FIELDS = /^(password|token|secret|api_key|authorization|cookie|ssn|cccd)$/i;

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_FIELDS.test(k)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redact(v, depth + 1);
    }
  }
  return result;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] > LEVELS[CURRENT_LEVEL]) return;

  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };

  if (process.env.NODE_ENV === 'production') {
    const stream = level === 'error' || level === 'warn' ? console.error : console.log;
    stream(JSON.stringify(entry));
  } else {
    const tag = level.toUpperCase().padEnd(5);
    const time = entry.timestamp.slice(11, 19);
    const extra = fields ? ' ' + JSON.stringify(redact(fields)) : '';
    const stream = level === 'error' || level === 'warn' ? console.error : console.log;
    stream(`[${time}] ${tag} ${event}${extra}`);
  }
}

export const logger = {
  error(event: string, fields?: Record<string, unknown>): void {
    emit('error', event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>): void {
    emit('warn', event, fields);
  },
  info(event: string, fields?: Record<string, unknown>): void {
    emit('info', event, fields);
  },
  debug(event: string, fields?: Record<string, unknown>): void {
    emit('debug', event, fields);
  },
};
