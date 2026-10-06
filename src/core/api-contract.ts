import type { ModelClaimAnalysis } from './types';

/** Wire contract between the app and the TrustGuardAI backend. Shared by both sides. */

export const API_ROUTES = {
  claimAnalysis: '/api/v1/claims/analyze',
  evidenceSearch: '/api/v1/evidence/search',
  imageAnalysis: '/api/v1/images/analyze',
  ocr: '/api/v1/images/ocr',
} as const;

export interface ClaimAnalysisRequest {
  text: string;
  mode: 'text' | 'claim';
}

export type ClaimAnalysisResponse = ModelClaimAnalysis;

export type ApiErrorCode =
  | 'invalid_request'
  | 'not_configured'
  | 'rate_limited'
  | 'model_refused'
  | 'model_unavailable'
  | 'invalid_model_output'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
