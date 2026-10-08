import Anthropic from '@anthropic-ai/sdk';

import type { ApiErrorBody, ApiErrorCode } from '@/core/api-contract';

/** An error with a stable API code, safe to show to the client. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  not_configured: 503,
  rate_limited: 429,
  model_refused: 422,
  model_unavailable: 502,
  invalid_model_output: 502,
  timeout: 504,
  search_unavailable: 503,
  evaluation_failed: 502,
  empty_image: 400,
  unsupported_image: 415,
  image_too_large: 413,
  invalid_image: 400,
  internal: 500,
};

export function errorResponse(code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

/** Maps Anthropic SDK failures to API errors without leaking provider details. */
export function mapAnthropicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ApiError('not_configured', 'The AI provider rejected the server credentials.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ApiError('rate_limited', 'The AI provider is busy. Try again in a minute.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ApiError('model_unavailable', 'The AI provider rejected the request.');
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError('timeout', 'The AI provider took too long to respond.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ApiError('model_unavailable', 'Could not reach the AI provider.');
  }
  if (error instanceof Anthropic.APIError) {
    return new ApiError('model_unavailable', 'The AI provider returned an error.');
  }
  if (error instanceof Anthropic.AnthropicError) {
    // The SDK could not parse the model output against the schema.
    return new ApiError('invalid_model_output', 'The AI model returned a malformed response.');
  }
  return new ApiError('internal', 'Unexpected error while analyzing.');
}
