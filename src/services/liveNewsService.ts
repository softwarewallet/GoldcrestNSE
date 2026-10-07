export interface LiveNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  language?: string;
  sourceCountry?: string;
  summary?: string;
  bannerImage?: string | null;
  sentimentScore?: number;
  sentimentLabel?: string;
  topics?: string[];
}

export type LiveNewsSource = 'FINNHUB' | 'MASSIVE' | 'CURRENTS' | 'GOOGLE_NEWS_RSS' | 'NONE';
export type LiveNewsProviderStatus = 'LIVE' | 'NO_RESULTS' | 'STALE' | 'RATE_LIMITED' | 'UNCONFIGURED' | 'ERROR';

export interface LiveNewsProviderDiagnostic {
  status: LiveNewsProviderStatus;
  rawArticleCount: number;
  freshArticleCount: number;
  staleArticleCount: number;
  configured: boolean;
  latencyMs?: number;
  latestRawArticleAt?: string | null;
  latestFreshArticleAt?: string | null;
  error?: string;
}

export interface LiveNewsSentimentSummary {
  averageScore: number;
  overallLabel: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface LiveNewsSnapshot {
  source: LiveNewsSource;
  fetchedAt: string;
  status: 'LIVE' | 'NO_RESULTS' | 'STALE' | 'UNAVAILABLE';
  articleCount: number;
  highImpactCount: number;
  elevatedCount: number;
  /** Number of currently-active high-impact events relevant to the configured FX universe. */
  activeHighImpactCount?: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  articles: LiveNewsArticle[];
  queryPairs?: string[];
  providerStatus?: {
    FINNHUB: LiveNewsProviderStatus;
    MASSIVE: LiveNewsProviderStatus;
    CURRENTS: LiveNewsProviderStatus;
    GOOGLE_NEWS_RSS: LiveNewsProviderStatus;
  };
  providerDiagnostics?: {
    FINNHUB: LiveNewsProviderDiagnostic;
    MASSIVE: LiveNewsProviderDiagnostic;
    CURRENTS: LiveNewsProviderDiagnostic;
    GOOGLE_NEWS_RSS: LiveNewsProviderDiagnostic;
  };
  pairRisk?: Record<string, {
    highImpactCount: number;
    elevatedCount: number;
    riskLevel: 'HIGH' | 'ELEVATED' | 'LOW';
  }>;
  sentimentSummary?: LiveNewsSentimentSummary;
  latestArticleAt?: string | null;
  error?: string;
}

export interface LiveNewsFetchOptions {
  pairs?: string[];
  forceRefresh?: boolean;
}

const CURRENCY_NEWS_ALIASES: Record<string, string[]> = {
  USD: ['usd', 'us dollar', 'u.s. dollar', 'dollar', 'fed', 'federal reserve'],
  EUR: ['eur', 'euro', 'ecb', 'european central bank'],
  GBP: ['gbp', 'pound', 'british pound', 'sterling', 'boe', 'bank of england'],
  JPY: ['jpy', 'yen', 'japanese yen', 'boj', 'bank of japan'],
  CHF: ['chf', 'franc', 'swiss franc', 'snb', 'swiss national bank'],
  AUD: ['aud', 'australian dollar', 'aussie', 'rba', 'reserve bank of australia'],
  NZD: ['nzd', 'new zealand dollar', 'kiwi', 'rbnz', 'reserve bank of new zealand'],
  CAD: ['cad', 'canadian dollar', 'loonie', 'boc', 'bank of canada'],
  SEK: ['sek', 'swedish krona', 'riksbank'],
  NOK: ['nok', 'norwegian krone', 'norges bank'],
  XAU: ['xau', 'gold'],
  XAG: ['xag', 'silver']
};

const HIGH_IMPACT_EVENT_PATTERNS: RegExp[] = [
  /interest rate/i,
  /rate decision/i,
  /central bank/i,
  /monetary policy/i,
  /cpi/i,
  /inflation/i,
  /nonfarm payroll/i,
  /nfp\b/i,
  /employment report/i,
  /jobs report/i,
  /unemployment rate/i,
  /retail sales/i,
  /gdp/i,
  /pmi/i,
  /fomc/i,
  /press conference/i
];

const GLOBAL_HIGH_IMPACT_PATTERNS: RegExp[] = [
  /federal reserve/i,
  /fomc/i,
  /ecb\b/i,
  /bank of england/i,
  /bank of japan/i,
  /bank of canada/i,
  /reserve bank of australia/i,
  /reserve bank of new zealand/i,
  /swiss national bank/i
];

const ELEVATED_TERMS = [
  'tariff',
  'sanction',
  'geopolitical',
  'war',
  'crisis',
  'intervention',
  'yield',
  'bond',
  'recession',
  'downgrade',
  'upgrade',
  'trade deficit',
  'trade surplus'
];

const NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS = Math.max(
  5 * 60_000,
  Number(process.env.GOLDCREST_NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS || 30 * 60_000)
);

const FINNHUB_ENDPOINT = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1/news';
const MASSIVE_ENDPOINT = process.env.MASSIVE_BASE_URL || 'https://api.massive.com/v2/reference/news';
const CURRENTS_ENDPOINT = process.env.CURRENTS_BASE_URL || 'https://api.currentsapi.services/v2/search';
const GOOGLE_NEWS_RSS_ENDPOINT = process.env.GOOGLE_NEWS_RSS_BASE_URL || 'https://news.google.com/rss/search';

const REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS || 10_000)
);
const CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.GOLDCREST_NEWS_CACHE_TTL_MS || 60_000)
);
const FAILURE_BACKOFF_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS || 180_000)
);
const MAX_ARTICLE_AGE_MS = Math.max(
  15 * 60_000,
  Number(process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS || 6 * 60 * 60_000)
);
const MASSIVE_MAX_ARTICLES = Math.max(
  20,
  Math.min(100, Number(process.env.MASSIVE_MAX_ARTICLES || 100))
);
const CURRENTS_PAGE_SIZE = Math.max(
  1,
  Math.min(20, Number(process.env.CURRENTS_PAGE_SIZE || 20))
);
const GOOGLE_NEWS_RSS_MAX_QUERIES = Math.max(
  1,
  Math.min(4, Number(process.env.GOOGLE_NEWS_RSS_MAX_QUERIES || 2))
);
const GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES = Math.max(
  0,
  Number(process.env.GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES || 3)
);

let newsCache: {
  key: string;
  snapshot: LiveNewsSnapshot;
  expiresAt: number;
} | null = null;

let unavailableBackoff: {
  key: string;
  until: number;
} | null = null;

let inFlight: {
  key: string;
  promise: Promise<LiveNewsSnapshot>;
} | null = null;

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Live news request timed out.';
    return error.message;
  }
  return String(error);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => {
      const numeric = code.toLowerCase().startsWith('x')
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
    })
    .trim();
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  const raw = decodeXmlEntities(String(value ?? '').trim());
  if (!raw) return null;

  const gdeltMatch = raw.match(/^(\d{8})T?(\d{6})Z?$/i);
  if (gdeltMatch) {
    const [, date, time] = gdeltMatch;
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizePair(pair: string): string {
  const normalized = pair.toUpperCase().trim().replace(/\\/g, '/');
  if (normalized.includes('/')) {
    const [base, quote] = normalized.split('/');
    return base && quote ? `${base}/${quote}` : normalized;
  }
  if (normalized.length === 6) return `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
  return normalized;
}

function normalizePairs(pairs: string[] | undefined): string[] {
  if (!Array.isArray(pairs)) return [];
  return [...new Set(
    pairs
      .map(value => normalizePair(String(value)))
      .filter(pair => /^[A-Z]{3}\/[A-Z]{3}$/.test(pair))
  )].sort();
}


function articleText(article: LiveNewsArticle): string {
  return [article.title, article.summary].filter(Boolean).join(' ').toLowerCase();
}

function getRelevantCurrencies(pairs: string[]): Set<string> {
  const currencies = new Set<string>();
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    if (base) currencies.add(base);
    if (quote) currencies.add(quote);
  }
  return currencies;
}

function articleMentionsRelevantCurrency(article: LiveNewsArticle, relevantCurrencies: Set<string>): boolean {
  const text = articleText(article).replace(/[^a-z0-9.]+/g, ' ');
  for (const currency of relevantCurrencies) {
    const aliases = CURRENCY_NEWS_ALIASES[currency] || [currency.toLowerCase()];
    if (aliases.some(alias => {
      const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
      return ` ${text} `.includes(` ${normalizedAlias} `);
    })) return true;
  }
  return false;
}

function hasHighImpactEvent(article: LiveNewsArticle): boolean {
  // A central-bank name alone is contextual information, not an economic
  // event. Require an explicit event term (rate decision, CPI, NFP, etc.)
  // before an article can be classified as HIGH.
  const text = articleText(article);
  return HIGH_IMPACT_EVENT_PATTERNS.some(pattern => pattern.test(text));
}

function isArticleInsideHighImpactWindow(article: LiveNewsArticle, now: number): boolean {
  if (!article.publishedAt) return false;
  const timestamp = Date.parse(article.publishedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= -5 * 60_000 && age <= NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS;
}

function classifyArticle(
  article: LiveNewsArticle,
  relevantCurrencies: Set<string>,
  now: number
): 'HIGH' | 'ELEVATED' | 'LOW' {
  const highImpactEvent = hasHighImpactEvent(article);
  const currencyRelevant = articleMentionsRelevantCurrency(article, relevantCurrencies);
  const globalEvent = GLOBAL_HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(articleText(article)));

  // IMPORTANT: sentiment is never sufficient to classify a headline as HIGH.
  // A strongly bullish/bearish article is market information, not an economic
  // calendar event. HIGH is reserved for a specific event-type headline that
  // is both relevant to the FX universe and inside the short active window.
  if (highImpactEvent
    && currencyRelevant
    && isArticleInsideHighImpactWindow(article, now)) {
    return 'HIGH';
  }

  // FX risk must never be raised by an unrelated article. Sentiment or a
  // generic word such as "dollar" is only meaningful after the article has
  // been tied to at least one configured currency, or is an explicitly global
  // market shock.
  if (!currencyRelevant && !globalEvent) return 'LOW';

  if (typeof article.sentimentScore === 'number' && Math.abs(article.sentimentScore) >= 0.25) {
    return 'ELEVATED';
  }
  if (ELEVATED_TERMS.some(term => articleText(article).includes(term))) return 'ELEVATED';
  return 'LOW';
}

function scoreArticles(
  articles: LiveNewsArticle[],
  pairs: string[],
  now: number
): Pick<LiveNewsSnapshot, 'highImpactCount' | 'elevatedCount' | 'riskLevel' | 'activeHighImpactCount' | 'pairRisk'> {
  const relevantCurrencies = getRelevantCurrencies(pairs);
  let highImpactCount = 0;
  let elevatedCount = 0;

  for (const article of articles) {
    const classification = classifyArticle(article, relevantCurrencies, now);
    if (classification === 'HIGH') highImpactCount += 1;
    else if (classification === 'ELEVATED') elevatedCount += 1;
  }

  const pairRisk: NonNullable<LiveNewsSnapshot['pairRisk']> = {};
  for (const pair of pairs) {
    const pairCurrencies = getRelevantCurrencies([pair]);
    let pairHigh = 0;
    let pairElevated = 0;
    for (const article of articles) {
      const classification = classifyArticle(article, pairCurrencies, now);
      if (classification === 'HIGH') pairHigh += 1;
      else if (classification === 'ELEVATED') pairElevated += 1;
    }
    pairRisk[pair] = {
      highImpactCount: pairHigh,
      elevatedCount: pairElevated,
      riskLevel: pairHigh > 0 ? 'HIGH' : pairElevated >= 4 ? 'ELEVATED' : 'LOW'
    };
  }

  return {
    highImpactCount,
    elevatedCount,
    activeHighImpactCount: highImpactCount,
    riskLevel: highImpactCount > 0
      ? 'HIGH'
      : elevatedCount >= 4
        ? 'ELEVATED'
        : 'LOW',
    pairRisk
  };
}

function computeAggregatedSentiment(
  articles: LiveNewsArticle[]
): LiveNewsSentimentSummary | undefined {
  const scored = articles.filter(a => typeof a.sentimentScore === 'number');
  if (scored.length === 0) return undefined;

  let totalScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const a of scored) {
    const s = a.sentimentScore!;
    totalScore += s;
    if (s >= 0.15 || (a.sentimentLabel && a.sentimentLabel.toLowerCase().includes('bullish'))) {
      bullishCount += 1;
    } else if (s <= -0.15 || (a.sentimentLabel && a.sentimentLabel.toLowerCase().includes('bearish'))) {
      bearishCount += 1;
    } else {
      neutralCount += 1;
    }
  }

  const averageScore = Number((totalScore / scored.length).toFixed(4));
  let overallLabel = 'Neutral';
  if (averageScore >= 0.35) overallLabel = 'Bullish';
  else if (averageScore >= 0.15) overallLabel = 'Somewhat-Bullish';
  else if (averageScore <= -0.35) overallLabel = 'Bearish';
  else if (averageScore <= -0.15) overallLabel = 'Somewhat-Bearish';

  return {
    averageScore,
    overallLabel,
    bullishCount,
    bearishCount,
    neutralCount
  };
}


async function fetchText(
  url: URL,
  headers: Record<string, string> = {}
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, text/plain',
        'User-Agent': 'Goldcrest/2.0 live-forex-news',
        ...headers
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('HTTP ' + response.status + ': ' + (text.slice(0, 250) || response.statusText));
      (error as any).status = response.status;
      throw error;
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(
  url: URL,
  headers: Record<string, string> = {}
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Goldcrest/2.0 live-forex-news',
        ...headers
      }
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || text.slice(0, 250) || response.statusText;
      const error = new Error(`HTTP ${response.status}: ${message}`);
      (error as any).status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromFinnhub(): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  try {
    const url = new URL(FINNHUB_ENDPOINT);
    url.searchParams.set('category', 'forex');
    const payload = await fetchJson(url, { 'X-Finnhub-Token': token });
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.news) ? payload.news : [];

    const articles: LiveNewsArticle[] = rows
      .map((row: any) => ({
        title: decodeXmlEntities(String(row?.headline || row?.title || '')),
        url: decodeXmlEntities(String(row?.url || '')),
        source: decodeXmlEntities(String(row?.source || row?.publisher || 'Finnhub')),
        publishedAt: normalizePublishedAt(
          Number.isFinite(Number(row?.datetime)) ? Number(row.datetime) * 1000 : row?.datetime
        ),
        summary: decodeXmlEntities(String(row?.summary || row?.description || '')),
        bannerImage: decodeXmlEntities(String(row?.image || '')) || null
      }))
      .filter((article: LiveNewsArticle) => Boolean(article.title && article.url));

    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      status: Number(error?.status) === 429 ? 'RATE_LIMITED' : 'ERROR',
      articles: [],
      error: error?.name === 'AbortError'
        ? 'Finnhub news request timed out.'
        : error?.message || String(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

function isFxNewsRelevant(article: LiveNewsArticle, pairs: string[]): boolean {
  const text = articleText(article);
  const relevantCurrencies = getRelevantCurrencies(pairs);
  const globalForexTerms = /forex|foreign exchange|exchange rate|currency market|fx market|central bank|interest rate|inflation|fomc|ecb|boj|boe|bank of england|bank of japan|federal reserve/i.test(text);
  return globalForexTerms || articleMentionsRelevantCurrency(article, relevantCurrencies);
}

async function fetchFromMassive(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  if (!apiKey) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  try {
    const url = new URL(MASSIVE_ENDPOINT);
    url.searchParams.set('limit', String(MASSIVE_MAX_ARTICLES));
    url.searchParams.set('order', 'descending');
    url.searchParams.set('sort', 'published_utc');
    url.searchParams.set(
      'published_utc.gte',
      new Date(Date.now() - 48 * 60 * 60_000).toISOString()
    );

    const payload = await fetchJson(url, {
      Authorization: `Bearer ${apiKey}`
    });
    const rows = Array.isArray(payload?.results) ? payload.results : [];

    const articles = rows
      .map((row: any) => ({
        title: decodeXmlEntities(String(row?.title || '')),
        url: decodeXmlEntities(String(row?.article_url || row?.amp_url || '')),
        source: decodeXmlEntities(String(row?.publisher?.name || 'Massive')),
        publishedAt: normalizePublishedAt(row?.published_utc),
        summary: decodeXmlEntities(String(row?.description || '')),
        bannerImage: decodeXmlEntities(String(row?.image_url || '')) || null,
        topics: Array.isArray(row?.keywords)
          ? row.keywords.map((value: unknown) => String(value)).filter(Boolean)
          : undefined
      }))
      .filter((article: LiveNewsArticle) => Boolean(article.title && article.url))
      .filter((article: LiveNewsArticle) => isFxNewsRelevant(article, pairs));

    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles: deduplicateArticles(articles),
      latencyMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      status: Number(error?.status) === 429 ? 'RATE_LIMITED' : 'ERROR',
      articles: [],
      error: error?.name === 'AbortError'
        ? 'Massive news request timed out.'
        : error?.message || String(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

function buildCurrentsQuery(pairs: string[]): string {
  const aliases = new Set<string>();
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    for (const currency of [base, quote]) {
      for (const alias of (CURRENCY_NEWS_ALIASES[currency] || [currency.toLowerCase()]).slice(0, 4)) {
        aliases.add(alias);
      }
    }
  }

  if (aliases.size === 0) {
    return '(forex OR "foreign exchange" OR "exchange rate" OR "central bank" OR FOMC OR ECB OR BOJ OR "Bank of England" OR "Bank of Japan")';
  }

  return `(${[...aliases].map(alias => `"${alias}"`).join(' OR ')}) AND (forex OR "foreign exchange" OR "exchange rate" OR "central bank" OR inflation OR "interest rate")`;
}

async function fetchFromCurrents(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const apiKey = process.env.CURRENTS_API_KEY?.trim();
  if (!apiKey) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  try {
    const url = new URL(CURRENTS_ENDPOINT);
    url.searchParams.set('query', buildCurrentsQuery(pairs));
    url.searchParams.set('language', 'en');
    url.searchParams.set('page_number', '1');
    url.searchParams.set('page_size', String(CURRENTS_PAGE_SIZE));

    const payload = await fetchJson(url, {
      Authorization: `Bearer ${apiKey}`
    });

    if (payload?.status === 'error') {
      throw new Error(payload?.message || payload?.msg || 'Currents API returned an error.');
    }

    const rows = Array.isArray(payload?.news) ? payload.news : [];
    const articles = rows
      .map((row: any) => ({
        title: decodeXmlEntities(String(row?.title || '')),
        url: decodeXmlEntities(String(row?.url || '')),
        source: decodeXmlEntities(String(row?.author || row?.source || 'Currents')),
        publishedAt: normalizePublishedAt(row?.published),
        language: decodeXmlEntities(String(row?.language || 'en')),
        summary: decodeXmlEntities(String(row?.description || '')),
        bannerImage: decodeXmlEntities(String(row?.image || '')) || null,
        topics: Array.isArray(row?.category)
          ? row.category.map((value: unknown) => String(value)).filter(Boolean)
          : undefined
      }))
      .filter((article: LiveNewsArticle) => Boolean(article.title && article.url))
      .filter((article: LiveNewsArticle) => isFxNewsRelevant(article, pairs));

    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles: deduplicateArticles(articles),
      latencyMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      status: Number(error?.status) === 429 ? 'RATE_LIMITED' : 'ERROR',
      articles: [],
      error: error?.name === 'AbortError'
        ? 'Currents news request timed out.'
        : error?.message || String(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

function buildGoogleNewsRssQueries(pairs: string[]): string[] {
  const queries: string[] = [];
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    const baseAliases = (CURRENCY_NEWS_ALIASES[base] || [base.toLowerCase()]).slice(0, 2);
    const quoteAliases = (CURRENCY_NEWS_ALIASES[quote] || [quote.toLowerCase()]).slice(0, 2);
    queries.push(
      '(' + [
        '"' + pair + '"',
        '"' + base + '"',
        '"' + quote + '"',
        ...baseAliases.map(alias => '"' + alias + '"'),
        ...quoteAliases.map(alias => '"' + alias + '"')
      ].join(' OR ') + ') AND (forex OR "foreign exchange" OR "central bank" OR inflation OR "interest rate")'
    );
  }
  if (queries.length === 0) {
    queries.push('forex OR "foreign exchange" OR "central bank" OR FOMC OR ECB OR BOJ');
  }
  return [...new Set(queries)].slice(0, GOOGLE_NEWS_RSS_MAX_QUERIES);
}

function xmlTagValue(item: string, tag: string): string {
  const match = item.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' ')) : '';
}

async function fetchFromGoogleNewsRss(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const startedAt = Date.now();
  const results: LiveNewsArticle[] = [];
  const errors: string[] = [];

  for (const query of buildGoogleNewsRssQueries(pairs)) {
    try {
      const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('hl', 'en-US');
      url.searchParams.set('gl', 'US');
      url.searchParams.set('ceid', 'US:en');

      const xml = await fetchText(url);
      const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
      for (const item of items) {
        const title = xmlTagValue(item, 'title');
        const link = xmlTagValue(item, 'link');
        const publishedAt = normalizePublishedAt(xmlTagValue(item, 'pubDate'));
        const source = xmlTagValue(item, 'source') || 'Google News RSS';
        const summary = xmlTagValue(item, 'description');
        if (!title || !link || !publishedAt) continue;
        results.push({ title, url: link, source, publishedAt, summary });
      }
    } catch (error: any) {
      errors.push(error?.name === 'AbortError'
        ? 'Google News RSS request timed out.'
        : error?.message || String(error));
    }
  }

  const articles = deduplicateArticles(results);
  return {
    status: articles.length > 0
      ? 'LIVE'
      : errors.length === buildGoogleNewsRssQueries(pairs).length ? 'ERROR' : 'NO_RESULTS',
    articles,
    error: errors.length ? errors.join(' | ') : undefined,
    latencyMs: Date.now() - startedAt
  };
}

function deduplicateArticles(articles: LiveNewsArticle[]): LiveNewsArticle[] {
  const seen = new Set<string>();
  const output: LiveNewsArticle[] = [];
  for (const article of articles) {
    const key = String(article.url || article.title)
      .trim()
      .toLowerCase()
      .replace(/\/$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(article);
  }
  return output;
}

function filterFreshArticles(
  articles: LiveNewsArticle[],
  now: number
): LiveNewsArticle[] {
  return articles.filter(article => {
    if (!article.publishedAt) return false;
    const timestamp = Date.parse(article.publishedAt);
    if (!Number.isFinite(timestamp)) return false;
    const age = now - timestamp;
    return age >= -5 * 60_000 && age <= MAX_ARTICLE_AGE_MS;
  });
}

function latestArticleAt(articles: LiveNewsArticle[]): string | null {
  return articles.reduce<string | null>((latest, article) => {
    if (!article.publishedAt) return latest;
    if (!latest) return article.publishedAt;
    return Date.parse(article.publishedAt) > Date.parse(latest) ? article.publishedAt : latest;
  }, null);
}

function providerEffectiveStatus(
  rawStatus: LiveNewsProviderStatus,
  rawCount: number,
  freshCount: number
): LiveNewsProviderStatus {
  if (rawStatus === 'UNCONFIGURED' || rawStatus === 'ERROR' || rawStatus === 'RATE_LIMITED') {
    return rawStatus;
  }
  if (freshCount > 0) return 'LIVE';
  if (rawCount > 0) return 'STALE';
  return 'NO_RESULTS';
}

function unavailableSnapshot(
  error: unknown,
  queryPairs: string[],
  providerStatus: LiveNewsSnapshot['providerStatus']
): LiveNewsSnapshot {
  return {
    source: 'NONE',
    fetchedAt: new Date().toISOString(),
    status: 'UNAVAILABLE',
    articleCount: 0,
    highImpactCount: 0,
    elevatedCount: 0,
    activeHighImpactCount: 0,
    riskLevel: 'UNAVAILABLE',
    articles: [],
    queryPairs,
    providerStatus,
    error: asErrorMessage(error)
  };
}

async function fetchLiveForexNewsInternal(
  options: LiveNewsFetchOptions
): Promise<LiveNewsSnapshot> {
  const now = Date.now();
  const queryPairs = normalizePairs(options.pairs);
  const queryKey = queryPairs.join(',');

  const [finnhubRes, massiveRes, currentsRes, googleNewsRssRes] = await Promise.all([
    fetchFromFinnhub(),
    fetchFromMassive(queryPairs),
    fetchFromCurrents(queryPairs),
    fetchFromGoogleNewsRss(queryPairs)
  ]);

  const freshFinnhub = filterFreshArticles(finnhubRes.articles, now);
  const freshMassive = filterFreshArticles(massiveRes.articles, now);
  const freshCurrents = filterFreshArticles(currentsRes.articles, now);
  const freshGoogleNewsRss = filterFreshArticles(googleNewsRssRes.articles, now);

  const providerStatus: LiveNewsSnapshot['providerStatus'] = {
    FINNHUB: providerEffectiveStatus(
      finnhubRes.status,
      finnhubRes.articles.length,
      freshFinnhub.length
    ),
    MASSIVE: providerEffectiveStatus(
      massiveRes.status,
      massiveRes.articles.length,
      freshMassive.length
    ),
    CURRENTS: providerEffectiveStatus(
      currentsRes.status,
      currentsRes.articles.length,
      freshCurrents.length
    ),
    GOOGLE_NEWS_RSS: providerEffectiveStatus(
      googleNewsRssRes.status,
      googleNewsRssRes.articles.length,
      freshGoogleNewsRss.length
    )
  };

  const errors = [
    finnhubRes.error,
    massiveRes.error,
    currentsRes.error,
    googleNewsRssRes.error
  ].filter(Boolean) as string[];

  const providerDiagnostics: LiveNewsSnapshot['providerDiagnostics'] = {
    FINNHUB: {
      status: providerStatus.FINNHUB,
      rawArticleCount: finnhubRes.articles.length,
      freshArticleCount: freshFinnhub.length,
      staleArticleCount: Math.max(0, finnhubRes.articles.length - freshFinnhub.length),
      configured: finnhubRes.status !== 'UNCONFIGURED',
      latencyMs: finnhubRes.latencyMs,
      latestRawArticleAt: latestArticleAt(finnhubRes.articles),
      latestFreshArticleAt: latestArticleAt(freshFinnhub),
      error: finnhubRes.error
    },
    MASSIVE: {
      status: providerStatus.MASSIVE,
      rawArticleCount: massiveRes.articles.length,
      freshArticleCount: freshMassive.length,
      staleArticleCount: Math.max(0, massiveRes.articles.length - freshMassive.length),
      configured: massiveRes.status !== 'UNCONFIGURED',
      latencyMs: massiveRes.latencyMs,
      latestRawArticleAt: latestArticleAt(massiveRes.articles),
      latestFreshArticleAt: latestArticleAt(freshMassive),
      error: massiveRes.error
    },
    CURRENTS: {
      status: providerStatus.CURRENTS,
      rawArticleCount: currentsRes.articles.length,
      freshArticleCount: freshCurrents.length,
      staleArticleCount: Math.max(0, currentsRes.articles.length - freshCurrents.length),
      configured: currentsRes.status !== 'UNCONFIGURED',
      latencyMs: currentsRes.latencyMs,
      latestRawArticleAt: latestArticleAt(currentsRes.articles),
      latestFreshArticleAt: latestArticleAt(freshCurrents),
      error: currentsRes.error
    },
    GOOGLE_NEWS_RSS: {
      status: providerStatus.GOOGLE_NEWS_RSS,
      rawArticleCount: googleNewsRssRes.articles.length,
      freshArticleCount: freshGoogleNewsRss.length,
      staleArticleCount: Math.max(0, googleNewsRssRes.articles.length - freshGoogleNewsRss.length),
      configured: true,
      latencyMs: googleNewsRssRes.latencyMs,
      latestRawArticleAt: latestArticleAt(googleNewsRssRes.articles),
      latestFreshArticleAt: latestArticleAt(freshGoogleNewsRss),
      error: googleNewsRssRes.error
    }  };

  // Finnhub provides live market headlines. Massive supplies financial news
  // with ticker-tagged metadata, while Currents provides keyword/date search
  // across a broad news source catalog. Google News RSS remains the no-key
  // backup when primary fresh coverage is thin.
  const primaryFreshArticles = deduplicateArticles([
    ...freshFinnhub,
    ...freshMassive,
    ...freshCurrents
  ]);
  const useGoogleNewsBackup = primaryFreshArticles.length < GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES;
  const fetchedArticles = useGoogleNewsBackup
    ? [...primaryFreshArticles, ...freshGoogleNewsRss]
    : primaryFreshArticles;
  const articles = deduplicateArticles(fetchedArticles).slice(0, 100);

  if (articles.length === 0) {
    const configuredProviders = [finnhubRes, massiveRes, currentsRes, googleNewsRssRes]
      .filter(result => result.status !== 'UNCONFIGURED');
    const allUnavailable = configuredProviders.length > 0
      && configuredProviders.every(result => ['ERROR', 'RATE_LIMITED'].includes(result.status));

    const snapshot: LiveNewsSnapshot = {
      source: 'NONE',
      fetchedAt: new Date().toISOString(),
      status: allUnavailable ? 'UNAVAILABLE' : 'STALE',
      articleCount: 0,
      highImpactCount: 0,
      elevatedCount: 0,
      activeHighImpactCount: 0,
      riskLevel: allUnavailable ? 'UNAVAILABLE' : 'LOW',
      articles: [],
      queryPairs,
      providerStatus,
      providerDiagnostics,
      error: errors.length
        ? errors.join(' | ')
        : 'No fresh Forex news/events are currently available.'
    };

    newsCache = {
      key: queryKey,
      snapshot,
      expiresAt: now + (
        snapshot.status === 'UNAVAILABLE'
          ? Math.min(CACHE_TTL_MS, FAILURE_BACKOFF_MS)
          : CACHE_TTL_MS
      )
    };

    if (snapshot.status === 'UNAVAILABLE') {
      unavailableBackoff = {
        key: queryKey,
        until: now + FAILURE_BACKOFF_MS
      };
    } else {
      unavailableBackoff = null;
    }

    return snapshot;
  }

  const score = scoreArticles(articles, queryPairs, now);
  const sentiment = computeAggregatedSentiment(articles);

  const source: LiveNewsSource = freshFinnhub.length > 0
    ? 'FINNHUB'
    : freshMassive.length > 0
      ? 'MASSIVE'
      : freshCurrents.length > 0
        ? 'CURRENTS'
        : 'GOOGLE_NEWS_RSS';

  const snapshot: LiveNewsSnapshot = {
    source,
    fetchedAt: new Date().toISOString(),
    status: 'LIVE',
    articleCount: articles.length,
    highImpactCount: score.highImpactCount,
    elevatedCount: score.elevatedCount,
    activeHighImpactCount: score.activeHighImpactCount,
    riskLevel: score.riskLevel,
    articles,
    queryPairs,
    providerStatus,
    providerDiagnostics,
    pairRisk: score.pairRisk,
    sentimentSummary: sentiment,
    latestArticleAt: latestArticleAt(articles),
    error: undefined
  };

  newsCache = {
    key: queryKey,
    snapshot,
    expiresAt: now + CACHE_TTL_MS
  };
  unavailableBackoff = null;
  return snapshot;
}

export async function fetchLiveForexNews(
  options: LiveNewsFetchOptions = {}
): Promise<LiveNewsSnapshot> {
  const queryPairs = normalizePairs(options.pairs);
  const key = queryPairs.join(',');
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && newsCache && newsCache.key === key && now < newsCache.expiresAt) {
    return newsCache.snapshot;
  }

  if (
    !forceRefresh
    && unavailableBackoff
    && unavailableBackoff.key === key
    && now < unavailableBackoff.until
    && newsCache?.key === key
    && newsCache.snapshot.status === 'UNAVAILABLE'
  ) {
    return newsCache.snapshot;
  }

  // Never start overlapping provider requests for the same working universe.
  // A forced refresh shares an already-running fetch rather than creating a duplicate load.
  if (inFlight?.key === key) {
    return inFlight.promise;
  }

  const promise = fetchLiveForexNewsInternal(options)
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

  inFlight = { key, promise };
  return promise;
}

/**
 * Test-only cache reset used by deterministic provider/parser tests.
 * It is harmless in production and avoids global fetch state leaking between tests.
 */
export function resetLiveForexNewsCacheForTest(): void {
  newsCache = null;
  unavailableBackoff = null;
  inFlight = null;
}
