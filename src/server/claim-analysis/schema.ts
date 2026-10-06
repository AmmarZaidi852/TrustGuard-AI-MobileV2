import { z } from 'zod';

import { normalizeModelAnalysis } from '@/core/model/model-analysis';
import type { ModelClaimAnalysis } from '@/core/types';

/**
 * Structured-output schema the model must follow. Kept to features supported by
 * JSON-schema structured outputs (no numeric bounds) — ranges are enforced by
 * `normalizeModelAnalysis` instead.
 */
export const ClaimAnalysisOutputSchema = z.object({
  extractedClaim: z.string(),
  claimCategory: z.enum([
    'factual',
    'statistical',
    'scientific_health',
    'event_news',
    'quote_attribution',
    'opinion',
    'prediction',
    'unknown',
  ]),
  verifiable: z.boolean(),
  verifiabilityNote: z.string(),
  assessment: z.enum(['supported', 'contradicted', 'disputed', 'unverifiable']),
  confidence: z.number(),
  keyFindings: z.array(
    z.object({
      finding: z.string(),
      explanation: z.string(),
      direction: z.enum(['raises_concern', 'supports_reliability']),
      strength: z.enum(['weak', 'moderate', 'strong']),
      excerpt: z.string(),
    }),
  ),
  reasoning: z.string(),
  evidenceNeeded: z.array(z.string()),
  limitations: z.string(),
});

export type ClaimAnalysisOutput = z.infer<typeof ClaimAnalysisOutputSchema>;

const STRENGTH_WEIGHT = { weak: 0.15, moderate: 0.3, strong: 0.5 } as const;

export function toModelClaimAnalysis(
  output: ClaimAnalysisOutput,
  model: string,
): ModelClaimAnalysis {
  return normalizeModelAnalysis({
    extractedClaim: output.extractedClaim,
    claimType: output.claimCategory,
    verifiable: output.verifiable,
    verifiabilityNote: output.verifiabilityNote,
    stance: output.assessment,
    confidence: output.confidence,
    reasoning: output.reasoning,
    indicators: output.keyFindings.map((finding, index) => ({
      id: `model_${index}`,
      label: finding.finding,
      description: finding.explanation,
      direction: finding.direction,
      weight: STRENGTH_WEIGHT[finding.strength],
      origin: 'model',
      excerpt: finding.excerpt || undefined,
    })),
    evidenceNeeded: output.evidenceNeeded,
    limitations: output.limitations,
    model,
  });
}
