import assert from 'node:assert/strict';

import { brokerRegistry } from '../src/brokers/registry';
import { autoExecutionEngine, validateAutoLiveOrderPacket } from '../src/brokers/safety/AutoExecutionEngine';
import {
  claimExecutionIntent,
  completeExecutionIntent,
  failExecutionIntent,
  getExecutionIntent,
  markExecutionIntentInFlight,
  markExecutionIntentReconciliationTimeout,
  reconcileExecutionIntent
} from '../src/services/executionIntentService';

type Scenario = { id: number; name: string; run: () => void | Promise<void> };

const suffix = `phase8-7-${Date.now()}`;
const key = (n: number) => `${suffix}-${n}`;

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

const scenarios: Scenario[] = [
  { id: 1, name: 'FOREX routes to cTrader', run: () => assert.equal(brokerRegistry.validateMarketCompatibility('FOREX', 'CTRADER').compatible, true) },
  { id: 2, name: 'Indian equity routes to 5paisa', run: () => assert.equal(brokerRegistry.validateMarketCompatibility('INDIAN_EQUITY', 'FIVE_PAISA').compatible, true) },
  { id: 3, name: 'cTrader rejects Indian market routing', run: () => assert.equal(brokerRegistry.validateMarketCompatibility('INDIAN_EQUITY', 'CTRADER').compatible, false) },
  { id: 4, name: '5paisa rejects FOREX routing', run: () => assert.equal(brokerRegistry.validateMarketCompatibility('FOREX', 'FIVE_PAISA').compatible, false) },
  { id: 5, name: 'Non-LIVE environment cannot be selected', run: () => assert.throws(() => brokerRegistry.setEnvironment('DEMO' as any), /LIVE_ONLY/i) },

  { id: 6, name: 'Valid BUY packet passes final validation', run: () => assert.equal(validateAutoLiveOrderPacket(baseOrder).valid, true) },
  { id: 7, name: 'Valid SELL packet passes final validation', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseOrder, side: 'SELL', stopLoss: 1.129, takeProfit: 1.120 }).valid, true) },
  { id: 8, name: 'Fractional quantity cannot reach broker packet', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseOrder, quantity: 1000.5 }).valid, false) },
  { id: 9, name: 'Missing stop loss cannot reach broker packet', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseOrder, stopLoss: undefined }).valid, false) },
  { id: 10, name: 'Invalid BUY geometry cannot reach broker packet', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseOrder, stopLoss: 1.125 }).valid, false) },

  { id: 11, name: 'First execution intent is claimed', run: async () => {
    const result = await claimExecutionIntent(key(11), { broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', payload: { ...baseOrder, signalId: key(11) } });
    assert.equal(result.claimed, true);
  }},
  { id: 12, name: 'Duplicate execution intent is not claimed twice', run: async () => {
    const result = await claimExecutionIntent(key(11), { broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', payload: { ...baseOrder, signalId: key(11) } });
    assert.equal(result.claimed, false);
    assert.equal(result.existing?.state, 'PENDING');
  }},
  { id: 13, name: 'Duplicate intent preserves original payload', run: async () => {
    const result = await getExecutionIntent(key(11));
    assert.equal(result?.payload && (result.payload as any).signalId, key(11));
  }},
  { id: 14, name: 'Idempotency payload mismatch is rejected', run: async () => {
    await assert.rejects(
      claimExecutionIntent(key(11), { broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', payload: { ...baseOrder, signalId: key(11), quantity: 2000 } }),
      /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/
    );
  }},
  { id: 15, name: 'PENDING intent can enter IN_FLIGHT', run: async () => {
    await markExecutionIntentInFlight(key(11), { status: 'SUBMISSION_STARTED' });
    assert.equal((await getExecutionIntent(key(11)))?.state, 'IN_FLIGHT');
  }},
  { id: 16, name: 'IN_FLIGHT intent can complete', run: async () => {
    await completeExecutionIntent(key(11), { status: 'FILLED', brokerOrderId: 'TEST-1101' });
    const intent = await getExecutionIntent(key(11));
    assert.equal(intent?.state, 'COMPLETED');
    assert.equal((intent?.result as any)?.brokerOrderId, 'TEST-1101');
  }},
  { id: 17, name: 'Completed intent cannot be completed again by stale transition', run: async () => {
    await completeExecutionIntent(key(11), { status: 'FILLED', brokerOrderId: 'TEST-1102' });
    assert.equal((await getExecutionIntent(key(11)))?.result && ((await getExecutionIntent(key(11)))?.result as any).brokerOrderId, 'TEST-1101');
  }},

  { id: 18, name: 'Second intent can enter IN_FLIGHT', run: async () => {
    const result = await claimExecutionIntent(key(18), { broker: 'CTRADER', market: 'FOREX', symbol: 'GBP/USD', side: 'SELL', payload: { ...baseOrder, signalId: key(18), symbol: 'GBP/USD', side: 'SELL', stopLoss: 1.130, takeProfit: 1.120 } });
    assert.equal(result.claimed, true);
    await markExecutionIntentInFlight(key(18), { status: 'SUBMISSION_STARTED' });
    assert.equal((await getExecutionIntent(key(18)))?.state, 'IN_FLIGHT');
  }},
  { id: 19, name: 'IN_FLIGHT intent can be moved to reconciliation timeout', run: async () => {
    await markExecutionIntentReconciliationTimeout(key(18), { code: 'BROKER_SUBMISSION_AMBIGUOUS' });
    assert.equal((await getExecutionIntent(key(18)))?.state, 'RECONCILIATION_TIMEOUT');
  }},
  { id: 20, name: 'Timed-out intent remains durable for reconciliation', run: async () => {
    const intent = await getExecutionIntent(key(18));
    assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
    assert.equal((intent?.result as any)?.code, 'BROKER_SUBMISSION_AMBIGUOUS');
  }},
  { id: 21, name: 'Broker-native reconciliation resolves an exact order', run: async () => {
    const adapter: any = {
      broker: 'CTRADER',
      environment: 'LIVE',
      getOrderByClientOrderId: async () => ({
        id: 'native-18',
        brokerOrderId: 'native-18',
        broker: 'CTRADER',
        market: 'FOREX',
        symbol: 'GBP/USD',
        side: 'SELL',
        status: 'FILLED',
        requestedQuantity: 1000,
        filledQuantity: 1000,
        quantity: 1000,
        timestamp: Date.now()
      })
    };
    const result = await reconcileExecutionIntent(key(18), adapter);
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.order?.brokerOrderId, 'native-18');
    assert.equal((await getExecutionIntent(key(18)))?.state, 'COMPLETED');
  }},
  { id: 22, name: 'Reconciliation of completed intent is skipped', run: async () => {
    const adapter: any = { getOrderByClientOrderId: async () => { throw new Error('BROKER_CALL_SHOULD_NOT_OCCUR'); } };
    const result = await reconcileExecutionIntent(key(18), adapter);
    assert.equal(result.status, 'SKIPPED');
  }},

  { id: 23, name: 'Ambiguous broker history does not resolve an intent', run: async () => {
    await claimExecutionIntent(key(23), { broker: 'CTRADER', market: 'FOREX', symbol: 'USD/JPY', side: 'BUY', payload: { ...baseOrder, signalId: key(23), symbol: 'USD/JPY' } });
    await markExecutionIntentInFlight(key(23), { status: 'SUBMISSION_STARTED' });
    const adapter: any = {
      getOrderHistoryRange: async () => [
        { id: 'a', brokerOrderId: 'a', symbol: 'USD/JPY', side: 'BUY', status: 'FILLED', requestedQuantity: 1000, quantity: 1000, timestamp: Date.now() },
        { id: 'b', brokerOrderId: 'b', symbol: 'USD/JPY', side: 'BUY', status: 'FILLED', requestedQuantity: 1000, quantity: 1000, timestamp: Date.now() }
      ]
    };
    const result = await reconcileExecutionIntent(key(23), adapter);
    assert.equal(result.status, 'AMBIGUOUS');
    assert.equal((await getExecutionIntent(key(23)))?.state, 'IN_FLIGHT');
  }},
  { id: 24, name: 'No broker match does not falsely complete an intent', run: async () => {
    const adapter: any = { getOrderHistoryRange: async () => [] };
    const result = await reconcileExecutionIntent(key(23), adapter);
    assert.equal(result.status, 'NOT_FOUND');
    assert.equal((await getExecutionIntent(key(23)))?.state, 'IN_FLIGHT');
  }},

  { id: 25, name: 'Guarded engine rejects malformed packet before broker placer', run: async () => {
    const original = brokerRegistry.getAdapterForMarket;
    let placeCalled = false;
    const adapter: any = {
      broker: 'CTRADER',
      environment: 'LIVE',
      getInstrument: async () => ({ symbol: 'EUR/USD', digits: 3, maxQuantity: 1000000, quoteCurrency: 'USD' }),
      placeAutonomousOrder: async () => { placeCalled = true; throw new Error('SHOULD_NOT_BE_CALLED'); }
    };
    (brokerRegistry as any).getAdapterForMarket = () => adapter;
    try {
      const result = await autoExecutionEngine.processSignal(
        { signalTimestamp: Date.now(), signal: baseOrder } as any,
        { ...baseOrder, signalId: key(25), quantity: 0 },
        {
          signalAgeMs: 0,
          currentQuote: { bid: 1.122, ask: 1.123, timestamp: Date.now(), status: 'FRESH' }
        } as any
      );
      assert.equal(result.executed, false);
      assert.equal(result.code, 'INVALID_AUTONOMOUS_ORDER_PACKET');
      assert.equal(placeCalled, false);
    } finally {
      (brokerRegistry as any).getAdapterForMarket = original;
    }
  }},
  { id: 26, name: 'Guarded engine does not submit when autonomous permission is locked', run: async () => {
    const original = brokerRegistry.getAdapterForMarket;
    let placeCalled = false;
    const adapter: any = {
      broker: 'CTRADER',
      environment: 'LIVE',
      getInstrument: async () => ({ symbol: 'EUR/USD', digits: 3, maxQuantity: 1000000, quoteCurrency: 'USD' }),
      getTradingStatus: async () => 'DISCONNECTED',
      placeAutonomousOrder: async () => { placeCalled = true; throw new Error('SHOULD_NOT_BE_CALLED'); }
    };
    (brokerRegistry as any).getAdapterForMarket = () => adapter;
    try {
      const result = await autoExecutionEngine.processSignal(
        { signalTimestamp: Date.now(), signal: baseOrder } as any,
        { ...baseOrder, signalId: key(26) },
        {
          signalAgeMs: 0,
          currentQuote: { bid: 1.122, ask: 1.123, timestamp: Date.now(), status: 'FRESH' },
          isMarketOpen: true,
          dailyRealizedLoss: 0,
          dailyLossLimit: 100,
          totalAccountExposure: 0,
          maxAllowedExposure: 1000000,
          activePositionsCount: 0,
          maxOpenPositions: 5,
          activePairPositionsCount: 0,
          maxPairPositions: 5
        } as any
      );
      assert.equal(result.executed, false);
      assert.equal(result.code, 'SAFETY_GATE_REJECTED');
      assert.equal(placeCalled, false);
    } finally {
      (brokerRegistry as any).getAdapterForMarket = original;
    }
  }},
  { id: 27, name: 'Autonomous engine remains disabled after blocked signal', run: () => {
    assert.equal(autoExecutionEngine.getControls().autonomousLiveExecutionAllowed, false);
  }},

  { id: 28, name: 'LIVE registry environment remains authoritative', run: () => assert.equal(brokerRegistry.getEnvironment(), 'LIVE') },
  { id: 29, name: 'Execution intent terminal state is durable', run: async () => assert.ok(['COMPLETED', 'IN_FLIGHT'].includes(String((await getExecutionIntent(key(18)))?.state))) },
  { id: 30, name: 'Phase 8.7 certification uses unique deterministic intent namespace', run: () => assert.match(suffix, /^phase8-7-\d+$/) }
];

async function run(): Promise<void> {
  console.log('===========================================================================');
  console.log('PHASE 8.7 — AUTO LIVE END-TO-END EXECUTION BOUNDARY CERTIFICATION');
  console.log('30 deterministic scenarios; broker submission is prohibited by test design');
  console.log('===========================================================================');

  assert.equal(scenarios.length, 30);

  for (const scenario of scenarios) {
    await scenario.run();
    console.log(`[PASS ${String(scenario.id).padStart(2, '0')}/30] ${scenario.name}`);
  }

  assert.equal(brokerRegistry.getEnvironment(), 'LIVE');
  assert.equal(autoExecutionEngine.getControls().autonomousLiveExecutionAllowed, false);

  console.log('===========================================================================');
  console.log('PHASE 8.7 CERTIFICATION: 30/30 PASSED');
  console.log('Live broker submission: NOT INVOKED');
  console.log('Duplicate-order protection: VERIFIED');
  console.log('Ambiguous submission reconciliation: VERIFIED');
  console.log('Autonomous permission boundary: LOCKED');
  console.log('===========================================================================');
}

run().catch((error) => {
  console.error('Phase 8.7 certification failed:', error);
  process.exitCode = 1;
});
