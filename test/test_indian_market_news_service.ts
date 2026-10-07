import assert from 'node:assert/strict';
import {
  parseProviderPage,
  parseFmpArticles,
  prediction,
  fetchIndianMarketNews,
  resetIndianMarketNewsCacheForTest
} from '../src/services/indianMarketNewsService';

const now = Date.parse('2026-09-22T10:00:00.000Z');
const html = `
  <a href="/market/nifty-rises">Nifty rises 1.2% as banks rally</a>
  <span datetime="2026-09-22T09:58:00.000Z"></span>
  <a href="/market/ignore">Markets</a>
`;

const parsed = parseProviderPage(
  html,
  'MINT',
  'https://www.livemint.com/market',
  ['/market/'],
  now
);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].provider, 'MINT');
assert.equal(parsed[0].title, 'Nifty rises 1.2% as banks rally');
assert.equal(parsed[0].sentimentScore, 1 / 3);

const fmp = parseFmpArticles([
  {
    title: 'Indian stocks fall on inflation worries',
    url: 'https://example.com/story',
    site: 'Example',
    publishedDate: '2026-09-22T09:55:00Z'
  }
], now);
assert.equal(fmp.length, 1);
assert.equal(fmp[0].provider, 'FMP');
assert.equal(fmp[0].sentimentScore, -1 / 3);

const pred = prediction([
  { ...parsed[0], provider: 'MINT', sentimentScore: 0.8 },
  { ...parsed[0], provider: 'ET_MARKETS', sentimentScore: 0.7 }
], [
  { symbol: 'NIFTY', signal: { direction: 'BUY' } },
  { symbol: 'BANKNIFTY', signal: { direction: 'BUY' } }
]);
assert.equal(pred.bias, 'BULLISH');
assert.ok(pred.confidence >= 25 && pred.confidence <= 85);

resetIndianMarketNewsCacheForTest();
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error('fetch must not be called while Indian market is closed');
}) as typeof fetch;

try {
  const closed = await fetchIndianMarketNews(
    { forceRefresh: true },
    new Date('2026-09-26T10:00:00.000Z')
  );
  assert.equal(closed.status, 'MARKET_CLOSED');
  assert.equal(closed.marketOpen, false);
  assert.equal(closed.articleCount, 0);
  assert.equal(fetchCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Indian market news service tests passed.');
