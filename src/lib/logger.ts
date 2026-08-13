type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

const PII_KEYS = new Set([
  'avatar',
  'avatar_url',
  'text',
  'body',
  'message',
  'phone',
  'phone_number',
  'email',
  'token',
  'password',
  'secret',
  'key',
  'authorization',
  'cookie',
  'session',
  'user_id',
  'profile_id',
  'admin_id',
  'chat_id',
  'contact_id',
]);

const SENSITIVE_URL_PATTERNS = [
  /avatar/,
  /photo/,
  /image/,
  /media/,
  /upload/,
  /profile/,
];

function isPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PII_KEYS.has(lower) || SENSITIVE_URL_PATTERNS.some((p) => p.test(lower));
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (isPiiKey(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && (v.startsWith('data:') || v.startsWith('blob:'))) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeMeta(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const errorBuffer: LogEntry[] = [];
const FLUSH_THRESHOLD = 10;
const FLUSH_INTERVAL_MS = 10000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushErrors(): Promise<void> {
  if (errorBuffer.length === 0) return;
  const toSend = [...errorBuffer];
  errorBuffer.length = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    const { supabase } = await import('../lib/supabase');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('app_errors').insert(
      toSend.map((e) => ({
        level: e.level,
        message: e.message,
        meta: e.meta,
        created_at: e.timestamp,
        user_id: user?.id ?? null,
      }))
    );
    if (error) {
      console.error('[LOGGER] Failed to flush errors to Supabase:', error);
    }
  } catch {
    // Silently fail - errors table might not exist yet or network down
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushErrors, FLUSH_INTERVAL_MS);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    meta: sanitizeMeta(meta),
    timestamp: new Date().toISOString(),
  };

  if (import.meta.env.DEV) {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console[level](`${prefix} [${entry.timestamp}] ${message}`, entry.meta ?? '');
  }

  if (level === 'error' && !import.meta.env.DEV) {
    errorBuffer.push(entry);
    if (errorBuffer.length >= FLUSH_THRESHOLD) {
      flushErrors();
    } else {
      scheduleFlush();
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};

export function flushLogger(): Promise<void> {
  return flushErrors();
}