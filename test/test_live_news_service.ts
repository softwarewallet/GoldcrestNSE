import assert from 'node:assert/strict';

process.env.FINNHUB_API_KEY = 'test-finnhub';
process.env.MASSIVE_API_KEY = 'test-massive';
process.env.CURRENTS_API_KEY = 'test-currents';
process.env.GOLDCREST_NEWS_TIMEOUT_MS = '5000';
process.env.GOLDCREST_NEWS_CACHE_TTL_MS = '30000';
process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS = '60000';
process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS = String(2 * 60 * 60_000);
process.env.CURRENTS_PAGE_SIZE = '20';

const { fetchLiveForexNews, resetLiveForexNewsCacheForTest } =
  await import('../src/services/liveNewsService');

const originalFetch = globalThis.fetch;

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as Response;
}

function finnhubArticle(title: string, minutesAgo = 1) {
  return JSON.stringify([{
    id: 1,
    headline: title,
    url: 'https://finnhub.example/article',
    source: 'Finnhub Test',
    datetime: Math.floor((Date.now() - minutesAgo * 60_000) / 1000),
    summary: 'Fresh Forex market headline.'
  }]);
}

try {
  resetLiveForexNewsCacheForTest();

  const requestedUrls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('finnhub.io')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-Finnhub-Token'], 'test-finnhub');
      return response(finnhubArticle('EUR/USD rises after ECB rate decision'));
    }

    if (url.includes('api.massive.com')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['Authorization'], 'Bearer test-massive');
      return response(JSON.stringify({
        status: 'OK',
        results: [{
          id: 1,
          title: 'Dollar markets react to new tariff announcement',
          article_url: 'https://massive.example/usd',
          publisher: { name: 'Massive Test' },
          published_utc: new Date(Date.now() - 2 * 60_000).toISOString(),
          description: 'Fresh financial news for USD.',
          keywords: ['tariff']
        }]
      }));
    }

    if (url.includes('api.currentsapi.services')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['Authorization'], 'Bearer test-currents');
      return response(JSON.stringify({
        status: 'ok',
        news: [{
          id: 'currents-1',
          title: 'GBP/USD reacts to Bank of England interest rate decision',
          url: 'https://currents.example/gbp',
          author: 'Currents Test',
          published: new Date(Date.now() - 3 * 60_000).toISOString(),
          description: 'Fresh FX news.',
          language: 'en',
          category: ['economy_business_finance']
        }]
      }));
    }

    if (url.includes('news.google.com')) {
      return response(JSON.stringify([]));
    }

    throw new Error('Unexpected news provider URL: ' + url);
  };

  const live = await fetchLiveForexNews({
    pairs: ['EUR/USD', 'GBP/USD'],
    forceRefresh: true
  });

  assert.equal(live.status, 'LIVE');
  assert.equal(live.source, 'FINNHUB');
  assert.ok(live.articleCount >= 3);
  assert.equal(live.providerStatus?.FINNHUB, 'LIVE');
  assert.equal(live.providerStatus?.MASSIVE, 'LIVE');
  assert.equal(live.providerStatus?.CURRENTS, 'LIVE');
  assert.equal(live.providerDiagnostics?.FINNHUB?.freshArticleCount, 1);
  assert.equal(live.providerDiagnostics?.MASSIVE?.freshArticleCount, 1);
  assert.equal(live.providerDiagnostics?.CURRENTS?.freshArticleCount, 1);
  assert.equal(live.highImpactCount, 2);
  assert.equal(live.pairRisk?.['EUR/USD']?.riskLevel, 'HIGH');
  assert.deepEqual(live.queryPairs, ['EUR/USD', 'GBP/USD']);

  assert.equal(requestedUrls.some(url => url.includes('newsapi.org')), false);
  assert.equal(requestedUrls.some(url => url.includes('jblanked.com')), false);

  resetLiveForexNewsCacheForTest();
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('finnhub.io')) {
      return response(JSON.stringify([]));
    }

    if (url.includes('api.massive.com')) {
      return response(JSON.stringify({ status: 'OK', results: [] }));
    }

    if (url.includes('api.currentsapi.services')) {
      return response(JSON.stringify({ status: 'ok', news: [] }));
    }

    if (url.includes('news.google.com')) {
      const publishedAt = new Date(Date.now() - 2 * 60_000).toUTCString();
      return response(`<?xml version="1.0" encoding="UTF-8"?>
        <rss><channel>
          <item>
            <title>EUR/USD moves after ECB update</title>
            <link>https://news.google.com/rss/articles/test-eurusd</link>
            <pubDate>${publishedAt}</pubDate>
            <source>Google News Test</source>
            <description>Fresh backup headline.</description>
          </item>
          <item>
            <title>Dollar outlook changes ahead of Fed remarks</title>
            <link>https://news.google.com/rss/articles/test-usd</link>
            <pubDate>${publishedAt}</pubDate>
            <source>Google News Test</source>
            <description>Fresh second backup headline.</description>
          </item>
        </channel></rss>`);
    }

    throw new Error('Unexpected news provider URL: ' + url);
  };

  const googleBackup = await fetchLiveForexNews({
    pairs: ['EUR/USD'],
    forceRefresh: true
  });

  assert.equal(googleBackup.status, 'LIVE');
  assert.equal(googleBackup.source, 'GOOGLE_NEWS_RSS');
  assert.equal(googleBackup.providerStatus?.GOOGLE_NEWS_RSS, 'LIVE');
  assert.equal(googleBackup.providerDiagnostics?.GOOGLE_NEWS_RSS?.freshArticleCount, 2);
  assert.equal(googleBackup.articleCount, 2);

  resetLiveForexNewsCacheForTest();
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('finnhub.io')) {
      return response(JSON.stringify([{
        headline: 'Old EUR/USD commentary',
        url: 'https://finnhub.example/old',
        source: 'Finnhub',
        datetime: Math.floor((Date.now() - 26 * 60 * 60_000) / 1000),
        summary: 'Stale article'
      }]));
    }

    if (url.includes('api.massive.com')) {
      return response(JSON.stringify({
        status: 'OK',
        results: [{
          title: 'Old dollar tariff commentary',
          article_url: 'https://massive.example/old',
          publisher: { name: 'Massive' },
          published_utc: new Date(Date.now() - 26 * 60 * 60_000).toISOString()
        }]
      }));
    }

    if (url.includes('api.currentsapi.services')) {
      return response(JSON.stringify({
        status: 'ok',
        news: [{
          title: 'FOMC rate decision keeps USD volatile',
          url: 'https://currents.example/fomc',
          author: 'Currents',
          published: new Date(Date.now() - 30 * 60_000).toISOString(),
          description: 'Fresh macro event.',
          language: 'en'
        }]
      }));
    }

    if (url.includes('news.google.com')) {
      return response('');
    }

    throw new Error('Unexpected news provider URL: ' + url);
  };

  const staleCheck = await fetchLiveForexNews({
    pairs: ['EUR/USD'],
    forceRefresh: true
  });

  assert.equal(staleCheck.status, 'LIVE');
  assert.equal(staleCheck.providerStatus?.FINNHUB, 'STALE');
  assert.equal(staleCheck.providerStatus?.MASSIVE, 'STALE');
  assert.equal(staleCheck.providerStatus?.CURRENTS, 'LIVE');
  assert.equal(staleCheck.articleCount, 1);

  resetLiveForexNewsCacheForTest();
  globalThis.fetch = async () => response('', 503);

  const unavailable = await fetchLiveForexNews({
    pairs: ['USD/JPY'],
    forceRefresh: true
  });

  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.riskLevel, 'UNAVAILABLE');
  assert.equal(unavailable.articleCount, 0);
  assert.equal(unavailable.providerStatus?.FINNHUB, 'ERROR');
  assert.equal(unavailable.providerStatus?.MASSIVE, 'ERROR');
  assert.equal(unavailable.providerStatus?.CURRENTS, 'ERROR');

  resetLiveForexNewsCacheForTest();
  console.log('LIVE NEWS SERVICE TEST PASSED');
} finally {
  globalThis.fetch = originalFetch;
}
