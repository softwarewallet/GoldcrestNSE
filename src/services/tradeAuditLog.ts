import fs from 'node:fs';
import path from 'node:path';

export type TradeAuditStatus = 'REQUEST_SENT' | 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'TIMEOUT';

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

function getDailyTradeLogFile(date = getLogDate()): string {
  return path.join(LOG_DIR, `${date}-TradeLog.log`);
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/((?:client[_ -]?secret|secret|access[_ -]?token|api[_ -]?key|password|user[_ -]?key|encryption[_ -]?key|totp[_ -]?secret|pin))\s*[:=]\s*[^,;\s\]}]+/gi, '$1=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/[A-Za-z0-9+/=_-]{32,}/g, token => token.length > 40 ? '[REDACTED_TOKEN]' : token);
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (/^(clientSecret|accessToken|apiKey|password|secret|userKey|encryptionKey|totpSecret|pin)$/i.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = sanitize(child);
    }
  }
  return output;
}

function append(record: Record<string, unknown>): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = getDailyTradeLogFile();
  fs.appendFileSync(
    file,
    JSON.stringify({
      auditTimestamp: new Date().toISOString(),
      auditDate: getLogDate(),
      ...(sanitize(record) as Record<string, unknown>)
    }) + '\n',
    'utf8'
  );
}

export function recordTradeRequest(params: {
  tradeAuditId: string;
  broker: 'CTRADER';
  environment: 'LIVE';
  accountId: number;
  symbolId: number;
  symbol: string;
  orderType: string;
  side: string;
  volume: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStopLoss: true;
  clientOrderId: string;
  packet: Record<string, unknown>;
}): void {
  append({
    recordType: 'TRADE_REQUEST',
    status: 'REQUEST_SENT',
    ...params
  });
}

export function recordTradeResult(params: {
  tradeAuditId: string;
  broker: 'CTRADER';
  environment: 'LIVE';
  status: Exclude<TradeAuditStatus, 'REQUEST_SENT'>;
  orderId?: number;
  executionPrice?: number;
  executedVolume?: number;
  error?: string;
  response?: unknown;
}): void {
  append({
    recordType: 'TRADE_RESULT',
    ...params
  });
}

export function getTradeAuditLogFile(date = getLogDate()): string {
  return getDailyTradeLogFile(date);
}
