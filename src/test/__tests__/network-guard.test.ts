/**
 * The test setup (`jest.setup.ts`) must stop every route to the network, not only
 * `fetch`, so no test can reach a live (paid) AI provider. Runs in the app's default
 * test environment; the server suites check the same for `fetch` under `node`.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const BLOCKED = /Network access is blocked in tests/;
// A closed local port: even if the guard failed, nothing would leave this machine.
const LOCAL = 'http://127.0.0.1:9/v1/messages';

describe('network guard', () => {
  it('refuses fetch', async () => {
    await expect(fetch(LOCAL)).rejects.toThrow(BLOCKED);
  });

  it('refuses WebSocket', () => {
    expect(() => new WebSocket('ws://127.0.0.1:9')).toThrow(BLOCKED);
  });

  it.each([
    ['http.request', () => http.request(LOCAL)],
    ['http.get', () => http.get(LOCAL)],
    ['https.request', () => https.request('https://127.0.0.1:9')],
    ['https.get', () => https.get('https://127.0.0.1:9')],
    ['net.connect', () => net.connect(9, '127.0.0.1')],
    ['net.createConnection', () => net.createConnection(9, '127.0.0.1')],
    ['tls.connect', () => tls.connect(9, '127.0.0.1')],
  ])('refuses %s', (_name, open) => {
    expect(open).toThrow(BLOCKED);
  });

  it('hides provider credentials and settings from tests', () => {
    for (const name of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'OPENROUTER_API_KEY',
      'TRUSTGUARD_AI_PROVIDER',
      'TRUSTGUARD_CLAIM_MODEL',
    ]) {
      expect(process.env[name]).toBeUndefined();
    }
  });
});
