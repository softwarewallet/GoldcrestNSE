import fs from 'node:fs';
import path from 'node:path';

export type LiveLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRADE' | 'SYSTEM';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_TIMEZONE = process.env.GOLDCREST_LOG_TIMEZONE || 'Asia/Kolkata';

function getLogDate(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: LOG_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getDailyLogFile(date = getLogDate()): string {
  return path.join(LOG_DIR, `goldcrest-live-${date}.log`);
}

let enabled = false;
let consoleCaptureInstalled = false;

export function initializeLiveRuntimeLog(source = 'APPLICATION_START'): { enabled: boolean; file: string } {
  const status = startLiveRuntimeLog(source);
  installConsoleAuditCapture();
  return status;
}

export function installConsoleAuditCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const methods: Array<{ name: 'log' | 'info' | 'warn' | 'error' | 'debug'; level: LiveLogLevel }> = [
    { name: 'log', level: 'SYSTEM' },
    { name: 'info', level: 'INFO' },
    { name: 'warn', level: 'WARN' },
    { name: 'error', level: 'ERROR' },
    { name: 'debug', level: 'INFO' }
  ];

  for (const { name, level } of methods) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      try {
        writeLine(level, 'CONSOLE_OUTPUT', {
          method: name,
          args
        });
      } catch {
        // Never let audit capture interfere with the application logger.
      }
      original(...args);
    };
  }
}

function ensureLogFile(date = getLogDate()): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = getDailyLogFile(date);
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '', 'utf8');
  }
  return logFile;
}

function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  return raw
    .replace(/((?:client[_ -]?secret|secret|access[_ -]?token|api[_ -]?key|password|user[_ -]?key|encryption[_ -]?key|totp[_ -]?secret|pin))\s*[:=]\s*[^,;\s\]}]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, token => token.length > 40 ? '[REDACTED_TOKEN]' : token);
}

function writeLine(level: LiveLogLevel, event: string, details?: unknown): void {
  if (!enabled) return;
  const logFile = ensureLogFile();
  const timestamp = new Date().toISOString();
  const detailText = details === undefined ? '' : ` | ${sanitize(details)}`;
  const line = `[${timestamp}] [${level}] [${event}]${detailText}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (error) {
    process.stderr.write(`[LIVE-LOG] Failed to append log file: ${String(error)}\n`);
  }
}

export function startLiveRuntimeLog(source = 'SETTINGS'): {
  enabled: boolean;
  file: string;
} {
  const file = ensureLogFile();
  enabled = true;
  writeLine('SYSTEM', 'LIVE_LOG_STARTED', { source, pid: process.pid, cwd: process.cwd(), logDate: getLogDate(), timeZone: LOG_TIMEZONE });
  return { enabled, file };
}

export function stopLiveRuntimeLog(source = 'SETTINGS'): {
  enabled: boolean;
  file: string;
} {
  const file = ensureLogFile();

  // During development/pre-production testing the audit trail is mandatory.
  // A UI action must not be able to disable evidence collection.
  if (process.env.NODE_ENV !== 'production') {
    writeLine('WARN', 'LIVE_LOG_STOP_REQUEST_IGNORED', {
      source,
      reason: 'Audit logging is mandatory until Goldcrest reaches production.'
    });
    enabled = true;
    return { enabled, file };
  }

  if (enabled) writeLine('SYSTEM', 'LIVE_LOG_STOPPED', { source, logDate: getLogDate(), timeZone: LOG_TIMEZONE });
  enabled = false;
  return { enabled, file };
}

export function isLiveRuntimeLogEnabled(): boolean {
  return enabled;
}

export function getLiveRuntimeLogStatus(): {
  enabled: boolean;
  file: string;
  logDate: string;
  timeZone: string;
  exists: boolean;
  sizeBytes: number;
  lastModifiedAt: string | null;
} {
  const file = ensureLogFile();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(file);
  } catch {
    stat = null;
  }
  return {
    enabled,
    file,
    logDate: getLogDate(),
    timeZone: LOG_TIMEZONE,
    exists: Boolean(stat),
    sizeBytes: stat?.size ?? 0,
    lastModifiedAt: stat?.mtime?.toISOString() ?? null
  };
}

export function liveRuntimeLog(level: LiveLogLevel, event: string, details?: unknown): void {
  writeLine(level, event, details);
}

export function tradeAuditLog(event: string, details?: unknown): void {
  const date = getLogDate();
  const file = path.join(LOG_DIR, `TradeLog-${date}.log`);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const detailText = details === undefined ? '' : ` | ${sanitize(details)}`;
    fs.appendFileSync(
      file,
      `[${timestamp}] [TRADE] [${event}]${detailText}\n`,
      'utf8'
    );
  } catch (error) {
    process.stderr.write(`[TRADE-LOG] Failed to append trade log: ${String(error)}\n`);
  }
}

export function getTradeLogFile(date = getLogDate()): string {
  return path.join(LOG_DIR, `TradeLog-${date}.log`);
}


export function logApplicationAction(event: string, details?: unknown): void {
  liveRuntimeLog('SYSTEM', event, details);
}

export function getLiveRuntimeLogFile(date = getLogDate()): string {
  return getDailyLogFile(date);
}

export function listLiveRuntimeLogFiles(): Array<{
  date: string;
  file: string;
  sizeBytes: number;
  lastModifiedAt: string | null;
}> {
  ensureLogFile();
  const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /^goldcrest-live-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name))
    .map(entry => {
      const file = path.join(LOG_DIR, entry.name);
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(file); } catch { stat = null; }
      return {
        date: entry.name.slice('goldcrest-live-'.length, -'.log'.length),
        file,
        sizeBytes: stat?.size ?? 0,
        lastModifiedAt: stat?.mtime?.toISOString() ?? null
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
