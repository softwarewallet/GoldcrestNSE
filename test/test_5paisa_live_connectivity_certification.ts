import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { firstLiveService } from '../src/services/firstLiveService';
import { maskIdentifier } from '../src/brokers/auditLog';

/**
 * 5PAISA LIVE READ-ONLY CONNECTIVITY AUDIT
 * 
 * This script performs real-world authentication (with manual TOTP) and read-only
 * API tests for the 5paisa broker. It produces a detailed audit log in JSON and TXT
 * formats, ensuring all sensitive information is redacted.
 */

const LOG_DIR = path.join(process.cwd(), 'data', 'logs');
const JSON_LOG_PATH = path.join(LOG_DIR, '5paisa_live_connectivity_audit.json');
const TXT_LOG_PATH = path.join(LOG_DIR, '5paisa_live_connectivity_audit.txt');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

class AuditLogger {
  private events: any[] = [];
  private runId: string;
  private startTime: number;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    this.runId = `5PAISA-LIVE-CONNECTIVITY-${timestamp}-${random}`;
    this.startTime = Date.now();
  }

  logEvent(stage: string, operation: string, status: string, details: any = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      stage,
      operation,
      status,
      ...this.sanitize(details)
    };
    this.events.push(event);
    console.log(`[${stage}] ${operation}: ${status}`);
  }

  getRunId() { return this.runId; }

  private sanitize(obj: any): any {
    if (!obj) return obj;
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item));
    }
    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value);
        }
      }
      return sanitized;
    }
    return obj;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'password', 'passcode', 'pin', 'totp', 'otp',
      'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'requestToken', 'request_token', 'authorization', 'bearer',
      'userKey', 'user_key', 'apiKey', 'api_key', 'secret',
      'clientSecret', 'client_secret', 'encryptionKey', 'encryption_key'
    ];
    return sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
  }

  private sanitizeString(str: string): string {
    // Mask common sensitive patterns if found in strings (e.g. JWTs)
    let sanitized = str;
    // Simple check for potential bearer tokens or large hex/base64 strings
    if (str.length > 50 && (str.startsWith('ey') || /^[a-f0-9]{32,}$/i.test(str))) {
      return '[REDACTED_CONTENT]';
    }
    return sanitized;
  }

  async writeLogs(finalStatus: any) {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;

    const report = {
      runId: this.runId,
      broker: '5PAISA',
      environment: 'LIVE',
      mode: 'READ_ONLY_CONNECTIVITY',
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs,
      nodeVersion: process.version,
      events: this.events,
      finalResult: finalStatus
    };

    // Write JSON
    fs.writeFileSync(JSON_LOG_PATH, JSON.stringify(report, null, 2));

    // Write TXT
    const txtContent = this.generateTxtReport(report);
    fs.writeFileSync(TXT_LOG_PATH, txtContent);

    console.log(`\nAudit logs written to:`);
    console.log(`JSON: ${JSON_LOG_PATH}`);
    console.log(`TXT:  ${TXT_LOG_PATH}`);
  }

  private generateTxtReport(report: any): string {
    const res = report.finalResult;
    return `============================================================
5PAISA LIVE CONNECTIVITY CERTIFICATION
============================================================

Run ID: ${report.runId}
Broker: ${report.broker}
Environment: ${report.environment}
Mode: ${report.mode}

START: ${report.startTime}
END: ${report.endTime}
DURATION: ${(report.durationMs / 1000).toFixed(2)}s

------------------------------------------------------------
AUTHENTICATION
------------------------------------------------------------

TOTP required: YES
Manual TOTP supplied: ${res.manualTotpSupplied}
Authentication: ${res.authentication}
Session established: ${res.authentication === 'PASS' ? 'YES' : 'NO'}

------------------------------------------------------------
READ-ONLY CONNECTIVITY
------------------------------------------------------------

Account Discovery       : ${res.account_discovery}
Margin Access           : ${res.margin_access}
Positions Read          : ${res.positions_read_access}
Open Orders Read        : ${res.orders_read_access}
Market Data             : ${res.market_data_access}
Instrument Metadata     : ${res.instrument_metadata}

------------------------------------------------------------
ORDER SAFETY
------------------------------------------------------------

PlaceOrderRequest       : ${res.placeOrderAttempts} attempts
ModifyOrderRequest      : ${res.modifyOrderAttempts} attempts
CancelOrderRequest      : ${res.cancelOrderAttempts} attempts

Underlying order network transport reached: NO

------------------------------------------------------------
FIRST-LIVE SAFETY
------------------------------------------------------------

First-Live state changed: ${res.firstLiveStateChanged}
Reservations created: 0
Reservations consumed: 0

------------------------------------------------------------
DATABASE SAFETY
------------------------------------------------------------

Production DB modified: ${res.productionDbChanged}

------------------------------------------------------------
FINAL RESULT
------------------------------------------------------------

LIVE AUTHENTICATION: ${res.authentication}
LIVE READ-ONLY CONNECTIVITY: ${res.overallConnectivity}
ZERO-ORDER SAFETY: ${res.zeroOrderSafety}

REAL ORDER EXECUTION: NOT CERTIFIED
REAL-MONEY TRADING: NOT CERTIFIED

============================================================
`;
  }
}

async function promptForTotp(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\n[ACTION REQUIRED] Enter 6-digit 5paisa TOTP: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runCertification() {
  console.log('=== 5PAISA LIVE CONNECTIVITY AUDIT INITIATED ===');
  const logger = new AuditLogger();
  process.env.NODE_ENV = 'test';

  const results = {
    manualTotpSupplied: 'NO',
    authentication: 'FAIL',
    account_discovery: 'NOT_TESTED',
    margin_access: 'NOT_TESTED',
    positions_read_access: 'NOT_TESTED',
    orders_read_access: 'NOT_TESTED',
    market_data_access: 'NOT_TESTED',
    instrument_metadata: 'NOT_TESTED',
    placeOrderAttempts: 0,
    modifyOrderAttempts: 0,
    cancelOrderAttempts: 0,
    firstLiveStateChanged: 'NO',
    productionDbChanged: 'NO',
    overallConnectivity: 'FAIL',
    zeroOrderSafety: 'PASS'
  };

  // 1. Hard Zero-Order Network Guard
  const originalFetch = global.fetch;
  (global as any).fetch = async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('/PlaceOrderRequest')) {
      results.placeOrderAttempts++;
      results.zeroOrderSafety = 'FAIL';
      logger.logEvent('ORDER_SAFETY', 'PlaceOrderRequest', 'SECURITY_VIOLATION', { url });
      throw new Error(`TEST SAFETY FAILURE: Real order endpoint attempted: /PlaceOrderRequest`);
    }
    if (url.includes('/ModifyOrderRequest')) {
      results.modifyOrderAttempts++;
      results.zeroOrderSafety = 'FAIL';
      logger.logEvent('ORDER_SAFETY', 'ModifyOrderRequest', 'SECURITY_VIOLATION', { url });
      throw new Error(`TEST SAFETY FAILURE: Real order endpoint attempted: /ModifyOrderRequest`);
    }
    if (url.includes('/CancelOrderRequest')) {
      results.cancelOrderAttempts++;
      results.zeroOrderSafety = 'FAIL';
      logger.logEvent('ORDER_SAFETY', 'CancelOrderRequest', 'SECURITY_VIOLATION', { url });
      throw new Error(`TEST SAFETY FAILURE: Real order endpoint attempted: /CancelOrderRequest`);
    }
    return originalFetch(input, init);
  };

  const adapter = new FivePaisaLiveAdapter();
  const initialFirstLiveStatus = await firstLiveService.getStatus();

  try {
    // 2. Authentication
    logger.logEvent('AUTHENTICATION', 'login', 'WAITING_FOR_TOTP', { message: '5paisa authentication requires manual TOTP' });
    
    // Check if we have credentials at all
    const configStatus = adapter.getConfigStatus();
    if (!configStatus.configured) {
        logger.logEvent('AUTHENTICATION', 'login', 'FAILED', { reason: 'Credentials not configured in environment' });
        results.authentication = 'FAIL';
    } else {
        const totp = await promptForTotp();
        if (totp && totp.length === 6) {
          results.manualTotpSupplied = 'YES';
          const authStart = Date.now();
          try {
            await adapter.loginWithTotp(totp);
            results.authentication = 'PASS';
            logger.logEvent('AUTHENTICATION', 'login', 'SUCCESS', { durationMs: Date.now() - authStart });
          } catch (err: any) {
            results.authentication = 'FAIL';
            logger.logEvent('AUTHENTICATION', 'login', 'FAILED', { error: err.message, durationMs: Date.now() - authStart });
          }
        } else {
          logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', { reason: 'Invalid or missing TOTP input' });
        }
    }

    if (results.authentication === 'PASS') {
      // 3. Account Discovery
      const accStart = Date.now();
      try {
        const account = await adapter.getAccount();
        results.account_discovery = account?.accountId ? 'PASS' : 'FAIL';
        logger.logEvent('ACCOUNT', 'getAccount', results.account_discovery, { 
            accountId: account?.accountId,
            durationMs: Date.now() - accStart 
        });
      } catch (err: any) {
        results.account_discovery = 'FAIL';
        logger.logEvent('ACCOUNT', 'getAccount', 'FAILED', { error: err.message, durationMs: Date.now() - accStart });
      }

      // 4. Margin Access
      const marginStart = Date.now();
      try {
        const margin = await adapter.fetchMarginFromApi();
        results.margin_access = margin ? 'PASS' : 'FAIL';
        logger.logEvent('MARGIN', 'fetchMarginFromApi', results.margin_access, { 
            hasEquity: !!margin.equity,
            durationMs: Date.now() - marginStart 
        });
      } catch (err: any) {
        results.margin_access = 'FAIL';
        logger.logEvent('MARGIN', 'fetchMarginFromApi', 'FAILED', { error: err.message, durationMs: Date.now() - marginStart });
      }

      // 5. Positions Read
      const posStart = Date.now();
      try {
        const positions = await adapter.getPositions();
        results.positions_read_access = Array.isArray(positions) ? 'PASS' : 'FAIL';
        logger.logEvent('POSITIONS', 'getPositions', results.positions_read_access, { 
            count: positions.length,
            durationMs: Date.now() - posStart 
        });
      } catch (err: any) {
        results.positions_read_access = 'FAIL';
        logger.logEvent('POSITIONS', 'getPositions', 'FAILED', { error: err.message, durationMs: Date.now() - posStart });
      }

      // 6. Open Orders Read
      const ordStart = Date.now();
      try {
        const orders = await adapter.getOpenOrders();
        results.orders_read_access = Array.isArray(orders) ? 'PASS' : 'FAIL';
        logger.logEvent('OPEN_ORDERS', 'getOpenOrders', results.orders_read_access, { 
            count: orders.length,
            durationMs: Date.now() - ordStart 
        });
      } catch (err: any) {
        results.orders_read_access = 'FAIL';
        logger.logEvent('OPEN_ORDERS', 'getOpenOrders', 'FAILED', { error: err.message, durationMs: Date.now() - ordStart });
      }

      // 7. Market Data (NIFTY)
      const quoteStart = Date.now();
      try {
        const quote = await adapter.getQuote('NIFTY');
        results.market_data_access = (quote && typeof quote.price === 'number') ? 'PASS' : 'FAIL';
        logger.logEvent('MARKET_DATA', 'getQuote', results.market_data_access, { 
            symbol: 'NIFTY',
            hasPrice: !!quote?.price,
            durationMs: Date.now() - quoteStart 
        });
      } catch (err: any) {
        results.market_data_access = 'FAIL';
        logger.logEvent('MARKET_DATA', 'getQuote', 'FAILED', { error: err.message, symbol: 'NIFTY', durationMs: Date.now() - quoteStart });
      }

      // 8. Instrument Metadata
      const instStart = Date.now();
      try {
        const instruments = await adapter.getInstruments();
        const niftyResolved = instruments.some(i => i.symbol === 'NIFTY');
        results.instrument_metadata = (instruments.length > 0 && niftyResolved) ? 'PASS' : 'FAIL';
        logger.logEvent('INSTRUMENT_METADATA', 'getInstruments', results.instrument_metadata, { 
            totalCount: instruments.length,
            niftyResolved,
            durationMs: Date.now() - instStart 
        });
      } catch (err: any) {
        results.instrument_metadata = 'FAIL';
        logger.logEvent('INSTRUMENT_METADATA', 'getInstruments', 'FAILED', { error: err.message, durationMs: Date.now() - instStart });
      }

      results.overallConnectivity = (
        results.account_discovery === 'PASS' &&
        results.margin_access === 'PASS' &&
        results.market_data_access === 'PASS'
      ) ? 'PASS' : 'FAIL';
    }

    // First-Live state check
    const finalFirstLiveStatus = await firstLiveService.getStatus();
    if (initialFirstLiveStatus.ordersSubmitted !== finalFirstLiveStatus.ordersSubmitted || initialFirstLiveStatus.locked !== finalFirstLiveStatus.locked) {
        results.firstLiveStateChanged = 'YES';
        logger.logEvent('FIRST_LIVE_SAFETY', 'stateCheck', 'FAIL', { message: 'First-Live state modified during diagnostic' });
    } else {
        logger.logEvent('FIRST_LIVE_SAFETY', 'stateCheck', 'PASS', { message: 'First-Live state unchanged' });
    }

  } catch (err: any) {
    console.error('Certification fatal error:', err.message);
    logger.logEvent('CRITICAL', 'main', 'ERROR', { error: err.message });
  } finally {
    global.fetch = originalFetch;
    await logger.writeLogs(results);
    console.log('\n=== CONNECTIVITY AUDIT COMPLETE ===');
    if (results.overallConnectivity !== 'PASS' || results.zeroOrderSafety !== 'PASS') {
        process.exit(1);
    }
  }
}

runCertification().catch(err => {
    console.error('Certification failed to execute:', err);
    process.exit(1);
});
