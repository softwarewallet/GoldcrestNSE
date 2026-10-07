// ============================================================================
// PHASE 8.6 — CURRENT PRODUCTION READINESS & LIVE-GATE CERTIFICATION
// 50 deterministic scenarios against the active Goldcrest safety architecture.
// This suite is deliberately broker-side-effect free: it validates the
// application safety/readiness boundaries without submitting a live order.
// ============================================================================

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const configDir = path.join(os.tmpdir(), `goldcrest-phase8-6-${Date.now()}`);
process.env.GOLDCREST_CONFIG_DIR = configDir;
process.env.GOLDCREST_CONFIG_FILE = path.join(configDir, 'system-config.json');
process.env.NODE_ENV = 'test';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';

const { getSystemConfig, updateSystemConfig } = await import('../src/services/configService');
const {
  LIVE_AUTO_EXECUTION_ALLOWED,
  refreshAutonomousExecutionPermission,
  lockAutonomousExecutionGate,
  autoExecutionEngine,
  validateAutoLiveOrderPacket
} = await import('../src/brokers/safety/AutoExecutionEngine');
const { autoTradeReadinessService } = await import('../src/brokers/safety/AutoTradeReadiness');

type Scenario = {
  id: number;
  category: string;
  name: string;
  run: () => void | Promise<void>;
};

const baseBuy = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  orderType: 'MARKET',
  side: 'BUY',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.120,
  takeProfit: 1.129,
  signalId: 'phase8-6-signal',
  strategyId: 'fx_structure_v2a'
} as any;

const baseSell = {
  ...baseBuy,
  side: 'SELL',
  stopLoss: 1.129,
  takeProfit: 1.120
} as any;

const scenarios: Scenario[] = [
  // --------------------------------------------------------------------------
  // A. Runtime / production architecture invariants (10)
  // --------------------------------------------------------------------------
  { id: 1, category: 'RUNTIME_INVARIANTS', name: 'Trading mode is LIVE_ONLY', run: () => assert.equal(getSystemConfig().tradingMode, 'LIVE_ONLY') },
  { id: 2, category: 'RUNTIME_INVARIANTS', name: 'cTrader API selector defaults to DEMO', run: () => assert.equal(getSystemConfig().cTraderApiMode, 'DEMO') },
  { id: 3, category: 'RUNTIME_INVARIANTS', name: 'Autonomous permission starts locked', run: () => assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false) },
  { id: 4, category: 'RUNTIME_INVARIANTS', name: 'Environment refresh keeps autonomous execution locked', run: () => assert.equal(refreshAutonomousExecutionPermission(), false) },
  { id: 5, category: 'RUNTIME_INVARIANTS', name: 'Auto-trading environment flag is disabled', run: () => assert.notEqual(process.env.GOLDCREST_AUTO_TRADING_ENABLED, 'true') },
  { id: 6, category: 'RUNTIME_INVARIANTS', name: 'Autonomous-live environment flag is disabled', run: () => assert.notEqual(process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION, 'true') },
  { id: 7, category: 'RUNTIME_INVARIANTS', name: 'Production strategy approval starts disabled', run: () => assert.notEqual(process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED, 'true') },
  { id: 8, category: 'RUNTIME_INVARIANTS', name: 'LIVE trading flag starts disabled', run: () => assert.notEqual(process.env.LIVE_TRADING_ENABLED, 'true') },
  { id: 9, category: 'RUNTIME_INVARIANTS', name: 'Execution controls expose autonomous permission', run: () => assert.equal(typeof autoExecutionEngine.getControls().autonomousLiveExecutionAllowed, 'boolean') },
  { id: 10, category: 'RUNTIME_INVARIANTS', name: 'Execution gate can be explicitly locked', run: () => assert.equal(lockAutonomousExecutionGate().code, 'EXECUTION_GATE_LOCKED') },

  // --------------------------------------------------------------------------
  // B. Auto-Live order packet validation (10)
  // --------------------------------------------------------------------------
  { id: 11, category: 'ORDER_PACKET_SAFETY', name: 'Valid BUY packet passes', run: () => assert.equal(validateAutoLiveOrderPacket(baseBuy).valid, true) },
  { id: 12, category: 'ORDER_PACKET_SAFETY', name: 'Valid SELL packet passes', run: () => assert.equal(validateAutoLiveOrderPacket(baseSell).valid, true) },
  { id: 13, category: 'ORDER_PACKET_SAFETY', name: 'Non-FOREX market is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, market: 'INDIA' }).valid, false) },
  { id: 14, category: 'ORDER_PACKET_SAFETY', name: 'Malformed FX symbol is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, symbol: 'EURUSD' }).valid, false) },
  { id: 15, category: 'ORDER_PACKET_SAFETY', name: 'Non-market order type is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, orderType: 'LIMIT' }).valid, false) },
  { id: 16, category: 'ORDER_PACKET_SAFETY', name: 'Zero quantity is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, quantity: 0 }).valid, false) },
  { id: 17, category: 'ORDER_PACKET_SAFETY', name: 'Fractional quantity is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, quantity: 1000.5 }).valid, false) },
  { id: 18, category: 'ORDER_PACKET_SAFETY', name: 'Non-positive entry price is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, price: 0 }).valid, false) },
  { id: 19, category: 'ORDER_PACKET_SAFETY', name: 'BUY stop-loss above entry is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, stopLoss: 1.125 }).valid, false) },
  { id: 20, category: 'ORDER_PACKET_SAFETY', name: 'SELL take-profit above entry is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseSell, takeProfit: 1.125 }).valid, false) },

  // --------------------------------------------------------------------------
  // C. Order packet capital-protection fields (10)
  // --------------------------------------------------------------------------
  { id: 21, category: 'ORDER_PACKET_SAFETY', name: 'BUY take-profit must exceed entry', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, takeProfit: 1.121 }).valid, false) },
  { id: 22, category: 'ORDER_PACKET_SAFETY', name: 'SELL stop-loss must exceed entry', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseSell, stopLoss: 1.121 }).valid, false) },
  { id: 23, category: 'ORDER_PACKET_SAFETY', name: 'Missing stop-loss is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, stopLoss: undefined }).valid, false) },
  { id: 24, category: 'ORDER_PACKET_SAFETY', name: 'Missing take-profit is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, takeProfit: undefined }).valid, false) },
  { id: 25, category: 'ORDER_PACKET_SAFETY', name: 'Negative quantity is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, quantity: -1 }).valid, false) },
  { id: 26, category: 'ORDER_PACKET_SAFETY', name: 'NaN quantity is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, quantity: Number.NaN }).valid, false) },
  { id: 27, category: 'ORDER_PACKET_SAFETY', name: 'NaN entry price is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, price: Number.NaN }).valid, false) },
  { id: 28, category: 'ORDER_PACKET_SAFETY', name: 'NaN stop-loss is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, stopLoss: Number.NaN }).valid, false) },
  { id: 29, category: 'ORDER_PACKET_SAFETY', name: 'NaN take-profit is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, takeProfit: Number.NaN }).valid, false) },
  { id: 30, category: 'ORDER_PACKET_SAFETY', name: 'Invalid side geometry is rejected', run: () => assert.equal(validateAutoLiveOrderPacket({ ...baseBuy, side: 'SELL' }).valid, false) },

  // --------------------------------------------------------------------------
  // D. Operator readiness / state-machine controls (10)
  // --------------------------------------------------------------------------
  { id: 31, category: 'READINESS_STATE', name: 'Initial readiness state is OFF', run: () => assert.equal(autoTradeReadinessService.getState(), 'OFF') },
  { id: 32, category: 'READINESS_STATE', name: 'Blocked report cannot be armed', run: async () => {
    const report = await autoTradeReadinessService.arm({
      state: 'BLOCKED',
      ready: false,
      evaluatedAt: Date.now(),
      checks: { strategyCalibrated: false },
      metrics: {
        dailyLoss: 0, dailyLossLimit: 100, activePositions: 0, maxOpenPositions: 5,
        consecutiveLosses: 0, maxConsecutiveLosses: 3, spreadBps: null, maxSpreadBps: 30,
        signalAgeMs: 1000, signalMaxAgeMs: 300000
      },
      failedReasons: ['Production strategy approval is not enabled.']
    });
    assert.equal(report.ready, false);
    assert.equal(report.state, 'BLOCKED');
  }},
  { id: 33, category: 'READINESS_STATE', name: 'Blocked readiness state remains observable', run: () => {
    assert.equal(autoTradeReadinessService.getState(), 'BLOCKED');
  }},
  { id: 34, category: 'READINESS_STATE', name: 'A structurally ready report can enter ARMED state', run: async () => {
    const report = await autoTradeReadinessService.arm({
      state: 'OFF',
      ready: true,
      evaluatedAt: Date.now(),
      checks: { strategyCalibrated: true },
      metrics: {
        dailyLoss: 0, dailyLossLimit: 100, activePositions: 0, maxOpenPositions: 5,
        consecutiveLosses: 0, maxConsecutiveLosses: 3, spreadBps: 1, maxSpreadBps: 30,
        signalAgeMs: 1000, signalMaxAgeMs: 300000
      },
      failedReasons: []
    });
    assert.equal(report.ready, true);
    assert.equal(report.state, 'ARMED');
  }},
  { id: 35, category: 'READINESS_STATE', name: 'ARMED state is observable', run: () => assert.equal(autoTradeReadinessService.getState(), 'ARMED') },
  { id: 36, category: 'READINESS_STATE', name: 'Disarm returns OFF state', run: () => assert.equal(autoTradeReadinessService.disarm()?.state, 'OFF') },
  { id: 37, category: 'READINESS_STATE', name: 'Disarm makes readiness false', run: () => assert.equal(autoTradeReadinessService.getStatus()?.ready, false) },
  { id: 38, category: 'READINESS_STATE', name: 'Execution gate lock returns success', run: () => assert.equal(lockAutonomousExecutionGate().success, true) },
  { id: 39, category: 'READINESS_STATE', name: 'Execution permission remains false after lock', run: () => assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false) },
  { id: 40, category: 'READINESS_STATE', name: 'Refresh after lock remains false', run: () => assert.equal(refreshAutonomousExecutionPermission(), false) },

  // --------------------------------------------------------------------------
  // E. Config / research-governance contracts (10)
  // --------------------------------------------------------------------------
  { id: 41, category: 'GOVERNANCE_CONTRACTS', name: 'Default daily loss limit is 3 percent', run: () => assert.equal(getSystemConfig().maxDailyLossPct, 3) },
  { id: 42, category: 'GOVERNANCE_CONTRACTS', name: 'Default open-position limit is positive', run: () => assert.ok(getSystemConfig().maxOpenPositions > 0) },
  { id: 43, category: 'GOVERNANCE_CONTRACTS', name: 'Default consecutive-loss limit is positive', run: () => assert.ok(getSystemConfig().maxConsecutiveLosses > 0) },
  { id: 44, category: 'GOVERNANCE_CONTRACTS', name: 'Default spread limit is positive', run: () => assert.ok(getSystemConfig().maxSpreadBps > 0) },
  { id: 45, category: 'GOVERNANCE_CONTRACTS', name: 'Default signal cooldown is positive', run: () => assert.ok(getSystemConfig().signalCooldownMs > 0) },
  { id: 46, category: 'GOVERNANCE_CONTRACTS', name: 'cTrader LIVE selector can be persisted', run: () => assert.equal(updateSystemConfig({ cTraderApiMode: 'LIVE' }).cTraderApiMode, 'LIVE') },
  { id: 47, category: 'GOVERNANCE_CONTRACTS', name: 'cTrader DEMO selector can be restored', run: () => assert.equal(updateSystemConfig({ cTraderApiMode: 'DEMO' }).cTraderApiMode, 'DEMO') },
  { id: 48, category: 'GOVERNANCE_CONTRACTS', name: 'Trading mode remains LIVE_ONLY after config writes', run: () => assert.equal(getSystemConfig().tradingMode, 'LIVE_ONLY') },
  { id: 49, category: 'GOVERNANCE_CONTRACTS', name: 'Execution controls report autonomous permission false', run: () => assert.equal(autoExecutionEngine.getControls().autonomousLiveExecutionAllowed, false) },
  { id: 50, category: 'GOVERNANCE_CONTRACTS', name: 'Final autonomous permission invariant is locked', run: () => {
    assert.equal(refreshAutonomousExecutionPermission(), false);
    assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false);
  }}
];

async function runPhase8_6Certification(): Promise<void> {
  console.log('===========================================================================');
  console.log('PHASE 8.6 — CURRENT PRODUCTION READINESS & LIVE-GATE CERTIFICATION');
  console.log('50 deterministic, broker-side-effect-free safety scenarios');
  console.log('===========================================================================');

  assert.equal(scenarios.length, 50, 'Phase 8.6 must contain exactly 50 scenarios');

  const results: Array<{ id: number; category: string; name: string; durationMs: number }> = [];
  for (const scenario of scenarios) {
    const started = Date.now();
    await scenario.run();
    results.push({ id: scenario.id, category: scenario.category, name: scenario.name, durationMs: Date.now() - started });
    console.log(`[PASS ${String(scenario.id).padStart(2, '0')}/50] [${scenario.category}] ${scenario.name}`);
  }

  assert.equal(results.length, 50);
  assert.equal(new Set(results.map(result => result.id)).size, 50);
  assert.equal(autoTradeReadinessService.getState(), 'OFF');
  assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false);
  assert.equal(getSystemConfig().tradingMode, 'LIVE_ONLY');
  assert.equal(getSystemConfig().cTraderApiMode, 'DEMO');

  console.log('===========================================================================');
  console.log('PHASE 8.6 CERTIFICATION: 50/50 PASSED');
  console.log('Live broker submission: NOT INVOKED');
  console.log('Autonomous live execution permission: LOCKED');
  console.log('Trading mode: LIVE_ONLY');
  console.log('cTrader API selector: DEMO (persisted default)');
  console.log('===========================================================================');
}

runPhase8_6Certification().catch((error) => {
  console.error('Phase 8.6 certification failed:', error);
  process.exitCode = 1;
});
