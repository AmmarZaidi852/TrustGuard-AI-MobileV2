import { createAnthropicClaimAnalyzer } from '@/server/claim-analysis/anthropic-analyzer';
import { createClaimAnalysisHandler } from '@/server/claim-analysis/handler';
import { readServerEnv, warnAboutConfigProblem } from '@/server/env';
import { createAiProvider } from '@/server/provider-client';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
const env = readServerEnv();
warnAboutConfigProblem(env);

function createAnalyzer() {
  if (!env.ai) return null;
  const provider = createAiProvider(env.ai, { timeout: 50_000 });
  return createAnthropicClaimAnalyzer({
    apiKey: env.ai.apiKey,
    model: provider.model,
    client: provider.client,
    extras: provider.extras,
  });
}

const handler = createClaimAnalysisHandler({
  analyzer: createAnalyzer(),
  allowRequest: createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
