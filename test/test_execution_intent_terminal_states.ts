import assert from 'node:assert/strict';
import { completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight, markExecutionIntentReconciliationTimeout, resumeExecutionIntentReconciliation } from '../src/services/executionIntentService';
import { executeQuery, executeRun } from '../src/database/db';

const key = 'TEST-EXECUTION-INTENT-TRANSITIONS-' + Date.now();
await executeRun('INSERT INTO execution_intents (idempotency_key, claim_token, broker, market, symbol, side, state, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [key, 'test', 'CTRADER', 'FOREX', 'EUR/USD', 'BUY', 'PENDING', '{}', Date.now(), Date.now()]);
await markExecutionIntentInFlight(key, { status: 'SUBMISSION_STARTED' });
await markExecutionIntentReconciliationTimeout(key, { code: 'BROKER_SUBMISSION_AMBIGUOUS' });
await completeExecutionIntent(key, { status: 'FILLED' });
let row = (await executeQuery<any>('SELECT state FROM execution_intents WHERE idempotency_key = ?', [key]))[0];
assert.equal(row.state, 'COMPLETED');
await resumeExecutionIntentReconciliation(key);
await failExecutionIntent(key, { status: 'REJECTED' });
row = (await executeQuery<any>('SELECT state FROM execution_intents WHERE idempotency_key = ?', [key]))[0];
assert.equal(row.state, 'COMPLETED');

const key2 = key + '-FAILED';
await executeRun('INSERT INTO execution_intents (idempotency_key, claim_token, broker, market, symbol, side, state, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [key2, 'test', 'CTRADER', 'FOREX', 'EUR/USD', 'BUY', 'IN_FLIGHT', '{}', Date.now(), Date.now()]);
await markExecutionIntentReconciliationTimeout(key2, { code: 'BROKER_SUBMISSION_AMBIGUOUS' });
await failExecutionIntent(key2, { status: 'REJECTED' });
row = (await executeQuery<any>('SELECT state FROM execution_intents WHERE idempotency_key = ?', [key2]))[0];
assert.equal(row.state, 'FAILED');
console.log('EXECUTION INTENT TERMINAL STATE TRANSITION TESTS PASSED');
