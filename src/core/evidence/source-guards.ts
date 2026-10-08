import type { SourceRelationship, VerifiedSource } from '../api-contract';
import { MODEL_LIMITS } from '../model/model-analysis';
import { evaluateSource } from '../sources/source-evaluation';
import type { SourceEvaluation, SourceRelevance, SourceVerdict } from '../types';

/**
 * Code-level guard rails for source-backed verdicts, applied on the server and
 * again in the app. The model reads the sources; these rules decide how far its
 * reading may be trusted:
 *
 * 1. "supported" / "contradicted" must be backed by at least one source the model
 *    marked as supporting / contradicting with medium or high relevance.
 * 2. Credible sources on both sides make the verdict "mixed" rather than letting
 *    the model pick a side.
 * 3. Confidence never exceeds the strength of the evidence itself (relevance x
 *    outlet credibility) and never the global model ceiling. Finding more sources
 *    does not raise it unless they are relevant and credible.
 * 4. Uncertainty-oriented verdicts carry at most moderate confidence.
 */

export const RELEVANCE_WEIGHT: Record<SourceRelevance, number> = { high: 1, medium: 0.6, low: 0.3 };

/** Ceiling for mixed / insufficient / cannot-verify verdicts. */
export const UNCERTAIN_VERDICT_MAX_CONFIDENCE = 0.5;

/** Opposing evidence at least this fraction of the backing evidence makes the verdict mixed. */
export const CONFLICT_RATIO = 0.5;

type GuardedSource = Pick<VerifiedSource, 'url' | 'relationship' | 'relevance'>;

export function sourceQuality(source: GuardedSource): number {
  return RELEVANCE_WEIGHT[source.relevance] * evaluateSource(source.url).credibility;
}

const opposite = (direction: SourceRelationship): SourceRelationship =>
  direction === 'supports' ? 'contradicts' : 'supports';

const counts = (source: GuardedSource) => source.relevance !== 'low';

/**
 * 0..1 strength of the evidence for one direction: a noisy-OR over the quality of
 * agreeing sources, reduced by the quality of sources pointing the other way.
 */
export function evidenceStrength(sources: GuardedSource[], direction: SourceRelationship): number {
  let miss = 1;
  let opposing = 0;
  for (const source of sources) {
    if (!counts(source)) continue;
    if (source.relationship === direction) miss *= 1 - sourceQuality(source);
    else if (source.relationship === opposite(direction)) opposing += sourceQuality(source);
  }
  return (1 - miss) * Math.max(0.3, 1 - opposing);
}

function directionOf(verdict: SourceVerdict): SourceRelationship | null {
  if (verdict === 'supported') return 'supports';
  if (verdict === 'contradicted') return 'contradicts';
  return null;
}

function guardedVerdict(verdict: SourceVerdict, sources: GuardedSource[]): SourceVerdict {
  if (sources.length === 0) return 'insufficient_evidence';
  const direction = directionOf(verdict);
  if (!direction) return verdict;

  const backing = sources.filter((s) => counts(s) && s.relationship === direction);
  if (backing.length === 0) return 'insufficient_evidence';

  const quality = (list: GuardedSource[]) => list.reduce((sum, s) => sum + sourceQuality(s), 0);
  const against = sources.filter((s) => counts(s) && s.relationship === opposite(direction));
  if (against.length > 0 && quality(against) >= CONFLICT_RATIO * quality(backing)) return 'mixed';
  return verdict;
}

export function guardSourceEvaluation(
  evaluation: SourceEvaluation,
  sources: GuardedSource[],
): SourceEvaluation {
  const verdict = guardedVerdict(evaluation.verdict, sources);
  const raw = Number.isFinite(evaluation.confidence) ? evaluation.confidence : 0;
  let confidence = Math.max(0, Math.min(MODEL_LIMITS.maxConfidence, raw));

  const direction = directionOf(verdict);
  confidence = direction
    ? Math.min(confidence, evidenceStrength(sources, direction))
    : Math.min(confidence, UNCERTAIN_VERDICT_MAX_CONFIDENCE);

  return { ...evaluation, verdict, confidence: Number(confidence.toFixed(2)) };
}
