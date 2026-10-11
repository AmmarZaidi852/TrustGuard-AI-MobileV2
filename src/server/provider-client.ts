import Anthropic from '@anthropic-ai/sdk';

/** The only host the API key may be sent to. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * Creates the provider client with everything security-relevant pinned. Without
 * this, the SDK silently reads `ANTHROPIC_BASE_URL` (send the key elsewhere),
 * `ANTHROPIC_AUTH_TOKEN` (send a second credential) and `ANTHROPIC_LOG` (debug
 * logging of request bodies, i.e. user content and images) from the environment.
 */
export function createProviderClient({
  apiKey,
  timeout,
  maxRetries = 1,
  fetch,
}: {
  apiKey: string;
  timeout: number;
  maxRetries?: number;
  /** Tests only. */
  fetch?: typeof globalThis.fetch;
}): Anthropic {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: ANTHROPIC_BASE_URL,
    logLevel: 'warn',
    timeout,
    maxRetries,
    ...(fetch ? { fetch } : {}),
  });
}
