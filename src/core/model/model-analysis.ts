import type { Indicator, ModelClaimAnalysis } from '../types';

/**
 * Guard rails applied to every AI claim analysis, on the server before responding
 * and again in the app. Model output is treated as a signal to be sanity-checked,
 * never as a verdict.
 */

export const MODEL_LIMITS = {
  maxIndicators: 6,
  maxEvidenceNeeded: 5,
  maxTextLength: 1200,
  /** Model knowledge alone is never treated as near-certain. */
  maxConfidence: 0.9,
} as const;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MODEL_LIMITS.maxConfidence, value));
}

const clip = (text: string) => text.trim().slice(0, MODEL_LIMITS.maxTextLength);

function cleanIndicators(indicators: Indicator[]): Indicator[] {
  return indicators
    .filter((indicator) => indicator.label.trim().length > 0)
    .slice(0, MODEL_LIMITS.maxIndicators)
    .map((indicator, index) => ({
      ...indicator,
      id: indicator.id || `model_${index}`,
      label: clip(indicator.label),
      description: clip(indicator.description),
      weight: Math.max(0, Math.min(1, Number.isFinite(indicator.weight) ? indicator.weight : 0)),
      origin: 'model',
      excerpt: indicator.excerpt?.trim() ? clip(indicator.excerpt) : undefined,
    }));
}

export function normalizeModelAnalysis(analysis: ModelClaimAnalysis): ModelClaimAnalysis {
  const notCheckableType = analysis.claimType === 'opinion' || analysis.claimType === 'prediction';
  const verifiable = analysis.verifiable && !notCheckableType;

  // A claim the model calls unverifiable cannot also be "supported" or "contradicted".
  const stance = verifiable ? analysis.stance : 'unverifiable';

  return {
    ...analysis,
    extractedClaim: clip(analysis.extractedClaim),
    verifiable,
    verifiabilityNote: clip(analysis.verifiabilityNote),
    stance,
    confidence: clampConfidence(analysis.confidence),
    reasoning: clip(analysis.reasoning),
    indicators: cleanIndicators(analysis.indicators),
    evidenceNeeded: analysis.evidenceNeeded
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MODEL_LIMITS.maxEvidenceNeeded),
    limitations: clip(analysis.limitations),
  };
}
