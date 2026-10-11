import { readServerEnv, warnAboutKeyProblem } from '@/server/env';
import { createSourceDiscoverer } from '@/server/evidence/discovery';
import { createSourceEvaluator } from '@/server/evidence/evaluation';
import { createEvidenceHandler } from '@/server/evidence/handler';
import { createProviderClient } from '@/server/provider-client';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
const env = readServerEnv();
warnAboutKeyProblem(env);

function createServices(apiKey: string) {
  // Web search plus evaluation can take a while; allow up to 90 s per provider call.
  const client = createProviderClient({ apiKey, timeout: 90_000 });
  return {
    discover: createSourceDiscoverer({ client, model: env.claimModel }),
    evaluate: createSourceEvaluator({ client, model: env.claimModel }),
  };
}

const handler = createEvidenceHandler({
  services: env.anthropicApiKey ? createServices(env.anthropicApiKey) : null,
  // Source checks cost more (web search + two model calls), so the limit is tighter.
  allowRequest: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
