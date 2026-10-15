/**
 * Server-only configuration. Never import this (or anything in `src/server`) from
 * app code: these values are read from the server environment and must not be
 * bundled into the iOS app. ESLint enforces the boundary.
 */

export type AiProviderName = 'anthropic' | 'openrouter';

export const AI_PROVIDERS: readonly AiProviderName[] = ['anthropic', 'openrouter'];

/** Default model per provider: the same Claude model, in each provider's naming. */
export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-opus-5-5',
  openrouter: 'anthropic/claude-opus-5.5',
};

/** Key prefix each provider issues. A key is only ever sent to the provider that issued it. */
const KEY_PREFIX: Record<AiProviderName, string> = {
  anthropic: 'sk-ant-',
  openrouter: 'sk-or-',
};

export interface AiProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  model: string;
}

/**
 * Why AI features are disabled although something was configured. Describes the
 * problem only; never carries the configured values.
 */
export type ConfigProblem =
  | 'invalid_provider'
  /** The key was issued by a different provider than the selected one. */
  | 'foreign_key'
  /** An OpenRouter key was put in ANTHROPIC_API_KEY instead of OPENROUTER_API_KEY. */
  | 'misplaced_key'
  /** The model is not a Claude model in the selected provider's naming. */
  | 'unsupported_model';

export interface ServerEnv {
  /** `null` when AI features are not (usably) configured. */
  ai: AiProviderConfig | null;
  problem: ConfigProblem | null;
}

type Env = Record<string, string | undefined>;

const value = (env: Env, name: string) => env[name]?.trim() || null;

function selectProvider(env: Env): AiProviderName | null {
  const explicit = value(env, 'TRUSTGUARD_AI_PROVIDER')?.toLowerCase();
  if (explicit)
    return AI_PROVIDERS.includes(explicit as AiProviderName) ? (explicit as AiProviderName) : null;
  // Without an explicit choice, use OpenRouter only when it is the sole key provided.
  return value(env, 'OPENROUTER_API_KEY') && !value(env, 'ANTHROPIC_API_KEY')
    ? 'openrouter'
    : 'anthropic';
}

function isSupportedModel(provider: AiProviderName, model: string): boolean {
  // Only Claude models: the analyzers depend on Claude-specific features
  // (structured outputs, the web search tool and its citations, vision).
  return provider === 'openrouter'
    ? /^anthropic\/claude-[a-z0-9.-]+$/i.test(model)
    : /^claude-[a-z0-9.-]+$/i.test(model);
}

export function readServerEnv(env: Env = process.env): ServerEnv {
  const provider = selectProvider(env);
  if (!provider) return { ai: null, problem: 'invalid_provider' };

  const keyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
  const apiKey = value(env, keyName);
  if (!apiKey) {
    const misplaced =
      provider === 'openrouter' &&
      value(env, 'ANTHROPIC_API_KEY')?.startsWith(KEY_PREFIX.openrouter);
    return { ai: null, problem: misplaced ? 'misplaced_key' : null };
  }
  if (!apiKey.startsWith(KEY_PREFIX[provider])) {
    // e.g. an OpenRouter key selected for Anthropic, or the reverse: never send it.
    return { ai: null, problem: 'foreign_key' };
  }

  const model = value(env, 'TRUSTGUARD_CLAIM_MODEL') ?? DEFAULT_MODELS[provider];
  if (!isSupportedModel(provider, model)) return { ai: null, problem: 'unsupported_model' };

  return { ai: { provider, apiKey, model }, problem: null };
}

const PROBLEM_MESSAGES: Record<ConfigProblem, string> = {
  invalid_provider: 'TRUSTGUARD_AI_PROVIDER must be "anthropic" or "openrouter".',
  foreign_key:
    'The API key does not belong to the selected provider, so it was not used ' +
    '(Anthropic keys start with sk-ant-, OpenRouter keys with sk-or-).',
  misplaced_key: 'ANTHROPIC_API_KEY holds an OpenRouter key. Set it as OPENROUTER_API_KEY instead.',
  unsupported_model:
    "TRUSTGUARD_CLAIM_MODEL must be a Claude model in the selected provider's naming " +
    '(e.g. claude-opus-5-5 for Anthropic, anthropic/claude-opus-5.5 for OpenRouter).',
};

/** Logs (once, at route start-up) why AI features are disabled. Never logs a key. */
export function warnAboutConfigProblem(
  env: ServerEnv,
  log = (message: string) => console.warn(message),
) {
  if (env.problem) log(`[config] ${PROBLEM_MESSAGES[env.problem]} AI features are disabled.`);
}
