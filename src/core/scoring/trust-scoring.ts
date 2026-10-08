import { RELEVANCE_WEIGHT } from '../evidence/source-guards';
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
  SourceEvaluation,
  SourceVerdict,
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
 * When a source-backed evaluation exists (Phase 3), its verdict decides the label
 * through explicit rules (see `chooseLabel`) and its guarded confidence caps the
 * overall confidence. Without one, the Phase 2 rules apply unchanged.
 *
 * The whole module is a pure function of its inputs so it can be swapped for a
 * model-based scorer without touching the pipeline or UI.
 */

export const FACTOR_WEIGHTS = {
  model_assessment: 0.3,
  source_backed_assessment: 0.3,
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
  /** Model evaluation of the claim against retrieved sources, already guarded. */
  sourceEvaluation?: SourceEvaluation | null;
}

const SOURCE_VERDICT_VALUE: Record<SourceVerdict, number | null> = {
  supported: 0.88,
  contradicted: 0.1,
  mixed: 0.45,
  insufficient_evidence: null,
  cannot_verify: null,
};

/** Retrieved sources and the model's own knowledge point in opposite directions. */
export function knowledgeConflict(input: ScoringInput): boolean {
  const verdict = input.sourceEvaluation?.verdict;
  const stance = input.model?.stance;
  return (
    (verdict === 'supported' && stance === 'contradicted') ||
    (verdict === 'contradicted' && stance === 'supported')
  );
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
    // Weighted by outlet credibility and, when known, by relevance to the claim.
    const weight =
      item.source.credibility * (item.relevance ? RELEVANCE_WEIGHT[item.relevance] : 1);
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
      id: 'source_backed_assessment',
      label: 'Source-backed AI evaluation',
      value: (() => {
        const evaluation = input.sourceEvaluation;
        const base = evaluation ? SOURCE_VERDICT_VALUE[evaluation.verdict] : null;
        return base === null || !evaluation
          ? null
          : clamp01(0.5 + (base - 0.5) * evaluation.confidence);
      })(),
      weight: FACTOR_WEIGHTS.source_backed_assessment,
      explanation: input.sourceEvaluation
        ? `Judged against the retrieved sources: "${input.sourceEvaluation.verdict.replace('_', ' ')}" with ${Math.round(input.sourceEvaluation.confidence * 100)}% confidence after evidence-strength limits.`
        : 'The claim was not evaluated against external sources.',
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
  let confidence = hasVerificationSignal ? raw : Math.min(raw, 0.25);

  const evaluation = input.sourceEvaluation;
  if (evaluation) {
    // Never more confident than the guarded, evidence-strength-limited evaluation:
    // finding sources only helps when they are relevant and credible.
    confidence = Math.min(confidence, evaluation.confidence);
    if (knowledgeConflict(input)) confidence *= 0.6;
  }
  return Number(clamp01(confidence).toFixed(2));
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

  const evaluation = input.sourceEvaluation;
  // A search ran and found nothing usable: say so, whatever the model believes.
  if (!evaluation && input.evidenceStatus === 'none_found') return 'insufficient_evidence';
  if (evaluation) {
    const strong =
      confidence >= THRESHOLDS.minConfidenceForStrongLabel && !knowledgeConflict(input);
    switch (evaluation.verdict) {
      case 'supported':
        return strong ? 'likely_reliable' : 'needs_verification';
      case 'contradicted':
        if (knowledgeConflict(input)) return 'needs_verification';
        return strong ? 'likely_false' : 'possibly_misleading';
      case 'mixed':
        return 'needs_verification';
      case 'insufficient_evidence':
        return 'insufficient_evidence';
      case 'cannot_verify':
        return 'cannot_verify';
    }
  }

  const relevant = relevantEvidence(input.evidence);
  if (!input.model && relevant.length === 0) {
    // Evidence search ran and found nothing usable — different from not being able to search.
    return input.evidenceStatus === 'none_found' ? 'insufficient_evidence' : 'cannot_verify';
  }
  if (score === null) return 'cannot_verify';
  if (input.model?.stance === 'unverifiable' && relevant.length === 0) {
    return input.evidenceStatus === 'none_found' ? 'insufficient_evidence' : 'cannot_verify';
  }

  // Strong labels need independent evidence: the model's own knowledge is never enough.
  const strong = confidence >= THRESHOLDS.minConfidenceForStrongLabel && relevant.length > 0;
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

  return {
    label,
    score,
    confidence,
    riskLevel: riskFromScore(score, concern),
    factors,
    summary: summarize(input, label),
    recommendation: RECOMMENDATIONS[label],
  };
}

const MODEL_ONLY_SUMMARIES: Record<ModelClaimAnalysis['stance'], string> = {
  supported:
    'The AI analysis found this claim broadly consistent with established knowledge, but no independent sources were checked, so it is not confirmed.',
  contradicted:
    'The AI analysis found that this claim conflicts with established knowledge. No independent sources were checked yet, so treat this as a strong warning, not a final verdict.',
  disputed:
    'The AI analysis found this claim is disputed, exaggerated or only partly accurate. No independent sources were checked yet.',
  unverifiable:
    'The AI model could not assess this claim from its own knowledge (for example, it may be too recent or too specific). That does not mean it is false.',
};

const SOURCE_BACKED_SUMMARIES: Record<AssessmentLabel, string> = {
  likely_reliable:
    'Credible sources found during this check support the claim. A source-backed check is stronger than AI knowledge alone, but it is not a guarantee.',
  likely_false:
    'Credible sources found during this check contradict the claim. A source-backed check is stronger than AI knowledge alone, but some uncertainty remains.',
  possibly_misleading:
    'Some sources contradict the claim, but the evidence found is limited or not authoritative enough to be conclusive.',
  needs_verification:
    'The sources found are mixed, only partly support the claim, or are not strong enough to rely on. It needs further verification.',
  insufficient_evidence:
    'Sources were searched, but none directly address this claim with reliable evidence. That does not mean it is false.',
  cannot_verify:
    'This claim cannot be checked against public sources (for example, it concerns private or unknowable information).',
};

function summarize(input: ScoringInput, label: AssessmentLabel): string {
  const { claim, model } = input;
  if (claim && !claim.checkable) {
    if (claim.type === 'opinion') {
      return 'This reads as an opinion, which cannot be verified as true or false.';
    }
    if (claim.type === 'prediction') {
      return 'This is a prediction about the future, which cannot be verified yet.';
    }
    return 'This statement cannot be fact-checked as written, for example because it is too vague.';
  }
  if (input.sourceEvaluation) {
    if (knowledgeConflict(input)) {
      return 'The sources found and the AI model’s own knowledge point in different directions, so this needs further verification.';
    }
    if (input.sourceEvaluation.verdict === 'mixed') {
      return 'The sources disagree, or the claim is only partly accurate. It needs further verification.';
    }
    return SOURCE_BACKED_SUMMARIES[label];
  }
  if (input.evidenceStatus === 'none_found' && model) {
    return SOURCE_BACKED_SUMMARIES.insufficient_evidence;
  }
  if (model && relevantEvidence(input.evidence).length === 0) {
    const prefix =
      input.evidenceStatus === 'failed'
        ? 'External source checking was unavailable, so this rests on the AI model’s own knowledge. '
        : '';
    return prefix + MODEL_ONLY_SUMMARIES[model.stance];
  }
  return SUMMARIES[label];
}
