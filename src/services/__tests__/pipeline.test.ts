import { AnalysisUnavailableError, ValidationError } from '@/core/errors';
import { createUnavailableProviders } from '@/services/providers/unavailable';
import {
  mockAuthenticity,
  mockContradictingEvidence,
  mockModelContradicted,
  mockOcr,
  mockProviders,
  networkError,
} from '@/test/fixtures';

import { analyzeImage, analyzeText } from '../analysis/pipeline';

const COFFEE =
  'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.';
const options = { createId: () => 'id-1', now: () => new Date('2026-01-01T00:00:00Z') };
const image = { uri: 'file://photo.jpg', mimeType: 'image/jpeg', base64: 'abc' };

const statusOf = (result: Awaited<ReturnType<typeof analyzeText>>, component: string) =>
  result.components.find((c) => c.component === component)?.status;

describe('analyzeText without connected services', () => {
  it('runs on-device checks only and does not invent verification', async () => {
    const result = await analyzeText(COFFEE, 'text', createUnavailableProviders(), options);

    expect(result.id).toBe('id-1');
    expect(result.claim?.text).toContain('coffee completely prevents cancer');
    expect(result.indicators.length).toBeGreaterThan(0);
    expect(result.indicators.every((i) => i.origin === 'heuristic')).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.evidenceStatus).toBe('not_searched');
    expect(result.assessment.label).toBe('cannot_verify');
    expect(result.assessment.score).toBeNull();
    expect(statusOf(result, 'llm_analysis')).toBe('unavailable');
    expect(statusOf(result, 'evidence_retrieval')).toBe('unavailable');
    expect(result.reasoning.join(' ')).toMatch(/not been checked against sources/);
  });

  it('skips verification for opinions', async () => {
    const result = await analyzeText(
      'I think this is the best phone ever made.',
      'claim',
      createUnavailableProviders(),
    );
    expect(statusOf(result, 'llm_analysis')).toBe('skipped');
    expect(result.assessment.summary).toMatch(/opinion/);
  });

  it('rejects invalid input before running anything', async () => {
    await expect(analyzeText('  ', 'text', createUnavailableProviders())).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('analyzeText with services', () => {
  it('combines model analysis, evidence and source evaluation', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: mockContradictingEvidence }),
      options,
    );

    expect(result.evidenceStatus).toBe('found');
    expect(result.evidence.map((e) => e.source.category)).toEqual([
      'government',
      'fact_checker',
      'user_generated',
    ]);
    // Missing publisher falls back to the domain.
    expect(result.evidence[2].publisher).toBe('facebook.com');
    expect(result.assessment.label).toBe('likely_false');
    expect(result.reasoning[0]).toBe(mockModelContradicted.reasoning);
    expect(result.evidenceNeeded).toEqual(mockModelContradicted.evidenceNeeded);
    expect(statusOf(result, 'source_evaluation')).toBe('completed');
  });

  it('records a failed evidence search instead of hiding it', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: networkError() }),
    );
    expect(statusOf(result, 'evidence_retrieval')).toBe('failed');
    expect(result.evidenceStatus).toBe('failed');
    expect(result.components.find((c) => c.component === 'evidence_retrieval')?.detail).toMatch(
      /Could not reach/,
    );
    // The model still ran, so the claim is assessed, but with less confidence.
    expect(result.assessment.score).not.toBeNull();
  });

  it('reports insufficient evidence when a search finds nothing relevant', async () => {
    const result = await analyzeText(
      'A small village in Peru recorded 14 UFO sightings in 2023.',
      'claim',
      mockProviders({ evidence: [] }),
    );
    expect(result.evidenceStatus).toBe('none_found');
    expect(result.assessment.label).toBe('insufficient_evidence');
  });
});

describe('analyzeImage', () => {
  it('refuses to produce a result when no image service is connected', async () => {
    await expect(analyzeImage(image, createUnavailableProviders())).rejects.toThrow(
      AnalysisUnavailableError,
    );
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

  it('assesses authenticity and verifies claims found in the image', async () => {
    const result = await analyzeImage(
      image,
      mockProviders({
        vision: mockAuthenticity,
        ocr: mockOcr,
        model: mockModelContradicted,
        evidence: mockContradictingEvidence,
      }),
    );
    expect(result.kind).toBe('image');
    expect(result.authenticity).toEqual(mockAuthenticity);
    expect(result.extractedText?.text).toBe(mockOcr.text);
    expect(result.claim?.text).toContain('NASA confirmed');
    expect(statusOf(result, 'claim_extraction')).toBe('completed');
    expect(result.assessment.factors.map((f) => f.id)).toContain('ai_generation');
  });

  it('handles images without text: authenticity only, no claim', async () => {
    const result = await analyzeImage(
      image,
      mockProviders({ vision: mockAuthenticity, ocr: { text: '', confidence: 0, engine: 'm' } }),
    );
    expect(result.claim).toBeNull();
    expect(statusOf(result, 'claim_extraction')).toBe('skipped');
    expect(result.assessment.summary).toMatch(/No factual claim was found in this image/);
  });
});
