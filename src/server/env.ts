/**
 * Server-only configuration. Never import this (or anything in `src/server`) from
 * app code: these values are read from the server environment and must not be
 * bundled into the iOS app. ESLint enforces the boundary.
 */

export const DEFAULT_CLAIM_MODEL = 'claude-opus-5-5';

export interface ServerEnv {
  /** `null` when missing, or when the key belongs to another provider. */
  anthropicApiKey: string | null;
  /** Why `anthropicApiKey` is `null` despite a value being set (never the value itself). */
  keyProblem: 'foreign_key' | null;
  claimModel: string;
}

/**
 * Key prefixes of other providers. Such a key must never be sent to Anthropic: that
 * would disclose a credential to a third party for no benefit.
 */
const FOREIGN_KEY_PREFIXES = ['sk-or-'];

export function readServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const key = env.ANTHROPIC_API_KEY?.trim() || null;
  const foreign = key !== null && FOREIGN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  return {
    anthropicApiKey: foreign ? null : key,
    keyProblem: foreign ? 'foreign_key' : null,
    claimModel: env.TRUSTGUARD_CLAIM_MODEL?.trim() || DEFAULT_CLAIM_MODEL,
  };
}

/** Logs (once, at route start-up) why a configured key is not used. Never logs the key. */
export function warnAboutKeyProblem(
  env: ServerEnv,
  log = (message: string) => console.warn(message),
) {
  if (env.keyProblem === 'foreign_key') {
    log(
      '[config] ANTHROPIC_API_KEY holds a key for another provider (OpenRouter format). ' +
        'It was not used, and AI features are disabled.',
    );
  }
}
