import Anthropic from '@anthropic-ai/sdk';

import type { AiProviderConfig, AiProviderName } from './env';

/**
 * The only host each provider's key may be sent to. OpenRouter is used through its
 * documented Anthropic-compatible Messages endpoint (`POST /api/v1/messages`), so
 * the same SDK, request shapes and response parsing serve both providers.
 */
export const PROVIDER_BASE_URLS: Record<AiProviderName, string> = {
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api',
};

/**
 * Provider-specific fields added to every Messages request.
 *
 * - Anthropic: retry safety-classifier refusals on a fallback model in the same call.
 * - OpenRouter: route only to Anthropic itself (no other upstream, no fallbacks), and
 *   only to an upstream that supports every parameter sent. By default OpenRouter
 *   silently drops unsupported parameters, which could remove structured outputs or
 *   the web search tool; with `require_parameters` the request fails instead.
 *   Anthropic's `fallbacks` option is not sent: OpenRouter uses a different format.
 */
export type RequestExtras =
  | { betas: ['server-side-fallback-2026-07-01']; fallbacks: 'default' }
  | {
      provider: {
        only: ['anthropic'];
        allow_fallbacks: false;
        require_parameters: true;
      };
    };

export const REQUEST_EXTRAS = {
  anthropic: { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
  openrouter: {
    provider: { only: ['anthropic'], allow_fallbacks: false, require_parameters: true },
  },
} satisfies Record<AiProviderName, RequestExtras>;

/** What the analyzers need: a client, the model id and the provider's request fields. */
export interface AiProvider {
  name: AiProviderName;
  client: Anthropic;
  model: string;
  extras: RequestExtras;
}

/**
 * Creates the provider client with everything security-relevant pinned. Without
 * this, the SDK silently reads `ANTHROPIC_BASE_URL` (send the key elsewhere),
 * `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` (send another credential) and
 * `ANTHROPIC_LOG` (debug logging of request bodies, i.e. user content and images)
 * from the environment.
 */
export function createProviderClient(
  { provider, apiKey }: Pick<AiProviderConfig, 'provider' | 'apiKey'>,
  {
    timeout,
    maxRetries = 1,
    fetch,
  }: {
    timeout: number;
    maxRetries?: number;
    /** Tests only. */
    fetch?: typeof globalThis.fetch;
  },
): Anthropic {
  const auth =
    provider === 'openrouter'
      ? // OpenRouter authenticates with a bearer token, never `x-api-key`.
        { apiKey: null, authToken: apiKey }
      : { apiKey, authToken: null };
  return new Anthropic({
    ...auth,
    baseURL: PROVIDER_BASE_URLS[provider],
    logLevel: 'warn',
    timeout,
    maxRetries,
    ...(fetch ? { fetch } : {}),
  });
}

export function createAiProvider(
  config: AiProviderConfig,
  options: Parameters<typeof createProviderClient>[1],
): AiProvider {
  return {
    name: config.provider,
    client: createProviderClient(config, options),
    model: config.model,
    extras: REQUEST_EXTRAS[config.provider],
  };
}
