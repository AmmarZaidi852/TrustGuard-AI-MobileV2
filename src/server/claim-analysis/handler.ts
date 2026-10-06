import type { ApiErrorBody, ApiErrorCode, ClaimAnalysisRequest } from '@/core/api-contract';
import { ValidationError } from '@/core/errors';
import { validateTextInput } from '@/core/validation';

import { clientKey } from '../rate-limit';
import type { ClaimAnalyzerFn } from './anthropic-analyzer';
import { ClaimAnalysisError, STATUS_BY_CODE } from './errors';

export interface ClaimAnalysisHandlerDeps {
  /** `null` when the server has no provider credentials configured. */
  analyzer: ClaimAnalyzerFn | null;
  allowRequest: (key: string) => boolean;
  log?: (message: string) => void;
}

function errorResponse(code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

async function readRequest(request: Request): Promise<ClaimAnalysisRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('The request body must be JSON.');
  }
  const { text, mode } = (body ?? {}) as Partial<ClaimAnalysisRequest>;
  if (mode !== 'text' && mode !== 'claim') {
    throw new ValidationError('mode must be "text" or "claim".');
  }
  if (typeof text !== 'string') {
    throw new ValidationError('text must be a string.');
  }
  // Same validation as the app, so limits cannot be bypassed by calling the API directly.
  return { mode, text: validateTextInput(text, mode) };
}

export function createClaimAnalysisHandler({
  analyzer,
  allowRequest,
  log = (message) => console.error(message),
}: ClaimAnalysisHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    let payload: ClaimAnalysisRequest;
    try {
      payload = await readRequest(request);
    } catch (error) {
      return errorResponse(
        'invalid_request',
        error instanceof ValidationError ? error.message : 'Invalid request.',
      );
    }

    if (!analyzer) {
      return errorResponse(
        'not_configured',
        'AI analysis is not configured on the server (missing ANTHROPIC_API_KEY).',
      );
    }

    if (!allowRequest(clientKey(request))) {
      return errorResponse(
        'rate_limited',
        'Too many analyses in a short time. Wait a few minutes and try again.',
      );
    }

    try {
      return Response.json(await analyzer(payload));
    } catch (error) {
      if (error instanceof ClaimAnalysisError) {
        log(`[claim-analysis] ${error.code}: ${error.message}`);
        return errorResponse(error.code, error.message);
      }
      log(`[claim-analysis] unexpected error: ${error instanceof Error ? error.message : error}`);
      return errorResponse('internal', 'Unexpected error while analyzing.');
    }
  };
}
