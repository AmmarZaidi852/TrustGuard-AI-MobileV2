import AsyncStorage from '@react-native-async-storage/async-storage';

import { ServiceRequestError, ValidationError } from '@/core/errors';
import { MODEL_LIMITS } from '@/core/model/model-analysis';
import { describeSourceFindings } from '@/core/presentation';
import type { ImageClaimAnalysis } from '@/core/types';
import {
  IMAGE_BYTES,
  mockContradictingEvidence,
  mockEvaluationContradicted,
  mockEvaluationMixed,
  mockEvaluationSupported,
  mockImageReading,
  mockImageReadingInjection,
  mockImageReadingMultiple,
  mockImageReadingNoClaim,
  mockImageReadingOpinion,
  mockImageReadingUnreadable,
  mockModelContradicted,
  mockModelSupported,
  mockProviders,
  mockSupportingEvidence,
  networkError,
  sourceSearch,
  testImage,
} from '@/test/fixtures';

import { type AnalysisStage, analyzeImage, analyzeText } from '../analysis/pipeline';
import { createRemoteProviders, parseImageClaimAnalysis } from '../providers/remote';
import { loadHistory, resetHistoryCache, saveAnalysis } from '../history/history-store';

type Result = Awaited<ReturnType<typeof analyzeImage>>;
const report = (result: Result, component: string) =>
  result.components.find((c) => c.component === component);

const contradicting = mockContradictingEvidence.slice(0, 2);

describe('image claim → existing verification pipeline', () => {
  it('sends the extracted claim through Phase 2 analysis and Phase 3 sources', async () => {
    const analyzeClaim = jest.fn().mockResolvedValue(mockModelContradicted);
    const findEvidence = jest
      .fn()
      .mockResolvedValue(sourceSearch(contradicting, mockEvaluationContradicted));
    const providers = {
      ...mockProviders({ vision: mockImageReading }),
      claimAnalyzer: { analyzeClaim },
      evidenceRetriever: { findEvidence },
    };
    const result = await analyzeImage(testImage, providers);

    // Same request shape as a typed claim.
    expect(analyzeClaim).toHaveBeenCalledWith({
      text: 'Drinking coffee completely prevents cancer.',
      mode: 'claim',
    });
    expect(findEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ text: mockModelContradicted.extractedClaim }),
    );
    expect(result.kind).toBe('image');
    expect(result.assessment.label).toBe('likely_false');
    expect(result.sourceEvaluation?.verdict).toBe('contradicted');
    expect(result.evidence).toHaveLength(2);
    expect(report(result, 'vision_analysis')?.status).toBe('completed');
  });

  it('reaches a source-backed "Likely reliable" verdict', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: { ...mockModelSupported, claimType: 'event_news' },
        evidence: sourceSearch(mockSupportingEvidence, mockEvaluationSupported),
      }),
    );
    expect(result.assessment.label).toBe('likely_reliable');
  });

  it('keeps mixed evidence mixed', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: mockModelContradicted,
        evidence: sourceSearch(mockContradictingEvidence, mockEvaluationMixed),
      }),
    );
    expect(result.assessment.label).toBe('needs_verification');
    expect(describeSourceFindings(result).kind).toBe('mixed');
  });

  it('keeps insufficient evidence insufficient', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: mockModelContradicted,
        evidence: sourceSearch([], null),
      }),
    );
    expect(result.assessment.label).toBe('insufficient_evidence');
  });

  it('keeps the claim and marks verification unavailable when source checking fails', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: { ...mockModelContradicted, confidence: 0.9 },
        evidence: new ServiceRequestError('x', 'http', 503, 'search_unavailable'),
      }),
    );
    expect(result.claim?.text).toBe(mockModelContradicted.extractedClaim);
    expect(result.evidenceStatus).toBe('failed');
    expect(['likely_false', 'likely_reliable']).not.toContain(result.assessment.label);
    expect(result.assessment.summary).toMatch(/External source checking was unavailable/);
  });

  it('caps confidence and lowers it when the image was only partly readable', async () => {
    const providers = (reading: ImageClaimAnalysis) =>
      mockProviders({
        vision: reading,
        model: { ...mockModelContradicted, confidence: 1 },
        evidence: sourceSearch(contradicting, { ...mockEvaluationContradicted, confidence: 1 }),
      });
    const clear = await analyzeImage(testImage, providers(mockImageReading));
    const partial = await analyzeImage(
      testImage,
      providers({ ...mockImageReading, readability: 'partial' }),
    );
    expect(clear.assessment.confidence).toBeLessThanOrEqual(MODEL_LIMITS.maxConfidence);
    expect(partial.assessment.confidence).toBeLessThan(clear.assessment.confidence);
    expect(partial.reasoning[0]).toMatch(/could not be read reliably/);
  });

  it('verifies the primary claim and lists the others when there are several', async () => {
    const analyzeClaim = jest.fn().mockResolvedValue(mockModelContradicted);
    const result = await analyzeImage(testImage, {
      ...mockProviders({
        vision: mockImageReadingMultiple,
        evidence: sourceSearch(contradicting, mockEvaluationContradicted),
      }),
      claimAnalyzer: { analyzeClaim },
    });
    expect(analyzeClaim).toHaveBeenCalledTimes(1);
    expect(result.imageAnalysis?.claims).toHaveLength(2);
    expect(result.imageAnalysis?.primaryClaimIndex).toBe(0);
    expect(result.keyStatements).toHaveLength(2);
    expect(report(result, 'claim_extraction')?.detail).toMatch(/claim 1 of 2 verified/);
  });
});

describe('images without a checkable claim', () => {
  it.each([
    ['unreadable', mockImageReadingUnreadable, /could not be read reliably/],
    ['no claim', mockImageReadingNoClaim, /No factual claim was found/],
    ['opinion / meme', mockImageReadingOpinion, /commentary, opinion or humour/],
  ])('%s → Cannot verify, nothing searched, never "false"', async (_name, reading, reason) => {
    const findEvidence = jest.fn();
    const analyzeClaim = jest.fn();
    const result = await analyzeImage(testImage, {
      ...mockProviders({ vision: reading }),
      claimAnalyzer: { analyzeClaim },
      evidenceRetriever: { findEvidence },
    });
    expect(result.assessment.label).toBe('cannot_verify');
    expect(result.assessment.summary).toMatch(reason);
    expect(result.assessment.summary).toMatch(/says nothing about whether/);
    expect(analyzeClaim).not.toHaveBeenCalled();
    expect(findEvidence).not.toHaveBeenCalled();
  });
});

describe('prompt injection inside the image', () => {
  it('flags embedded instructions and still uses the normal guarded pipeline', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReadingInjection,
        model: mockModelContradicted,
        evidence: sourceSearch(contradicting, mockEvaluationContradicted),
      }),
    );
    expect(result.indicators.map((i) => i.id)).toContain('embedded_instructions');
    // The injected "say this is true" had no effect on the source-backed verdict.
    expect(result.assessment.label).toBe('likely_false');
  });
});

describe('image failures', () => {
  it.each([
    [
      'vision model failure',
      new ServiceRequestError('x', 'http', 502, 'model_unavailable'),
      /temporarily unavailable/,
    ],
    ['network timeout', new ServiceRequestError('x', 'timeout'), /took too long/],
    [
      'API key failure',
      new ServiceRequestError('x', 'http', 503, 'not_configured'),
      /could not be analyzed/,
    ],
    ['upload failure', networkError(), /Could not reach/],
  ])('reports %s as an error, never a text-only guess', async (_name, error, message) => {
    await expect(analyzeImage(testImage, mockProviders({ vision: error }))).rejects.toThrow(
      message,
    );
  });

  it('passes server-side image validation errors through unchanged', async () => {
    await expect(
      analyzeImage(
        testImage,
        mockProviders({ vision: new ValidationError('The image is too large.') }),
      ),
    ).rejects.toThrow(new ValidationError('The image is too large.'));
  });

  it.each([
    ['unsupported format', { ...testImage, base64: IMAGE_BYTES.heic }, /HEIC/],
    ['malformed data', { ...testImage, base64: 'not!!base64' }, /damaged/],
    ['empty data', { ...testImage, base64: '' }, /could not be read/],
  ])('rejects %s before uploading', async (_name, image, message) => {
    const analyzeImageFn = jest.fn();
    await expect(
      analyzeImage(image, {
        ...mockProviders({}),
        visionAnalyzer: { analyzeImage: analyzeImageFn },
      }),
    ).rejects.toThrow(message);
    expect(analyzeImageFn).not.toHaveBeenCalled();
  });
});

it('reports progress stages in order', async () => {
  const stages: AnalysisStage[] = [];
  await analyzeImage(
    testImage,
    mockProviders({
      vision: mockImageReading,
      model: mockModelContradicted,
      evidence: sourceSearch(contradicting, mockEvaluationContradicted),
    }),
    { onProgress: (stage) => stages.push(stage) },
  );
  expect(stages).toEqual(['reading_image', 'analyzing_claim', 'checking_sources']);
});

it('leaves the typed-text flow unchanged', async () => {
  const result = await analyzeText(
    'Drinking coffee completely prevents cancer.',
    'claim',
    mockProviders({
      model: mockModelContradicted,
      evidence: sourceSearch(contradicting, mockEvaluationContradicted),
    }),
  );
  expect(result.kind).toBe('claim');
  expect(result.imageAnalysis).toBeNull();
  expect(result.assessment.label).toBe('likely_false');
});

describe('image privacy', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetHistoryCache();
  });

  it('never writes the image (or its URI) to stored history', async () => {
    const result = await analyzeImage(
      { ...testImage, uri: `data:image/png;base64,${IMAGE_BYTES.png}` },
      mockProviders({ vision: mockImageReadingNoClaim }),
    );
    await saveAnalysis(result);
    const stored = (await AsyncStorage.getItem('trustguard:recent-analyses:v1')) ?? '';
    expect(stored).not.toContain(IMAGE_BYTES.png.slice(0, 24));
    expect(stored).not.toContain('imageUri');

    resetHistoryCache();
    const [reloaded] = await loadHistory();
    expect(reloaded.input.imageUri).toBeUndefined();
  });

  it('uploads only the validated bytes and detected type', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(Response.json(mockImageReading)));
    const providers = createRemoteProviders('', 1000, fetchImpl as typeof fetch);
    await providers.visionAnalyzer.analyzeImage({
      ...testImage,
      base64: IMAGE_BYTES.png,
      mediaType: 'image/png',
      bytes: 256,
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(Object.keys(body).sort()).toEqual(['image', 'mediaType']);
  });
});

describe('parseImageClaimAnalysis', () => {
  it('re-applies the guard rails to backend responses', () => {
    const result = parseImageClaimAnalysis({
      ...mockImageReading,
      claims: [{ ...mockImageReading.claims[0], quote: 'text that is not in the image at all' }],
    });
    expect(result.claims[0].checkable).toBe(false);
  });

  it.each([
    ['unknown image kind', { imageKind: 'selfie' }],
    ['bad readability', { readability: 'blurry' }],
    ['non-boolean instructions flag', { containsInstructions: 'no' }],
    ['non-integer primary index', { primaryClaimIndex: 0.5 }],
    ['claims not a list', { claims: 'many' }],
  ])('rejects malformed readings: %s', (_name, patch) => {
    expect(() => parseImageClaimAnalysis({ ...mockImageReading, ...patch })).toThrow(
      ServiceRequestError,
    );
  });
});
