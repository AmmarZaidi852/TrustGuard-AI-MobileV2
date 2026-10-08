import type { SourceRelationship } from '../api-contract';
import {
  UNCERTAIN_VERDICT_MAX_CONFIDENCE,
  evidenceStrength,
  guardSourceEvaluation,
} from '../evidence/source-guards';
import { MODEL_LIMITS } from '../model/model-analysis';
import type { SourceEvaluation, SourceRelevance } from '../types';

const evaluation = (patch: Partial<SourceEvaluation> = {}): SourceEvaluation => ({
  verdict: 'supported',
  confidence: 0.9,
  whatSourcesSay: '',
  inference: '',
  uncertainty: '',
  missingEvidence: [],
  searchQueries: [],
  model: 'm',
  ...patch,
});

const src = (
  url: string,
  relationship: SourceRelationship,
  relevance: SourceRelevance = 'high',
) => ({ url, relationship, relevance });

const GOV = 'https://www.cdc.gov/a';
const FACT = 'https://www.snopes.com/b';
const NEWS = 'https://apnews.com/c';
const SOCIAL = 'https://x.com/d';
const UNKNOWN = 'https://random-blog.example/e';

describe('guardSourceEvaluation', () => {
  it('keeps a well-backed verdict but caps confidence by evidence strength', () => {
    const result = guardSourceEvaluation(evaluation(), [src(GOV, 'supports')]);
    expect(result.verdict).toBe('supported');
    // One government source (credibility 0.8) cannot justify 0.9.
    expect(result.confidence).toBe(0.8);
  });

  it('never exceeds the global confidence ceiling', () => {
    const result = guardSourceEvaluation(evaluation({ confidence: 5 }), [
      src(GOV, 'supports'),
      src(FACT, 'supports'),
      src(NEWS, 'supports'),
    ]);
    expect(result.confidence).toBeLessThanOrEqual(MODEL_LIMITS.maxConfidence);
  });

  it('does not grow confidence from many weak sources', () => {
    const weak = guardSourceEvaluation(
      evaluation(),
      Array.from({ length: 6 }, (_, i) => src(`https://x.com/${i}`, 'supports', 'low')),
    );
    // Low-relevance sources do not count as backing at all.
    expect(weak.verdict).toBe('insufficient_evidence');

    const social = guardSourceEvaluation(evaluation(), [src(SOCIAL, 'supports', 'medium')]);
    const authoritative = guardSourceEvaluation(evaluation(), [src(GOV, 'supports')]);
    expect(social.confidence).toBeLessThan(0.55);
    expect(authoritative.confidence).toBeGreaterThan(social.confidence);
  });

  it('downgrades a verdict that no source backs (e.g. after prompt injection)', () => {
    const result = guardSourceEvaluation(evaluation({ verdict: 'supported' }), [
      src(GOV, 'context'),
      src(NEWS, 'contradicts', 'low'),
    ]);
    expect(result.verdict).toBe('insufficient_evidence');
    expect(result.confidence).toBeLessThanOrEqual(UNCERTAIN_VERDICT_MAX_CONFIDENCE);
  });

  it('turns credible disagreement into "mixed" instead of picking a side', () => {
    const result = guardSourceEvaluation(evaluation({ verdict: 'contradicted' }), [
      src(GOV, 'contradicts'),
      src(NEWS, 'supports'),
    ]);
    expect(result.verdict).toBe('mixed');
    expect(result.confidence).toBeLessThanOrEqual(UNCERTAIN_VERDICT_MAX_CONFIDENCE);
  });

  it('is not swayed by a single low-credibility dissenting source', () => {
    const result = guardSourceEvaluation(evaluation({ verdict: 'contradicted' }), [
      src(GOV, 'contradicts'),
      src(FACT, 'contradicts'),
      src(SOCIAL, 'supports', 'medium'),
    ]);
    expect(result.verdict).toBe('contradicted');
  });

  it('caps uncertainty-oriented verdicts at moderate confidence', () => {
    for (const verdict of ['mixed', 'insufficient_evidence', 'cannot_verify'] as const) {
      const result = guardSourceEvaluation(evaluation({ verdict, confidence: 0.9 }), [
        src(GOV, 'context'),
      ]);
      expect(result.confidence).toBeLessThanOrEqual(UNCERTAIN_VERDICT_MAX_CONFIDENCE);
    }
  });

  it('treats zero sources as insufficient evidence', () => {
    expect(guardSourceEvaluation(evaluation(), []).verdict).toBe('insufficient_evidence');
  });

  it('handles non-finite confidence', () => {
    const result = guardSourceEvaluation(evaluation({ confidence: Number.NaN }), [
      src(GOV, 'supports'),
    ]);
    expect(result.confidence).toBe(0);
  });
});

describe('evidenceStrength', () => {
  it('rewards relevance and credibility, and is reduced by opposing evidence', () => {
    const high = evidenceStrength([src(GOV, 'supports')], 'supports');
    const medium = evidenceStrength([src(GOV, 'supports', 'medium')], 'supports');
    const unknown = evidenceStrength([src(UNKNOWN, 'supports')], 'supports');
    const opposed = evidenceStrength([src(GOV, 'supports'), src(NEWS, 'contradicts')], 'supports');
    expect(high).toBeGreaterThan(medium);
    expect(high).toBeGreaterThan(unknown);
    expect(opposed).toBeLessThan(high);
  });
});
