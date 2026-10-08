import Anthropic from '@anthropic-ai/sdk';

import { readServerEnv } from '@/server/env';
import { createImageHandler } from '@/server/image/handler';
import { createVisionAnalyzer } from '@/server/image/vision-analyzer';
import { createRateLimiter } from '@/server/rate-limit';

// Server-only route: the API key is read here and never reaches the app bundle.
// Images are processed in memory for the duration of the request and never stored.
const env = readServerEnv();

const handler = createImageHandler({
  analyzer: env.anthropicApiKey
    ? createVisionAnalyzer({
        client: new Anthropic({ apiKey: env.anthropicApiKey, timeout: 60_000, maxRetries: 1 }),
        model: env.claimModel,
      })
    : null,
  allowRequest: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
});

export function POST(request: Request): Promise<Response> {
  return handler(request);
}
