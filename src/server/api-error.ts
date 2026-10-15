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
  provider_billing: 503,
  model_refused: 422,
  content_blocked: 422,
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

/**
 * True when a 403 is a content block rather than a permissions problem. OpenRouter
 * uses 403 for both; its moderation/guardrail errors carry `metadata.reasons` and
 * `flagged_input`. Nothing from the body is passed on (it can quote user content).
 */
export function isContentBlock(body: unknown): boolean {
  const error = (body as { error?: { message?: unknown; metadata?: Record<string, unknown> } })
    ?.error;
  if (!error || typeof error !== 'object') return false;
  const metadata = error.metadata;
  if (metadata && (Array.isArray(metadata.reasons) || typeof metadata.flagged_input === 'string')) {
    return true;
  }
  return typeof error.message === 'string' && /moderation|flagged|guardrail/i.test(error.message);
}

/**
 * Maps provider failures (Anthropic, or OpenRouter's Anthropic-compatible endpoint,
 * both surfaced by the Anthropic SDK) to API errors without leaking provider details.
 */
export function mapAnthropicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  // The request's time budget ran out (or the client left): the call was cancelled
  // on purpose. Checked before APIError, which it extends.
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ApiError('timeout', 'The analysis took too long and was stopped.');
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ApiError('not_configured', 'The AI provider rejected the server credentials.');
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    if (isContentBlock(error.error)) {
      return new ApiError(
        'content_blocked',
        "The AI provider's content filter blocked this request, so no analysis was made.",
      );
    }
    return new ApiError(
      'not_configured',
      'The AI provider denied access for the server credentials.',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ApiError('rate_limited', 'The AI provider is busy. Try again in a minute.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ApiError('model_unavailable', 'The AI provider rejected the request.');
  }
  if (error instanceof Anthropic.APIError && error.status === 402) {
    return new ApiError(
      'provider_billing',
      'The AI provider account cannot cover this request (insufficient credits).',
    );
  }
  if (error instanceof Anthropic.APIError && error.status === 408) {
    return new ApiError('timeout', 'The AI provider took too long to respond.');
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
  // Compared by name: the fetch implementation may throw these from another JS realm.
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : null;
  if (name === 'AbortError' || name === 'TimeoutError') {
    // Cancelled while the response body was still arriving: the SDK only wraps aborts
    // that happen before the response headers.
    return new ApiError('timeout', 'The analysis took too long and was stopped.');
  }
  if (name === 'SyntaxError' || name === 'TypeError') {
    // The provider answered, but not with a well-formed message (e.g. a proxy error page).
    return new ApiError('invalid_model_output', 'The AI provider returned a malformed response.');
  }
  return new ApiError('internal', 'Unexpected error while analyzing.');
}
