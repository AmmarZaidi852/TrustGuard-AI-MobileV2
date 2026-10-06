import { AnalysisUnavailableError, ServiceRequestError, ValidationError } from '@/core/errors';
import { createUnavailableProviders } from '@/services/providers/unavailable';
import {
  mockAuthenticity,
  mockContradictingEvidence,
  mockModelContradicted,
  mockModelOpinion,
  mockModelSupported,
  mockModelUnverifiable,
  mockOcr,
  mockProviders,
  networkError,
} from '@/test/fixtures';

import { analyzeImage, analyzeText } from '../analysis/pipeline';

const COFFEE =
  'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.';
const options = { createId: () => 'id-1', now: () => new Date('2026-01-01T00:00:00Z') };
const image = { uri: 'file://photo.jpg', mimeType: 'image/jpeg', base64: 'abc' };

type Result = Awaited<ReturnType<typeof analyzeText>>;
const statusOf = (result: Result, component: string) =>
  result.components.find((c) => c.component === component)?.status;

describe('analyzeText with AI analysis', () => {
  it('uses the model claim, findings and reasoning, plus on-device language signals', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted }),
      options,
    );

    expect(result.claim).toMatchObject({
      text: mockModelContradicted.extractedClaim,
      type: 'scientific_health',
      method: 'model',
      checkable: true,
    });
    expect(result.indicators.some((i) => i.origin === 'model')).toBe(true);
    expect(result.indicators.some((i) => i.origin === 'heuristic')).toBe(true);
    expect(result.reasoning[0]).toBe(mockModelContradicted.reasoning);
    expect(result.evidenceNeeded).toEqual(mockModelContradicted.evidenceNeeded);
    expect(statusOf(result, 'llm_analysis')).toBe('completed');
    expect(result.components.find((c) => c.component === 'llm_analysis')?.detail).toBe(
      'Model: mock-model',
    );
    // Evidence search is not connected yet; that is reported, not hidden.
    expect(statusOf(result, 'evidence_retrieval')).toBe('unavailable');
    expect(result.evidenceStatus).toBe('not_searched');
  });

  it('never lets the model alone declare a claim false or reliable', async () => {
    const contradicted = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: { ...mockModelContradicted, confidence: 0.9 } }),
    );
    expect(contradicted.assessment.label).toBe('possibly_misleading');

    const supported = await analyzeText(
      'Water boils at 100 degrees Celsius at sea level.',
      'claim',
      mockProviders({ model: { ...mockModelSupported, confidence: 0.9 } }),
    );
    expect(supported.assessment.label).toBe('needs_verification');
  });

  it('reaches a strong label once independent evidence agrees', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: mockContradictingEvidence }),
    );
    expect(result.evidenceStatus).toBe('found');
    expect(result.evidence.map((e) => e.source.category)).toEqual([
      'government',
      'fact_checker',
      'user_generated',
    ]);
    expect(result.evidence[2].publisher).toBe('facebook.com');
    expect(result.assessment.label).toBe('likely_false');
  });

  it('returns "Cannot verify" when the model cannot assess the claim', async () => {
    const result = await analyzeText(
      'A local council in a small town voted to close its library last night.',
      'claim',
      mockProviders({ model: mockModelUnverifiable }),
    );
    expect(result.assessment.label).toBe('cannot_verify');
    expect(result.assessment.summary).toMatch(/does not mean it is false/);
    expect(result.reasoning.join(' ')).toMatch(/Limitations:/);
  });

  it('handles ambiguous claims as disputed without a strong label', async () => {
    const result = await analyzeText(
      'Eating late at night makes you gain weight.',
      'claim',
      mockProviders({
        model: { ...mockModelContradicted, stance: 'disputed', confidence: 0.5 },
      }),
    );
    expect(['possibly_misleading', 'needs_verification']).toContain(result.assessment.label);
    expect(result.assessment.confidence).toBeLessThan(0.55);
  });

  it('skips evidence search for opinions and explains why', async () => {
    const result = await analyzeText(
      'I think this is the best phone ever made.',
      'claim',
      mockProviders({ model: mockModelOpinion }),
    );
    expect(result.assessment.label).toBe('cannot_verify');
    expect(result.assessment.summary).toMatch(/opinion/);
    expect(statusOf(result, 'evidence_retrieval')).toBe('skipped');
    expect(result.reasoning).toContain(mockModelOpinion.verifiabilityNote);
  });

  it('records a failed evidence search instead of hiding it', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: networkError() }),
    );
    expect(statusOf(result, 'evidence_retrieval')).toBe('failed');
    expect(result.evidenceStatus).toBe('failed');
  });
});

describe('analyzeText failure handling', () => {
  it('rejects empty and invalid input before calling the AI', async () => {
    const analyzeClaim = jest.fn();
    const providers = { ...createUnavailableProviders(), claimAnalyzer: { analyzeClaim } };
    await expect(analyzeText('   ', 'text', providers)).rejects.toThrow(ValidationError);
    await expect(analyzeText('hi', 'claim', providers)).rejects.toThrow(ValidationError);
    expect(analyzeClaim).not.toHaveBeenCalled();
  });

  it('shows an error instead of a result when the AI is not configured', async () => {
    await expect(analyzeText(COFFEE, 'text', createUnavailableProviders())).rejects.toThrow(
      AnalysisUnavailableError,
    );
  });

  it.each([
    ['network failure', networkError(), /Could not reach/],
    ['timeout', new ServiceRequestError('slow', 'timeout'), /took too long/],
    ['server error', new ServiceRequestError('x', 'http', 502, 'model_unavailable'), /temporarily/],
    ['malformed AI output', new ServiceRequestError('bad', 'invalid_response'), /unexpected/],
    ['model refusal', new ServiceRequestError('no', 'http', 422, 'model_refused'), /declined/],
    ['rate limit', new ServiceRequestError('slow', 'http', 429, 'rate_limited'), /Too many/],
  ])('surfaces a useful error on %s, never a fake result', async (_name, error, message) => {
    const promise = analyzeText(COFFEE, 'text', mockProviders({ model: error }));
    await expect(promise).rejects.toThrow(AnalysisUnavailableError);
    await expect(analyzeText(COFFEE, 'text', mockProviders({ model: error }))).rejects.toThrow(
      message,
    );
  });
});

describe('analyzeImage', () => {
  it('refuses to produce a result when no image service is connected', async () => {
    await expect(analyzeImage(image, createUnavailableProviders())).rejects.toThrow(
      /not connected/,
    );
  });

  it('surfaces failures when every image service fails', async () => {
    await expect(
      analyzeImage(image, mockProviders({ vision: networkError(), ocr: networkError() })),
    ).rejects.toThrow(/Image analysis failed/);
  });

  it('validates the image', async () => {
    await expect(analyzeImage(null, createUnavailableProviders())).rejects.toThrow(ValidationError);
  });

  it('assesses authenticity and sends text found in the image to AI claim analysis', async () => {
    const result = await analyzeImage(
      image,
      mockProviders({
        vision: mockAuthenticity,
        ocr: mockOcr,
        model: mockModelContradicted,
        evidence: mockContradictingEvidence,
      }),
    );
    expect(result.authenticity).toEqual(mockAuthenticity);
    expect(result.extractedText?.text).toBe(mockOcr.text);
    expect(result.claim?.method).toBe('model');
    expect(result.assessment.factors.map((f) => f.id)).toContain('ai_generation');
  });

  it('keeps authenticity findings when AI claim analysis fails for the image text', async () => {
    const result = await analyzeImage(
      image,
      mockProviders({ vision: mockAuthenticity, ocr: mockOcr, model: networkError() }),
    );
    expect(statusOf(result, 'llm_analysis')).toBe('failed');
    expect(result.claim?.method).toBe('heuristic');
    expect(result.authenticity).toEqual(mockAuthenticity);
  });

  it('handles images without text: authenticity only, no claim', async () => {
    const result = await analyzeImage(
      image,
      mockProviders({ vision: mockAuthenticity, ocr: { text: '', confidence: 0, engine: 'm' } }),
    );
    expect(result.claim).toBeNull();
    expect(statusOf(result, 'llm_analysis')).toBe('skipped');
    expect(result.assessment.summary).toMatch(/No factual claim was found in this image/);
  });
});
