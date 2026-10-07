import { getForexSessionState, getIndianSessionState } from '../markets/common/session';

export interface AutoLiveMarketGate {
  forex: {
    isOpen: boolean;
    sessions: string[];
  };
  india: {
    isOpen: boolean;
    phase: string;
  };
  anyMarketOpen: boolean;
  bothMarketsClosed: boolean;
}

export function getAutoLiveMarketGate(now: Date = new Date()): AutoLiveMarketGate {
  const forex = getForexSessionState(now);
  const india = getIndianSessionState(now);
  const forexOpen = !forex.activeSessions.includes('CLOSED (WEEKEND)');
  const indiaOpen = india.isOpen;

  return {
    forex: {
      isOpen: forexOpen,
      sessions: [...forex.activeSessions]
    },
    india: {
      isOpen: indiaOpen,
      phase: india.currentPhase
    },
    anyMarketOpen: forexOpen || indiaOpen,
    bothMarketsClosed: !forexOpen && !indiaOpen
  };
}
