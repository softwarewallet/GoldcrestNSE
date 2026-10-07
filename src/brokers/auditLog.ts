import { AuditLogEntry, BrokerType, TradingEnvironment } from './types';
import { liveRuntimeLog } from '../services/liveRuntimeLog';

// In-memory audit trail buffer (keeps last 500 actions, sanitized)
const auditLogs: AuditLogEntry[] = [];

export function logBrokerAction(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
  const sanitizedEntry: AuditLogEntry = {
    ...entry,
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: Date.now(),
    // Strictly sanitize account id to masked format if needed
    account: maskIdentifier(entry.account)
  };

  auditLogs.unshift(sanitizedEntry);
  if (auditLogs.length > 500) {
    auditLogs.pop();
  }

  // Print sanitized log without credentials
  const line = `[${sanitizedEntry.environment}] [${sanitizedEntry.broker}] ${sanitizedEntry.action} -> ${sanitizedEntry.result} (Account: ${sanitizedEntry.account})`;
  console.log(`[AUDIT-LOG] ${line}`);
  liveRuntimeLog(
    sanitizedEntry.result === 'FAILURE' ? 'ERROR' : sanitizedEntry.result === 'BLOCKED' ? 'WARN' : 'TRADE',
    'BROKER_ACTION',
    { line, symbol: sanitizedEntry.symbol, quantity: sanitizedEntry.quantity, orderId: sanitizedEntry.orderId, signalId: sanitizedEntry.signalId, strategyId: sanitizedEntry.strategyId, riskValidation: sanitizedEntry.riskValidation }
  );

  return sanitizedEntry;
}

export function getAuditLogs(limit: number = 100, filter?: { broker?: BrokerType; environment?: TradingEnvironment }): AuditLogEntry[] {
  let filtered = auditLogs;
  if (filter?.broker) {
    filtered = filtered.filter(l => l.broker === filter.broker);
  }
  if (filter?.environment) {
    filtered = filtered.filter(l => l.environment === filter.environment);
  }
  return filtered.slice(0, limit);
}

export function maskIdentifier(val?: string): string {
  if (!val) return '****';
  const str = String(val).trim();
  if (str.length <= 4) return '****' + str;
  return '****' + str.slice(-4);
}
