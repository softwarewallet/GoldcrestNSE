import React, { useState, useEffect } from 'react';
import { Activity, Clock } from 'lucide-react';
import { IndianSessionState } from '../markets/common/types';

interface NseMarketClockProps {
  initialSession?: IndianSessionState;
}

export interface MarketLiveState {
  istTimeString: string;
  isMarketOpen: boolean;
  isPreMarket: boolean;
  statusText: string;
  countdownLabel: string;
  countdownText: string;
}

export function computeLiveIndianMarketState(date: Date = new Date()): MarketLiveState {
  // Convert current system time to Indian Standard Time (UTC + 5:30)
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
  const istDate = new Date(utcMs + (5.5 * 3600000));

  const day = istDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const seconds = istDate.getSeconds();
  const timeInSec = hours * 3600 + minutes * 60 + seconds;

  // Real-time running IST Clock (HH:MM:SS IST)
  const istTimeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} IST`;

  const isWeekend = day === 0 || day === 6;

  // NSE Indian Market Timings (Monday to Friday):
  // Pre-market: 09:00:00 - 09:15:00 IST (32,400 to 33,300 sec)
  // Regular Trading Session: 09:15:00 - 15:30:00 IST (33,300 to 55,800 sec)
  const isMarketOpen = !isWeekend && timeInSec >= 33300 && timeInSec < 55800;
  const isPreMarket = !isWeekend && timeInSec >= 32400 && timeInSec < 33300;

  let statusText: string;
  let countdownLabel: string;
  let countdownText: string;
  let remainingSeconds: number;

  if (isMarketOpen) {
    statusText = 'OPEN';
    countdownLabel = 'Closes in';
    remainingSeconds = 55800 - timeInSec;

    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;

    countdownText = `${h > 0 ? `${h}h ` : ''}${m}m ${String(s).padStart(2, '0')}s`;
  } else if (isPreMarket) {
    statusText = 'PRE-MARKET';
    countdownLabel = 'Regular in';
    remainingSeconds = 33300 - timeInSec;

    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    countdownText = `${m}m ${String(s).padStart(2, '0')}s`;
  } else {
    statusText = 'CLOSED';
    countdownLabel = 'Opens in';

    // Calculate seconds until next trading session (09:15:00 IST on next trading day)
    let daysToAdd = 0;
    if (isWeekend) {
      if (day === 6) daysToAdd = 2; // Saturday -> Monday
      else if (day === 0) daysToAdd = 1; // Sunday -> Monday
    } else {
      // Weekday
      if (timeInSec < 33300) {
        // Today before 09:15 AM
        daysToAdd = 0;
      } else {
        // Today after 15:30 (3:30 PM)
        if (day === 5) daysToAdd = 3; // Friday -> Monday
        else daysToAdd = 1; // Mon-Thu -> Tomorrow
      }
    }

    if (daysToAdd === 0) {
      remainingSeconds = 33300 - timeInSec;
    } else {
      const secUntilMidnight = 86400 - timeInSec;
      const fullDaysBetweenSec = (daysToAdd - 1) * 86400;
      const secToNineFifteen = 33300; // 09:15 AM
      remainingSeconds = secUntilMidnight + fullDaysBetweenSec + secToNineFifteen;
    }

    const d = Math.floor(remainingSeconds / 86400);
    const remAfterDays = remainingSeconds % 86400;
    const h = Math.floor(remAfterDays / 3600);
    const m = Math.floor((remAfterDays % 3600) / 60);
    const s = remAfterDays % 60;

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    parts.push(`${String(s).padStart(2, '0')}s`);

    countdownText = parts.join(' ');
  }

  return {
    istTimeString,
    isMarketOpen,
    isPreMarket,
    statusText,
    countdownLabel,
    countdownText
  };
}

export const NseMarketClock: React.FC<NseMarketClockProps> = () => {
  const [state, setState] = useState<MarketLiveState>(() => computeLiveIndianMarketState());

  useEffect(() => {
    // 1-second precision live running clock
    const timer = setInterval(() => {
      setState(computeLiveIndianMarketState());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const { istTimeString, isMarketOpen, isPreMarket, statusText, countdownLabel, countdownText } = state;

  return (
    <div
      id="header_nse_session_badge"
      title={`NSE Real-Time Market Session: ${statusText} | ${countdownLabel} ${countdownText} | ${istTimeString}`}
      className={`px-3 py-1.5 rounded-lg border font-mono shadow-sm flex flex-col justify-center min-w-[245px] shrink-0 transition-colors ${
        isMarketOpen
          ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
          : 'bg-[#040e1b] border-slate-800 text-slate-300'
      }`}
    >
      {/* Top Row: NSE Header and Running IST Clock */}
      <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
        <div className="flex items-center gap-1.5 font-bold">
          <Activity className={`w-3.5 h-3.5 ${isMarketOpen ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="text-slate-300">NSE</span>
          <span className={`w-1.5 h-1.5 rounded-full ${isMarketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
        </div>
        <div className="flex items-center gap-1.5 text-slate-200 font-semibold tabular-nums">
          <Clock className="w-3 h-3 text-cyan-400 animate-pulse" />
          <span>{istTimeString}</span>
        </div>
      </div>

      {/* Bottom Row: Market Status & Dynamic Countdown */}
      <div className="flex items-center justify-between gap-2 mt-1 text-[11px] leading-tight pt-1 border-t border-slate-800/70">
        <div className="flex items-center gap-1.5">
          {isMarketOpen ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : (
            <span className={`w-2 h-2 rounded-full ${isPreMarket ? 'bg-cyan-400 animate-pulse' : 'bg-amber-500/90'}`} />
          )}
          <span className={`font-bold uppercase text-[10px] ${
            isMarketOpen ? 'text-emerald-400' : isPreMarket ? 'text-cyan-400' : 'text-amber-400'
          }`}>
            {statusText}
          </span>
        </div>

        <div className={`text-[11px] font-medium tabular-nums ${
          isMarketOpen ? 'text-emerald-300' : 'text-amber-200'
        }`}>
          <span className="text-[10px] text-slate-400 mr-1">{countdownLabel}:</span>
          <span className="font-semibold text-slate-100">{countdownText}</span>
        </div>
      </div>
    </div>
  );
};
