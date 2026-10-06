import { ServiceRequestError, ValidationError } from '@/core/errors';
import type {
  AuthenticityFinding,
  EvidenceStance,
  ImageAuthenticityAnalysis,
  Indicator,
  Likelihood,
  ModelClaimAnalysis,
  OcrResult,
} from '@/core/types';
import type { ImageInput } from '@/core/validation';

import { postJson } from '../http/api-client';
import type { AnalysisProviders, RetrievedEvidence } from './types';

/**
 * Providers backed by the TrustGuardAI backend proxy, which holds all API keys.
 * Every response is validated at runtime; malformed responses are rejected
 * rather than partially trusted.
 */

const ENDPOINTS = {
  claim: '/v1/claims/analyze',
  evidence: '/v1/evidence/search',
  vision: '/v1/images/analyze',
  ocr: '/v1/images/ocr',
} as const;

type Json = Record<string, unknown>;

function invalid(field: string): never {
  throw new ServiceRequestError(`Invalid response field: ${field}`, 'invalid_response');
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function str(obj: Json, key: string, optional = false): string {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (optional && value === undefined) return '';
  return invalid(key);
}

function unit(obj: Json, key: string): number {
  const value = obj[key];
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : invalid(key);
}

function oneOf<T extends string>(obj: Json, key: string, allowed: readonly T[]): T {
  const value = obj[key];
  return allowed.includes(value as T) ? (value as T) : invalid(key);
}

function strings(obj: Json, key: string): string[] {
  const value = obj[key] ?? [];
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : invalid(key);
}

function objects(obj: Json, key: string): Json[] {
  const value = obj[key] ?? [];
  return Array.isArray(value) && value.every(isObject) ? value : invalid(key);
}

function root(value: unknown): Json {
  return isObject(value) ? value : invalid('body');
}

const STANCES = ['supported', 'contradicted', 'disputed', 'unverifiable'] as const;
const EVIDENCE_STANCES: readonly EvidenceStance[] = [
  'supports',
  'contradicts',
  'mixed',
  'unrelated',
];
const LIKELIHOODS: readonly Likelihood[] = ['low', 'moderate', 'high', 'undetermined'];

export function parseClaimAnalysis(body: unknown): ModelClaimAnalysis {
  const data = root(body);
  const indicators: Indicator[] = objects(data, 'indicators').map((item, index) => ({
    id: str(item, 'id', true) || `model_${index}`,
    label: str(item, 'label'),
    description: str(item, 'description', true),
    direction: oneOf(item, 'direction', ['raises_concern', 'supports_reliability'] as const),
    weight: unit(item, 'weight'),
    origin: 'model',
    excerpt: str(item, 'excerpt', true) || undefined,
  }));
  return {
    stance: oneOf(data, 'stance', STANCES),
    confidence: unit(data, 'confidence'),
    reasoning: str(data, 'reasoning'),
    indicators,
    evidenceNeeded: strings(data, 'evidenceNeeded'),
    model: str(data, 'model'),
  };
}

export function parseEvidence(body: unknown): RetrievedEvidence[] {
  return objects(root(body), 'results').map((item) => ({
    title: str(item, 'title'),
    url: str(item, 'url'),
    publisher: str(item, 'publisher', true),
    snippet: str(item, 'snippet', true),
    stance: oneOf(item, 'stance', EVIDENCE_STANCES),
    publishedAt: str(item, 'publishedAt', true) || undefined,
  }));
}

function parseFinding(value: unknown, key: string): AuthenticityFinding {
  if (!isObject(value)) return invalid(key);
  return {
    likelihood: oneOf(value, 'likelihood', LIKELIHOODS),
    signals: strings(value, 'signals'),
  };
}

export function parseImageAnalysis(body: unknown): ImageAuthenticityAnalysis {
  const data = root(body);
  return {
    aiGeneration: parseFinding(data.aiGeneration, 'aiGeneration'),
    manipulation: parseFinding(data.manipulation, 'manipulation'),
    misleadingContext: parseFinding(data.misleadingContext, 'misleadingContext'),
    description: str(data, 'description', true),
    model: str(data, 'model'),
  };
}

export function parseOcr(body: unknown): OcrResult {
  const data = root(body);
  return {
    text: str(data, 'text', true),
    confidence: unit(data, 'confidence'),
    engine: str(data, 'engine'),
  };
}

function imagePayload(image: ImageInput) {
  if (!image.base64) {
    throw new ValidationError('The image data could not be read. Try selecting the image again.');
  }
  return { image: image.base64, mimeType: image.mimeType ?? 'image/jpeg' };
}

export function createRemoteProviders(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): AnalysisProviders {
  const post = (path: string, body: unknown) =>
    postJson(`${baseUrl}${path}`, body, { timeoutMs, fetchImpl });

  return {
    claimAnalyzer: {
      analyzeClaim: async (claim, context) =>
        parseClaimAnalysis(
          await post(ENDPOINTS.claim, { claim: claim.text, type: claim.type, context }),
        ),
    },
    evidenceRetriever: {
      findEvidence: async (claim) =>
        parseEvidence(await post(ENDPOINTS.evidence, { claim: claim.text })),
    },
    visionAnalyzer: {
      analyzeImage: async (image) =>
        parseImageAnalysis(await post(ENDPOINTS.vision, imagePayload(image))),
    },
    ocr: {
      extractText: async (image) => parseOcr(await post(ENDPOINTS.ocr, imagePayload(image))),
    },
  };
}
