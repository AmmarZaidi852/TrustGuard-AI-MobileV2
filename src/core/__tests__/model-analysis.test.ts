import { MODEL_LIMITS, normalizeModelAnalysis } from '../model/model-analysis';
import type { ModelClaimAnalysis } from '../types';

const base: ModelClaimAnalysis = {
  extractedClaim: '  NASA discovered life on Mars.  ',
  claimType: 'scientific_health',
  verifiable: true,
  verifiabilityNote: '',
  stance: 'contradicted',
  confidence: 0.7,
  reasoning: 'No such discovery has been announced.',
  indicators: [],
  evidenceNeeded: ['An official NASA announcement', ' ', 'Peer-reviewed publication'],
  limitations: '',
  model: 'm',
};

describe('normalizeModelAnalysis', () => {
  it('trims text and drops empty list items', () => {
    const result = normalizeModelAnalysis(base);
    expect(result.extractedClaim).toBe('NASA discovered life on Mars.');
    expect(result.evidenceNeeded).toEqual([
      'An official NASA announcement',
      'Peer-reviewed publication',
    ]);
  });

  it.each([
    [1.4, MODEL_LIMITS.maxConfidence],
    [0.99, MODEL_LIMITS.maxConfidence],
    [-0.2, 0],
    [Number.NaN, 0],
    [0.55, 0.55],
  ])('clamps confidence %p to %p', (input, expected) => {
    expect(normalizeModelAnalysis({ ...base, confidence: input }).confidence).toBe(expected);
  });

  it('forces "unverifiable" when the model says the claim cannot be checked', () => {
    const result = normalizeModelAnalysis({ ...base, verifiable: false, stance: 'contradicted' });
    expect(result.stance).toBe('unverifiable');
  });

  it('never treats opinions or predictions as verifiable, whatever the model says', () => {
    for (const claimType of ['opinion', 'prediction'] as const) {
      const result = normalizeModelAnalysis({ ...base, claimType, verifiable: true });
      expect(result.verifiable).toBe(false);
      expect(result.stance).toBe('unverifiable');
    }
  });

  it('caps and cleans key findings, marking them as model output', () => {
    const indicators = Array.from({ length: 10 }, (_, i) => ({
      id: '',
      label: i === 0 ? '   ' : `Finding ${i}`,
      description: 'd',
      direction: 'raises_concern' as const,
      weight: 3,
      origin: 'heuristic' as const,
    }));
    const result = normalizeModelAnalysis({ ...base, indicators });
    expect(result.indicators).toHaveLength(MODEL_LIMITS.maxIndicators);
    expect(result.indicators.every((i) => i.origin === 'model' && i.weight === 1)).toBe(true);
    expect(result.indicators[0].label).toBe('Finding 1');
  });
});
