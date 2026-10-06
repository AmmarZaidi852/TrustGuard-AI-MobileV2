/**
 * @jest-environment node
 */
import Anthropic from '@anthropic-ai/sdk';

import {
  type ParseClient,
  createAnthropicClaimAnalyzer,
} from '../claim-analysis/anthropic-analyzer';
import { CLAIM_ANALYSIS_SYSTEM_PROMPT } from '../claim-analysis/prompt';
import type { ClaimAnalysisOutput } from '../claim-analysis/schema';

/** MOCK MODEL OUTPUT — test fixture only. */
const output: ClaimAnalysisOutput = {
  extractedClaim: 'Drinking coffee completely prevents cancer.',
  claimCategory: 'scientific_health',
  verifiable: true,
  verifiabilityNote: '',
  assessment: 'contradicted',
  confidence: 0.97,
  keyFindings: [
    {
      finding: 'Overstates a modest association',
      explanation: 'Studies show at most a modest association with some cancers.',
      direction: 'raises_concern',
      strength: 'strong',
      excerpt: 'completely prevents cancer',
    },
  ],
  reasoning: 'Research does not show complete prevention.',
  evidenceNeeded: ['Systematic reviews'],
  limitations: '',
};

function clientReturning(response: unknown): { client: ParseClient; parse: jest.Mock } {
  const parse = jest.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { parse } } } as unknown as ParseClient, parse };
}

function clientThrowing(error: unknown): ParseClient {
  return {
    beta: { messages: { parse: jest.fn().mockRejectedValue(error) } },
  } as unknown as ParseClient;
}

const request = { text: 'BREAKING: coffee completely prevents cancer!!', mode: 'text' as const };
const analyzerWith = (client: ParseClient) =>
  createAnthropicClaimAnalyzer({
    apiKey: 'test-key',
    model: 'claude-opus-5-5',
    client,
    now: () => new Date('2026-10-06T12:00:00Z'),
  });

describe('Anthropic claim analyzer', () => {
  it('sends a structured-output request and maps the parsed result', async () => {
    const { client, parse } = clientReturning({
      stop_reason: 'end_turn',
      parsed_output: output,
      model: 'claude-opus-5-5',
    });
    const result = await analyzerWith(client)(request);

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.system).toBe(CLAIM_ANALYSIS_SYSTEM_PROMPT);
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0].content).toContain('<content>\n' + request.text);
    expect(params.messages[0].content).toContain('2026-10-06');

    expect(result).toMatchObject({
      extractedClaim: output.extractedClaim,
      claimType: 'scientific_health',
      stance: 'contradicted',
      model: 'claude-opus-5-5',
    });
    // Over-confident model output is capped.
    expect(result.confidence).toBe(0.9);
    expect(result.indicators[0]).toMatchObject({ weight: 0.5, origin: 'model' });
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal', parsed_output: null }, 'model_refused'],
    [
      'truncated output',
      { stop_reason: 'max_tokens', parsed_output: null },
      'invalid_model_output',
    ],
    ['unparsed output', { stop_reason: 'end_turn', parsed_output: null }, 'invalid_model_output'],
  ])('rejects %s', async (_name, response, code) => {
    const { client } = clientReturning({ model: 'm', ...response });
    await expect(analyzerWith(client)(request)).rejects.toMatchObject({ code });
  });

  it.each([
    [
      'auth failure',
      new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers()),
      'not_configured',
    ],
    ['rate limit', new Anthropic.RateLimitError(429, {}, 'slow', new Headers()), 'rate_limited'],
    [
      'connection error',
      new Anthropic.APIConnectionError({ message: 'down' }),
      'model_unavailable',
    ],
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 'model_unavailable'],
    [
      'server error',
      new Anthropic.InternalServerError(500, {}, 'oops', new Headers()),
      'model_unavailable',
    ],
    [
      'malformed JSON from the model',
      new Anthropic.AnthropicError('bad json'),
      'invalid_model_output',
    ],
    ['unknown error', new Error('?'), 'internal'],
  ])('maps %s', async (_name, error, code) => {
    await expect(analyzerWith(clientThrowing(error))(request)).rejects.toMatchObject({ code });
  });
});

describe('claim analysis prompt', () => {
  it('treats submitted content as untrusted and separates unknown from false', () => {
    expect(CLAIM_ANALYSIS_SYSTEM_PROMPT).toMatch(/untrusted/);
    expect(CLAIM_ANALYSIS_SYSTEM_PROMPT).toMatch(/NOT evidence that it is false/);
    // Byte-stable so it can be cached: no dates in the system prompt.
    expect(CLAIM_ANALYSIS_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
