import assert from 'node:assert/strict';
import { getAutoLiveMarketGate } from '../src/services/marketOpenGate';

// Sunday 12:00 UTC: Forex is in the weekend closure and NSE is closed.
const weekend = getAutoLiveMarketGate(new Date('2026-09-20T12:00:00.000Z'));
assert.equal(weekend.forex.isOpen, false);
assert.equal(weekend.india.isOpen, false);
assert.equal(weekend.anyMarketOpen, false);
assert.equal(weekend.bothMarketsClosed, true);

// Monday 09:30 UTC / 15:00 IST: Forex is open and India is at the end of its session.
const weekday = getAutoLiveMarketGate(new Date('2026-09-21T09:30:00.000Z'));
assert.equal(weekday.forex.isOpen, false);
assert.equal(weekday.india.isOpen, true);
assert.equal(weekday.anyMarketOpen, true);
assert.equal(weekday.bothMarketsClosed, false);

console.log('AUTO LIVE MARKET OPEN GATE TEST PASSED');
