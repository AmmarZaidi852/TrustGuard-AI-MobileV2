import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

import type { ClaimAnalysisRequest } from '@/core/api-contract';
import type { ModelClaimAnalysis } from '@/core/types';

import { mapAnthropicError } from '../api-error';
import { ClaimAnalysisError } from './errors';
import { CLAIM_ANALYSIS_SYSTEM_PROMPT, buildClaimAnalysisUserMessage } from './prompt';
import { ClaimAnalysisOutputSchema, toModelClaimAnalysis } from './schema';

export type ClaimAnalyzerFn = (request: ClaimAnalysisRequest) => Promise<ModelClaimAnalysis>;

/** The subset of the SDK client this module uses, so tests can substitute it. */
export type ParseClient = Pick<Anthropic, 'beta'>;

export interface AnthropicAnalyzerOptions {
  apiKey: string;
  model: string;
  client?: ParseClient;
  now?: () => Date;
}

export function createAnthropicClaimAnalyzer({
  apiKey,
  model,
  client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 }),
  now = () => new Date(),
}: AnthropicAnalyzerOptions): ClaimAnalyzerFn {
  return async (request) => {
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        // Claim analysis benefits from reasoning; medium keeps latency and cost modest.
        output_config: { effort: 'medium', format: betaZodOutputFormat(ClaimAnalysisOutputSchema) },
        // If a safety classifier declines (e.g. sensitive health claims), retry on a
        // fallback model inside the same call instead of failing outright.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: CLAIM_ANALYSIS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildClaimAnalysisUserMessage(request, now().toISOString().slice(0, 10)),
          },
        ],
      });
    } catch (error) {
      throw mapAnthropicError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new ClaimAnalysisError(
        'model_refused',
        'The AI model declined to analyze this content.',
      );
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new ClaimAnalysisError(
        'invalid_model_output',
        'The AI model returned an incomplete analysis.',
      );
    }
    return toModelClaimAnalysis(response.parsed_output, response.model);
  };
}
