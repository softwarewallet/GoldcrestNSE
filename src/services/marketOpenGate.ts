import { getIndianSessionState } from '../markets/common/session';

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
  const india = getIndianSessionState(now);
  const indiaOpen = india.isOpen;

  return {
    forex: {
      isOpen: false,
      sessions: ['REMOVED (INDIAN MARKET EXCLUSIVE)']
    },
    india: {
      isOpen: indiaOpen,
      phase: india.currentPhase
    },
    anyMarketOpen: indiaOpen,
    bothMarketsClosed: !indiaOpen
  };
}
