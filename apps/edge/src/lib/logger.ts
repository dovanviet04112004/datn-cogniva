type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  trace_id?: string;
  user_id?: string | null;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, ctx?: LogContext): void {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...(ctx ?? {}),
  };
  if (level === 'error') console.error(JSON.stringify(payload));
  else if (level === 'warn') console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

export const logger = {
  debug: (event: string, ctx?: LogContext) => emit('debug', event, ctx),
  info: (event: string, ctx?: LogContext) => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => emit('error', event, ctx),
};
