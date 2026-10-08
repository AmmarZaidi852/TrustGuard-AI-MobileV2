import type { SupportedImageType } from './image/image-payload';
import type {
  ImageClaimAnalysis,
  ClaimType,
  ModelClaimAnalysis,
  SourceEvaluation,
  SourceRelevance,
} from './types';

/** Wire contract between the app and the TrustGuardAI backend. Shared by both sides. */

export const API_ROUTES = {
  claimAnalysis: '/api/v1/claims/analyze',
  evidenceSearch: '/api/v1/evidence/search',
  imageAnalysis: '/api/v1/images/analyze',
} as const;

/** Image claim extraction. The image is used for this request only and never stored. */
export interface ImageAnalysisRequest {
  /** Base64 image bytes (no data-URI prefix). */
  image: string;
  /** The type the app detected from the bytes; the server re-detects and must agree. */
  mediaType: SupportedImageType;
}

export type ImageAnalysisResponse = ImageClaimAnalysis;

export interface ClaimAnalysisRequest {
  text: string;
  mode: 'text' | 'claim';
}

export type ClaimAnalysisResponse = ModelClaimAnalysis;

/** Source discovery + source-backed evaluation for one normalized claim. */
export interface EvidenceSearchRequest {
  claim: string;
  claimType: ClaimType;
}

export type SourceRelationship = 'supports' | 'contradicts' | 'context';

export interface VerifiedSource {
  /** Stable id within one response ("S1", "S2", ...). */
  id: string;
  title: string;
  /** Validated public http(s) URL. */
  url: string;
  domain: string;
  /** Passage quoted from the page by the search provider (not written by the model). */
  excerpt: string;
  relationship: SourceRelationship;
  relevance: SourceRelevance;
  /** Short explanation of how the source bears on the claim. */
  explanation: string;
  publishedAt?: string;
}

export interface EvidenceSearchResponse {
  /** Relevant sources only; may be empty. Not a fixed length. */
  sources: VerifiedSource[];
  /** `null` when no usable sources were found, so nothing could be evaluated. */
  evaluation: SourceEvaluation | null;
  /** Sources dropped for unsafe/invalid URLs or missing data. */
  rejectedSources: number;
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'not_configured'
  | 'rate_limited'
  | 'model_refused'
  | 'model_unavailable'
  | 'invalid_model_output'
  | 'timeout'
  | 'search_unavailable'
  | 'evaluation_failed'
  | 'empty_image'
  | 'unsupported_image'
  | 'image_too_large'
  | 'invalid_image'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
