import {
  API_ROUTES,
  type EvidenceSearchRequest,
  type SourceRelationship,
} from '@/core/api-contract';
import { ServiceRequestError, ServiceUnavailableError, ValidationError } from '@/core/errors';
import { guardSourceEvaluation } from '@/core/evidence/source-guards';
import { normalizeModelAnalysis } from '@/core/model/model-analysis';
import { validateSourceUrl } from '@/core/sources/url-safety';
import {
  type AuthenticityFinding,
  CLAIM_TYPES,
  type ImageAuthenticityAnalysis,
  type Indicator,
  type Likelihood,
  type ModelClaimAnalysis,
  type OcrResult,
  type SourceEvaluation,
} from '@/core/types';
import type { ImageInput } from '@/core/validation';

import { postJson } from '../http/api-client';
import type { AnalysisProviders, EvidenceSearchResult, RetrievedEvidence } from './types';

/**
 * Providers backed by the TrustGuardAI backend proxy, which holds all API keys.
 * Every response is validated at runtime; malformed responses are rejected
 * rather than partially trusted.
 */

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
  if (typeof data.verifiable !== 'boolean') invalid('verifiable');
  return normalizeModelAnalysis({
    extractedClaim: str(data, 'extractedClaim'),
    claimType: oneOf(data, 'claimType', CLAIM_TYPES),
    verifiable: data.verifiable as boolean,
    verifiabilityNote: str(data, 'verifiabilityNote', true),
    stance: oneOf(data, 'stance', STANCES),
    confidence: unit(data, 'confidence'),
    reasoning: str(data, 'reasoning'),
    indicators,
    evidenceNeeded: strings(data, 'evidenceNeeded'),
    limitations: str(data, 'limitations', true),
    model: str(data, 'model'),
  });
}

const RELATIONSHIPS = ['supports', 'contradicts', 'context'] as const;
const RELEVANCES = ['high', 'medium', 'low'] as const;
const SOURCE_VERDICTS = [
  'supported',
  'contradicted',
  'mixed',
  'insufficient_evidence',
  'cannot_verify',
] as const;

function parseSource(item: Json): RetrievedEvidence | null {
  // Individual bad sources are dropped rather than failing the whole check.
  const url = validateSourceUrl(item.url);
  if (!url || typeof item.title !== 'string' || !item.title.trim()) return null;
  if (!RELATIONSHIPS.includes(item.relationship as never)) return null;
  if (!RELEVANCES.includes(item.relevance as never)) return null;
  return {
    title: item.title.trim(),
    url,
    publisher: typeof item.domain === 'string' ? item.domain : '',
    snippet: typeof item.excerpt === 'string' ? item.excerpt : '',
    stance: item.relationship as RetrievedEvidence['stance'],
    relevance: item.relevance as RetrievedEvidence['relevance'],
    explanation: typeof item.explanation === 'string' ? item.explanation : '',
    publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : undefined,
  };
}

function parseSourceEvaluation(value: unknown, sources: RetrievedEvidence[]): SourceEvaluation {
  const data = root(value);
  const evaluation: SourceEvaluation = {
    verdict: oneOf(data, 'verdict', SOURCE_VERDICTS),
    confidence: unit(data, 'confidence'),
    whatSourcesSay: str(data, 'whatSourcesSay', true),
    inference: str(data, 'inference', true),
    uncertainty: str(data, 'uncertainty', true),
    missingEvidence: strings(data, 'missingEvidence'),
    searchQueries: strings(data, 'searchQueries'),
    model: str(data, 'model'),
  };
  // Re-apply the shared guard rails to what actually arrived.
  return guardSourceEvaluation(
    evaluation,
    sources.map((source) => ({
      url: source.url,
      relationship: source.stance as SourceRelationship,
      relevance: source.relevance ?? 'low',
    })),
  );
}

export function parseEvidence(body: unknown): EvidenceSearchResult {
  const data = root(body);
  const items = objects(data, 'sources');
  const sources: RetrievedEvidence[] = [];
  let rejected = typeof data.rejectedSources === 'number' ? data.rejectedSources : 0;
  for (const item of items) {
    const source = parseSource(item);
    if (source) sources.push(source);
    else rejected += 1;
  }
  const evaluation =
    data.evaluation === null || data.evaluation === undefined || sources.length === 0
      ? null
      : parseSourceEvaluation(data.evaluation, sources);
  return { sources, evaluation, rejectedSources: rejected };
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
  /** Source checks (web search + evaluation) take longer than a single model call. */
  evidenceTimeoutMs: number = timeoutMs,
): AnalysisProviders {
  const post = async (path: string, body: unknown, service: string, timeout = timeoutMs) => {
    try {
      return await postJson(`${baseUrl}${path}`, body, { timeoutMs: timeout, fetchImpl });
    } catch (error) {
      if (error instanceof ServiceRequestError && error.code === 'not_configured') {
        throw new ServiceUnavailableError(service, `${service} is not set up on the server yet.`);
      }
      if (error instanceof ServiceRequestError && error.code === 'invalid_request') {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  };

  return {
    claimAnalyzer: {
      analyzeClaim: async (request) =>
        parseClaimAnalysis(await post(API_ROUTES.claimAnalysis, request, 'AI claim analysis')),
    },
    evidenceRetriever: {
      findEvidence: async (claim) =>
        parseEvidence(
          await post(
            API_ROUTES.evidenceSearch,
            { claim: claim.text, claimType: claim.type } satisfies EvidenceSearchRequest,
            'Source checking',
            evidenceTimeoutMs,
          ),
        ),
    },
    visionAnalyzer: {
      analyzeImage: async (image) =>
        parseImageAnalysis(
          await post(API_ROUTES.imageAnalysis, imagePayload(image), 'Image analysis'),
        ),
    },
    ocr: {
      extractText: async (image) =>
        parseOcr(await post(API_ROUTES.ocr, imagePayload(image), 'Text extraction (OCR)')),
    },
  };
}
