import { GoogleGenAI } from '@google/genai';
import { CompletePairAnalysisResponse } from '../markets/forex/types';

const SYSTEM_INSTRUCTION = `You are the explanation layer of a quantitative Forex analysis system.

Never invent market data.
Never guarantee a market outcome.
Never modify calculated numerical values.
Clearly distinguish observed data from analytical interpretation.
Explain why the quantitative engine produced the supplied signal.
If evidence conflicts, explicitly state the conflict.
If the correct result is NO TRADE, explain why.

You must structure your response with the following 7 sections:
1. Market summary
2. Trend explanation
3. Supporting evidence
4. Conflicting evidence
5. Trade-plan explanation
6. Main risks
7. Invalidation conditions`;

export interface GeminiExplanationResult {
  pair: string;
  timestamp: number;
  explanationText: string;
  sections: {
    marketSummary: string;
    trendExplanation: string;
    supportingEvidence: string[];
    conflictingEvidence: string[];
    tradePlanExplanation: string;
    mainRisks: string[];
    invalidationConditions: string[];
  };
  generatedByAi: boolean;
}

export async function explainForexAnalysis(
  analysis: CompletePairAnalysisResponse
): Promise<GeminiExplanationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Graceful deterministic explanation when GEMINI_API_KEY is not configured
    return generateDeterministicExplanation(analysis);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Explain the following quantitative Forex analysis according to your instructions:

ANALYSIS PAYLOAD:
${JSON.stringify(analysis, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2
      }
    });

    const text = response.text || '';
    return parseExplanationIntoSections(analysis.pair, text);
  } catch (err) {
    console.warn('Gemini API call failed, falling back to deterministic quantitative explanation:', err);
    return generateDeterministicExplanation(analysis);
  }
}

function parseExplanationIntoSections(pair: string, rawText: string): GeminiExplanationResult {
  const lines = rawText.split('\n');
  const sections: GeminiExplanationResult['sections'] = {
    marketSummary: '',
    trendExplanation: '',
    supportingEvidence: [],
    conflictingEvidence: [],
    tradePlanExplanation: '',
    mainRisks: [],
    invalidationConditions: []
  };

  let currentSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (/1\.\s*market\s*summary/i.test(trimmed)) {
      currentSection = 'marketSummary';
    } else if (/2\.\s*trend\s*explanation/i.test(trimmed)) {
      currentSection = 'trendExplanation';
    } else if (/3\.\s*supporting\s*evidence/i.test(trimmed)) {
      currentSection = 'supportingEvidence';
    } else if (/4\.\s*conflicting\s*evidence/i.test(trimmed)) {
      currentSection = 'conflictingEvidence';
    } else if (/5\.\s*trade-plan\s*explanation/i.test(trimmed) || /5\.\s*trade\s*plan/i.test(trimmed)) {
      currentSection = 'tradePlanExplanation';
    } else if (/6\.\s*main\s*risks/i.test(trimmed)) {
      currentSection = 'mainRisks';
    } else if (/7\.\s*invalidation\s*conditions/i.test(trimmed)) {
      currentSection = 'invalidationConditions';
    } else if (trimmed) {
      if (currentSection === 'marketSummary') {
        sections.marketSummary += (sections.marketSummary ? ' ' : '') + trimmed;
      } else if (currentSection === 'trendExplanation') {
        sections.trendExplanation += (sections.trendExplanation ? ' ' : '') + trimmed;
      } else if (currentSection === 'tradePlanExplanation') {
        sections.tradePlanExplanation += (sections.tradePlanExplanation ? ' ' : '') + trimmed;
      } else if (currentSection === 'supportingEvidence') {
        sections.supportingEvidence.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'conflictingEvidence') {
        sections.conflictingEvidence.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'mainRisks') {
        sections.mainRisks.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'invalidationConditions') {
        sections.invalidationConditions.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      }
    }
  }

  // Fallbacks if formatting differed
  if (!sections.marketSummary) sections.marketSummary = rawText.slice(0, 300);

  return {
    pair,
    timestamp: Date.now(),
    explanationText: rawText,
    sections,
    generatedByAi: true
  };
}

function generateDeterministicExplanation(analysis: CompletePairAnalysisResponse): GeminiExplanationResult {
  const isNoTrade = analysis.signal.direction === 'NO_TRADE';
  const isBuy = analysis.signal.direction.includes('BUY');
  const isSell = analysis.signal.direction.includes('SELL');

  const marketSummary = `${analysis.pair} is currently trading at ${analysis.currentPrice.toFixed(5)} under a ${analysis.regime} regime in the ${analysis.session} session. The quantitative signal is ${analysis.signal.direction} with an aggregate score of ${analysis.signal.score}/100.`;

  const trendExplanation = `The macro market structure displays a ${analysis.marketStructure.type} pattern in a ${analysis.marketStructure.phase} phase. Multi-timeframe trend alignment is evaluated as ${analysis.multiTimeframe.alignment} (${analysis.multiTimeframe.summary}).`;

  const supportingEvidence: string[] = [
    `Price action printing ${analysis.marketStructure.type} on 15M execution candles.`,
    analysis.indicators.rsi !== null ? `RSI is currently measured at ${analysis.indicators.rsi}.` : 'RSI baseline neutral.',
    analysis.indicators.ema9 !== null && analysis.indicators.ema21 !== null
      ? `EMA 9 (${analysis.indicators.ema9}) relative to EMA 21 (${analysis.indicators.ema21}) confirms ${isBuy ? 'bullish' : isSell ? 'bearish' : 'neutral'} moving average gradient.`
      : 'Moving average alignment neutral.',
    `Nearest significant Support at ${analysis.supportResistance.nearestSupport ?? 'N/A'} and Resistance at ${analysis.supportResistance.nearestResistance ?? 'N/A'}.`
  ];

  const conflictingEvidence: string[] = [];
  if (analysis.warnings.length > 0) {
    conflictingEvidence.push(...analysis.warnings);
  }
  if (analysis.multiTimeframe.alignment === 'CONFLICTING') {
    conflictingEvidence.push('Higher timeframes conflict with lower timeframe execution trend.');
  }
  if (conflictingEvidence.length === 0) {
    conflictingEvidence.push('No severe directional divergence identified across multi-timeframe inputs.');
  }

  let tradePlanExplanation = 'No active trade plan is established due to filtering conditions.';
  if (analysis.tradePlan) {
    tradePlanExplanation = `Entry zone defined between ${analysis.tradePlan.entryMin} and ${analysis.tradePlan.entryMax}. Stop-Loss set at ${analysis.tradePlan.stopLoss} (${analysis.tradePlan.stopLossReason}). Target 1 at ${analysis.tradePlan.takeProfit1} provides a ${analysis.tradePlan.riskReward}:1 Risk/Reward ratio.`;
  }

  const mainRisks: string[] = [
    `Macroeconomic volatility shifts during active ${analysis.session} session.`,
    `Spread widening during liquidity transitions.`,
    isBuy ? `Break below key structural support at ${analysis.supportResistance.nearestSupport ?? analysis.tradePlan?.stopLoss}.` : `Break above key structural resistance at ${analysis.supportResistance.nearestResistance ?? analysis.tradePlan?.stopLoss}.`
  ];

  const invalidationConditions: string[] = [
    isBuy ? `Hourly candle close below ${analysis.tradePlan?.stopLoss ?? analysis.supportResistance.nearestSupport}.` : `Hourly candle close above ${analysis.tradePlan?.stopLoss ?? analysis.supportResistance.nearestResistance}.`,
    `Trend alignment deterioration across 1H and 4H timeframes.`,
    `High-impact central bank announcement within 20 minutes.`
  ];

  const rawText = `1. Market summary\n${marketSummary}\n\n2. Trend explanation\n${trendExplanation}\n\n3. Supporting evidence\n${supportingEvidence.map(s => `- ${s}`).join('\n')}\n\n4. Conflicting evidence\n${conflictingEvidence.map(c => `- ${c}`).join('\n')}\n\n5. Trade-plan explanation\n${tradePlanExplanation}\n\n6. Main risks\n${mainRisks.map(r => `- ${r}`).join('\n')}\n\n7. Invalidation conditions\n${invalidationConditions.map(i => `- ${i}`).join('\n')}`;

  return {
    pair: analysis.pair,
    timestamp: Date.now(),
    explanationText: rawText,
    sections: {
      marketSummary,
      trendExplanation,
      supportingEvidence,
      conflictingEvidence,
      tradePlanExplanation,
      mainRisks,
      invalidationConditions
    },
    generatedByAi: false
  };
}
