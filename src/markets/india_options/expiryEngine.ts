export interface ExpiryInfo {
  dateString: string; // e.g. "2026-09-24"
  label: string; // e.g. "24 SEP (Weekly)"
  isWeekly: boolean;
  isMonthly: boolean;
  daysToExpiry: number;
  tradingDaysToExpiry: number;
  isExpiryToday: boolean;
  expiryDayRiskScore: number; // 0-100 (high on expiry day due to gamma/theta explosion)
}

/**
 * Dynamically computes upcoming weekly and monthly expiries for Indian indices.
 * @param targetDayOfWeek 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
 */
export function generateExpiries(targetDayOfWeek: number = 4, referenceDate: Date = new Date()): ExpiryInfo[] {
  const expiries: ExpiryInfo[] = [];
  const current = new Date(referenceDate);
  current.setHours(15, 30, 0, 0);

  // Find next 4 target weekly expiries
  let candidate = new Date(current);
  let count = 0;

  while (count < 5) {
    const day = candidate.getDay();
    if (day === targetDayOfWeek) {
      const diffTime = candidate.getTime() - referenceDate.getTime();
      const daysToExpiry = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

      // Estimate trading days (excluding Sat/Sun)
      let tradingDays = 0;
      const walk = new Date(referenceDate);
      while (walk <= candidate) {
        const d = walk.getDay();
        if (d !== 0 && d !== 6) tradingDays++;
        walk.setDate(walk.getDate() + 1);
      }

      // Check if it's the last targetDay of the month (Monthly Expiry)
      const testNextWeek = new Date(candidate);
      testNextWeek.setDate(testNextWeek.getDate() + 7);
      const isMonthly = testNextWeek.getMonth() !== candidate.getMonth();

      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const label = `${candidate.getDate()} ${monthNames[candidate.getMonth()]} ${candidate.getFullYear()} (${isMonthly ? 'Monthly' : 'Weekly'})`;
      const dateString = candidate.toISOString().split('T')[0];

      expiries.push({
        dateString,
        label,
        isWeekly: !isMonthly,
        isMonthly,
        daysToExpiry,
        tradingDaysToExpiry: Math.max(1, tradingDays),
        isExpiryToday: daysToExpiry === 0,
        expiryDayRiskScore: daysToExpiry === 0 ? 95 : daysToExpiry <= 1 ? 75 : daysToExpiry <= 3 ? 45 : 20
      });

      count++;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return expiries;
}
