import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Filter,
  Globe,
  Newspaper,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { IndianNewsArticle, IndianNewsSnapshot } from '../services/indianMarketNewsService';

interface MarketNewsProps {
  className?: string;
  maxArticles?: number;
  compact?: boolean;
}

export const MarketNews: React.FC<MarketNewsProps> = ({
  className = '',
  maxArticles = 30,
  compact = false
}) => {
  const [snapshot, setSnapshot] = useState<IndianNewsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSentiment, setSelectedSentiment] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchNews = async (force: boolean = false) => {
    if (force) setRefreshing(true);
    try {
      const url = force ? '/api/india/news?refresh=true' : '/api/india/news';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok && !data?.articles?.length) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }
      setSnapshot(data);
      setError(null);
    } catch (err: any) {
      if (!snapshot) {
        setError(err?.message || 'Unable to fetch Indian market news');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => {
      fetchNews(false);
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const articles = snapshot?.articles || [];

  const sources = useMemo(() => {
    const list = Array.from(new Set(articles.map(a => a.source))).filter(Boolean);
    return ['ALL', ...list];
  }, [articles]);

  const categories = useMemo(() => {
    const list = Array.from(new Set(articles.map(a => a.category))).filter((c): c is string => Boolean(c));
    return ['ALL', ...list];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      if (selectedSource !== 'ALL' && article.source !== selectedSource) return false;
      if (selectedCategory !== 'ALL' && article.category !== selectedCategory) return false;

      if (selectedSentiment !== 'ALL') {
        const score = article.sentimentScore || 0;
        if (selectedSentiment === 'BULLISH' && score <= 0.05) return false;
        if (selectedSentiment === 'BEARISH' && score >= -0.05) return false;
        if (selectedSentiment === 'NEUTRAL' && Math.abs(score) > 0.05) return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const text = `${article.title} ${article.summary || ''} ${article.source} ${article.category || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    }).slice(0, maxArticles);
  }, [articles, selectedSource, selectedCategory, selectedSentiment, searchQuery, maxArticles]);

  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Recent';
    const parsed = Date.parse(dateStr);
    if (!Number.isFinite(parsed)) return 'Recent';
    const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const prediction = snapshot?.prediction;

  return (
    <div className={`rounded-xl border border-slate-800 bg-[#04121f] flex flex-col overflow-hidden text-slate-200 ${className}`}>
      {/* Header bar */}
      <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#030e19]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Newspaper className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white tracking-wide flex items-center gap-2">
                Indian Market News &amp; Live Sentiment
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-emerald-950/60 border border-emerald-800 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                REAL-TIME
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              ET Markets • Zerodha Pulse • LiveMint • CNBC-TV18
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] font-mono text-slate-400">
              {articles.length} headlines ingested
            </div>
            <div className="text-[9px] text-slate-500 font-mono">
              {snapshot?.marketPhase || 'NSE / BSE'}
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchNews(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 disabled:opacity-50 transition cursor-pointer flex items-center gap-1 text-xs font-mono"
            title="Refresh Indian Market News"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden md:inline text-[10px]">Refresh</span>
          </button>
        </div>
      </div>

      {/* Market Sentiment & Predictive Signal Banner */}
      {prediction && (
        <div className="px-4 py-2.5 bg-gradient-to-r from-[#071d2e] via-[#051827] to-[#04121f] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-300">Sentiment Gauge:</span>
              <span
                className={`px-2 py-0.5 rounded font-mono font-extrabold text-[11px] ${
                  prediction.bias === 'BULLISH'
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700'
                    : prediction.bias === 'BEARISH'
                    ? 'bg-rose-950/80 text-rose-400 border border-rose-700'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                {prediction.bias === 'BULLISH' && <TrendingUp className="inline w-3 h-3 mr-1 -mt-0.5" />}
                {prediction.bias === 'BEARISH' && <TrendingDown className="inline w-3 h-3 mr-1 -mt-0.5" />}
                {prediction.bias}
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
              <span>Score: <b className={prediction.newsSentimentScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{prediction.newsSentimentScore > 0 ? `+${prediction.newsSentimentScore}` : prediction.newsSentimentScore}</b></span>
              <span className="text-slate-700">•</span>
              <span>Confidence: <b className="text-cyan-400">{prediction.confidence}%</b></span>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 italic hidden sm:block truncate max-w-md">
            {prediction.rationale?.[0] || 'Derived from live Indian market headline analysis.'}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="px-4 py-2.5 border-b border-slate-800/60 bg-[#020b14] flex flex-wrap items-center gap-2 text-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search news (Nifty, RBI, Reliance, Tata, IT, Banking...)"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60 transition"
          />
        </div>

        {/* Source Dropdown / Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 font-mono hidden md:inline">Source:</span>
          <select
            value={selectedSource}
            onChange={e => setSelectedSource(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 font-mono cursor-pointer"
          >
            {sources.map(src => (
              <option key={src} value={src}>
                {src === 'ALL' ? 'All Sources' : src}
              </option>
            ))}
          </select>
        </div>

        {/* Category Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 font-mono hidden md:inline">Category:</span>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 font-mono cursor-pointer"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {cat === 'ALL' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>

        {/* Sentiment Filter Tabs */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px] font-mono shrink-0">
          {(['ALL', 'BULLISH', 'BEARISH'] as const).map(sentiment => (
            <button
              key={sentiment}
              type="button"
              onClick={() => setSelectedSentiment(sentiment)}
              className={`px-2 py-1 rounded transition cursor-pointer ${
                selectedSentiment === sentiment
                  ? sentiment === 'BULLISH'
                    ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-700/60'
                    : sentiment === 'BEARISH'
                    ? 'bg-rose-950 text-rose-300 font-bold border border-rose-700/60'
                    : 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sentiment}
            </button>
          ))}
        </div>
      </div>

      {/* News Feed Stream */}
      <div className={`overflow-y-auto divide-y divide-slate-800/60 font-sans ${compact ? 'max-h-[380px]' : 'max-h-[540px]'}`}>
        {loading && !articles.length ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-mono">Ingesting authoritative Indian financial feeds...</p>
          </div>
        ) : error && !articles.length ? (
          <div className="p-8 text-center space-y-3">
            <AlertCircle className="w-6 h-6 text-rose-400 mx-auto" />
            <p className="text-xs text-rose-300 font-mono">{error}</p>
            <button
              onClick={() => fetchNews(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition font-mono"
            >
              Retry
            </button>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-slate-500">
            <p className="text-xs font-mono">No news articles match your current search or filter criteria.</p>
            <button
              onClick={() => {
                setSelectedSource('ALL');
                setSelectedCategory('ALL');
                setSelectedSentiment('ALL');
                setSearchQuery('');
              }}
              className="text-xs text-emerald-400 hover:underline font-mono"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredArticles.map((article, idx) => {
            const score = article.sentimentScore || 0;
            const isBullish = score > 0.05;
            const isBearish = score < -0.05;

            return (
              <article
                key={`${article.url}-${idx}`}
                className="p-3.5 hover:bg-slate-900/70 transition flex flex-col gap-1.5 group"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Source tag */}
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-semibold">
                      {article.source}
                    </span>

                    {/* Category tag */}
                    {article.category && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-800/40">
                        {article.category}
                      </span>
                    )}

                    {/* Sentiment tag */}
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        isBullish
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                          : isBearish
                          ? 'bg-rose-950/60 text-rose-400 border border-rose-800/50'
                          : 'bg-slate-800/60 text-slate-400 border border-slate-700/50'
                      }`}
                    >
                      {isBullish ? '+ Bullish' : isBearish ? '- Bearish' : 'Neutral'}
                    </span>
                  </div>

                  {/* Timestamp */}
                  <span className="text-slate-500 flex items-center gap-1 shrink-0">
                    <Clock className="w-2.5 h-2.5 text-slate-600" />
                    {timeAgo(article.publishedAt)}
                  </span>
                </div>

                {/* Headline */}
                <h4 className="text-xs md:text-sm font-semibold text-slate-100 group-hover:text-emerald-300 transition leading-snug">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline flex items-start gap-1"
                  >
                    <span>{article.title}</span>
                    <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5" />
                  </a>
                </h4>

                {/* Summary / Snippet */}
                {article.summary && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 border-t border-slate-800 bg-[#020b14] flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span className="flex items-center gap-1">
          <Globe className="w-3 h-3 text-slate-600" />
          <span>Ingested via Economic Times &amp; Indian Financial Wire</span>
        </span>
        <span>Displaying {filteredArticles.length} of {articles.length}</span>
      </div>
    </div>
  );
};
