import { createAnthropicClaimAnalyzer } from '@/server/claim-analysis/anthropic-analyzer';
import { createClaimAnalysisHandler } from '@/server/claim-analysis/handler';
import { readServerEnv } from '@/server/env';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
const env = readServerEnv();

const handler = createClaimAnalysisHandler({
  analyzer: env.anthropicApiKey
    ? createAnthropicClaimAnalyzer({ apiKey: env.anthropicApiKey, model: env.claimModel })
    : null,
  allowRequest: createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
