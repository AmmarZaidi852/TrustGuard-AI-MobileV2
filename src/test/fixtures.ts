/**
 * MOCK DATA — TEST FIXTURES ONLY.
 * These stand in for external AI/search services in unit tests and must never be
 * imported by application code.
 */
import { ServiceRequestError, ServiceUnavailableError } from '@/core/errors';
import type { ImageAuthenticityAnalysis, ModelClaimAnalysis, OcrResult } from '@/core/types';
import type { AnalysisProviders, RetrievedEvidence } from '@/services/providers/types';
import { createUnavailableProviders } from '@/services/providers/unavailable';

export const mockModelContradicted: ModelClaimAnalysis = {
  stance: 'contradicted',
  confidence: 0.85,
  reasoning: '[mock] Large studies associate coffee with modest risk changes, not prevention.',
  indicators: [],
  evidenceNeeded: ['[mock] Systematic reviews of coffee and cancer risk'],
  model: 'mock-model',
};

export const mockModelSupported: ModelClaimAnalysis = {
  ...mockModelContradicted,
  stance: 'supported',
  reasoning: '[mock] Widely documented.',
};

export const mockContradictingEvidence: RetrievedEvidence[] = [
  {
    title: '[mock] Coffee and cancer: what the research says',
    url: 'https://www.cancer.gov/mock-coffee',
    publisher: 'National Cancer Institute',
    snippet: '[mock] No evidence that coffee prevents cancer.',
    stance: 'contradicts',
  },
  {
    title: '[mock] Fact check: coffee does not prevent cancer',
    url: 'https://www.fullfact.org/mock',
    publisher: 'Full Fact',
    snippet: '[mock] Claim is false.',
    stance: 'contradicts',
  },
  {
    title: '[mock] Viral post',
    url: 'https://www.facebook.com/mock',
    publisher: '',
    snippet: '[mock] Coffee cures cancer!',
    stance: 'supports',
  },
];

export const mockSupportingEvidence: RetrievedEvidence[] = [
  {
    title: '[mock] A',
    url: 'https://apnews.com/a',
    publisher: 'AP',
    snippet: '',
    stance: 'supports',
  },
  {
    title: '[mock] B',
    url: 'https://www.reuters.com/b',
    publisher: 'Reuters',
    snippet: '',
    stance: 'supports',
  },
  {
    title: '[mock] C',
    url: 'https://www.nasa.gov/c',
    publisher: 'NASA',
    snippet: '',
    stance: 'supports',
  },
];

export const mockAuthenticity: ImageAuthenticityAnalysis = {
  aiGeneration: {
    likelihood: 'high',
    signals: ['[mock] Inconsistent hands', '[mock] Garbled text'],
  },
  manipulation: { likelihood: 'low', signals: [] },
  misleadingContext: { likelihood: 'undetermined', signals: [] },
  description: '[mock] A crowd scene.',
  model: 'mock-vision',
};

export const mockOcr: OcrResult = {
  text: 'BREAKING: NASA confirmed that astronauts found water on the Moon in 2020.',
  confidence: 0.9,
  engine: 'mock-ocr',
};

export function mockProviders(overrides: {
  model?: ModelClaimAnalysis | Error;
  evidence?: RetrievedEvidence[] | Error;
  vision?: ImageAuthenticityAnalysis | Error;
  ocr?: OcrResult | Error;
}): AnalysisProviders {
  const base = createUnavailableProviders();
  const respond = <T>(value: T | Error | undefined, fallback: () => Promise<T>) =>
    value === undefined
      ? fallback()
      : value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(value);
  return {
    claimAnalyzer: {
      analyzeClaim: (claim, ctx) =>
        respond(overrides.model, () => base.claimAnalyzer.analyzeClaim(claim, ctx)),
    },
    evidenceRetriever: {
      findEvidence: (claim) =>
        respond(overrides.evidence, () => base.evidenceRetriever.findEvidence(claim)),
    },
    visionAnalyzer: {
      analyzeImage: (img) => respond(overrides.vision, () => base.visionAnalyzer.analyzeImage(img)),
    },
    ocr: { extractText: (img) => respond(overrides.ocr, () => base.ocr.extractText(img)) },
  };
}

export const networkError = () => new ServiceRequestError('offline', 'network');
export const unavailable = (name: string) => new ServiceUnavailableError(name);
