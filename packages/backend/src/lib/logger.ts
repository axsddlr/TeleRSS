type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

function resolveLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (env in LOG_LEVELS) return env as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const currentLevel = (): number => LOG_LEVELS[resolveLevel()];
const shouldLog = (level: LogLevel): boolean => LOG_LEVELS[level] >= currentLevel();

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

let sequence = 0;

function formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data ? { data } : {}),
  };
}

function emit(entry: LogEntry): void {
  const structured = process.env.LOG_FORMAT === 'json';
  if (structured) {
    const line = JSON.stringify(entry);
    if (entry.level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } else {
    const seq = ++sequence;
    const label = LEVEL_LABELS[entry.level].padEnd(5);
    const ts = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
    let line = `[${ts}] ${label} #${seq} ${entry.message}`;
    if (entry.data) {
      line += ' ' + JSON.stringify(entry.data);
    }
    if (entry.level === 'error') {
      console.error(line);
    } else if (entry.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  emit(formatEntry(level, message, data));
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    log('debug', message, data);
  },
  info(message: string, data?: Record<string, unknown>): void {
    log('info', message, data);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    log('warn', message, data);
  },
  error(message: string, data?: Record<string, unknown>): void {
    log('error', message, data);
  },
};
