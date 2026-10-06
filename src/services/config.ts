/**
 * Runtime configuration. Only *public* values belong here: `EXPO_PUBLIC_*`
 * variables are inlined into the app bundle. API keys for models and search
 * must live on the backend proxy, never in the client.
 */
function readApiBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

export const config = {
  apiBaseUrl: readApiBaseUrl(),
  requestTimeoutMs: 30_000,
} as const;
