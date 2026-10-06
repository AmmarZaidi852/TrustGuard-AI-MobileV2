/**
 * Server-only configuration. Never import this (or anything in `src/server`) from
 * app code: these values are read from the server environment and must not be
 * bundled into the iOS app. ESLint enforces the boundary.
 */

export const DEFAULT_CLAIM_MODEL = 'claude-opus-5-5';

export interface ServerEnv {
  anthropicApiKey: string | null;
  claimModel: string;
}

export function readServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    claimModel: env.TRUSTGUARD_CLAIM_MODEL?.trim() || DEFAULT_CLAIM_MODEL,
  };
}
