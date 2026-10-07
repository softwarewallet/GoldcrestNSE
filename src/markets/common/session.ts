import { ForexSessionState, IndianSessionState } from './types';

/**
 * Calculates current active Forex trading sessions based on UTC time.
 * Standard sessions (UTC):
 * - Sydney: 21:00 - 06:00 UTC
 * - Tokyo: 00:00 - 09:00 UTC
 * - London: 07:00 - 16:00 UTC
 * - New York: 12:00 - 21:00 UTC
 * - London / NY Overlap: 12:00 - 16:00 UTC
 */
export function getForexSessionState(now: Date = new Date()): ForexSessionState {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const day = now.getUTCDay(); // 0 = Sun, 6 = Sat

  // Weekend check (Forex typically closes Friday ~21:00 UTC to Sunday ~21:00 UTC)
  const isWeekend = (day === 6) || (day === 0 && utcHours < 21) || (day === 5 && utcHours >= 21);

  if (isWeekend) {
    return {
      sydney: false,
      tokyo: false,
      london: false,
      newYork: false,
      isLondonNyOverlap: false,
      activeSessions: ['CLOSED (WEEKEND)']
    };
  }

  const sydney = (utcHours >= 21 || utcHours < 6);
  const tokyo = (utcHours >= 0 && utcHours < 9);
  const london = (utcHours >= 7 && utcHours < 16);
  const newYork = (utcHours >= 12 && utcHours < 21);
  const isLondonNyOverlap = (utcHours >= 12 && utcHours < 16);

  const activeSessions: string[] = [];
  if (isLondonNyOverlap) activeSessions.push('London/NY Overlap');
  else {
    if (london) activeSessions.push('London');
    if (newYork) activeSessions.push('New York');
  }
  if (tokyo) activeSessions.push('Tokyo');
  if (sydney) activeSessions.push('Sydney');

  if (activeSessions.length === 0) {
    activeSessions.push('Market Transition');
  }

  return {
    sydney,
    tokyo,
    london,
    newYork,
    isLondonNyOverlap,
    activeSessions
  };
}

/**
 * Calculates Indian Equity Derivatives session state based on IST (UTC + 5:30).
 * Session timeline:
 * - 09:00 - 09:08 IST: Pre-Market
 * - 09:15 IST: Market Open
 * - 09:15 - 15:00 IST: Regular Session
 * - 15:00 - 15:30 IST: Near Close / Intraday Squaring
 * - Thursday (or Wednesday for BankNifty): Expiry Session
 * - 15:30 IST: Market Closes
 */
export function getIndianSessionState(now: Date = new Date()): IndianSessionState {
  // Convert to IST (UTC + 5:30)
  const istOffset = 5.5 * 3600000;
  const istDate = new Date(now.getTime() + istOffset);

  const istDay = istDate.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const timeInMinutes = hours * 60 + minutes;

  const istTimeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} IST`;
  const isWeekend = (istDay === 0 || istDay === 6);
  const isExpiryDay = (istDay === 4); // Thursday weekly expiry for NSE Nifty

  if (isWeekend) {
    return {
      currentPhase: 'CLOSED',
      isOpen: false,
      istTime: istTimeString,
      minutesToClose: 0,
      isExpiryDay
    };
  }

  // Pre-market: 09:00 to 09:14 (540 to 554 mins)
  if (timeInMinutes >= 540 && timeInMinutes < 555) {
    return {
      currentPhase: 'PRE_MARKET',
      isOpen: false,
      istTime: istTimeString,
      minutesToClose: 0,
      isExpiryDay
    };
  }

  // Market Open: 09:15 to 09:30 (555 to 570 mins)
  if (timeInMinutes >= 555 && timeInMinutes < 570) {
    return {
      currentPhase: 'MARKET_OPEN',
      isOpen: true,
      istTime: istTimeString,
      minutesToClose: 930 - timeInMinutes,
      isExpiryDay
    };
  }

  // Regular Session: 09:30 to 15:00 (570 to 900 mins)
  if (timeInMinutes >= 570 && timeInMinutes < 900) {
    return {
      currentPhase: isExpiryDay ? 'EXPIRY_SESSION' : 'REGULAR',
      isOpen: true,
      istTime: istTimeString,
      minutesToClose: 930 - timeInMinutes,
      isExpiryDay
    };
  }

  // Near Close: 15:00 to 15:30 (900 to 930 mins)
  if (timeInMinutes >= 900 && timeInMinutes <= 930) {
    return {
      currentPhase: 'NEAR_CLOSE',
      isOpen: true,
      istTime: istTimeString,
      minutesToClose: 930 - timeInMinutes,
      isExpiryDay
    };
  }

  // Post market or before 9 AM
  return {
    currentPhase: 'CLOSED',
    isOpen: false,
    istTime: istTimeString,
    minutesToClose: 0,
    isExpiryDay
  };
}
