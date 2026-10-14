jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Tests must never reach a real AI provider (live calls cost money). The developer's
// shell can hold a real key, so provider settings are removed from the test process,
// and any request that is not sent through a fetch the test injected is refused.
for (const name of [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_LOG',
  'OPENROUTER_API_KEY',
  'TRUSTGUARD_AI_PROVIDER',
  'TRUSTGUARD_CLAIM_MODEL',
]) {
  delete process.env[name];
}
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: (input: unknown) =>
    Promise.reject(new Error(`Network access is blocked in tests (${String(input)})`)),
});
