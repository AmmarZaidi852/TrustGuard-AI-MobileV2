import { readServerEnv, warnAboutConfigProblem } from '@/server/env';
import { createImageHandler } from '@/server/image/handler';
import { createVisionAnalyzer } from '@/server/image/vision-analyzer';
import { createAiProvider } from '@/server/provider-client';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
// Images are processed in memory for the duration of the request and never stored.
const env = readServerEnv();
warnAboutConfigProblem(env);

function createAnalyzer() {
  if (!env.ai) return null;
  const { client, model, extras } = createAiProvider(env.ai, { timeout: 60_000 });
  return createVisionAnalyzer({ client, model, extras });
}

const handler = createImageHandler({
  analyzer: createAnalyzer(),
  allowRequest: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
