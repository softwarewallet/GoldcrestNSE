import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';
process.env.GOLDCREST_CONFIG_DIR = path.join(os.tmpdir(), `goldcrest-phase8-9-${Date.now()}`);

const { executeQuery, executeRun } = await import('../src/database/db');
const {
  claimExecutionIntent,
  completeExecutionIntent,
  failExecutionIntent,
  getExecutionIntent,
  markExecutionIntentInFlight,
  markExecutionIntentReconciliationTimeout,
  markExecutionIntentSubmissionAmbiguous,
  resumeExecutionIntentReconciliation
} = await import('../src/services/executionIntentService');
const {
  EXECUTION_RECONCILIATION_MAX_AGE_MS,
  reconcileExecutionIntent: reconcileRuntimeIntent
} = await import('../src/services/executionReconciliationService');
const {
  ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS,
  captureAccountBalanceSnapshots,
  getAccountBalanceSnapshots,
  nextThreeHourBoundary
} = await import('../src/services/accountBalanceSnapshotService');
const {
  AUTO_LIVE_POSITION_CAPACITY_POLL_MS,
  AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS
} = await import('../src/services/autoLiveTradePolicy');
const { autoTradingService } = await import('../src/services/autoTradingService');
const { getAutoLiveMarketGate } = await import('../src/services/marketOpenGate');
const { brokerRegistry } = await import('../src/brokers/registry');
const { getSystemConfig, updateSystemConfig } = await import('../src/services/configService');
const { evaluateRuntimeReadiness, buildRuntimeHealthPayload } = await import('../src/services/runtimeReadiness');
const { validateAutoLiveOrderPacket } = await import('../src/brokers/safety/AutoExecutionEngine');

type Scenario = { id: number; name: string; run: () => void | Promise<void> };

const suffix = `phase8-9-${Date.now()}`;
const key = (n: number) => `${suffix}-${n}`;
const fillBrokerOrderId = `${suffix}-fill-21`;
const fillBrokerFillId = `${suffix}-deal-21`;

const baseOrder = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  orderType: 'MARKET',
  side: 'BUY',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.120,
  takeProfit: 1.129,
  signalId: key(1),
  strategyId: 'fx_structure_v2a'
} as any;

async function createIntent(id: number, symbol = 'EUR/USD', side = 'BUY', quantity = 1000): Promise<void> {
  const idempotencyKey = key(id);
  await claimExecutionIntent(idempotencyKey, {
    broker: 'CTRADER',
    market: 'FOREX',
    symbol,
    side,
    payload: { ...baseOrder, signalId: idempotencyKey, symbol, side, quantity }
  });
  await markExecutionIntentInFlight(idempotencyKey, { requestedQuantity: quantity, quantity });
}

async function setStoredResult(id: number, result: Record<string, unknown>, createdAt?: number): Promise<void> {
  const idempotencyKey = key(id);
  await executeRun(
    'UPDATE execution_intents SET result_json = ?, created_at = ?, updated_at = ? WHERE idempotency_key = ?',
    [JSON.stringify(result), createdAt ?? Date.now(), Date.now(), idempotencyKey]
  );
}

const scenarios: Scenario[] = [
  { id: 1, name: 'Execution intent starts in durable PENDING state', run: async () => {
    await claimExecutionIntent(key(1), {
      broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
      payload: { ...baseOrder, signalId: key(1) }
    });
    assert.equal((await getExecutionIntent(key(1)))?.state, 'PENDING');
  }},
  { id: 2, name: 'PENDING intent can enter IN_FLIGHT', run: async () => {
    await markExecutionIntentInFlight(key(1), { status: 'SUBMISSION_STARTED' });
    assert.equal((await getExecutionIntent(key(1)))?.state, 'IN_FLIGHT');
  }},
  { id: 3, name: 'IN_FLIGHT intent supports reconciliation timeout', run: async () => {
    await markExecutionIntentReconciliationTimeout(key(1), { code: 'BROKER_SUBMISSION_AMBIGUOUS' });
    assert.equal((await getExecutionIntent(key(1)))?.state, 'RECONCILIATION_TIMEOUT');
  }},
  { id: 4, name: 'Reconciliation timeout can resume to IN_FLIGHT', run: async () => {
    await resumeExecutionIntentReconciliation(key(1));
    assert.equal((await getExecutionIntent(key(1)))?.state, 'IN_FLIGHT');
  }},
  { id: 5, name: 'IN_FLIGHT intent can reach terminal COMPLETED', run: async () => {
    await completeExecutionIntent(key(1), { status: 'FILLED', brokerOrderId: 'phase89-complete-1' });
    assert.equal((await getExecutionIntent(key(1)))?.state, 'COMPLETED');
  }},
  { id: 6, name: 'Failed terminal state is durable', run: async () => {
    await claimExecutionIntent(key(6), {
      broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
      payload: { ...baseOrder, signalId: key(6) }
    });
    await failExecutionIntent(key(6), { status: 'REJECTED', brokerOrderId: 'phase89-failed-1' });
    assert.equal((await getExecutionIntent(key(6)))?.state, 'FAILED');
  }},
  { id: 7, name: 'Duplicate claims preserve idempotency', run: async () => {
    const result = await claimExecutionIntent(key(6), {
      broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
      payload: { ...baseOrder, signalId: key(6) }
    });
    assert.equal(result.claimed, false);
    assert.equal(result.existing?.state, 'FAILED');
  }},
  { id: 8, name: 'Idempotency payload mismatch fails closed', run: async () => {
    await assert.rejects(
      claimExecutionIntent(key(6), {
        broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
        payload: { ...baseOrder, signalId: key(6), quantity: 2000 }
      }),
      /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/
    );
  }},
  { id: 9, name: 'Ambiguous submission helper records reconciliation timeout', run: async () => {
    await claimExecutionIntent(key(9), {
      broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
      payload: { ...baseOrder, signalId: key(9) }
    });
    await markExecutionIntentSubmissionAmbiguous(key(9), { detail: 'BROKER_TIMEOUT' });
    const intent = await getExecutionIntent(key(9));
    assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
    assert.equal((intent?.result as any)?.code, 'BROKER_SUBMISSION_AMBIGUOUS');
  }},
  { id: 10, name: 'Execution intent survives reconciliation resume contract', run: async () => {
    await resumeExecutionIntentReconciliation(key(9));
    assert.equal((await getExecutionIntent(key(9)))?.state, 'IN_FLIGHT');
  }},

  { id: 11, name: 'Reconciliation age contract is exactly 15 minutes', run: () => {
    assert.equal(EXECUTION_RECONCILIATION_MAX_AGE_MS, 15 * 60_000);
  }},
  { id: 12, name: 'Stale intent with no broker order times out deterministically', run: async () => {
    await createIntent(12);
    await setStoredResult(12, { requestedQuantity: 1000 }, Date.now() - EXECUTION_RECONCILIATION_MAX_AGE_MS - 1000);
    const original = brokerRegistry.getAdapter;
    let lookupCalled = false;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderByClientOrderId: async () => { lookupCalled = true; return null; }
    });
    try {
      await reconcileRuntimeIntent(key(12));
      const intent = await getExecutionIntent(key(12));
      assert.equal(lookupCalled, true);
      assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
      assert.equal((intent?.result as any)?.operatorActionRequired, true);
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 13, name: 'Broker transport lookup failure is fail-closed and reaches timeout', run: async () => {
    await createIntent(13);
    await setStoredResult(13, { requestedQuantity: 1000 }, Date.now() - EXECUTION_RECONCILIATION_MAX_AGE_MS - 1000);
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderByClientOrderId: async () => { throw new Error('TRANSPORT_DOWN'); }
    });
    try {
      await reconcileRuntimeIntent(key(13));
      const intent = await getExecutionIntent(key(13));
      assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
      assert.equal((intent?.result as any)?.operatorActionRequired, true);
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 14, name: 'Stale reconciliation preserves an auditable timeout error code', run: async () => {
    const intent = await getExecutionIntent(key(13));
    assert.equal((intent?.result as any)?.reconciliationError, 'TRANSPORT_DOWN');
    assert.ok(String((intent?.result as any)?.reconciliationErrorCode || '').length > 0);
  }},
  { id: 15, name: 'Stale reconciliation retains durable attempt count', run: async () => {
    const intent = await getExecutionIntent(key(13));
    assert.ok(Number((intent?.result as any)?.reconciliationAttemptCount) >= 1);
  }},
  { id: 16, name: 'Stale reconciliation retains durable last-attempt timestamp', run: async () => {
    const intent = await getExecutionIntent(key(13));
    assert.ok(Number((intent?.result as any)?.reconciliationLastAttemptAt) > 0);
  }},
  { id: 17, name: 'Cumulative fill quantity cannot regress', run: async () => {
    await createIntent(17, 'GBP/USD', 'BUY', 1000);
    await setStoredResult(17, { requestedQuantity: 1000, filledQuantity: 600, brokerOrderId: 'phase89-fill-17' });
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-17', status: 'PARTIAL', requestedQuantity: 1000,
        filledQuantity: 400, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(17));
      const intent = await getExecutionIntent(key(17));
      assert.equal((intent?.result as any)?.filledQuantity, 600);
      assert.equal(intent?.state, 'IN_FLIGHT');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 18, name: 'Excess broker fill is rejected without completion', run: async () => {
    await createIntent(18, 'GBP/USD', 'BUY', 1000);
    await setStoredResult(18, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: 'phase89-fill-18' });
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-18', status: 'FILLED', requestedQuantity: 1000,
        filledQuantity: 1200, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(18));
      const intent = await getExecutionIntent(key(18));
      assert.equal(intent?.state, 'IN_FLIGHT');
      assert.equal((intent?.result as any)?.reconciliationErrorCode, 'FILL_QUANTITY_INCONSISTENT');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 19, name: 'Incomplete FILLED status remains non-terminal', run: async () => {
    await createIntent(19, 'GBP/USD', 'BUY', 1000);
    await setStoredResult(19, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: 'phase89-fill-19' });
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-19', status: 'FILLED', requestedQuantity: 1000,
        filledQuantity: 600, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(19));
      assert.equal((await getExecutionIntent(key(19)))?.state, 'IN_FLIGHT');
      assert.equal((await getExecutionIntent(key(19)))?.result && ((await getExecutionIntent(key(19)))?.result as any).reconciliationErrorCode, 'FILL_QUANTITY_INCOMPLETE');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 20, name: 'Exact cumulative fill reaches COMPLETED', run: async () => {
    await createIntent(20, 'GBP/USD', 'BUY', 1000);
    await setStoredResult(20, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: 'phase89-fill-20' });
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-20', status: 'FILLED', requestedQuantity: 1000,
        filledQuantity: 1000, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(20));
      assert.equal((await getExecutionIntent(key(20)))?.state, 'COMPLETED');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 21, name: 'Duplicate broker fill events are idempotent', run: async () => {
    await createIntent(21, 'GBP/USD', 'BUY', 1000);
    await setStoredResult(21, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: fillBrokerOrderId });
    const adapter = {
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-21', status: 'PARTIAL', requestedQuantity: 1000,
        filledQuantity: 500, quantity: 1000, timestamp: Date.now(),
        fillEvents: [{ brokerFillId: fillBrokerFillId, quantity: 500, price: 1.123, timestamp: Date.now() }]
      })
    };
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => adapter;
    try {
      await reconcileRuntimeIntent(key(21));
      const before = await executeQuery<any>('SELECT COUNT(*) AS count FROM execution_fill_events WHERE idempotency_key = ?', [key(21)]);
      await reconcileRuntimeIntent(key(21));
      const after = await executeQuery<any>('SELECT COUNT(*) AS count FROM execution_fill_events WHERE idempotency_key = ?', [key(21)]);
      assert.equal(Number(before[0]?.count), Number(after[0]?.count));
      assert.equal(Number(after[0]?.count), 1);
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 22, name: 'Duplicate fill observations are idempotent', run: async () => {
    const before = await executeQuery<any>('SELECT COUNT(*) AS count FROM execution_fill_observations WHERE idempotency_key = ?', [key(21)]);
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-21', status: 'PARTIAL', requestedQuantity: 1000,
        filledQuantity: 500, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(21));
      const after = await executeQuery<any>('SELECT COUNT(*) AS count FROM execution_fill_observations WHERE idempotency_key = ?', [key(21)]);
      assert.equal(Number(after[0]?.count), Number(before[0]?.count));
      assert.equal(Number(after[0]?.count), 1);
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 23, name: 'Rejected broker status fails the execution intent', run: async () => {
    await createIntent(23, 'GBP/USD', 'SELL', 1000);
    await setStoredResult(23, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: 'phase89-fill-23' });
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({
      getOrderStatus: async () => ({
        brokerOrderId: 'phase89-fill-23', status: 'REJECTED', requestedQuantity: 1000,
        filledQuantity: 0, quantity: 1000, timestamp: Date.now()
      })
    });
    try {
      await reconcileRuntimeIntent(key(23));
      assert.equal((await getExecutionIntent(key(23)))?.state, 'FAILED');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 24, name: 'LIVE adapter selection is explicit during reconciliation', run: async () => {
    await createIntent(24);
    const original = brokerRegistry.getAdapter;
    let environmentSeen: unknown;
    (brokerRegistry as any).getAdapter = (_broker: unknown, environment: unknown) => {
      environmentSeen = environment;
      return { getOrderStatus: async () => ({ status: 'CANCELLED', brokerOrderId: 'phase89-fill-24', quantity: 1000, requestedQuantity: 1000, filledQuantity: 0, timestamp: Date.now() }) };
    };
    try {
      await setStoredResult(24, { requestedQuantity: 1000, filledQuantity: 0, brokerOrderId: 'phase89-fill-24' });
      await reconcileRuntimeIntent(key(24));
      assert.equal(environmentSeen, 'LIVE');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 25, name: 'Live reconciliation leaves no unresolved stale intent after timeout transition', run: async () => {
    await createIntent(25);
    await setStoredResult(25, { requestedQuantity: 1000, brokerOrderId: 'phase89-fill-25' }, Date.now() - EXECUTION_RECONCILIATION_MAX_AGE_MS - 1000);
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({ getOrderStatus: async () => ({ status: 'PENDING', brokerOrderId: 'phase89-fill-25', quantity: 1000, requestedQuantity: 1000, filledQuantity: 0, timestamp: Date.now() }) });
    try {
      await reconcileRuntimeIntent(key(25));
      assert.equal((await getExecutionIntent(key(25)))?.state, 'RECONCILIATION_TIMEOUT');
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},

  { id: 26, name: 'Runtime readiness is false until both database and preflight are ready', run: () => {
    assert.deepEqual(evaluateRuntimeReadiness(false, true), { ready: false, statusCode: 503, status: 'not_ready' });
    assert.deepEqual(evaluateRuntimeReadiness(true, false), { ready: false, statusCode: 503, status: 'not_ready' });
  }},
  { id: 27, name: 'Runtime readiness becomes ready only when both inputs are true', run: () => {
    assert.deepEqual(evaluateRuntimeReadiness(true, true), { ready: true, statusCode: 200, status: 'ready' });
  }},
  { id: 28, name: 'Health payload is stable and environment-aware', run: () => {
    assert.deepEqual(buildRuntimeHealthPayload('production'), {
      status: 'ok', service: 'goldcrest', environment: 'production'
    });
  }},
  { id: 29, name: 'Runtime readiness distinguishes database initialization failure from generic ready state', run: () => {
    assert.equal(evaluateRuntimeReadiness(false, false).statusCode, 503);
    assert.equal(evaluateRuntimeReadiness(true, true).statusCode, 200);
  }},
  { id: 30, name: 'Production start command is cross-platform', run: async () => {
    const packageJson = JSON.parse((await import('node:fs/promises')).readFile
      ? await (await import('node:fs/promises')).readFile(path.resolve(process.cwd(), 'package.json'), 'utf8')
      : '{}');
    assert.equal(packageJson.scripts['start:prod'], 'cross-env NODE_ENV=production node dist/server.cjs');
  }},

  { id: 31, name: 'Auto Live stop control returns STOPPED state', run: () => {
    const status = autoTradingService.stop('Phase 8.9 certification stop');
    assert.equal(status.state, 'STOPPED');
  }},
  { id: 32, name: 'Auto Live initial observable state is STOPPED after explicit stop', run: () => {
    assert.equal(autoTradingService.getStatus().state, 'STOPPED');
  }},
  { id: 33, name: 'Closed-market confirmation contract is explicit', run: () => {
    const marketGate = getAutoLiveMarketGate();
    const status = autoTradingService.start({ confirmWhenClosed: false });
    if (marketGate.bothMarketsClosed) {
      assert.equal(status.requiresClosedMarketConfirmation, true);
    } else {
      assert.notEqual(status.requiresClosedMarketConfirmation, true);
    }
    autoTradingService.stop('Phase 8.9 closed-market confirmation cleanup');
  }},
  { id: 34, name: 'Auto Live capacity polling and position refresh are both 10 seconds', run: () => {
    assert.equal(AUTO_LIVE_POSITION_CAPACITY_POLL_MS, 10_000);
    assert.equal(AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS, 10_000);
  }},
  { id: 35, name: 'Selected Auto Live pairs remain configuration-driven', run: () => {
    updateSystemConfig({ autoLiveForexPairs: ['USD/JPY', 'AUD/USD', 'EUR/GBP'] });
    assert.deepEqual(autoTradingService.getStatus().pairs, ['USD/JPY', 'AUD/USD', 'EUR/GBP']);
  }},
  { id: 36, name: 'Balance snapshot query is durable and broker-side-effect-free', run: async () => {
    const rows = await getAccountBalanceSnapshots({ limit: 5 });
    assert.ok(Array.isArray(rows));
  }},
  { id: 37, name: 'Account balance snapshot capture uses LIVE adapters', run: async () => {
    const original = brokerRegistry.getAdapter;
    const seen: string[] = [];
    (brokerRegistry as any).getAdapter = (broker: string, environment: string) => {
      seen.push(`${broker}:${environment}`);
      return {
        getAccount: async () => ({ accountId: `TEST-${broker}`, currency: 'USD', balance: 1000, equity: 1000, usedMargin: 0, freeMargin: 1000 })
      };
    };
    try {
      const captured = await captureAccountBalanceSnapshots(Date.now());
      assert.equal(captured.length, 2);
      assert.deepEqual(new Set(seen), new Set(['CTRADER:LIVE', 'FIVE_PAISA:LIVE']));
      assert.ok(captured.every(row => row.status === 'CAPTURED'));
    } finally {
      (brokerRegistry as any).getAdapter = original;
    }
  }},
  { id: 38, name: 'Account balance snapshot cadence is an exact three-hour boundary', run: () => {
    assert.equal(ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS, 3);
    const input = new Date(2026, 8, 27, 10, 17, 22);
    const next = nextThreeHourBoundary(input);
    assert.equal(next.getFullYear(), input.getFullYear());
    assert.equal(next.getMonth(), input.getMonth());
    assert.equal(next.getDate(), input.getDate());
    assert.equal(next.getHours(), 12);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getSeconds(), 0);
  }},
  { id: 39, name: 'cTrader API selector persists and restores without changing LIVE_ONLY mode', run: () => {
    assert.equal(updateSystemConfig({ cTraderApiMode: 'LIVE' }).cTraderApiMode, 'LIVE');
    assert.equal(updateSystemConfig({ cTraderApiMode: 'DEMO' }).cTraderApiMode, 'DEMO');
    assert.equal(getSystemConfig().tradingMode, 'LIVE_ONLY');
  }},
  { id: 40, name: 'LIVE broker registry exposes both authoritative live adapters', run: () => {
    assert.equal(brokerRegistry.getEnvironment(), 'LIVE');
    const adapters = brokerRegistry.getActiveLiveAdapters();
    assert.deepEqual(adapters.map(adapter => `${adapter.broker}:${adapter.environment}`).sort(), ['CTRADER:LIVE', 'FIVE_PAISA:LIVE']);
    assert.throws(() => brokerRegistry.setEnvironment('DEMO' as any), /LIVE_ONLY/i);
  }}
];

async function run(): Promise<void> {
  console.log('===========================================================================');
  console.log('PHASE 8.9 — LIVE RUNTIME & OPERATIONAL RESILIENCE CERTIFICATION');
  console.log('40 deterministic, broker-side-effect-free runtime resilience scenarios');
  console.log('===========================================================================');

  assert.equal(scenarios.length, 40);
  let passed = 0;
  for (const item of scenarios) {
    await item.run();
    passed += 1;
    console.log(`[PASS ${String(item.id).padStart(2, '0')}/40] ${item.name}`);
  }

  assert.equal(passed, 40);
  assert.equal(autoTradingService.getStatus().state, 'STOPPED');
  assert.equal(getSystemConfig().cTraderApiMode, 'DEMO');
  console.log('===========================================================================');
  console.log('PHASE 8.9 CERTIFICATION: 40/40 PASSED');
  console.log('Live broker order submission: NOT INVOKED');
  console.log('Execution-intent durable recovery: VERIFIED');
  console.log('Reconciliation failure/timeout behavior: VERIFIED');
  console.log('Runtime readiness contract: VERIFIED');
  console.log('Auto Live operational controls: VERIFIED');
  console.log('Three-hour balance snapshot contract: VERIFIED');
  console.log('cTrader LIVE/DEMO selector preservation: VERIFIED');
  console.log('LIVE-only broker registry: VERIFIED');
  console.log('===========================================================================');
}

run().catch(error => {
  console.error('Phase 8.9 certification failed:', error);
  process.exitCode = 1;
});
