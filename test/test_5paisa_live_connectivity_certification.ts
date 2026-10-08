import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { firstLiveService } from '../src/services/firstLiveService';
import { maskIdentifier } from '../src/brokers/auditLog';
import { getDatabase, executeQuery } from '../src/database/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 5PAISA LIVE READ-ONLY CONNECTIVITY CERTIFICATION & AUDIT LOG GENERATOR
 * 
 * Objectives:
 * 1. ZERO-ORDER certification gate: No orders placed, modified, canceled, or transmitted.
 * 2. Complete 2-Factor Authentication sequence:
 *    - 6-digit 2FA PIN prompt (hidden/no-echo input, local format validation)
 *    - 6-digit TOTP prompt (hidden/no-echo input, local format validation)
 * 3. Complete read-only verification:
 *    - Account / Margin
 *    - Positions
 *    - Open Orders
 *    - Order History
 *    - Market Data
 *    - Instrument Metadata
 * 4. First-Live state isolation (zero reservations or ledger entries created/consumed).
 * 5. Production database isolation (SHA-256 before == SHA-256 after).
 * 6. Sanitized physical audit logging:
 *    - data/logs/5paisa_live_connectivity_audit.json
 *    - data/logs/5paisa_live_connectivity_audit.txt
 *    Verified on physical disk before exit.
 * 7. Complete secret redaction: Never logs PIN, TOTP, tokens, or encryption keys.
 */

// Deterministic Absolute Path Resolution
const projectRoot = path.resolve(process.cwd());
const auditLogDirectory = path.resolve(projectRoot, 'data', 'logs');
const jsonLogPath = path.resolve(auditLogDirectory, '5paisa_live_connectivity_audit.json');
const txtLogPath = path.resolve(auditLogDirectory, '5paisa_live_connectivity_audit.txt');

// Ensure log directory exists immediately
if (!fs.existsSync(auditLogDirectory)) {
  fs.mkdirSync(auditLogDirectory, { recursive: true });
}

export class AuditLogger {
  private events: any[] = [];
  private runId: string;
  private startTime: number;
  private registeredSecrets: Set<string> = new Set();

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    this.runId = `5PAISA-LIVE-CONNECTIVITY-${timestamp}-${random}`;
    this.startTime = Date.now();
  }

  registerSecret(secret: string | undefined | null) {
    if (secret && typeof secret === 'string' && secret.trim().length >= 3) {
      this.registeredSecrets.add(secret.trim());
    }
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

  public sanitize(obj: any): any {
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
    const allowedStatusKeys = [
      'pinValidation', 'totpValidation', 'manualPinSupplied', 'manualTotpSupplied',
      'hasAccessToken', 'hasTotpSecret', 'accessTokenObtained', 'activeSessionConfirmed',
      'requestTokenObtained', 'twoFactorAuth', 'pinAbsentFromLogs', 'totpAbsentFromLogs',
      'accessTokenAbsentFromLogs', 'authHeadersAbsent', 'jsonWrittenRead', 'txtWrittenRead',
      'margin_access', 'positions_read_access', 'orders_read_access', 'order_history_access',
      'market_data_access', 'instrument_metadata', 'overallCertification'
    ];
    if (allowedStatusKeys.includes(key)) {
      return false;
    }

    const sensitiveKeys = [
      'password', 'passcode', 'pin', 'totp', 'otp', '2fa',
      'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'requestToken', 'request_token', 'authorization', 'bearer',
      'userKey', 'user_key', 'apiKey', 'api_key', 'secret',
      'clientSecret', 'client_secret', 'encryptionKey', 'encryption_key'
    ];
    return sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
  }

  public sanitizeString(str: string): string {
    if (!str || typeof str !== 'string') return str;
    let sanitized = str;
    for (const secret of this.registeredSecrets) {
      sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
    }
    // Redact JWT-like or long hex tokens
    if (sanitized.length > 50 && (sanitized.startsWith('ey') || /^[a-f0-9]{32,}$/i.test(sanitized))) {
      return '[REDACTED_CONTENT]';
    }
    return sanitized;
  }

  writeAuditFiles(finalStatus: any) {
    const endTime = Date.now();
    const report = {
      runId: this.runId,
      broker: '5PAISA',
      environment: 'LIVE',
      mode: 'READ_ONLY_CONNECTIVITY',
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs: endTime - this.startTime,
      nodeVersion: process.version,
      executionEnvironment: (process.env.HOSTNAME || process.env.K_REVISION || process.cwd() === '/app/applet')
        ? 'SANDBOX / CONTAINER (AI Studio Environment: /app/applet)'
        : 'LOCAL PROJECT',
      projectRoot,
      auditLogDirectory,
      jsonLogPath,
      txtLogPath,
      events: this.events,
      finalResult: this.sanitize(finalStatus)
    };

    // Ensure directory exists
    if (!fs.existsSync(auditLogDirectory)) {
      fs.mkdirSync(auditLogDirectory, { recursive: true });
    }

    // Write JSON using synchronous writeFileSync
    const jsonString = JSON.stringify(report, null, 2);
    fs.writeFileSync(jsonLogPath, jsonString, 'utf8');

    // Write TXT using synchronous writeFileSync
    const txtContent = this.generateTxtReport(report);
    fs.writeFileSync(txtLogPath, txtContent, 'utf8');

    return { jsonLogPath, txtLogPath, report };
  }

  private generateTxtReport(report: any): string {
    const res = report.finalResult;
    return `=============================================
5PAISA LIVE READ-ONLY CERTIFICATION
=============================================

Run ID: ${report.runId}
Broker: 5PAISA
Environment: LIVE
Mode: READ_ONLY_CONNECTIVITY

START: ${report.startTime}
END: ${report.endTime}
DURATION: ${(report.durationMs / 1000).toFixed(2)}s
EXECUTION ENVIRONMENT: ${report.executionEnvironment}
PROJECT ROOT: ${report.projectRoot}

AUTHENTICATION
- 2FA PIN + TOTP: ${res.twoFactorAuth || res.authentication}
- RequestToken: ${res.requestTokenObtained || 'FAIL'}
- AccessToken obtained: ${res.accessTokenObtained || 'FAIL'}
- Active session: ${res.activeSessionConfirmed || 'FAIL'}

READ-ONLY API
- Account / Margin: ${res.margin_access || 'FAIL'}
- Positions: ${res.positions_read_access || 'FAIL'}
- Open Orders: ${res.orders_read_access || 'FAIL'}
- Order History: ${res.order_history_access || 'FAIL'}
- Market Data: ${res.market_data_access || 'FAIL'}
- Instrument Metadata: ${res.instrument_metadata || 'FAIL'}

ORDER SAFETY
- PlaceOrderRequest transmissions: ${res.placeOrderAttempts ?? 0}
- ModifyOrderRequest transmissions: ${res.modifyOrderAttempts ?? 0}
- CancelOrderRequest transmissions: ${res.cancelOrderAttempts ?? 0}

ISOLATION
- First-Live state unchanged: ${res.firstLiveStateChanged === 'NO' ? 'PASS' : 'FAIL'}
- Production DB unchanged: ${res.productionDbChanged === 'NO' ? 'PASS' : 'FAIL'}

SECURITY
- PIN absent from logs: ${res.pinAbsentFromLogs || 'PASS'}
- TOTP absent from logs: ${res.totpAbsentFromLogs || 'PASS'}
- Access token absent from logs: ${res.accessTokenAbsentFromLogs || 'PASS'}
- Authorization headers absent: ${res.authHeadersAbsent || 'PASS'}

AUDIT
- JSON written/read successfully: ${res.jsonWrittenRead || 'PASS'}
- TXT written/read successfully: ${res.txtWrittenRead || 'PASS'}

=============================================
OVERALL CERTIFICATION: ${res.overallCertification || 'FAIL'}
=============================================
`;
  }
}

/**
 * Prompts for sensitive input using hidden / non-echoing console input.
 * Supports environment variable bypass for automated test suites.
 */
export async function promptSecret(promptText: string, envVarNames: string[] = []): Promise<string> {
  for (const envVar of envVarNames) {
    if (process.env[envVar] && process.env[envVar]!.trim() !== '') {
      return process.env[envVar]!.trim();
    }
  }

  if (!process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      }
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    process.stdout.write(promptText);
    muted = true;

    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

function calculateSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'NOT_EXIST';
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return 'READ_ERROR';
  }
}

export async function runCertification() {
  const logger = new AuditLogger();
  console.log(`============================================================`);
  console.log(`5PAISA LIVE READ-ONLY CONNECTIVITY CERTIFICATION INITIATED`);
  console.log(`============================================================`);
  console.log(`Run ID: ${logger.getRunId()}`);
  console.log('');
  
  // 1. Print Runtime Environment Details
  console.log('EXECUTION RUNTIME DETAILS:');
  console.log(`process.cwd():                 ${process.cwd()}`);
  console.log(`process.argv:                  ${JSON.stringify(process.argv)}`);
  console.log(`__dirname:                     ${__dirname}`);
  console.log(`path.resolve("."):             ${path.resolve('.')}`);
  console.log(`Node version:                  ${process.version}`);
  console.log(`process.env.GOLDCREST_DB_FILE: ${process.env.GOLDCREST_DB_FILE || 'NOT SET'}`);
  console.log(`PROJECT ROOT:                  ${projectRoot}`);
  console.log(`AUDIT LOG DIRECTORY:           ${auditLogDirectory}`);
  console.log(`JSON LOG TARGET:               ${jsonLogPath}`);
  console.log(`TXT LOG TARGET:                ${txtLogPath}`);

  if (process.env.HOSTNAME || process.env.K_REVISION || process.cwd() === '/app/applet') {
    console.log('EXECUTION ENVIRONMENT:         SANDBOX / CONTAINER (AI Studio Environment: /app/applet)');
  } else {
    console.log('EXECUTION ENVIRONMENT:         LOCAL PROJECT');
  }
  console.log('============================================================\n');

  // Hard safety: ensure test mode for safety hooks
  process.env.NODE_ENV = 'test';

  const results = {
    manualPinSupplied: 'NO',
    manualTotpSupplied: 'NO',
    pinValidation: 'NOT_TESTED',
    totpValidation: 'NOT_TESTED',
    twoFactorAuth: 'FAIL',
    requestTokenObtained: 'FAIL',
    accessTokenObtained: 'FAIL',
    activeSessionConfirmed: 'FAIL',
    authentication: 'FAIL',
    margin_access: 'FAIL',
    positions_read_access: 'FAIL',
    orders_read_access: 'FAIL',
    order_history_access: 'FAIL',
    market_data_access: 'FAIL',
    instrument_metadata: 'FAIL',
    placeOrderAttempts: 0,
    modifyOrderAttempts: 0,
    cancelOrderAttempts: 0,
    firstLiveStateChanged: 'NO',
    productionDbChanged: 'NO',
    pinAbsentFromLogs: 'PASS',
    totpAbsentFromLogs: 'PASS',
    accessTokenAbsentFromLogs: 'PASS',
    authHeadersAbsent: 'PASS',
    jsonWrittenRead: 'FAIL',
    txtWrittenRead: 'FAIL',
    zeroOrderSafety: 'PASS',
    securityViolation: false,
    overallCertification: 'FAIL',
    authFailureReason: ''
  };

  const originalFetch = global.fetch;

  // Track production database hash
  const prodDbFile = path.join(projectRoot, 'data', 'trading_analyst.sqlite');
  const preProdDbHash = calculateSha256(prodDbFile);

  let enteredPin = '';
  let enteredTotp = '';
  let adapter: FivePaisaLiveAdapter | null = null;

  try {
    // 2. HARD ZERO-ORDER NETWORK TRANSMISSION GUARD
    (global as any).fetch = async (input: any, init?: any) => {
      const url = String(input);
      const lower = url.toLowerCase();
      if (
        lower.includes('/placeorderrequest') ||
        lower.includes('/modifyorderrequest') ||
        lower.includes('/cancelorderrequest')
      ) {
        if (lower.includes('/placeorderrequest')) results.placeOrderAttempts++;
        if (lower.includes('/modifyorderrequest')) results.modifyOrderAttempts++;
        if (lower.includes('/cancelorderrequest')) results.cancelOrderAttempts++;

        results.zeroOrderSafety = 'FAIL';
        results.securityViolation = true;
        logger.logEvent('ORDER_SAFETY', 'ORDER_ENDPOINT_ATTEMPTED', 'SECURITY_VIOLATION', { url });
        throw new Error(`TEST SAFETY FAILURE: Real order endpoint attempted: ${url}`);
      }

      const res = await originalFetch(input, init);

      if (url.includes('/TOTPLogin')) {
        try {
          const clone = res.clone();
          const json = await clone.json();
          if (json?.body?.RequestToken) {
            results.requestTokenObtained = 'PASS';
            logger.registerSecret(json.body.RequestToken);
          }
        } catch {
          // ignore
        }
      }

      if (url.includes('/GetAccessToken')) {
        try {
          const clone = res.clone();
          const json = await clone.json();
          if (json?.body?.AccessToken) {
            results.accessTokenObtained = 'PASS';
            logger.registerSecret(json.body.AccessToken);
          }
        } catch {
          // ignore
        }
      }

      return res;
    };

    // Initialize database for First-Live status check without altering production db
    await getDatabase();
    const initialFirstLiveStatus = await firstLiveService.getStatus();
    const initialLedgerRows = await executeQuery<any>("SELECT COUNT(*) as cnt FROM first_live_ledger").catch(() => [{ cnt: 0 }]);
    const initialLedgerCount = Number(initialLedgerRows[0]?.cnt || 0);

    adapter = new FivePaisaLiveAdapter();

    // Register configured credentials with logger so they are never leaked
    if (adapter.config.password) logger.registerSecret(adapter.config.password);
    if (adapter.config.userKey) logger.registerSecret(adapter.config.userKey);
    if (adapter.config.encryptionKey) logger.registerSecret(adapter.config.encryptionKey);

    // 3. Inspect Live Credentials
    const configStatus = adapter.getConfigStatus();
    logger.logEvent('PRE_CHECK', 'credentials', configStatus.configured ? 'CONFIGURED' : 'MISSING', {
      configured: configStatus.configured,
      maskedClientId: configStatus.maskedClientId,
      hasAccessToken: configStatus.hasAccessToken
    });

    if (!configStatus.configured) {
      results.authFailureReason = '5paisa LIVE API credentials (appName, userId, userKey, encryptionKey) not configured in environment or database';
      logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', { reason: results.authFailureReason });
      console.log(`\n⚠️  NOTICE: ${results.authFailureReason}.`);
      console.log('Skipping live network authentication attempt. Logging pre-flight state and physical audit logs.');
    } else {
      // Step 3.1: 2FA PIN
      logger.logEvent('AUTHENTICATION', 'login', 'WAITING_FOR_2FA_PIN', {
        message: '5paisa authentication requires manually supplied 6-digit 2FA PIN'
      });

      const pin = await promptSecret('[ACTION REQUIRED] Enter 6-digit 5paisa 2FA PIN: ', [
        'FIVEPAISA_2FA_PIN_INPUT',
        'FIVEPAISA_PIN_INPUT'
      ]);

      const PIN_REGEX = /^\d{6}$/;
      const TOTP_REGEX = /^\d{6}$/;

      if (!pin) {
        results.pinValidation = 'FAIL';
        results.twoFactorAuth = 'FAIL';
        results.authFailureReason = 'Manual 2FA PIN not supplied';
        logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', {
          stage: 'PIN_VALIDATION',
          reason: results.authFailureReason
        });
        console.log(`\n⚠️  NOTICE: ${results.authFailureReason}.`);
      } else if (!PIN_REGEX.test(pin)) {
        results.pinValidation = 'FAIL';
        results.twoFactorAuth = 'FAIL';
        results.authFailureReason = '2FA PIN must be exactly 6 numeric digits';
        logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', {
          stage: 'PIN_VALIDATION',
          reason: results.authFailureReason
        });
        console.log(`\n⚠️  NOTICE: ${results.authFailureReason}.`);
      } else {
        enteredPin = pin;
        logger.registerSecret(pin);
        results.manualPinSupplied = 'YES';
        results.pinValidation = 'PASS';
        logger.logEvent('AUTHENTICATION', 'pinValidation', 'PASS');

        // Step 3.2: TOTP
        logger.logEvent('AUTHENTICATION', 'login', 'WAITING_FOR_TOTP', {
          message: '5paisa authentication requires manually supplied 6-digit TOTP'
        });

        const totp = await promptSecret('[ACTION REQUIRED] Enter 6-digit 5paisa TOTP: ', [
          'FIVEPAISA_TOTP_INPUT'
        ]);

        if (!totp) {
          results.totpValidation = 'FAIL';
          results.twoFactorAuth = 'FAIL';
          results.authFailureReason = 'Manual TOTP not supplied';
          logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', {
            stage: 'TOTP_VALIDATION',
            reason: results.authFailureReason
          });
          console.log(`\n⚠️  NOTICE: ${results.authFailureReason}.`);
        } else if (!TOTP_REGEX.test(totp)) {
          results.totpValidation = 'FAIL';
          results.twoFactorAuth = 'FAIL';
          results.authFailureReason = 'TOTP must be exactly 6 numeric digits';
          logger.logEvent('AUTHENTICATION', 'login', 'ABORTED', {
            stage: 'TOTP_VALIDATION',
            reason: results.authFailureReason
          });
          console.log(`\n⚠️  NOTICE: ${results.authFailureReason}.`);
        } else {
          enteredTotp = totp;
          logger.registerSecret(totp);
          results.manualTotpSupplied = 'YES';
          results.totpValidation = 'PASS';
          logger.logEvent('AUTHENTICATION', 'totpValidation', 'PASS');

          // Step 3.3: Submit authentication with BOTH credentials
          logger.logEvent('AUTHENTICATION', 'login', 'SUBMITTED', { stage: 'CREDENTIALS_SUBMITTED' });
          const authStart = Date.now();
          try {
            await adapter.loginWithTotp(totp, pin);
            results.authentication = 'PASS';
            results.twoFactorAuth = 'PASS';
            results.requestTokenObtained = 'PASS';
            results.accessTokenObtained = (adapter.config.accessToken && adapter.config.accessToken.trim() !== '') ? 'PASS' : 'FAIL';
            results.activeSessionConfirmed = adapter.hasActiveSession() ? 'PASS' : 'FAIL';
            if (adapter.config.accessToken) {
              logger.registerSecret(adapter.config.accessToken);
            }
            logger.logEvent('AUTHENTICATION', 'login', 'SUCCESS', { durationMs: Date.now() - authStart });
          } catch (err: any) {
            results.authentication = 'FAIL';
            results.twoFactorAuth = 'FAIL';
            results.accessTokenObtained = 'FAIL';
            results.activeSessionConfirmed = 'FAIL';
            const sanitizedMsg = logger.sanitizeString(err?.message || '5paisa authentication failed');
            results.authFailureReason = sanitizedMsg;
            logger.logEvent('AUTHENTICATION', 'login', 'FAILED', {
              error: sanitizedMsg,
              stage: 'TOTPLogin',
              durationMs: Date.now() - authStart
            });
          }
        }
      }
    }

    // 4. Authenticated Read-Only Checks
    if (results.authentication === 'PASS') {
      console.log('\n--- EXECUTING READ-ONLY CONNECTIVITY CHECKS ---');

      // 4.1 Account / Margin
      const accStart = Date.now();
      try {
        const account = await adapter.getAccount();
        const margin = await adapter.fetchMarginFromApi();
        const validStructure = Boolean(
          account &&
          account.accountId &&
          Number.isFinite(account.balance) &&
          margin &&
          Number.isFinite(margin.availableMargin) &&
          Number.isFinite(margin.usedMargin)
        );
        results.account_discovery = account?.accountId ? 'PASS' : 'FAIL';
        results.margin_access = validStructure ? 'PASS' : 'FAIL';
        logger.logEvent('ACCOUNT_MARGIN', 'fetchMarginFromApi', results.margin_access, {
          accountId: maskIdentifier(account?.accountId),
          hasEquity: Number.isFinite(margin?.equity),
          availableMarginFinite: Number.isFinite(margin?.availableMargin),
          usedMarginFinite: Number.isFinite(margin?.usedMargin),
          durationMs: Date.now() - accStart
        });
      } catch (err: any) {
        results.account_discovery = 'FAIL';
        results.margin_access = 'FAIL';
        logger.logEvent('ACCOUNT_MARGIN', 'fetchMarginFromApi', 'FAILED', { error: logger.sanitizeString(err.message), durationMs: Date.now() - accStart });
      }

      // 4.2 Positions Read Access
      const posStart = Date.now();
      try {
        const positions = await adapter.getPositions();
        const validPositions = Array.isArray(positions) && positions.every(p => Boolean(p.symbol && Number.isFinite(p.quantity)));
        results.positions_read_access = validPositions ? 'PASS' : 'FAIL';
        logger.logEvent('POSITIONS', 'getPositions', results.positions_read_access, {
          count: positions.length,
          durationMs: Date.now() - posStart
        });
      } catch (err: any) {
        results.positions_read_access = 'FAIL';
        logger.logEvent('POSITIONS', 'getPositions', 'FAILED', { error: logger.sanitizeString(err.message), durationMs: Date.now() - posStart });
      }

      // 4.3 Open Orders Read Access
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
        logger.logEvent('OPEN_ORDERS', 'getOpenOrders', 'FAILED', { error: logger.sanitizeString(err.message), durationMs: Date.now() - ordStart });
      }

      // 4.4 Order History Read Access
      const histStart = Date.now();
      try {
        const history = await adapter.getOrderHistory();
        results.order_history_access = Array.isArray(history) ? 'PASS' : 'FAIL';
        logger.logEvent('ORDER_HISTORY', 'getOrderHistory', results.order_history_access, {
          count: history.length,
          durationMs: Date.now() - histStart
        });
      } catch (err: any) {
        results.order_history_access = 'FAIL';
        logger.logEvent('ORDER_HISTORY', 'getOrderHistory', 'FAILED', { error: logger.sanitizeString(err.message), durationMs: Date.now() - histStart });
      }

      // 4.5 Market Data Access (NIFTY)
      const quoteStart = Date.now();
      try {
        const quote = await adapter.getQuote('NIFTY');
        const validQuote = Boolean(
          quote &&
          typeof quote.symbol === 'string' &&
          (Number.isFinite(quote.price) || (Number.isFinite(quote.bid) && Number.isFinite(quote.ask)))
        );
        results.market_data_access = validQuote ? 'PASS' : 'FAIL';
        logger.logEvent('MARKET_DATA', 'getQuote', results.market_data_access, {
          symbol: 'NIFTY',
          hasPrice: !!quote?.price,
          durationMs: Date.now() - quoteStart
        });
      } catch (err: any) {
        results.market_data_access = 'FAIL';
        logger.logEvent('MARKET_DATA', 'getQuote', 'FAILED', { error: logger.sanitizeString(err.message), symbol: 'NIFTY', durationMs: Date.now() - quoteStart });
      }

      // 4.6 Instrument Metadata
      const instStart = Date.now();
      try {
        const instruments = await adapter.getInstruments();
        const niftyResolved = instruments.some(i => i.symbol === 'NIFTY');
        const hasValidLots = instruments.every(i => i.minQuantity >= 1);
        results.instrument_metadata = (instruments.length > 0 && niftyResolved && hasValidLots) ? 'PASS' : 'FAIL';
        logger.logEvent('INSTRUMENT_METADATA', 'getInstruments', results.instrument_metadata, {
          totalCount: instruments.length,
          niftyResolved,
          durationMs: Date.now() - instStart
        });
      } catch (err: any) {
        results.instrument_metadata = 'FAIL';
        logger.logEvent('INSTRUMENT_METADATA', 'getInstruments', 'FAILED', { error: logger.sanitizeString(err.message), durationMs: Date.now() - instStart });
      }
    }

    // 5. First-Live and Safety Integrity Check
    const finalFirstLiveStatus = await firstLiveService.getStatus();
    const finalLedgerRows = await executeQuery<any>("SELECT COUNT(*) as cnt FROM first_live_ledger").catch(() => [{ cnt: 0 }]);
    const finalLedgerCount = Number(finalLedgerRows[0]?.cnt || 0);
    const reservationCreated = (finalLedgerCount !== initialLedgerCount);
    const reservationConsumed = (finalFirstLiveStatus.ordersSubmitted !== initialFirstLiveStatus.ordersSubmitted);
    const firstLiveStatusChanged = (
      initialFirstLiveStatus.armed !== finalFirstLiveStatus.armed ||
      initialFirstLiveStatus.locked !== finalFirstLiveStatus.locked ||
      initialFirstLiveStatus.ordersAllowed !== finalFirstLiveStatus.ordersAllowed ||
      initialFirstLiveStatus.executionMode !== finalFirstLiveStatus.executionMode
    );

    if (reservationCreated || reservationConsumed || firstLiveStatusChanged) {
      results.firstLiveStateChanged = 'YES';
      logger.logEvent('FIRST_LIVE_SAFETY', 'stateCheck', 'FAIL', { message: 'First-Live state modified' });
    } else {
      results.firstLiveStateChanged = 'NO';
      logger.logEvent('FIRST_LIVE_SAFETY', 'stateCheck', 'PASS', { message: 'First-Live state remained completely untouched' });
    }

    // 6. Production DB Integrity Check
    const postProdDbHash = calculateSha256(prodDbFile);
    if (preProdDbHash !== postProdDbHash) {
      results.productionDbChanged = 'YES';
      logger.logEvent('PROD_DB_SAFETY', 'hashCheck', 'FAIL', { message: 'Production DB hash mismatch' });
    } else {
      results.productionDbChanged = 'NO';
      logger.logEvent('PROD_DB_SAFETY', 'hashCheck', 'PASS', { message: 'Production DB untouched' });
    }

    // 7. Overall Certification Evaluation
    results.overallCertification = (
      results.authentication === 'PASS' &&
      results.accessTokenObtained === 'PASS' &&
      results.activeSessionConfirmed === 'PASS' &&
      results.margin_access === 'PASS' &&
      results.positions_read_access === 'PASS' &&
      results.orders_read_access === 'PASS' &&
      results.order_history_access === 'PASS' &&
      results.market_data_access === 'PASS' &&
      results.instrument_metadata === 'PASS' &&
      results.zeroOrderSafety === 'PASS' &&
      results.firstLiveStateChanged === 'NO' &&
      results.productionDbChanged === 'NO' &&
      !results.securityViolation
    ) ? 'PASS' : 'FAIL';

  } catch (err: any) {
    console.error('\n❌ Diagnostic encountered an unexpected error:', err.message);
    logger.logEvent('CRITICAL', 'main', 'ERROR', { error: logger.sanitizeString(err.message) });
  } finally {
    global.fetch = originalFetch;

    // 8. First-pass synchronous physical file writing
    logger.writeAuditFiles(results);

    // 9. Rigorous Physical Existence and Readback Verification
    const jsonExists = fs.existsSync(jsonLogPath);
    const txtExists = fs.existsSync(txtLogPath);
    const jsonSize = jsonExists ? fs.statSync(jsonLogPath).size : 0;
    const txtSize = txtExists ? fs.statSync(txtLogPath).size : 0;

    let jsonReadbackPass = false;
    let txtReadbackPass = false;
    let jsonContent = '';
    let txtContent = '';

    if (jsonExists && jsonSize > 0) {
      try {
        jsonContent = fs.readFileSync(jsonLogPath, 'utf8');
        const parsed = JSON.parse(jsonContent);
        jsonReadbackPass = Boolean(parsed && parsed.runId && parsed.broker === '5PAISA');
      } catch {
        jsonReadbackPass = false;
      }
    }

    if (txtExists && txtSize > 0) {
      try {
        txtContent = fs.readFileSync(txtLogPath, 'utf8');
        txtReadbackPass = txtContent.includes('5PAISA LIVE READ-ONLY CERTIFICATION') && txtContent.includes(logger.getRunId());
      } catch {
        txtReadbackPass = false;
      }
    }

    results.jsonWrittenRead = jsonReadbackPass ? 'PASS' : 'FAIL';
    results.txtWrittenRead = txtReadbackPass ? 'PASS' : 'FAIL';

    // 10. Rigorous Secret Leakage Verification
    const combinedLogs = jsonContent + '\n' + txtContent;
    if (enteredPin && /^\d{6}$/.test(enteredPin)) {
      results.pinAbsentFromLogs = combinedLogs.includes(enteredPin) ? 'FAIL' : 'PASS';
    } else {
      results.pinAbsentFromLogs = 'PASS';
    }

    if (enteredTotp && /^\d{6}$/.test(enteredTotp)) {
      results.totpAbsentFromLogs = combinedLogs.includes(enteredTotp) ? 'FAIL' : 'PASS';
    } else {
      results.totpAbsentFromLogs = 'PASS';
    }

    const liveToken = (adapter as any)?.config?.accessToken;
    if (liveToken && liveToken.length > 10) {
      results.accessTokenAbsentFromLogs = combinedLogs.includes(liveToken) ? 'FAIL' : 'PASS';
    } else {
      results.accessTokenAbsentFromLogs = 'PASS';
    }

    const hasRawBearerLeak = /Bearer\s+[a-zA-Z0-9_\-\.]{25,}/.test(combinedLogs) ||
                             combinedLogs.includes('Authorization: Bearer');
    results.authHeadersAbsent = hasRawBearerLeak ? 'FAIL' : 'PASS';

    for (const secret of (logger as any).registeredSecrets) {
      if (secret && secret.length >= 4 && combinedLogs.includes(secret)) {
        results.secretsAbsent = 'FAIL';
      }
    }

    // 11. Final Overall Certification Determination
    results.overallCertification = (
      results.twoFactorAuth === 'PASS' &&
      results.requestTokenObtained === 'PASS' &&
      results.accessTokenObtained === 'PASS' &&
      results.activeSessionConfirmed === 'PASS' &&
      results.margin_access === 'PASS' &&
      results.positions_read_access === 'PASS' &&
      results.orders_read_access === 'PASS' &&
      results.order_history_access === 'PASS' &&
      results.market_data_access === 'PASS' &&
      results.instrument_metadata === 'PASS' &&
      results.placeOrderAttempts === 0 &&
      results.modifyOrderAttempts === 0 &&
      results.cancelOrderAttempts === 0 &&
      results.firstLiveStateChanged === 'NO' &&
      results.productionDbChanged === 'NO' &&
      results.pinAbsentFromLogs === 'PASS' &&
      results.totpAbsentFromLogs === 'PASS' &&
      results.accessTokenAbsentFromLogs === 'PASS' &&
      results.authHeadersAbsent === 'PASS' &&
      results.jsonWrittenRead === 'PASS' &&
      results.txtWrittenRead === 'PASS' &&
      !results.securityViolation
    ) ? 'PASS' : 'FAIL';

    // 12. Final write with all completed verification statuses
    logger.writeAuditFiles(results);

    console.log('\n============================================================');
    console.log('AUDIT FILE PHYSICAL CREATION AND INTEGRITY REPORT');
    console.log('============================================================');
    console.log(`JSON Log Path:     ${jsonLogPath}`);
    console.log(`TXT Log Path:      ${txtLogPath}`);
    console.log(`JSON File Exists:  ${jsonExists ? 'YES' : 'NO'}`);
    console.log(`TXT File Exists:   ${txtExists ? 'YES' : 'NO'}`);
    console.log(`JSON File Size:    ${jsonSize} bytes`);
    console.log(`TXT File Size:     ${txtSize} bytes`);
    console.log(`JSON Readback:     ${jsonReadbackPass ? 'PASS' : 'FAIL'}`);
    console.log(`TXT Readback:      ${txtReadbackPass ? 'PASS' : 'FAIL'}`);
    console.log('============================================================\n');

    // 13. Required Exact Final Output per Specification
    console.log('=============================================');
    console.log('5PAISA LIVE READ-ONLY CERTIFICATION');
    console.log('=============================================\n');
    console.log('AUTHENTICATION');
    console.log(`- 2FA PIN + TOTP: ${results.twoFactorAuth}`);
    console.log(`- RequestToken: ${results.requestTokenObtained}`);
    console.log(`- AccessToken obtained: ${results.accessTokenObtained}`);
    console.log(`- Active session: ${results.activeSessionConfirmed}\n`);
    console.log('READ-ONLY API');
    console.log(`- Account / Margin: ${results.margin_access}`);
    console.log(`- Positions: ${results.positions_read_access}`);
    console.log(`- Open Orders: ${results.orders_read_access}`);
    console.log(`- Order History: ${results.order_history_access}`);
    console.log(`- Market Data: ${results.market_data_access}`);
    console.log(`- Instrument Metadata: ${results.instrument_metadata}\n`);
    console.log('ORDER SAFETY');
    console.log(`- PlaceOrderRequest transmissions: ${results.placeOrderAttempts}`);
    console.log(`- ModifyOrderRequest transmissions: ${results.modifyOrderAttempts}`);
    console.log(`- CancelOrderRequest transmissions: ${results.cancelOrderAttempts}\n`);
    console.log('ISOLATION');
    console.log(`- First-Live state unchanged: ${results.firstLiveStateChanged === 'NO' ? 'PASS' : 'FAIL'}`);
    console.log(`- Production DB unchanged: ${results.productionDbChanged === 'NO' ? 'PASS' : 'FAIL'}\n`);
    console.log('SECURITY');
    console.log(`- PIN absent from logs: ${results.pinAbsentFromLogs}`);
    console.log(`- TOTP absent from logs: ${results.totpAbsentFromLogs}`);
    console.log(`- Access token absent from logs: ${results.accessTokenAbsentFromLogs}`);
    console.log(`- Authorization headers absent: ${results.authHeadersAbsent}\n`);
    console.log('AUDIT');
    console.log(`- JSON written/read successfully: ${results.jsonWrittenRead}`);
    console.log(`- TXT written/read successfully: ${results.txtWrittenRead}\n`);
    console.log('=============================================');
    console.log(`OVERALL CERTIFICATION: ${results.overallCertification}`);
    console.log('=============================================\n');

    if (!jsonExists || !txtExists || jsonSize === 0 || txtSize === 0 || !jsonReadbackPass || !txtReadbackPass) {
      console.error('\n❌ FATAL: Audit log files were NOT physically created or verified on disk!');
      process.exitCode = 1;
    } else if (results.securityViolation || results.zeroOrderSafety !== 'PASS') {
      console.error('\n❌ FATAL: Hard zero-order security barrier was breached!');
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('test_5paisa_live_connectivity_certification.ts')) {
  runCertification().catch((err) => {
    console.error('\n❌ Fatal certification runner exception:', err);
    process.exit(1);
  });
}
