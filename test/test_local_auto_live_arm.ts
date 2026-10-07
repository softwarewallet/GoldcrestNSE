import assert from 'node:assert/strict';

const originalNodeEnv = process.env.NODE_ENV;
const originalHost = process.env.HOST;
const originalLocal = process.env.GOLDCREST_LOCAL_DEVELOPMENT;
const originalAuto = process.env.GOLDCREST_AUTO_TRADING_ENABLED;
const originalLiveAuto = process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;
const originalLiveTrading = process.env.LIVE_TRADING_ENABLED;
const originalApproval = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED;
const originalStrategyId = process.env.GOLDCREST_PRODUCTION_STRATEGY_ID;

process.env.NODE_ENV = 'development';
process.env.HOST = '0.0.0.0';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'true';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';

const { autoExecutionEngine, armAutonomousExecutionGate, disarmLocalAutonomousExecution, refreshAutonomousExecutionPermission } = await import('../src/brokers/safety/AutoExecutionEngine');

const result = autoExecutionEngine.enableAutomaticExecution();
assert.equal(result.success, false, 'Broker credentials must still be required before automatic execution is allowed.');
assert.equal(refreshAutonomousExecutionPermission(), false);
assert.equal(process.env.GOLDCREST_AUTO_TRADING_ENABLED, 'true');
assert.equal(process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION, 'true');
assert.equal(process.env.LIVE_TRADING_ENABLED, 'true');
assert.equal(process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED, 'true');
disarmLocalAutonomousExecution();
assert.equal(process.env.GOLDCREST_AUTO_TRADING_ENABLED, 'false');
assert.equal(process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION, 'false');

const restartArm = armAutonomousExecutionGate();
assert.equal(restartArm.success, true, 'A new START AUTO LIVE action must re-arm the autonomous execution flags after STOP.');
assert.equal(process.env.GOLDCREST_AUTO_TRADING_ENABLED, 'true');
assert.equal(process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION, 'true');
assert.equal(process.env.LIVE_TRADING_ENABLED, 'true');
assert.equal(refreshAutonomousExecutionPermission(), false, 'Broker credentials must still remain a required execution permission.');


if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
if (originalHost === undefined) delete process.env.HOST; else process.env.HOST = originalHost;
if (originalLocal === undefined) delete process.env.GOLDCREST_LOCAL_DEVELOPMENT; else process.env.GOLDCREST_LOCAL_DEVELOPMENT = originalLocal;
if (originalAuto === undefined) delete process.env.GOLDCREST_AUTO_TRADING_ENABLED; else process.env.GOLDCREST_AUTO_TRADING_ENABLED = originalAuto;
if (originalLiveAuto === undefined) delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION; else process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = originalLiveAuto;
if (originalLiveTrading === undefined) delete process.env.LIVE_TRADING_ENABLED; else process.env.LIVE_TRADING_ENABLED = originalLiveTrading;
if (originalApproval === undefined) delete process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED; else process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = originalApproval;
if (originalStrategyId === undefined) delete process.env.GOLDCREST_PRODUCTION_STRATEGY_ID; else process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = originalStrategyId;

console.log('LOCAL AUTO-LIVE ARM REGRESSION TEST PASSED');
