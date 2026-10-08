/**
 * Runtime configuration. Only *public* values belong here: `EXPO_PUBLIC_*`
 * variables are inlined into the app bundle. API keys for models and search
 * live on the backend (`src/server`), never in the client.
 */
function readApiBaseUrl(): string {
  // Empty = relative URLs. Expo Router sends those to the dev server in development
  // and to the `origin` configured in app.json in production builds.
  return (process.env.EXPO_PUBLIC_API_URL?.trim() ?? '').replace(/\/+$/, '');
}

export const config = {
  apiBaseUrl: readApiBaseUrl(),
  /** AI analysis typically takes 5–30 s; allow for slow mobile networks. */
  requestTimeoutMs: 60_000,
  /** Web search plus source evaluation: two provider calls of up to 90 s each server-side. */
  evidenceTimeoutMs: 150_000,
} as const;
