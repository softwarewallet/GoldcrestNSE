import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-config-'));
const configFile = path.join(tempDir, 'system-config.json');

process.env.GOLDCREST_CONFIG_DIR = tempDir;
process.env.GOLDCREST_CONFIG_FILE = configFile;

// A stale bootstrap snapshot must never override values hydrated from the
// authoritative SQLite settings store during server startup.
fs.writeFileSync(configFile, JSON.stringify({
  maxTradeValueForexUsd: 100,
  maxTradeValueIndianInr: 1000
}, null, 2));

const {
  getSystemConfig,
  updateSystemConfig,
  loadPersistedSystemConfig,
  applyPersistedSystemConfig
} = await import('../src/services/configService');

try {
  applyPersistedSystemConfig({
    maxTradeValueForexUsd: 4321,
    maxTradeValueIndianInr: 87654
  });
  assert.equal(getSystemConfig().maxTradeValueForexUsd, 4321);
  assert.equal(getSystemConfig().maxTradeValueIndianInr, 87654);
  assert.equal(loadPersistedSystemConfig().maxTradeValueForexUsd, 4321);
  assert.equal(loadPersistedSystemConfig().maxTradeValueIndianInr, 87654);

  updateSystemConfig({
    maxTradeValueForexUsd: 777,
    maxTradeValueIndianInr: 55555,
    maxOpenPositions: 12,
    forexStopLossPips: 18,
    forexTakeProfitPips: 36,
    autoLiveForexPairs: ['EUR/USD', 'USD/JPY', 'XAU/USD'],
    autoLiveIndianUnderlyings: ['FINNIFTY', 'MIDCPNIFTY']
  });

  assert.equal(getSystemConfig().maxTradeValueForexUsd, 777);
  assert.equal(getSystemConfig().maxTradeValueIndianInr, 55555);
  assert.equal(getSystemConfig().maxOpenPositions, 12);
  assert.equal(getSystemConfig().forexStopLossPips, 18);
  assert.equal(getSystemConfig().forexTakeProfitPips, 36);
  assert.deepEqual(getSystemConfig().autoLiveForexPairs, ['EUR/USD', 'USD/JPY', 'XAU/USD']);
  assert.deepEqual(getSystemConfig().autoLiveIndianUnderlyings, ['FINNIFTY', 'MIDCPNIFTY']);

  assert.equal(fs.existsSync(configFile), true);
  const persisted = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(persisted.maxTradeValueForexUsd, 777);
  assert.equal(persisted.maxTradeValueIndianInr, 55555);
  assert.equal(persisted.maxOpenPositions, 12);
  assert.equal(persisted.forexStopLossPips, 18);
  assert.equal(persisted.forexTakeProfitPips, 36);
  assert.deepEqual(persisted.autoLiveForexPairs, ['EUR/USD', 'USD/JPY', 'XAU/USD']);
  assert.deepEqual(persisted.autoLiveIndianUnderlyings, ['FINNIFTY', 'MIDCPNIFTY']);

  console.log('CONFIG PERSISTENCE TEST PASSED');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
