import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import type { VerifiedSource } from '@/core/api-contract';
import { guardSourceEvaluation } from '@/core/evidence/source-guards';
import type { ClaimType, SourceEvaluation } from '@/core/types';

import { ApiError, mapAnthropicError } from '../api-error';
import type { CreateClient, DiscoveredSource } from './discovery';
import { EVALUATION_SYSTEM_PROMPT, buildEvaluationUserMessage } from './prompts';
import { clipText } from './untrusted';

/** Structured output the model must follow (no numeric bounds: enforced in code). */
export const SourceEvaluationOutputSchema = z.object({
  sourceAssessments: z.array(
    z.object({
      sourceId: z.string(),
      relationship: z.enum(['supports', 'contradicts', 'context', 'irrelevant']),
      relevance: z.enum(['high', 'medium', 'low']),
      explanation: z.string(),
    }),
  ),
  verdict: z.enum(['supported', 'contradicted', 'mixed', 'insufficient_evidence', 'cannot_verify']),
  confidence: z.number(),
  whatSourcesSay: z.string(),
  inference: z.string(),
  uncertainty: z.string(),
  missingEvidence: z.array(z.string()),
});

export type SourceEvaluationOutput = z.infer<typeof SourceEvaluationOutputSchema>;

export interface EvaluatedSources {
  sources: VerifiedSource[];
  evaluation: SourceEvaluation;
}

const MAX_FIELD = 600;

/**
 * Joins the model's per-source judgements onto the discovered sources. Only ids
 * that exist are accepted (the model cannot add sources); sources it marks
 * irrelevant or does not assess are dropped; then the guard rails run.
 */
export function mergeEvaluation(
  discovered: DiscoveredSource[],
  output: SourceEvaluationOutput,
  meta: { model: string; searchQueries: string[] },
): EvaluatedSources {
  const byId = new Map(discovered.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const sources: VerifiedSource[] = [];

  for (const assessment of output.sourceAssessments) {
    const source = byId.get(assessment.sourceId);
    if (!source || seen.has(source.id) || assessment.relationship === 'irrelevant') continue;
    seen.add(source.id);
    sources.push({
      id: source.id,
      title: source.title,
      url: source.url,
      domain: source.domain,
      excerpt: source.excerpts.join(' … '),
      relationship: assessment.relationship,
      relevance: assessment.relevance,
      explanation: clipText(assessment.explanation, 300),
      publishedAt: source.pageAge,
    });
  }

  const evaluation = guardSourceEvaluation(
    {
      verdict: output.verdict,
      confidence: output.confidence,
      whatSourcesSay: clipText(output.whatSourcesSay, MAX_FIELD),
      inference: clipText(output.inference, MAX_FIELD),
      uncertainty: clipText(output.uncertainty, MAX_FIELD),
      missingEvidence: output.missingEvidence
        .map((item) => clipText(item, 200))
        .filter(Boolean)
        .slice(0, 5),
      searchQueries: meta.searchQueries,
      model: meta.model,
    },
    sources,
  );

  return { sources, evaluation };
}

export type SourceEvaluator = (input: {
  claim: string;
  claimType: ClaimType;
  sources: DiscoveredSource[];
  searchQueries: string[];
}) => Promise<EvaluatedSources>;

export function createSourceEvaluator({
  client,
  model,
  now = () => new Date(),
}: {
  client: CreateClient;
  model: string;
  now?: () => Date;
}): SourceEvaluator {
  return async ({ claim, claimType, sources, searchQueries }) => {
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        output_config: {
          effort: 'medium',
          format: betaZodOutputFormat(SourceEvaluationOutputSchema),
        },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: EVALUATION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildEvaluationUserMessage(
              claim,
              claimType,
              sources,
              now().toISOString().slice(0, 10),
            ),
          },
        ],
      });
    } catch (error) {
      const mapped = mapAnthropicError(error);
      // A provider/credential failure is reported as such; anything else about the
      // evaluation step is "sources found but not evaluated".
      if (['not_configured', 'rate_limited', 'timeout'].includes(mapped.code)) throw mapped;
      throw new ApiError('evaluation_failed', mapped.message);
    }

    if (response.stop_reason === 'refusal') {
      throw new ApiError('model_refused', 'The AI model declined to evaluate these sources.');
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new ApiError('evaluation_failed', 'The AI returned an incomplete source evaluation.');
    }
    return mergeEvaluation(sources, response.parsed_output, {
      model: response.model,
      searchQueries,
    });
  };
}
