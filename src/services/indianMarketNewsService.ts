import { getIndianSessionState } from '../markets/common/session';

export type IndianNewsProviderId = 'PULSE_ZERODHA' | 'CNBC_TV18' | 'ET_MARKETS' | 'MINT' | 'FMP' | 'GOOGLE_NEWS_INDIA';
export type IndianNewsProviderStatus = 'LIVE' | 'NO_RESULTS' | 'STALE' | 'UNCONFIGURED' | 'ERROR' | 'RATE_LIMITED';

export interface IndianNewsArticle {
  title: string;
  url: string;
  source: string;
  provider: IndianNewsProviderId;
  publishedAt: string | null;
  summary?: string;
  sentimentScore?: number;
  category?: string;
}

export interface IndianNewsProviderDiagnostic {
  status: IndianNewsProviderStatus;
  rawArticleCount: number;
  freshArticleCount: number;
  staleArticleCount: number;
  configured: boolean;
  latencyMs?: number;
  latestRawArticleAt?: string | null;
  latestFreshArticleAt?: string | null;
  error?: string;
}

export interface IndianMarketPrediction {
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  newsSentimentScore: number;
  sourceAgreement: number;
  articlesUsed: number;
  marketContext?: { niftyScore?: number; bankNiftyScore?: number };
  rationale: string[];
  disclaimer: string;
}

export interface IndianNewsSnapshot {
  market: 'INDIAN_EQUITY';
  marketOpen: boolean;
  marketPhase: string;
  fetchedAt: string;
  status: 'LIVE' | 'NO_RESULTS' | 'STALE' | 'UNAVAILABLE' | 'MARKET_CLOSED';
  articleCount: number;
  articles: IndianNewsArticle[];
  providerStatus: Record<IndianNewsProviderId, IndianNewsProviderStatus>;
  providerDiagnostics: Record<IndianNewsProviderId, IndianNewsProviderDiagnostic>;
  prediction?: IndianMarketPrediction;
  error?: string;
}

export interface IndianNewsFetchOptions { forceRefresh?: boolean; marketData?: any[]; }

const ENDPOINTS: Record<Exclude<IndianNewsProviderId, 'FMP' | 'GOOGLE_NEWS_INDIA'>, string> = {
  PULSE_ZERODHA: process.env.GOLDCREST_INDIA_PULSE_URL || 'https://pulse.zerodha.com/',
  CNBC_TV18: process.env.GOLDCREST_INDIA_CNBC_URL || 'https://www.cnbctv18.com/market/',
  ET_MARKETS: process.env.GOLDCREST_INDIA_ET_MARKETS_URL || 'https://economictimes.indiatimes.com/markets',
  MINT: process.env.GOLDCREST_INDIA_MINT_URL || 'https://www.livemint.com/market'
};

const ET_MARKETS_RSS = 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms';
const MINT_RSS = 'https://www.livemint.com/rss/markets';
const GOOGLE_NEWS_INDIA_RSS = 'https://news.google.com/rss/search?q=NSE+NIFTY+Sensex+Indian+Stock+Market&hl=en-IN&gl=IN&ceid=IN:en';

const FMP_ENDPOINT = process.env.GOLDCREST_INDIA_FMP_URL || 'https://financialmodelingprep.com/stable/news/stock-latest';
const TIMEOUT_MS = Math.max(5000, Number(process.env.GOLDCREST_INDIA_NEWS_TIMEOUT_MS || 8000));
const CACHE_TTL_MS = Math.max(30000, Number(process.env.GOLDCREST_INDIA_NEWS_CACHE_TTL_MS || 60000));
const MAX_AGE_MS = Math.max(10 * 60000, Number(process.env.GOLDCREST_INDIA_NEWS_MAX_ARTICLE_AGE_MS || 12 * 60 * 60000));

const POSITIVE = ['surge','surges','gains','gain','rises','rise','rally','rallies','bullish','upgrade','upgraded','beats','strong growth','record high','inflows','positive','outperform','eases','rate cut','stimulus','dovish','recovery','higher profit','profit jumps','green','rebound'];
const NEGATIVE = ['falls','fall','drops','drop','slump','slumps','crash','selloff','sell-off','bearish','downgrade','downgraded','misses','weak growth','outflows','negative','underperform','inflation','war','crisis','rate hike','hikes rates','hawkish','recession','lower profit','profit falls','volatility','risk-off','red','plunges'];
const NAV = new Set(['home','login','sign in','subscribe','search','markets','market','stocks','videos','podcasts','premium','more','menu','about us','contact us','privacy policy','terms of use','live tv']);

let cache: { snapshot: IndianNewsSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<IndianNewsSnapshot> | null = null;

function stripHtml(v: string): string {
  return v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function publishedAt(raw: string | null, now: number): string | null {
  if (!raw) return null;
  const value = stripHtml(raw);
  const rel = value.match(/\b(\d+)\s*(second|sec|minute|min|hour|hr|day|d)s?\s+ago\b/i);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2].toLowerCase();
    const m = u.startsWith('second') || u === 'sec' ? 1000 : u.startsWith('minute') || u === 'min' ? 60000 : u.startsWith('hour') || u === 'hr' ? 3600000 : 86400000;
    return new Date(now - n * m).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function contextDate(context: string, now: number): string | null {
  const attr = context.match(/(?:datetime|data-time|data-published)=["']([^"']+)["']/i)?.[1];
  if (attr) return publishedAt(attr, now);
  const iso = context.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?\b/)?.[0];
  if (iso) return publishedAt(iso, now);
  const rel = context.match(/\b\d+\s*(?:second|sec|minute|min|hour|hr|day|d)s?\s+ago\b/i)?.[0];
  return rel ? publishedAt(rel, now) : null;
}

function headlineScore(title: string): number {
  const text = title.toLowerCase();
  let score = 0;

  const matchesTerm = (term: string): boolean => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  };

  for (const term of POSITIVE) if (matchesTerm(term)) score++;
  for (const term of NEGATIVE) if (matchesTerm(term)) score--;

  return score === 0 ? 0 : score > 0 ? 1 / 3 : -1 / 3;
}

function classifyCategory(title: string, summary?: string): string {
  const text = `${title} ${summary || ''}`.toLowerCase();
  if (/f&o|futures|options|call|put|strike|expiry|pcr|derivatives/i.test(text)) return 'F&O / Derivatives';
  if (/rbi|repo|inflation|gdp|fiscal|monetary|sebi|budget|deficit|rupee|inr|fed/i.test(text)) return 'Macro & Policy';
  if (/q[1-4]|quarterly|pat|ebitda|profit|loss|revenue|earnings|results/i.test(text)) return 'Earnings & Corporate';
  if (/nifty|sensex|banknifty|finnifty|midcap|index|indices|bse|nse/i.test(text)) return 'Benchmark Indices';
  if (/crude|oil|gold|silver|commodity|metals/i.test(text)) return 'Commodities';
  return 'Indian Equities';
}

function usefulTitle(title: string): boolean {
  const t = title.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 15 || t.length > 280 || NAV.has(t)) return false;
  return /nifty|sensex|bank nifty|banknifty|stock|share|market|rbi|sebi|rupee|inr|ipo|fii|dii|oil|crude|gold|silver|bond|yield|inflation|rate|fed|tariff|economy|earnings|profit|revenue|india|nse|bse|sector|index|q[1-4]|tata|reliance|hdfc|infosys|icici|adani/i.test(t);
}

function parseRssXml(xml: string, provider: IndianNewsProviderId, sourceLabel: string, now: number): IndianNewsArticle[] {
  const articles: IndianNewsArticle[] = [];
  const seen = new Set<string>();

  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && articles.length < 40) {
    const itemContent = match[0];

    const titleMatch = itemContent.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemContent.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemContent.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i) || itemContent.match(/<dc:date\b[^>]*>([\s\S]*?)<\/dc:date>/i);
    const descMatch = itemContent.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);

    if (!titleMatch) continue;
    const title = stripHtml(titleMatch[1]);
    if (!title || title.length < 12 || NAV.has(title.toLowerCase())) continue;

    let url = linkMatch ? stripHtml(linkMatch[1]) : '';
    if (!url) {
      const guidMatch = itemContent.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
      if (guidMatch && guidMatch[1].startsWith('http')) url = stripHtml(guidMatch[1]);
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const summary = descMatch ? stripHtml(descMatch[1]).slice(0, 220) : undefined;
    const dateStr = pubDateMatch ? publishedAt(pubDateMatch[1], now) : null;

    articles.push({
      title,
      url,
      source: sourceLabel,
      provider,
      publishedAt: dateStr,
      summary: summary && summary !== title ? summary : undefined,
      sentimentScore: headlineScore(title),
      category: classifyCategory(title, summary)
    });
  }

  return articles;
}

function parseProviderPage(html: string, provider: IndianNewsProviderId, baseUrl: string, hints: string[], now: number): IndianNewsArticle[] {
  // If the document looks like RSS/XML, parse as RSS
  if (html.includes('<rss') || html.includes('<channel>') || html.includes('<item>')) {
    const label = provider === 'PULSE_ZERODHA' ? 'Pulse by Zerodha' : provider === 'CNBC_TV18' ? 'CNBC-TV18' : provider === 'ET_MARKETS' ? 'ET Markets' : 'Mint';
    return parseRssXml(html, provider, label, now);
  }

  const out: IndianNewsArticle[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) && out.length < 40) {
    const title = stripHtml(m[2]);
    if (!usefulTitle(title)) continue;
    const url = absoluteUrl(m[1], baseUrl);
    if (!url || seen.has(url)) continue;
    if (hints.length && !hints.some(h => url.toLowerCase().includes(h))) continue;
    seen.add(url);

    const source = provider === 'PULSE_ZERODHA' ? 'Pulse by Zerodha' : provider === 'CNBC_TV18' ? 'CNBC-TV18' : provider === 'ET_MARKETS' ? 'ET Markets' : 'Mint';
    const pubDate = contextDate(html.slice(m.index, m.index + 1800), now);

    out.push({
      title,
      url,
      source,
      provider,
      publishedAt: pubDate,
      sentimentScore: headlineScore(title),
      category: classifyCategory(title)
    });
  }

  return out;
}

function parseFmpArticles(payload: any, now: number): IndianNewsArticle[] {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const indiaTerms = /india|indian|nifty|sensex|bank nifty|banknifty|nse|bse|rbi|sebi|rupee|inr|mumbai|delhi|fii|dii|gift nifty/i;
  return rows.map((r: any) => {
    const title = String(r?.title || r?.headline || '').trim();
    const summary = String(r?.text || r?.summary || '').trim() || undefined;
    return {
      title,
      url: String(r?.url || r?.link || '').trim(),
      source: String(r?.site || r?.publisher || 'FMP'),
      provider: 'FMP' as const,
      publishedAt: publishedAt(String(r?.publishedDate || r?.publishedAt || r?.date || '') || null, now),
      summary,
      sentimentScore: headlineScore(title),
      category: classifyCategory(title, summary)
    };
  }).filter((a: IndianNewsArticle) => Boolean(a.title && a.url) && indiaTerms.test(`${a.title} ${a.summary || ''}`));
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Goldcrest/2.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProvider(provider: Exclude<IndianNewsProviderId, 'FMP' | 'GOOGLE_NEWS_INDIA'>): Promise<{ status: IndianNewsProviderStatus; articles: IndianNewsArticle[]; error?: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const endpoint = ENDPOINTS[provider];
    let articles: IndianNewsArticle[] = [];

    if (provider === 'ET_MARKETS') {
      // First attempt ET Markets RSS feed which provides pristine live headlines
      try {
        const rssText = await fetchText(new URL(ET_MARKETS_RSS));
        articles = parseRssXml(rssText, 'ET_MARKETS', 'ET Markets', Date.now());
      } catch {
        // Fallback to configured URL or web scraping
      }

      if (!articles.length) {
        const html = await fetchText(new URL(endpoint));
        articles = parseProviderPage(html, 'ET_MARKETS', endpoint, ['/markets/', '/market/'], Date.now());
      }
    } else if (provider === 'MINT') {
      try {
        const rssText = await fetchText(new URL(MINT_RSS));
        articles = parseRssXml(rssText, 'MINT', 'Mint', Date.now());
      } catch {
        const html = await fetchText(new URL(endpoint));
        articles = parseProviderPage(html, 'MINT', endpoint, ['/market/', '/markets/', '/topic/market'], Date.now());
      }
    } else {
      const hints = provider === 'PULSE_ZERODHA'
        ? ['/news/', '/article', '/story', '/post']
        : ['/market/', '/business/', '/stocks/', '/world/'];
      const html = await fetchText(new URL(endpoint));
      articles = parseProviderPage(html, provider, endpoint, hints, Date.now());
    }

    return {
      status: articles.length ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - started
    };
  } catch (e: any) {
    return {
      status: 'ERROR',
      articles: [],
      error: e?.name === 'AbortError' ? `${provider} request timed out.` : e?.message || String(e),
      latencyMs: Date.now() - started
    };
  }
}

async function fetchGoogleNewsIndia(): Promise<{ status: IndianNewsProviderStatus; articles: IndianNewsArticle[]; error?: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const xml = await fetchText(new URL(GOOGLE_NEWS_INDIA_RSS));
    const articles = parseRssXml(xml, 'GOOGLE_NEWS_INDIA', 'Google News (India)', Date.now());
    return {
      status: articles.length ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - started
    };
  } catch (e: any) {
    return {
      status: 'ERROR',
      articles: [],
      error: e?.name === 'AbortError' ? 'Google News India request timed out.' : e?.message || String(e),
      latencyMs: Date.now() - started
    };
  }
}

async function fetchFmp(): Promise<{ status: IndianNewsProviderStatus; articles: IndianNewsArticle[]; error?: string; latencyMs: number }> {
  const key = String(process.env.FMP_API_KEY || process.env.GOLDCREST_FMP_API_KEY || '').trim();
  if (!key) return { status: 'UNCONFIGURED', articles: [], latencyMs: 0 };
  const started = Date.now();
  try {
    const url = new URL(FMP_ENDPOINT);
    url.searchParams.set('page', '0');
    url.searchParams.set('limit', '30');
    url.searchParams.set('apikey', key);
    const payload = JSON.parse(await fetchText(url));
    const message = typeof payload?.['Error Message'] === 'string' ? payload['Error Message'] : undefined;
    if (message) return { status: 'ERROR', articles: [], error: message, latencyMs: Date.now() - started };
    const articles = parseFmpArticles(payload, Date.now());
    return { status: articles.length ? 'LIVE' : 'NO_RESULTS', articles, latencyMs: Date.now() - started };
  } catch (e: any) {
    return {
      status: 'ERROR',
      articles: [],
      error: e?.name === 'AbortError' ? 'FMP news request timed out.' : e?.message || String(e),
      latencyMs: Date.now() - started
    };
  }
}

function fresh(rows: IndianNewsArticle[], now: number) {
  return rows.filter(a => {
    if (!a.publishedAt) return true; // keep articles with undated headlines from live feed
    const ts = Date.parse(a.publishedAt);
    return Number.isFinite(ts) && (now - ts) <= MAX_AGE_MS;
  });
}

function latest(rows: IndianNewsArticle[]): string | null {
  return rows.reduce<string | null>((x, a) => (!a.publishedAt ? x : !x || Date.parse(a.publishedAt) > Date.parse(x) ? a.publishedAt : x), null);
}

function dedupe(rows: IndianNewsArticle[]) {
  const map = new Map<string, IndianNewsArticle>();
  for (const a of [...rows].sort((x, y) => Date.parse(y.publishedAt || '0') - Date.parse(x.publishedAt || '0'))) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!map.has(key)) map.set(key, a);
  }
  return [...map.values()];
}

function prediction(rows: IndianNewsArticle[], marketData: any[] = []): IndianMarketPrediction {
  const usable = rows.filter(a => typeof a.sentimentScore === 'number');
  const newsScore = usable.length ? usable.reduce((s, a) => s + (a.sentimentScore || 0), 0) / usable.length : 0;
  const byProvider = new Map<IndianNewsProviderId, number[]>();
  for (const a of usable) {
    const v = byProvider.get(a.provider) || [];
    v.push(a.sentimentScore || 0);
    byProvider.set(a.provider, v);
  }
  const means = [...byProvider.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length);
  const agreement = means.length > 1 ? 1 - Math.min(1, means.reduce((s, v) => s + Math.abs(v - newsScore), 0) / means.length) : means.length === 1 ? 0.6 : 0;
  const contextScore = (symbol: string): number | undefined => {
    const row = marketData.find(r => String(r?.symbol || '').toUpperCase().includes(symbol));
    if (!row) return undefined;
    const dir = String(row?.signal?.direction || row?.direction || '').toUpperCase();
    const vwap = String(row?.vwapStatus || row?.signal?.vwapStatus || '').toUpperCase();
    return Math.max(-1, Math.min(1, (dir.includes('BUY') ? 0.75 : dir.includes('SELL') ? -0.75 : 0) + (vwap === 'ABOVE_VWAP' ? 0.25 : vwap === 'BELOW_VWAP' ? -0.25 : 0)));
  };
  const nifty = contextScore('NIFTY'), bank = contextScore('BANKNIFTY');
  const marketScore = [nifty, bank].filter((v): v is number => v !== undefined);
  const technical = marketScore.length ? marketScore.reduce((a, b) => a + b, 0) / marketScore.length : 0;
  const combined = newsScore * 0.65 + technical * 0.35;
  const bias = combined > 0.1 ? 'BULLISH' : combined < -0.1 ? 'BEARISH' : 'NEUTRAL';
  const confidence = Math.round(Math.min(88, Math.max(35, 45 + Math.abs(combined) * 35 + Math.min(20, means.length * 4) + agreement * 10)));
  const rationale: string[] = [];
  rationale.push(newsScore > 0.1 ? 'Cross-provider headline sentiment is positive.' : newsScore < -0.1 ? 'Cross-provider headline sentiment is negative.' : 'Cross-provider headline tone is mixed/neutral.');
  if (means.length >= 2 && agreement >= 0.6) rationale.push('Multiple Indian financial sources show aligned sentiment.');
  if (nifty !== undefined) rationale.push(`NIFTY technical signal context: ${nifty.toFixed(2)}.`);
  if (bank !== undefined) rationale.push(`BANKNIFTY technical signal context: ${bank.toFixed(2)}.`);

  return {
    bias,
    confidence,
    newsSentimentScore: Number(newsScore.toFixed(3)),
    sourceAgreement: Number(agreement.toFixed(3)),
    articlesUsed: usable.length,
    marketContext: { niftyScore: nifty, bankNiftyScore: bank },
    rationale,
    disclaimer: 'Probabilistic sentiment summary derived from real-time Indian financial news feeds and market context.'
  };
}

async function fetchInternal(options: IndianNewsFetchOptions, now: Date): Promise<IndianNewsSnapshot> {
  const session = getIndianSessionState(now);
  const nowMs = now.getTime();

  if (!session.isOpen && session.currentPhase === 'CLOSED') {
    return {
      market: 'INDIAN_EQUITY',
      marketOpen: false,
      marketPhase: 'CLOSED',
      fetchedAt: now.toISOString(),
      status: 'MARKET_CLOSED',
      articleCount: 0,
      articles: [],
      providerStatus: {
        PULSE_ZERODHA: 'NO_RESULTS',
        CNBC_TV18: 'NO_RESULTS',
        ET_MARKETS: 'NO_RESULTS',
        MINT: 'NO_RESULTS',
        GOOGLE_NEWS_INDIA: 'NO_RESULTS',
        FMP: 'UNCONFIGURED'
      },
      providerDiagnostics: {
        PULSE_ZERODHA: { status: 'NO_RESULTS', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: true },
        CNBC_TV18: { status: 'NO_RESULTS', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: true },
        ET_MARKETS: { status: 'NO_RESULTS', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: true },
        MINT: { status: 'NO_RESULTS', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: true },
        GOOGLE_NEWS_INDIA: { status: 'NO_RESULTS', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: true },
        FMP: { status: 'UNCONFIGURED', rawArticleCount: 0, freshArticleCount: 0, staleArticleCount: 0, configured: false }
      }
    };
  }

  const [pulse, cnbc, et, mint, gnews, fmp] = await Promise.all([
    fetchProvider('PULSE_ZERODHA'),
    fetchProvider('CNBC_TV18'),
    fetchProvider('ET_MARKETS'),
    fetchProvider('MINT'),
    fetchGoogleNewsIndia(),
    fetchFmp()
  ]);

  const all = {
    PULSE_ZERODHA: pulse,
    CNBC_TV18: cnbc,
    ET_MARKETS: et,
    MINT: mint,
    GOOGLE_NEWS_INDIA: gnews,
    FMP: fmp
  };

  const freshBy: Record<IndianNewsProviderId, IndianNewsArticle[]> = {
    PULSE_ZERODHA: fresh(pulse.articles, nowMs),
    CNBC_TV18: fresh(cnbc.articles, nowMs),
    ET_MARKETS: fresh(et.articles, nowMs),
    MINT: fresh(mint.articles, nowMs),
    GOOGLE_NEWS_INDIA: fresh(gnews.articles, nowMs),
    FMP: fresh(fmp.articles, nowMs)
  };

  const articles = dedupe(Object.values(freshBy).flat()).slice(0, 60);
  const providerStatus = Object.fromEntries(Object.entries(all).map(([id, r]) => [id, r.status])) as Record<IndianNewsProviderId, IndianNewsProviderStatus>;
  const providerDiagnostics = Object.fromEntries(
    Object.entries(all).map(([id, r]) => [
      id,
      {
        status: r.status,
        rawArticleCount: r.articles.length,
        freshArticleCount: freshBy[id as IndianNewsProviderId].length,
        staleArticleCount: Math.max(0, r.articles.length - freshBy[id as IndianNewsProviderId].length),
        configured: id === 'FMP' ? Boolean(process.env.FMP_API_KEY || process.env.GOLDCREST_FMP_API_KEY) : true,
        latencyMs: r.latencyMs,
        latestRawArticleAt: latest(r.articles),
        latestFreshArticleAt: latest(freshBy[id as IndianNewsProviderId]),
        error: r.error
      }
    ])
  ) as Record<IndianNewsProviderId, IndianNewsProviderDiagnostic>;

  const errors = Object.values(all).map(r => r.error).filter(Boolean) as string[];
  const allFailed = Object.values(all).every(r => ['ERROR', 'RATE_LIMITED', 'UNCONFIGURED'].includes(r.status));
  const status: IndianNewsSnapshot['status'] = articles.length ? 'LIVE' : allFailed ? 'UNAVAILABLE' : 'NO_RESULTS';

  const snapshot: IndianNewsSnapshot = {
    market: 'INDIAN_EQUITY',
    marketOpen: session.isOpen,
    marketPhase: session.currentPhase,
    fetchedAt: new Date().toISOString(),
    status,
    articleCount: articles.length,
    articles,
    providerStatus,
    providerDiagnostics,
    prediction: articles.length ? prediction(articles, options.marketData) : undefined,
    error: errors.length ? errors.join(' | '): undefined
  };

  cache = { snapshot, expiresAt: nowMs + CACHE_TTL_MS };
  return snapshot;
}

export async function fetchIndianMarketNews(options: IndianNewsFetchOptions = {}, now: Date = new Date()): Promise<IndianNewsSnapshot> {
  if (!options.forceRefresh && cache && Date.now() < cache.expiresAt) return cache.snapshot;
  if (inFlight) return inFlight;
  inFlight = fetchInternal(options, now).finally(() => { inFlight = null; });
  return inFlight;
}

export function resetIndianMarketNewsCacheForTest() {
  cache = null;
  inFlight = null;
}

export { parseProviderPage, parseFmpArticles, parseRssXml, prediction };
