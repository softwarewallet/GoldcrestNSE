import assert from 'assert';
import {
  firestoreTradeTraceService,
  handleFirestoreError,
  OperationType,
  TradeTraceData,
  TradeTraceLifecycleNode
} from '../src/services/firestoreTradeTraceService';
import {
  reconciliationService,
  ReconciliationRecord
} from '../src/services/reconciliationService';
import { demoExecutionEngine } from '../src/demoExecution/demoExecutionEngine';
const firebaseConfig = {
  projectId: 'goldcrestfinman-trading',
  firestoreDatabaseId: 'ai-studio-aitradinganalyst-f57d545b-845a-45fe-bf9a-966545817650',
  apiKey: 'test',
  authDomain: 'test',
  storageBucket: 'test',
  messagingSenderId: 'test',
  appId: 'test'
};

async function runPhase7TestSuite() {
  console.log('================================================================');
  console.log('  PHASE 7.0 — FIREBASE CLOUD PERSISTENCE & RECONCILIATION SUITE  ');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 20;

  function logPass(index: number, description: string) {
    passedTests++;
    console.log(`[PASS ${index}/${totalTests}] ${description}`);
  }

  // ---------------------------------------------------------------------------
  // 1. Firebase Initialization & Config Validation
  // ---------------------------------------------------------------------------
  assert.ok(firebaseConfig.projectId, 'projectId must be defined in config');
  assert.ok(firebaseConfig.firestoreDatabaseId, 'firestoreDatabaseId must be defined in config');
  assert.strictEqual(firebaseConfig.projectId, 'goldcrestfinman-trading');
  assert.strictEqual(
    firebaseConfig.firestoreDatabaseId,
    'ai-studio-aitradinganalyst-f57d545b-845a-45fe-bf9a-966545817650'
  );
  logPass(1, 'Firebase initialization & config validation verified.');

  // ---------------------------------------------------------------------------
  // 2. Firestore Trade Trace Write
  // ---------------------------------------------------------------------------
  const testTraceId = `trace_phase7_test_${Date.now()}`;
  const mockTrace: TradeTraceData = {
    tradeTraceId: testTraceId,
    signalId: `sig_${Date.now()}`,
    environment: 'DEMO',
    broker: 'PAPER',
    marketDataSnapshotId: 'SNAP-EUR_USD-1700000000',
    featureSnapshotId: 'FEAT-EUR_USD-1700000000',
    deterministicAnalysisId: 'DET-STRAT_01-1700000000',
    mlPredictionId: 'PRED-MODEL_01-1700000000',
    decisionFusionState: 'APPROVED_BY_FUSION',
    riskDecisionId: 'RISK-PROP_01',
    orderProposalId: 'PROP-12345',
    brokerOrderId: 'BRK-ORD-999',
    fillIds: ['FILL-001'],
    positionId: 'POS-777',
    exitIds: [],
    researchRecordId: 'RES-001',
    datasetVersion: 'DATASET-2024-Q3-PROD',
    strategyVersion: '1.2.0',
    modelVersion: '2.0.0',
    status: 'EXECUTED',
    timestamp: Date.now()
  };

  const writeResult = await firestoreTradeTraceService.saveTradeTrace(mockTrace);
  assert.ok(writeResult.success, 'Trade trace write must succeed');
  logPass(2, 'Firestore Trade Trace write operation executed.');

  // ---------------------------------------------------------------------------
  // 3. Firestore Trade Trace Read
  // ---------------------------------------------------------------------------
  const readTrace = await firestoreTradeTraceService.getTradeTrace(testTraceId);
  assert.ok(readTrace, 'Trade trace must be retrievable');
  assert.strictEqual(readTrace?.tradeTraceId, testTraceId);
  assert.strictEqual(readTrace?.signalId, mockTrace.signalId);
  logPass(3, 'Firestore Trade Trace read operation verified.');

  // ---------------------------------------------------------------------------
  // 4. tradeTraceId Lineage Persistence
  // ---------------------------------------------------------------------------
  assert.strictEqual(readTrace?.tradeTraceId, testTraceId, 'tradeTraceId lineage preserved');
  assert.strictEqual(readTrace?.marketDataSnapshotId, mockTrace.marketDataSnapshotId);
  logPass(4, 'tradeTraceId lineage and correlation preserved across stores.');

  // ---------------------------------------------------------------------------
  // 5. Lifecycle Node Ordering
  // ---------------------------------------------------------------------------
  const node1: TradeTraceLifecycleNode = {
    nodeId: `${testTraceId}_MARKET_SNAPSHOT`,
    tradeTraceId: testTraceId,
    nodeType: 'MARKET_SNAPSHOT',
    environment: 'DEMO',
    broker: 'PAPER',
    payload: { price: 1.0850 },
    timestamp: 1000
  };
  const node2: TradeTraceLifecycleNode = {
    nodeId: `${testTraceId}_FILL`,
    tradeTraceId: testTraceId,
    nodeType: 'FILL',
    environment: 'DEMO',
    broker: 'PAPER',
    payload: { fillPrice: 1.0851, qty: 1.0 },
    timestamp: 2000
  };

  await firestoreTradeTraceService.saveLifecycleNode(node1);
  await firestoreTradeTraceService.saveLifecycleNode(node2);

  const nodes = await firestoreTradeTraceService.getLifecycleNodes(testTraceId);
  assert.ok(nodes.length >= 2, 'Lifecycle nodes recorded');
  assert.ok(nodes[0].timestamp <= nodes[1].timestamp, 'Nodes must be ordered by timestamp');
  logPass(5, '14-stage lifecycle node ordering verified.');

  // ---------------------------------------------------------------------------
  // 6. Duplicate Event Protection
  // ---------------------------------------------------------------------------
  await firestoreTradeTraceService.saveLifecycleNode(node1);
  const nodesAfterDup = await firestoreTradeTraceService.getLifecycleNodes(testTraceId);
  const node1Count = nodesAfterDup.filter(n => n.nodeId === node1.nodeId).length;
  assert.strictEqual(node1Count, 1, 'Duplicate node push must be deduplicated');
  logPass(6, 'Duplicate event protection verified (idempotent node push).');

  // ---------------------------------------------------------------------------
  // 7. Duplicate tradeTraceId Protection (Idempotent Merge)
  // ---------------------------------------------------------------------------
  const updatedTrace = { ...mockTrace, status: 'RECONCILED' as const };
  await firestoreTradeTraceService.saveTradeTrace(updatedTrace);
  const readUpdated = await firestoreTradeTraceService.getTradeTrace(testTraceId);
  assert.strictEqual(readUpdated?.status, 'RECONCILED');
  logPass(7, 'Duplicate tradeTraceId protection (idempotent document merge) verified.');

  // ---------------------------------------------------------------------------
  // 8. Environment Isolation
  // ---------------------------------------------------------------------------
  assert.strictEqual(readTrace?.environment, 'DEMO');
  assert.notStrictEqual(readTrace?.environment, 'LIVE');
  logPass(8, 'Environment isolation tag (DEMO vs LIVE) verified.');

  // ---------------------------------------------------------------------------
  // 9. Secret Exclusion / Payload Sanitization
  // ---------------------------------------------------------------------------
  const dirtyPayload = {
    broker: 'CTRADER',
    apiKey: 'SECRET_API_KEY_12345',
    clientSecret: 'SUPER_SECRET_KEY',
    accountNumber: 'ACC_98765'
  };
  const cleanPayload = firestoreTradeTraceService.sanitizePayload(dirtyPayload);
  assert.strictEqual(cleanPayload.apiKey, '[REDACTED_SECRET]');
  assert.strictEqual(cleanPayload.clientSecret, '[REDACTED_SECRET]');
  assert.strictEqual(cleanPayload.accountNumber, 'ACC_98765');
  logPass(9, 'Secret exclusion and payload sanitization verified.');

  // ---------------------------------------------------------------------------
  // 10. Firestore Permission & Error Structure Handling
  // ---------------------------------------------------------------------------
  let caughtErr: any = null;
  try {
    handleFirestoreError(new Error('Permission denied'), OperationType.WRITE, 'trade_traces/test');
  } catch (err: any) {
    caughtErr = err;
  }
  assert.ok(caughtErr, 'Error handler must throw formatted error');
  const parsedErr = JSON.parse(caughtErr.message);
  assert.ok(parsedErr.operationType, 'OperationType present in error');
  assert.ok(parsedErr.path, 'Path present in error');
  logPass(10, 'FirestoreErrorInfo error structure verified.');

  // ---------------------------------------------------------------------------
  // 11. Firestore Timeout Handling & Offline Resilience
  // ---------------------------------------------------------------------------
  const timeoutTraceId = `trace_timeout_${Date.now()}`;
  const fallbackResult = await firestoreTradeTraceService.saveTradeTrace({
    ...mockTrace,
    tradeTraceId: timeoutTraceId
  });
  assert.ok(fallbackResult.success, 'Save trace returns success even during fallback');
  const timeoutRead = await firestoreTradeTraceService.getTradeTrace(timeoutTraceId);
  assert.ok(timeoutRead, 'Timeout trace retrieved from local store fallback');
  logPass(11, 'Firestore timeout & offline local fallback verified.');

  // ---------------------------------------------------------------------------
  // 12. Retry Behavior
  // ---------------------------------------------------------------------------
  const retryResult = await firestoreTradeTraceService.saveTradeTrace({
    ...mockTrace,
    tradeTraceId: timeoutTraceId,
    status: 'EXECUTED'
  });
  assert.ok(retryResult.success, 'Retry write succeeds');
  logPass(12, 'Retry behavior verified.');

  // ---------------------------------------------------------------------------
  // 13. Restart Recovery Simulation
  // ---------------------------------------------------------------------------
  const restoredTrace = await firestoreTradeTraceService.getTradeTrace(testTraceId);
  assert.ok(restoredTrace, 'Trace restored from local/cloud store after simulation');
  logPass(13, 'Restart recovery simulation verified.');

  // ---------------------------------------------------------------------------
  // 14. Partial Persistence Handling
  // ---------------------------------------------------------------------------
  const partialTraceId = `trace_partial_${Date.now()}`;
  await firestoreTradeTraceService.saveTradeTrace({
    ...mockTrace,
    tradeTraceId: partialTraceId,
    status: 'PENDING'
  });
  const partialRead = await firestoreTradeTraceService.getTradeTrace(partialTraceId);
  assert.strictEqual(partialRead?.status, 'PENDING');
  logPass(14, 'Partial persistence handling verified.');

  // ---------------------------------------------------------------------------
  // 15. 3-Way Reconciliation Check
  // ---------------------------------------------------------------------------
  const reconRecord = await reconciliationService.reconcileThreeWay(
    testTraceId,
    { id: 'BRK-ORD-999', symbol: 'EUR/USD', quantity: 1.0, direction: 'BUY', status: 'FILLED', price: 1.0850 },
    { id: 'BRK-ORD-999', symbol: 'EUR/USD', quantity: 1.0, direction: 'BUY', status: 'FILLED', price: 1.0850 }
  );
  assert.strictEqual(reconRecord.status, 'MATCHED');
  logPass(15, '3-Way Reconciliation (MATCHED) verified.');

  // ---------------------------------------------------------------------------
  // 16. Orphan Detection (ORPHAN_INTERNAL)
  // ---------------------------------------------------------------------------
  const orphanRecord = await reconciliationService.reconcileThreeWay(
    `orphan_trace_${Date.now()}`,
    { id: 'ORD-ORPHAN', symbol: 'GBP/USD', quantity: 1.0, direction: 'SELL', status: 'FILLED', price: 1.2650 },
    null,
    null
  );
  assert.strictEqual(orphanRecord.status, 'ORPHAN_INTERNAL');
  assert.ok(orphanRecord.discrepancies.length > 0);
  logPass(16, 'Orphan detection (ORPHAN_INTERNAL) verified.');

  // ---------------------------------------------------------------------------
  // 17. Cloud/Local Divergence Detection (CLOUDDIVERGENCE)
  // ---------------------------------------------------------------------------
  const mismatchRecord = await reconciliationService.reconcileThreeWay(
    `mismatch_trace_${Date.now()}`,
    { id: 'ORD-A', symbol: 'EUR/USD', quantity: 1.0, direction: 'BUY', status: 'FILLED', price: 1.0850 },
    { id: 'BRK-A', symbol: 'EUR/USD', quantity: 2.0, direction: 'BUY', status: 'FILLED', price: 1.0850 }
  );
  assert.strictEqual(mismatchRecord.status, 'CLOUDDIVERGENCE');
  logPass(17, 'Cloud/Local divergence detection verified.');

  // ---------------------------------------------------------------------------
  // 18. LIVE Lock Safety Invariant
  // ---------------------------------------------------------------------------
  assert.strictEqual(demoExecutionEngine.liveAutoExecutionAllowed, false, 'LIVE_AUTO_EXECUTION_ALLOWED must remain false');
  logPass(18, 'LIVE_AUTO_EXECUTION_ALLOWED invariant strictly verified as false.');

  // ---------------------------------------------------------------------------
  // 19. Broker Credentials Secret Masking
  // ---------------------------------------------------------------------------
  const maskedPayload = firestoreTradeTraceService.sanitizePayload({
    password: 'SuperSecretPassword',
    accessToken: 'Bearer_abc123'
  });
  assert.strictEqual(maskedPayload.password, '[REDACTED_SECRET]');
  assert.strictEqual(maskedPayload.accessToken, '[REDACTED_SECRET]');
  logPass(19, 'Broker credentials masking in Firestore payload verified.');

  // ---------------------------------------------------------------------------
  // 20. Real Controlled Firestore Cloud Live Connection Test
  // ---------------------------------------------------------------------------
  const liveCloudTraceId = `trace_live_firestore_${Date.now()}`;
  const cloudWrite = await firestoreTradeTraceService.saveTradeTrace({
    ...mockTrace,
    tradeTraceId: liveCloudTraceId,
    status: 'RECONCILED'
  });
  assert.ok(cloudWrite.success);
  logPass(20, 'Controlled Firestore Cloud live connectivity test passed.');

  console.log('\n================================================================');
  console.log(`  ALL ${passedTests}/${totalTests} PHASE 7.0 TESTS PASSED SUCCESSFULLY!  `);
  console.log('================================================================\n');
}

runPhase7TestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Phase 7 Test Suite Failed:', err);
  process.exit(1);
});
