import assert from 'node:assert/strict';
import {
  filterCTraderAccountsForApiMode,
  fetchLiveCTraderAccountDetails
} from '../src/brokers/adapters/cTrader/cTraderApiClient';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';

const accounts = [
  { ctidTraderAccountId: 1001, isLive: true, traderLogin: 1 },
  { ctidTraderAccountId: 2001, isLive: false, traderLogin: 2 }
];

assert.deepEqual(
  filterCTraderAccountsForApiMode(accounts, 'LIVE').map(account => account.ctidTraderAccountId),
  [1001]
);
assert.deepEqual(
  filterCTraderAccountsForApiMode(accounts, 'DEMO').map(account => account.ctidTraderAccountId),
  [2001]
);

const previousMode = getSystemConfig().cTraderApiMode;

try {
  updateSystemConfig({ cTraderApiMode: 'LIVE' });
  await assert.rejects(
    fetchLiveCTraderAccountDetails(accounts[1], 'client', 'secret', 'token'),
    /marked DEMO.*selected cTrader API mode is LIVE/
  );

  updateSystemConfig({ cTraderApiMode: 'DEMO' });
  await assert.rejects(
    fetchLiveCTraderAccountDetails(accounts[0], 'client', 'secret', 'token'),
    /marked LIVE.*selected cTrader API mode is DEMO/
  );

  console.log('cTrader account environment matching regression test: PASSED');
} finally {
  updateSystemConfig({ cTraderApiMode: previousMode });
}
