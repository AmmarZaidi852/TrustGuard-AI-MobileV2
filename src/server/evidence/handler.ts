import type { EvidenceSearchRequest, EvidenceSearchResponse } from '@/core/api-contract';
import { ValidationError } from '@/core/errors';
import { CLAIM_TYPES, type ClaimType } from '@/core/types';
import { validateTextInput } from '@/core/validation';

import { ApiError, errorResponse } from '../api-error';
import { clientKey } from '../rate-limit';
import type { SourceDiscoverer } from './discovery';
import type { SourceEvaluator } from './evaluation';

export interface EvidenceHandlerDeps {
  /** `null` when the server has no provider credentials configured. */
  services: { discover: SourceDiscoverer; evaluate: SourceEvaluator } | null;
  allowRequest: (key: string) => boolean;
  log?: (message: string) => void;
}

const NOT_CHECKABLE: ClaimType[] = ['opinion', 'prediction'];

async function readRequest(request: Request): Promise<EvidenceSearchRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('The request body must be JSON.');
  }
  const { claim, claimType } = (body ?? {}) as Partial<EvidenceSearchRequest>;
  if (typeof claim !== 'string') throw new ValidationError('claim must be a string.');
  if (!CLAIM_TYPES.includes(claimType as ClaimType)) {
    throw new ValidationError('claimType is not recognised.');
  }
  if (NOT_CHECKABLE.includes(claimType as ClaimType)) {
    throw new ValidationError('Opinions and predictions cannot be checked against sources.');
  }
  return { claim: validateTextInput(claim, 'claim'), claimType: claimType as ClaimType };
}

/**
 * POST /api/v1/evidence/search — discover sources for a normalized claim, then
 * evaluate the claim against them. No sources → empty list and no evaluation
 * (never a verdict without evidence).
 */
export function createEvidenceHandler({
  services,
  allowRequest,
  log = (message) => console.error(message),
}: EvidenceHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    let payload: EvidenceSearchRequest;
    try {
      payload = await readRequest(request);
    } catch (error) {
      return errorResponse(
        'invalid_request',
        error instanceof ValidationError ? error.message : 'Invalid request.',
      );
    }

    if (!services) {
      return errorResponse(
        'not_configured',
        'Source checking is not configured on the server (missing ANTHROPIC_API_KEY).',
      );
    }
    if (!allowRequest(clientKey(request))) {
      return errorResponse(
        'rate_limited',
        'Too many source checks in a short time. Wait a few minutes and try again.',
      );
    }

    try {
      const discovered = await services.discover(payload);
      if (discovered.sources.length === 0) {
        const body: EvidenceSearchResponse = {
          sources: [],
          evaluation: null,
          rejectedSources: discovered.rejected,
        };
        return Response.json(body);
      }

      const evaluated = await services.evaluate({
        claim: payload.claim,
        claimType: payload.claimType,
        sources: discovered.sources,
        searchQueries: discovered.queries,
      });
      const body: EvidenceSearchResponse = {
        sources: evaluated.sources,
        evaluation: evaluated.evaluation,
        rejectedSources: discovered.rejected,
      };
      return Response.json(body);
    } catch (error) {
      if (error instanceof ApiError) {
        log(`[evidence] ${error.code}: ${error.message}`);
        return errorResponse(error.code, error.message);
      }
      log(`[evidence] unexpected error: ${error instanceof Error ? error.message : error}`);
      return errorResponse('internal', 'Unexpected error while checking sources.');
    }
  };
}
