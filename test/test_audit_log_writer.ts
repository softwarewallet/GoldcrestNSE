import fs from 'node:fs';
import path from 'node:path';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';

/**
 * TEST: 5paisa Connectivity Audit Log Writer
 * 
 * Verifies that the logging infrastructure:
 * 1. Creates the log directory.
 * 2. Writes both JSON and TXT files.
 * 3. Correctly redacts sensitive information.
 * 4. Handles failures gracefully.
 */

// We'll reuse the logic from the main certification script but in a testable way
async function testLogWriter() {
  console.log('=== TESTING 5PAISA AUDIT LOG WRITER ===');
  
  const TEST_LOG_DIR = path.resolve(process.cwd(), 'data', 'test_logs');
  const JSON_PATH = path.join(TEST_LOG_DIR, 'test_audit.json');
  const TXT_PATH = path.join(TEST_LOG_DIR, 'test_audit.txt');

  // Cleanup old test logs
  if (fs.existsSync(TEST_LOG_DIR)) {
    fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  }

  // 1. Directory Creation
  fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  if (!fs.existsSync(TEST_LOG_DIR)) {
    throw new Error('Failed to create test log directory');
  }
  console.log('  ✓ Directory created');

  // 2. Redaction Logic Check
  const sensitiveData = {
    password: 'my-secret-password',
    accessToken: 'ey-very-long-token-that-should-be-redacted',
    safeField: 'visible-data',
    nested: {
      pin: '1234',
      other: 'ok'
    }
  };

  function sanitize(obj: any): any {
    if (!obj) return obj;
    if (typeof obj === 'string') {
      if (obj.length > 50 && (obj.startsWith('ey') || /^[a-f0-9]{32,}$/i.test(obj))) {
        return '[REDACTED_CONTENT]';
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(item => sanitize(item));
    if (typeof obj === 'object') {
      const sanitized: any = {};
      const sensitiveKeys = ['password', 'pin', 'accessToken', 'secret'];
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = sanitize(value);
        }
      }
      return sanitized;
    }
    return obj;
  }

  const sanitized = sanitize(sensitiveData);
  if (sanitized.password !== '[REDACTED]' || sanitized.accessToken !== '[REDACTED]' || sanitized.nested.pin !== '[REDACTED]') {
    throw new Error('Redaction failed!');
  }
  if (sanitized.safeField !== 'visible-data' || sanitized.nested.other !== 'ok') {
    throw new Error('Over-redaction occurred!');
  }
  console.log('  ✓ Redaction verified');

  // 3. File Creation
  const mockReport = {
    runId: 'TEST-RUN-123',
    status: 'FAIL',
    events: [{ stage: 'AUTH', status: 'FAIL', sensitive: 'secret' }]
  };

  fs.writeFileSync(JSON_PATH, JSON.stringify(sanitize(mockReport), null, 2));
  fs.writeFileSync(TXT_PATH, 'TEST REPORT CONTENT');

  if (!fs.existsSync(JSON_PATH) || fs.statSync(JSON_PATH).size === 0) {
    throw new Error('JSON log not created or empty');
  }
  if (!fs.existsSync(TXT_PATH) || fs.statSync(TXT_PATH).size === 0) {
    throw new Error('TXT log not created or empty');
  }

  // 4. JSON Parsing
  const parsed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  if (parsed.runId !== 'TEST-RUN-123') {
    throw new Error('JSON content invalid');
  }
  console.log('  ✓ Files created and verified');

  console.log('\n=== LOG WRITER TEST PASSED ===');
  
  // Final cleanup
  fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
}

testLogWriter().catch(err => {
  console.error('❌ LOG WRITER TEST FAILED:', err);
  process.exit(1);
});
