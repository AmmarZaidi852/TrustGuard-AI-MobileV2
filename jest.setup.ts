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
const blocked = (what: string) => new Error(`Network access is blocked in tests (${what})`);
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: (input: unknown) => Promise.reject(blocked(String(input))),
});

// fetch is not the only way out: Node's built-in WebSocket and the http/https/net/tls
// modules could also reach the network if a test or dependency used them directly.
Object.defineProperty(globalThis, 'WebSocket', {
  configurable: true,
  writable: true,
  value: class BlockedWebSocket {
    constructor(url: unknown) {
      throw blocked(`WebSocket ${String(url)}`);
    }
  },
});
const OUTBOUND: Record<string, string[]> = {
  'node:http': ['request', 'get'],
  'node:https': ['request', 'get'],
  'node:net': ['connect', 'createConnection'],
  'node:tls': ['connect'],
};
for (const [moduleName, functions] of Object.entries(OUTBOUND)) {
  const loaded = require(moduleName) as Record<string, unknown>;
  for (const name of functions) {
    loaded[name] = () => {
      throw blocked(`${moduleName}.${name}`);
    };
  }
}
