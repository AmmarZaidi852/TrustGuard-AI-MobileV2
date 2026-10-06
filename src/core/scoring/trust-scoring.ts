import { languageConcernIntensity } from '../signals/language-signals';
import type {
  AssessmentLabel,
  EvidenceItem,
  EvidenceStatus,
  ExtractedClaim,
  ImageAuthenticityAnalysis,
  Indicator,
  Likelihood,
  ModelClaimAnalysis,
  RiskLevel,
  TrustAssessment,
  TrustFactor,
} from '../types';

/**
 * Preliminary, rule-based trust scoring.
 *
 * Each signal becomes a factor in 0..1 (1 favours trust) with a fixed weight.
 * The score is the weighted mean of *available* factors, and is only produced
 * when at least one verification signal (model analysis or evidence) exists —
 * language heuristics alone never produce a trust score.
 *
 * The whole module is a pure function of its inputs so it can be swapped for a
 * model-based scorer without touching the pipeline or UI.
 */

export const FACTOR_WEIGHTS = {
  model_assessment: 0.3,
  evidence_balance: 0.3,
  /**
   * Credibility is not a direction on its own — a credible source can contradict a
   * claim. It already weights `evidence_balance` and feeds confidence, so it is shown
   * for transparency but not counted again in the score.
   */
  source_credibility: 0,
  language_signals: 0.1,
  ai_generation: 0.1,
  manipulation: 0.05,
} as const;

export const THRESHOLDS = {
  reliable: 70,
  misleading: 45,
  false: 30,
  minConfidenceForStrongLabel: 0.55,
} as const;

export interface ScoringInput {
  claim: ExtractedClaim | null;
  indicators: Indicator[];
  model: ModelClaimAnalysis | null;
  evidence: EvidenceItem[];
  evidenceStatus: EvidenceStatus;
  authenticity: ImageAuthenticityAnalysis | null;
}

const MODEL_STANCE_VALUE: Record<ModelClaimAnalysis['stance'], number> = {
  supported: 0.85,
  disputed: 0.4,
  unverifiable: 0.5,
  contradicted: 0.12,
};

const LIKELIHOOD_VALUE: Record<Likelihood, number | null> = {
  low: 0.85,
  moderate: 0.5,
  high: 0.15,
  undetermined: null,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function relevantEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.filter((item) => item.stance !== 'unrelated');
}

/** Credibility-weighted balance of supporting vs contradicting evidence, 0..1. */
export function evidenceBalance(evidence: EvidenceItem[]): number | null {
  const relevant = relevantEvidence(evidence);
  if (relevant.length === 0) return null;
  let total = 0;
  let net = 0;
  for (const item of relevant) {
    const weight = item.source.credibility;
    total += weight;
    if (item.stance === 'supports') net += weight;
    else if (item.stance === 'contradicts') net -= weight;
  }
  return total === 0 ? null : clamp01(0.5 + net / (2 * total));
}

export function buildFactors(input: ScoringInput): TrustFactor[] {
  const relevant = relevantEvidence(input.evidence);
  const balance = evidenceBalance(input.evidence);
  const meanCredibility =
    relevant.length > 0
      ? relevant.reduce((sum, item) => sum + item.source.credibility, 0) / relevant.length
      : null;
  const concern = languageConcernIntensity(input.indicators);
  const supports = relevant.filter((item) => item.stance === 'supports').length;
  const contradicts = relevant.filter((item) => item.stance === 'contradicts').length;

  const factors: TrustFactor[] = [
    {
      id: 'model_assessment',
      label: 'AI model assessment',
      value: input.model
        ? clamp01(0.5 + (MODEL_STANCE_VALUE[input.model.stance] - 0.5) * input.model.confidence)
        : null,
      weight: FACTOR_WEIGHTS.model_assessment,
      explanation: input.model
        ? `The model judged the claim "${input.model.stance}" with ${Math.round(input.model.confidence * 100)}% self-reported confidence.`
        : 'No AI model analysis was available.',
    },
    {
      id: 'evidence_balance',
      label: 'Supporting vs contradicting evidence',
      value: balance,
      weight: FACTOR_WEIGHTS.evidence_balance,
      explanation:
        balance === null
          ? 'No relevant evidence was available to weigh.'
          : `${supports} source(s) support and ${contradicts} contradict the claim, weighted by source credibility.`,
    },
    {
      id: 'source_credibility',
      label: 'Source credibility',
      value: meanCredibility,
      weight: FACTOR_WEIGHTS.source_credibility,
      explanation:
        meanCredibility === null
          ? 'No sources were available to evaluate.'
          : `Average heuristic credibility of ${relevant.length} relevant source(s). Used to weight the evidence and set confidence, not scored separately.`,
    },
    {
      id: 'language_signals',
      label: 'Language and framing',
      value: input.claim || input.indicators.length > 0 ? clamp01(1 - concern) : null,
      weight: FACTOR_WEIGHTS.language_signals,
      explanation:
        concern > 0
          ? 'The wording contains patterns common in misleading content. This concerns framing, not whether the claim is true.'
          : 'No concerning language patterns were detected.',
    },
  ];

  if (input.authenticity) {
    factors.push(
      {
        id: 'ai_generation',
        label: 'AI-generation signals',
        value: LIKELIHOOD_VALUE[input.authenticity.aiGeneration.likelihood],
        weight: FACTOR_WEIGHTS.ai_generation,
        explanation: `AI-generation likelihood: ${input.authenticity.aiGeneration.likelihood}.`,
      },
      {
        id: 'manipulation',
        label: 'Manipulation signals',
        value: LIKELIHOOD_VALUE[input.authenticity.manipulation.likelihood],
        weight: FACTOR_WEIGHTS.manipulation,
        explanation: `Manipulation likelihood: ${input.authenticity.manipulation.likelihood}.`,
      },
    );
  }

  return factors;
}

function weightedScore(factors: TrustFactor[]): number | null {
  const available = factors.filter((factor) => factor.value !== null);
  const totalWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight === 0) return null;
  const score = available.reduce(
    (sum, factor) => sum + (factor.value as number) * factor.weight,
    0,
  );
  return Math.round((score / totalWeight) * 100);
}

/**
 * 0..1 — how much the assessment rests on. Grows with signal coverage, the
 * amount, agreement and credibility of evidence, model confidence and the
 * claim's specificity.
 */
export function computeConfidence(input: ScoringInput, factors: TrustFactor[]): number {
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const coverage =
    totalWeight === 0
      ? 0
      : factors
          .filter((factor) => factor.value !== null)
          .reduce((sum, factor) => sum + factor.weight, 0) / totalWeight;
  const relevant = relevantEvidence(input.evidence);
  const meanCredibility =
    relevant.length > 0
      ? relevant.reduce((sum, item) => sum + item.source.credibility, 0) / relevant.length
      : 0;
  const evidenceVolume = Math.min(1, relevant.length / 4);
  const balance = evidenceBalance(input.evidence);
  const agreement = balance === null ? 0 : Math.abs(balance - 0.5) * 2;
  const specificity = input.claim?.specificity ?? 0.3;
  const modelConfidence = input.model?.confidence ?? 0;

  const raw =
    0.35 * coverage +
    0.25 * evidenceVolume * (0.5 + agreement / 2) * (0.5 + meanCredibility / 2) +
    0.2 * modelConfidence +
    0.2 * specificity;

  const hasVerificationSignal = input.model !== null || relevant.length > 0;
  return Number(clamp01(hasVerificationSignal ? raw : Math.min(raw, 0.25)).toFixed(2));
}

function riskFromScore(score: number | null, concern: number): RiskLevel {
  if (score === null) {
    if (concern >= 0.5) return 'moderate';
    return 'unknown';
  }
  if (score >= THRESHOLDS.reliable) return 'low';
  if (score >= THRESHOLDS.misleading) return 'moderate';
  return 'high';
}

export function chooseLabel(
  input: ScoringInput,
  score: number | null,
  confidence: number,
): AssessmentLabel {
  if (input.claim && !input.claim.checkable) return 'cannot_verify';

  const relevant = relevantEvidence(input.evidence);
  if (!input.model && relevant.length === 0) {
    // Evidence search ran and found nothing usable — different from not being able to search.
    return input.evidenceStatus === 'none_found' ? 'insufficient_evidence' : 'cannot_verify';
  }
  if (score === null) return 'cannot_verify';
  if (input.model?.stance === 'unverifiable' && relevant.length === 0) {
    return 'insufficient_evidence';
  }

  const strong = confidence >= THRESHOLDS.minConfidenceForStrongLabel;
  if (score >= THRESHOLDS.reliable) return strong ? 'likely_reliable' : 'needs_verification';
  if (score <= THRESHOLDS.false) return strong ? 'likely_false' : 'possibly_misleading';
  if (score < THRESHOLDS.misleading) return 'possibly_misleading';
  return 'needs_verification';
}

const SUMMARIES: Record<AssessmentLabel, string> = {
  likely_reliable:
    'The available evidence and analysis mostly support this claim. This is not a guarantee that it is accurate.',
  possibly_misleading:
    'Some signals suggest this content may be misleading, inaccurate or missing context.',
  needs_verification:
    'The signals are mixed or not strong enough to reach a conclusion. Check it before relying on it.',
  likely_false:
    'Credible evidence and analysis mostly contradict this claim. Some uncertainty remains.',
  cannot_verify:
    'This claim could not be verified with the analysis currently available. That does not mean it is false.',
  insufficient_evidence:
    'Too little relevant evidence was found to assess this claim. A lack of evidence does not mean it is false.',
};

const RECOMMENDATIONS: Record<AssessmentLabel, string> = {
  likely_reliable:
    'Still check the original source before sharing, especially for important decisions.',
  possibly_misleading:
    'Look for the original source and coverage from independent, established outlets before sharing.',
  needs_verification:
    'Compare with trusted sources such as fact-checkers or official bodies before sharing.',
  likely_false: 'Avoid sharing this. Check fact-checking sites for a detailed explanation.',
  cannot_verify:
    'Treat this as unverified. Search for the claim on fact-checking sites or official sources.',
  insufficient_evidence:
    'Treat this as unverified for now. Look for reporting from independent, credible sources.',
};

export function assessTrust(input: ScoringInput): TrustAssessment {
  const factors = buildFactors(input);
  const hasVerificationSignal = input.model !== null || relevantEvidence(input.evidence).length > 0;
  const score = hasVerificationSignal ? weightedScore(factors) : null;
  const confidence = computeConfidence(input, factors);
  const label = chooseLabel(input, score, confidence);
  const concern = languageConcernIntensity(input.indicators);

  let summary = SUMMARIES[label];
  if (label === 'cannot_verify' && input.claim && !input.claim.checkable) {
    summary =
      input.claim.type === 'opinion'
        ? 'This reads as an opinion, which cannot be verified as true or false.'
        : 'This is a prediction about the future, which cannot be verified yet.';
  }

  return {
    label,
    score,
    confidence,
    riskLevel: riskFromScore(score, concern),
    factors,
    summary,
    recommendation: RECOMMENDATIONS[label],
  };
}
