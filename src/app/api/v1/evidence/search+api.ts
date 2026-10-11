import { readServerEnv, warnAboutConfigProblem } from '@/server/env';
import { createSourceDiscoverer } from '@/server/evidence/discovery';
import { createSourceEvaluator } from '@/server/evidence/evaluation';
import { createEvidenceHandler } from '@/server/evidence/handler';
import { createAiProvider } from '@/server/provider-client';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
const env = readServerEnv();
warnAboutConfigProblem(env);

function createServices() {
  if (!env.ai) return null;
  // Web search plus evaluation can take a while; allow up to 90 s per provider call.
  const { client, model, extras } = createAiProvider(env.ai, { timeout: 90_000 });
  return {
    discover: createSourceDiscoverer({ client, model, extras }),
    evaluate: createSourceEvaluator({ client, model, extras }),
  };
}

const handler = createEvidenceHandler({
  services: createServices(),
  // Source checks cost more (web search + two model calls), so the limit is tighter.
  allowRequest: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
