import type { ApiErrorCode } from './api-contract';

/** Input rejected before any analysis ran. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A required external service (LLM, search, vision, OCR) is not configured. */
export class ServiceUnavailableError extends Error {
  constructor(
    readonly service: string,
    message = `${service} is not connected yet.`,
  ) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/** An external service was reachable in principle but the request failed. */
export class ServiceRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'http' | 'invalid_response',
    readonly status?: number,
    /** Error code from the TrustGuardAI backend, when it sent one. */
    readonly code?: ApiErrorCode,
  ) {
    super(message);
    this.name = 'ServiceRequestError';
  }
}

/** Nothing could be analyzed at all, so no result is produced. */
export class AnalysisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisUnavailableError';
  }
}

/**
 * For error responses without a TrustGuardAI error code: those come from the hosting
 * platform or a proxy in front of the API (e.g. a gateway timeout or an upload size
 * limit), not from the API itself.
 */
function messageForStatus(status: number | undefined): string | null {
  switch (status) {
    case 408:
    case 504:
    case 524: // Cloudflare: the server did not answer in time.
      return 'The analysis service took too long to respond. Please try again.';
    case 413:
      return 'The upload was too large for the server. Try a smaller image.';
    case 429:
      return 'Too many analyses in a short time. Wait a few minutes and try again.';
    case 502:
    case 503:
      return 'The analysis service is temporarily unavailable. Please try again shortly.';
    default:
      return null;
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof ValidationError || error instanceof AnalysisUnavailableError) {
    return error.message;
  }
  if (error instanceof ServiceUnavailableError) {
    return error.message;
  }
  if (error instanceof ServiceRequestError) {
    switch (error.kind) {
      case 'network':
        return 'Could not reach the analysis service. Check your connection and try again.';
      case 'timeout':
        return 'The analysis service took too long to respond. Please try again.';
      case 'invalid_response':
        return 'The analysis service returned an unexpected response.';
      case 'http':
        switch (error.code) {
          case 'rate_limited':
            return 'Too many analyses in a short time. Wait a few minutes and try again.';
          case 'provider_billing':
            return 'The AI service has run out of credits, so no analysis was made. Please try again later.';
          case 'content_blocked':
            return "The AI service's content filter blocked this request, so no assessment was made.";
          case 'model_refused':
            return 'The AI model declined to analyze this content, so no assessment was made.';
          case 'model_unavailable':
            return 'The AI service is temporarily unavailable. Please try again shortly.';
          case 'invalid_model_output':
            return 'The AI returned an incomplete analysis, so it was not used. Please try again.';
          case 'timeout':
            return 'The AI service took too long to respond. Please try again.';
          case 'search_unavailable':
            return 'Web search is unavailable right now, so no external sources could be checked.';
          case 'evaluation_failed':
            return 'Sources were found, but the AI could not evaluate them reliably.';
          case 'invalid_request':
          case 'empty_image':
          case 'unsupported_image':
          case 'image_too_large':
          case 'invalid_image':
            return error.message;
          case 'internal':
            return 'The analysis service hit an unexpected error, so no analysis was made. Please try again.';
          default:
            return (
              messageForStatus(error.status) ??
              `The analysis service returned an error${error.status ? ` (${error.status})` : ''}.`
            );
        }
    }
  }
  return 'Something went wrong while analyzing this content.';
}
