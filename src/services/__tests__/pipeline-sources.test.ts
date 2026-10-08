import { ServiceRequestError } from '@/core/errors';
import { MODEL_LIMITS } from '@/core/model/model-analysis';
import { describeSourceFindings } from '@/core/presentation';
import type { RetrievedEvidence } from '@/services/providers/types';
import {
  mockContradictingEvidence,
  mockEvaluationContradicted,
  mockEvaluationMixed,
  mockEvaluationSupported,
  mockModelContradicted,
  mockModelOpinion,
  mockModelSupported,
  mockProviders,
  mockSupportingEvidence,
  networkError,
  sourceSearch,
} from '@/test/fixtures';

import { type AnalysisStage, analyzeText } from '../analysis/pipeline';

const COFFEE =
  'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.';
const EVENT = 'The city of Oslo banned cars from its downtown in 2024.';

type Result = Awaited<ReturnType<typeof analyzeText>>;
const statusOf = (result: Result, component: string) =>
  result.components.find((c) => c.component === component);

const authoritativeContradicting = mockContradictingEvidence.slice(0, 2);

describe('source-backed verification', () => {
  it('labels a claim likely false when credible sources contradict it', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: mockModelContradicted,
        evidence: sourceSearch(authoritativeContradicting, mockEvaluationContradicted),
      }),
    );
    expect(result.assessment.label).toBe('likely_false');
    expect(result.sourceEvaluation?.verdict).toBe('contradicted');
    expect(result.evidence).toHaveLength(2);
    expect(describeSourceFindings(result).kind).toBe('contradicting');
    expect(result.assessment.summary).toMatch(/source-backed check/);
    expect(result.evidenceNeeded).toEqual(mockEvaluationContradicted.missingEvidence);
  });

  it('labels a claim likely reliable when credible sources support it', async () => {
    const result = await analyzeText(
      EVENT,
      'claim',
      mockProviders({
        model: { ...mockModelSupported, claimType: 'event_news', extractedClaim: EVENT },
        evidence: sourceSearch(mockSupportingEvidence, mockEvaluationSupported),
      }),
    );
    expect(result.assessment.label).toBe('likely_reliable');
    expect(describeSourceFindings(result).kind).toBe('supporting');
  });

  it('works with a single source', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: mockModelContradicted,
        evidence: sourceSearch([authoritativeContradicting[0]], mockEvaluationContradicted),
      }),
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.assessment.label).toBe('likely_false');
  });

  it('represents conflicting sources as needing verification, not a side', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: mockModelContradicted,
        evidence: sourceSearch(mockContradictingEvidence, mockEvaluationMixed),
      }),
    );
    expect(result.assessment.label).toBe('needs_verification');
    expect(result.assessment.summary).toMatch(/sources disagree/i);
    expect(describeSourceFindings(result).kind).toBe('mixed');
    expect(result.assessment.confidence).toBeLessThanOrEqual(0.5);
  });

  it('reports insufficient evidence when the search finds no usable sources', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: sourceSearch([], null) }),
    );
    expect(result.evidenceStatus).toBe('none_found');
    expect(result.assessment.label).toBe('insufficient_evidence');
    expect(result.assessment.summary).toMatch(/does not mean it is false/);
    expect(describeSourceFindings(result).kind).toBe('insufficient');
    expect(statusOf(result, 'evidence_retrieval')?.detail).toMatch(/no usable sources/);
  });

  it('reports insufficient evidence when sources exist but do not address the claim', async () => {
    const context: RetrievedEvidence[] = [
      { ...authoritativeContradicting[0], stance: 'context', relevance: 'medium' },
    ];
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: mockModelContradicted,
        evidence: sourceSearch(context, {
          ...mockEvaluationContradicted,
          verdict: 'insufficient_evidence',
          confidence: 0.3,
        }),
      }),
    );
    expect(result.assessment.label).toBe('insufficient_evidence');
  });

  it('never lets a source-backed "supported" override contrary AI knowledge', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: mockModelContradicted,
        evidence: sourceSearch(mockSupportingEvidence, mockEvaluationSupported),
      }),
    );
    expect(result.assessment.label).toBe('needs_verification');
    expect(result.assessment.summary).toMatch(/different directions/);
  });

  it('does not raise confidence just because more sources were found', async () => {
    const weakSources: RetrievedEvidence[] = Array.from({ length: 6 }, (_, i) => ({
      title: `[mock] Blog ${i}`,
      url: `https://blog-${i}.example/post`,
      publisher: '',
      snippet: '[mock] says so',
      stance: 'supports',
      relevance: 'medium',
    }));
    const many = await analyzeText(
      EVENT,
      'claim',
      mockProviders({
        model: { ...mockModelSupported, claimType: 'event_news', extractedClaim: EVENT },
        evidence: sourceSearch(weakSources, { ...mockEvaluationSupported, confidence: 0.45 }),
      }),
    );
    const one = await analyzeText(
      EVENT,
      'claim',
      mockProviders({
        model: { ...mockModelSupported, claimType: 'event_news', extractedClaim: EVENT },
        evidence: sourceSearch([mockSupportingEvidence[1]], {
          ...mockEvaluationSupported,
          confidence: 0.75,
        }),
      }),
    );
    expect(many.assessment.confidence).toBeLessThan(one.assessment.confidence);
    expect(many.assessment.label).not.toBe('likely_reliable');
  });

  it('keeps confidence under the ceiling', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({
        model: { ...mockModelContradicted, confidence: 1 },
        evidence: sourceSearch(authoritativeContradicting, {
          ...mockEvaluationContradicted,
          confidence: 1,
        }),
      }),
    );
    expect(result.assessment.confidence).toBeLessThanOrEqual(MODEL_LIMITS.maxConfidence);
  });

  it('does not present opinions as verified facts and does not search for them', async () => {
    const findEvidence = jest.fn();
    const providers = {
      ...mockProviders({ model: mockModelOpinion }),
      evidenceRetriever: { findEvidence },
    };
    const result = await analyzeText('I think this is the best phone ever.', 'claim', providers);
    expect(findEvidence).not.toHaveBeenCalled();
    expect(result.assessment.label).toBe('cannot_verify');
    expect(describeSourceFindings(result).kind).toBe('not_needed');
  });
});

describe('source-checking failures', () => {
  it.each([
    [
      'search unavailable',
      new ServiceRequestError('x', 'http', 503, 'search_unavailable'),
      /Web search is unavailable/,
    ],
    ['search timeout', new ServiceRequestError('x', 'http', 504, 'timeout'), /too long/],
    ['client timeout', new ServiceRequestError('x', 'timeout'), /too long/],
    [
      'model failure after search',
      new ServiceRequestError('x', 'http', 502, 'evaluation_failed'),
      /could not evaluate/,
    ],
    [
      'malformed source data',
      new ServiceRequestError('x', 'invalid_response'),
      /unexpected response/,
    ],
    ['network failure', networkError(), /Could not reach/],
  ])('downgrades to an AI-only result on %s, clearly marked', async (_name, error, detail) => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: { ...mockModelContradicted, confidence: 0.9 }, evidence: error }),
    );
    expect(result.evidenceStatus).toBe('failed');
    expect(statusOf(result, 'evidence_retrieval')?.status).toBe('failed');
    expect(statusOf(result, 'evidence_retrieval')?.detail).toMatch(detail);
    // Never a confident "verified" result when sources could not be checked.
    expect(['likely_false', 'likely_reliable']).not.toContain(result.assessment.label);
    expect(result.assessment.summary).toMatch(/External source checking was unavailable/);
    expect(describeSourceFindings(result).kind).toBe('unavailable');
  });

  it('marks an unconfigured source search as unavailable, not verified', async () => {
    const result = await analyzeText(COFFEE, 'text', mockProviders({ model: mockModelSupported }));
    expect(statusOf(result, 'evidence_retrieval')?.status).toBe('unavailable');
    expect(result.assessment.label).not.toBe('likely_reliable');
  });
});

it('reports progress stages in order', async () => {
  const stages: AnalysisStage[] = [];
  await analyzeText(
    COFFEE,
    'text',
    mockProviders({
      model: mockModelContradicted,
      evidence: sourceSearch(authoritativeContradicting, mockEvaluationContradicted),
    }),
    { onProgress: (stage) => stages.push(stage) },
  );
  expect(stages).toEqual(['analyzing_claim', 'checking_sources']);
});
