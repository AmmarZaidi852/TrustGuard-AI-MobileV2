import type { ApiErrorCode } from '@/core/api-contract';

export class ClaimAnalysisError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimAnalysisError';
  }
}

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  not_configured: 503,
  rate_limited: 429,
  model_refused: 422,
  model_unavailable: 502,
  invalid_model_output: 502,
  internal: 500,
};
