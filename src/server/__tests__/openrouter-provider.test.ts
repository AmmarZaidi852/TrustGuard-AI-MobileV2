/**
 * @jest-environment node
 */
/**
 * OpenRouter provider, end to end against a FIXTURE NETWORK:
 *
 *   readServerEnv → createAiProvider → analyzers / real API route modules
 *     → real Anthropic SDK → fixture fetch (deterministic OpenRouter-shaped replies)
 *
 * Nothing here can reach the network: every client gets the fixture fetch, the
 * global fetch is blocked (jest.setup.ts) or replaced by the fixture, and the keys
 * are synthetic. Passing these tests proves how the code builds requests and handles
 * responses; it does NOT prove that the live OpenRouter endpoint accepts these
 * requests or replies in these shapes.
 */
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

import { IMAGE_BYTES } from '@/test/fixtures';

import { createAnthropicClaimAnalyzer } from '../claim-analysis/anthropic-analyzer';
import { CLAIM_ANALYSIS_SYSTEM_PROMPT } from '../claim-analysis/prompt';
import { type ClaimAnalysisOutput, ClaimAnalysisOutputSchema } from '../claim-analysis/schema';
import { readServerEnv } from '../env';
import {
  DISCOVERY_LIMITS,
  createSourceDiscoverer,
  extractDiscoveredSources,
} from '../evidence/discovery';
import {
  type SourceEvaluationOutput,
  SourceEvaluationOutputSchema,
  createSourceEvaluator,
} from '../evidence/evaluation';
import {
  BLOCKED_SEARCH_DOMAINS,
  DISCOVERY_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
} from '../evidence/prompts';
import {
  type ImageAnalysisOutput,
  ImageAnalysisOutputSchema,
  VISION_SYSTEM_PROMPT,
  createVisionAnalyzer,
} from '../image/vision-analyzer';
import { createAiProvider } from '../provider-client';

/* ------------------------------------------------------------------------------------------ */
/* Fixtures                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Synthetic key, built at runtime so secret scanners never see a key-shaped literal. */
const FAKE_KEY = ['sk', 'or', 'v1', '5'.repeat(64)].join('-');
const OPENROUTER_ENV = { TRUSTGUARD_AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: FAKE_KEY };
const OR_MODEL = 'anthropic/claude-opus-5.5';
const ENDPOINT = 'https://openrouter.ai/api/v1/messages?beta=true';
const ROUTING = { only: ['anthropic'], allow_fallbacks: false, require_parameters: true };

const CLAIM = 'Drinking coffee completely prevents cancer.';
const NCI = 'https://www.cancer.gov/about-cancer/causes-prevention/risk/diet/coffee';
const WHO = 'https://www.who.int/news-room/fact-sheets/detail/cancer';
const CITED = 'There is no evidence that drinking coffee prevents cancer.';
const now = () => new Date('2026-10-14');

type Step = 'claim' | 'discovery' | 'evaluation' | 'vision';
type Reply = { status?: number; json: unknown } | { status?: number; raw: string };
// Request bodies are JSON chosen by the code under test; tests read arbitrary fields.
type Body = Record<string, any>;

interface Sent {
  step: Step;
  url: string;
  method: string;
  headers: Headers;
  body: Body;
}

const STEP_BY_SYSTEM: Record<string, Step> = {
  [CLAIM_ANALYSIS_SYSTEM_PROMPT]: 'claim',
  [DISCOVERY_SYSTEM_PROMPT]: 'discovery',
  [EVALUATION_SYSTEM_PROMPT]: 'evaluation',
  [VISION_SYSTEM_PROMPT]: 'vision',
};

/**
 * Deterministic stand-in for openrouter.ai. Records every request and answers each
 * step with its queued replies; anything unexpected fails the test instead of
 * going anywhere.
 */
function fixtureNetwork(replies: Partial<Record<Step, Reply | Reply[]>>) {
  const sent: Sent[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://openrouter.ai/api/')) throw new Error(`Unexpected host: ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Body;
    const step = STEP_BY_SYSTEM[body.system];
    if (!step) throw new Error('Unknown request sent to the provider');
    sent.push({
      step,
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    });

    const queued = replies[step];
    const reply = Array.isArray(queued) ? queued.shift() : queued;
    if (!reply) throw new Error(`No fixture reply for ${step}`);
    const status = reply.status ?? 200;
    const headers = {
      'content-type': 'application/json',
      // Errors are final: the SDK must not retry (and wait) on fixture failures.
      ...(status >= 400 ? { 'x-should-retry': 'false' } : {}),
    };
    return new Response('raw' in reply ? reply.raw : JSON.stringify(reply.json), {
      status,
      headers,
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, sent };
}

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'gen-fixture',
  type: 'message',
  role: 'assistant',
  model: OR_MODEL,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});
const structured = (output: unknown, stop_reason = 'end_turn'): Reply => ({
  json: message([{ type: 'text', text: JSON.stringify(output) }], stop_reason),
});
/** OpenRouter's error body: `{ error: { code, message, metadata? } }`. */
const orError = (status: number, text: string, metadata?: Record<string, unknown>): Reply => ({
  status,
  json: { error: { code: status, message: text, ...(metadata ? { metadata } : {}) } },
});

const claimOutput = (patch: Partial<ClaimAnalysisOutput> = {}): ClaimAnalysisOutput => ({
  extractedClaim: CLAIM,
  claimCategory: 'scientific_health',
  verifiable: true,
  verifiabilityNote: '',
  assessment: 'contradicted',
  confidence: 0.7,
  keyFindings: [],
  reasoning: 'Fixture reasoning.',
  evidenceNeeded: [],
  limitations: '',
  ...patch,
});
const evaluationOutput = (patch: Partial<SourceEvaluationOutput> = {}): SourceEvaluationOutput => ({
  sourceAssessments: [
    { sourceId: 'S1', relationship: 'contradicts', relevance: 'high', explanation: 'Fixture.' },
  ],
  verdict: 'contradicted',
  confidence: 0.8,
  whatSourcesSay: 'Fixture.',
  inference: 'Fixture.',
  uncertainty: 'Fixture.',
  missingEvidence: [],
  ...patch,
});
const visionOutput = (patch: Partial<ImageAnalysisOutput> = {}): ImageAnalysisOutput => ({
  imageKind: 'social_post_screenshot',
  description: 'A screenshot of a post.',
  visibleText: CLAIM,
  readability: 'clear',
  claims: [
    {
      text: CLAIM,
      quote: 'Drinking coffee completely prevents cancer',
      isFactual: true,
      claimType: 'scientific_health',
      readability: 'clear',
      context: '',
    },
  ],
  primaryClaimIndex: 0,
  containsInstructions: false,
  uncertainty: '',
  ...patch,
});

/* Web search content blocks, in Anthropic's shape (as OpenRouter is expected to relay them). */

const searchUse = (query = 'coffee cancer prevention evidence', id = 'srvtoolu_1') => ({
  type: 'server_tool_use',
  id,
  name: 'web_search',
  input: { query },
});
const results = (urls: string[], { id = 'srvtoolu_1', pageAge = null as string | null } = {}) => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: urls.map((url) => ({
    type: 'web_search_result',
    url,
    title: `Result title for ${new URL(url).hostname}`,
    encrypted_content: 'opaque',
    page_age: pageAge,
  })),
});
const cite = (url: string, cited_text: unknown, title = 'Cited page title') => ({
  type: 'web_search_result_location',
  url,
  title,
  cited_text,
  encrypted_index: 'opaque',
});
const citedText = (text: string, citations: unknown[]) => ({ type: 'text', text, citations });
const discoveryReply = (...content: unknown[]): Reply => ({ json: message(content) });
const goodDiscovery = () =>
  discoveryReply(searchUse(), results([NCI]), citedText('NCI says:', [cite(NCI, CITED)]));

const REQUEST_IMAGE = { image: IMAGE_BYTES.png, mediaType: 'image/png' as const };

/** The four analyzers, wired exactly as the routes wire them, but with the fixture fetch. */
function openRouter(network: ReturnType<typeof fixtureNetwork>, env: Record<string, string> = {}) {
  const config = readServerEnv({ ...OPENROUTER_ENV, ...env }).ai;
  if (!config) throw new Error('Fixture environment did not configure OpenRouter');
  const { client, model, extras } = createAiProvider(config, {
    timeout: 2000,
    maxRetries: 0,
    fetch: network.fetchImpl,
  });
  return {
    claim: createAnthropicClaimAnalyzer({ apiKey: config.apiKey, model, client, extras, now }),
    discover: createSourceDiscoverer({ client, model, extras, now }),
    evaluate: createSourceEvaluator({ client, model, extras, now }),
    vision: createVisionAnalyzer({ client, model, extras }),
  };
}

const allSuccessful = () =>
  fixtureNetwork({
    claim: structured(claimOutput()),
    discovery: goodDiscovery(),
    evaluation: structured(evaluationOutput()),
    vision: structured(visionOutput()),
  });

async function runAllSteps(network: ReturnType<typeof fixtureNetwork>, env = {}) {
  const ai = openRouter(network, env);
  await ai.claim({ text: CLAIM, mode: 'claim' });
  const found = await ai.discover({ claim: CLAIM, claimType: 'scientific_health' });
  await ai.evaluate({
    claim: CLAIM,
    claimType: 'scientific_health',
    sources: found.sources,
    searchQueries: found.queries,
  });
  await ai.vision(REQUEST_IMAGE);
  return network.sent;
}

/** What the SDK serializes for a Zod structured-output format. */
const wireFormat = (schema: z.ZodType) => JSON.parse(JSON.stringify(betaZodOutputFormat(schema)));

/* ------------------------------------------------------------------------------------------ */
/* 1. Request construction                                                                     */
/* ------------------------------------------------------------------------------------------ */

describe('OpenRouter request construction', () => {
  it('sends every step to the Anthropic-compatible endpoint with bearer auth only', async () => {
    const sent = await runAllSteps(allSuccessful());

    expect(sent.map((request) => request.step)).toEqual([
      'claim',
      'discovery',
      'evaluation',
      'vision',
    ]);
    for (const request of sent) {
      expect(request.method).toBe('POST');
      expect(request.url).toBe(ENDPOINT);
      expect(request.headers.get('authorization')).toBe(`Bearer ${FAKE_KEY}`);
      expect(request.headers.get('x-api-key')).toBeNull();
      expect(request.headers.get('anthropic-version')).toBeTruthy();
      expect(request.headers.get('content-type')).toContain('application/json');
    }
  });

  it('pins routing to Anthropic with require_parameters: true on every step', async () => {
    const sent = await runAllSteps(allSuccessful());

    for (const request of sent) {
      expect(request.body.provider).toEqual(ROUTING);
      // Anthropic-only options are not sent: OpenRouter uses its own formats.
      expect(request.body).not.toHaveProperty('fallbacks');
      expect(request.body).not.toHaveProperty('betas');
      expect(request.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    }
  });

  it("uses OpenRouter's model id by default and a validated override when set", async () => {
    const defaults = await runAllSteps(allSuccessful());
    expect(new Set(defaults.map((request) => request.body.model))).toEqual(new Set([OR_MODEL]));

    const override = await runAllSteps(allSuccessful(), {
      TRUSTGUARD_CLAIM_MODEL: 'anthropic/claude-sonnet-5.5',
    });
    expect(new Set(override.map((request) => request.body.model))).toEqual(
      new Set(['anthropic/claude-sonnet-5.5']),
    );
  });

  it('never streams, and keeps the per-step token budgets', async () => {
    const sent = await runAllSteps(allSuccessful());
    expect(
      Object.fromEntries(sent.map((request) => [request.step, request.body.max_tokens])),
    ).toEqual({ claim: 16000, discovery: 8000, evaluation: 16000, vision: 16000 });
    for (const request of sent) expect(request.body.stream ?? false).toBe(false);
  });

  it('builds identical requests for identical input (deterministic)', async () => {
    const strip = (sent: Sent[]) => sent.map(({ step, url, body }) => ({ step, url, body }));
    expect(strip(await runAllSteps(allSuccessful()))).toEqual(
      strip(await runAllSteps(allSuccessful())),
    );
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 2. Structured outputs and effort                                                            */
/* ------------------------------------------------------------------------------------------ */

describe('OpenRouter structured outputs and effort', () => {
  it.each([
    ['claim', ClaimAnalysisOutputSchema],
    ['evaluation', SourceEvaluationOutputSchema],
    ['vision', ImageAnalysisOutputSchema],
  ] as const)('%s: effort "medium" and the exact JSON schema', async (step, schema) => {
    const sent = await runAllSteps(allSuccessful());
    const request = sent.find((r) => r.step === step)!;

    expect(request.body.output_config).toEqual({ effort: 'medium', format: wireFormat(schema) });
    expect(request.body.output_config.format.type).toBe('json_schema');
    // Every field the app relies on is required by the schema the provider must enforce.
    expect([...request.body.output_config.format.schema.required].sort()).toEqual(
      Object.keys(schema.shape).sort(),
    );
  });

  it('discovery: effort "low", no output format, and only the restricted web search tool', async () => {
    const sent = await runAllSteps(allSuccessful());
    const request = sent.find((r) => r.step === 'discovery')!;

    expect(request.body.output_config).toEqual({ effort: 'low' });
    expect(request.body.tools).toEqual([
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: DISCOVERY_LIMITS.maxSearches,
        blocked_domains: BLOCKED_SEARCH_DOMAINS,
      },
    ]);
  });

  it('parses structured replies into results, keeping the model id the provider reports', async () => {
    const ai = openRouter(allSuccessful());

    const claim = await ai.claim({ text: CLAIM, mode: 'claim' });
    expect(claim).toMatchObject({ extractedClaim: CLAIM, model: OR_MODEL });

    const reading = await ai.vision(REQUEST_IMAGE);
    expect(reading).toMatchObject({ visibleText: CLAIM, model: OR_MODEL, primaryClaimIndex: 0 });
    expect(reading.claims[0]).toMatchObject({ text: CLAIM, grounded: true, checkable: true });
  });

  const STRUCTURED_STEPS = [
    ['claim', (ai: ReturnType<typeof openRouter>) => ai.claim({ text: CLAIM, mode: 'claim' })],
    [
      'evaluation',
      (ai: ReturnType<typeof openRouter>) =>
        ai.evaluate({
          claim: CLAIM,
          claimType: 'scientific_health',
          sources: [{ id: 'S1', title: 'NCI', url: NCI, domain: 'cancer.gov', excerpts: [CITED] }],
          searchQueries: [],
        }),
    ],
    ['vision', (ai: ReturnType<typeof openRouter>) => ai.vision(REQUEST_IMAGE)],
  ] as const;
  const MALFORMED_CODE = {
    claim: 'invalid_model_output',
    evaluation: 'evaluation_failed',
    vision: 'invalid_model_output',
  };

  it.each(STRUCTURED_STEPS)(
    '%s: output that violates the schema is rejected',
    async (step, run) => {
      const network = fixtureNetwork({ [step]: structured({ verdict: 'definitely_true' }) });
      await expect(run(openRouter(network))).rejects.toMatchObject({ code: MALFORMED_CODE[step] });
    },
  );

  it.each(STRUCTURED_STEPS)(
    '%s: a parameter the upstream does not support fails the request instead of being dropped',
    async (step, run) => {
      // With require_parameters, OpenRouter answers 404 when no endpoint supports every
      // parameter sent (e.g. structured outputs or effort), instead of silently dropping it.
      const network = fixtureNetwork({
        [step]: orError(404, 'No endpoints found that can handle the requested parameters.'),
      });
      await expect(run(openRouter(network))).rejects.toMatchObject({
        code: step === 'evaluation' ? 'evaluation_failed' : 'model_unavailable',
      });
    },
  );

  it('discovery: an unsupported tool parameter fails the search, never "found nothing"', async () => {
    const network = fixtureNetwork({
      discovery: orError(400, 'web_search_20260209: unsupported parameter blocked_domains'),
    });
    await expect(
      openRouter(network).discover({ claim: CLAIM, claimType: 'scientific_health' }),
    ).rejects.toMatchObject({ code: 'model_unavailable' });
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 3. Web search citations (cited_text)                                                         */
/* ------------------------------------------------------------------------------------------ */

describe('OpenRouter web search citation parsing', () => {
  it('turns a cited_text citation into a source with that exact excerpt', () => {
    const extracted = extractDiscoveredSources([
      searchUse(),
      results([NCI], { pageAge: 'March 3, 2025' }),
      citedText('The NCI says', [cite(NCI, `  ${CITED}\n`, 'Coffee and Cancer - NCI')]),
    ]);
    expect(extracted).toMatchObject({
      sources: [
        {
          id: 'S1',
          url: NCI,
          domain: 'cancer.gov',
          title: 'Coffee and Cancer - NCI',
          excerpts: [CITED],
          pageAge: 'March 3, 2025',
        },
      ],
      queries: ['coffee cancer prevention evidence'],
      rejected: 0,
      successfulSearches: 1,
    });
  });

  it('falls back to the search result title when the citation has none', () => {
    const { sources } = extractDiscoveredSources([
      searchUse(),
      results([NCI]),
      citedText('x', [cite(NCI, CITED, '')]),
    ]);
    expect(sources[0].title).toBe('Result title for www.cancer.gov');
  });

  it('clips a long cited_text to the excerpt limit', () => {
    const long = `${'Coffee research summary. '.repeat(40)}END`;
    const { sources } = extractDiscoveredSources([
      searchUse(),
      results([NCI]),
      citedText('x', [cite(NCI, long)]),
    ]);
    const [excerpt] = sources[0].excerpts;
    expect(excerpt.length).toBeLessThanOrEqual(DISCOVERY_LIMITS.maxExcerptLength);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(long.startsWith(excerpt.slice(0, -1))).toBe(true);
  });

  it('collects distinct excerpts per page across text blocks, up to the limit', () => {
    const { sources } = extractDiscoveredSources([
      searchUse(),
      results([NCI, WHO]),
      citedText('First,', [cite(NCI, 'Excerpt one.'), cite(WHO, 'WHO excerpt.')]),
      citedText('then', [cite(NCI, 'Excerpt one.'), cite(NCI, 'Excerpt two.')]),
      citedText('and', [cite(NCI, 'Excerpt three.')]),
    ]);
    const byUrl = Object.fromEntries(sources.map((source) => [source.url, source.excerpts]));
    expect(byUrl[NCI]).toEqual(['Excerpt one.', 'Excerpt two.']);
    expect(byUrl[WHO]).toEqual(['WHO excerpt.']);
    expect(byUrl[NCI]).toHaveLength(DISCOVERY_LIMITS.maxExcerptsPerSource);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \n\t '],
    ['not a string', { text: CITED }],
    ['missing', undefined],
  ])('rejects a citation whose cited_text is %s', (_name, value) => {
    const extracted = extractDiscoveredSources([
      searchUse(),
      results([NCI]),
      citedText('x', [cite(NCI, value)]),
    ]);
    expect(extracted.sources).toHaveLength(0);
    expect(extracted.rejected).toBe(1);
  });

  it('rejects a blocked domain even when the search returned it', () => {
    const blocked = `https://${BLOCKED_SEARCH_DOMAINS[0]}/post/123`;
    const extracted = extractDiscoveredSources([
      searchUse(),
      results([blocked]),
      citedText('x', [cite(blocked, 'Coffee prevents cancer, trust me.')]),
    ]);
    expect(extracted.sources).toHaveLength(0);
    expect(extracted.rejected).toBe(1);
  });

  it('follows a pause_turn continuation over OpenRouter and keeps the routing', async () => {
    const network = fixtureNetwork({
      discovery: [
        { json: message([searchUse(), results([NCI])], 'pause_turn') },
        discoveryReply(citedText('NCI:', [cite(NCI, CITED)])),
      ],
    });
    const found = await openRouter(network).discover({
      claim: CLAIM,
      claimType: 'scientific_health',
    });

    expect(found.sources).toMatchObject([{ url: NCI, excerpts: [CITED] }]);
    expect(network.sent).toHaveLength(2);
    const [, second] = network.sent;
    expect(second.body.provider).toEqual(ROUTING);
    // The paused turn is sent back unchanged so the server-side search can resume.
    expect(second.body.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'server_tool_use' }, { type: 'web_search_tool_result' }],
    });
  });

  it.each([
    ['a well-formed error code', 'max_uses_exceeded', /max_uses_exceeded/],
    ['a malformed error code', 'Bad <code>', /unknown/],
  ])('a search tool error with %s → search_unavailable', async (_name, errorCode, message) => {
    const network = fixtureNetwork({
      discovery: discoveryReply(searchUse(), {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: { type: 'web_search_tool_result_error', error_code: errorCode },
      }),
    });
    const error = await openRouter(network)
      .discover({ claim: CLAIM, claimType: 'scientific_health' })
      .catch((e: { code: string; message: string }) => e);
    expect(error).toMatchObject({ code: 'search_unavailable' });
    expect((error as { message: string }).message).toMatch(message);
    expect((error as { message: string }).message).not.toContain('<code>');
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 4. The real API route modules, configured for OpenRouter                                     */
/* ------------------------------------------------------------------------------------------ */

const ROUTES = {
  claims: {
    path: '../../app/api/v1/claims/analyze+api',
    body: { text: CLAIM, mode: 'claim' },
  },
  evidence: {
    path: '../../app/api/v1/evidence/search+api',
    body: { claim: CLAIM, claimType: 'scientific_health' },
  },
  images: {
    path: '../../app/api/v1/images/analyze+api',
    body: REQUEST_IMAGE,
  },
} as const;
type RouteName = keyof typeof ROUTES;

describe('API routes with OpenRouter configured (fixture network)', () => {
  const saved = { ...process.env };
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...saved, ...OPENROUTER_ENV };
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warnLog = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    // Nothing key-shaped may reach logs, whatever the test did.
    const logged = [...errorLog.mock.calls, ...warnLog.mock.calls].flat().map(String).join('\n');
    process.env = { ...saved };
    errorLog.mockRestore();
    warnLog.mockRestore();
    expect(logged).not.toMatch(/sk-or-|sk-ant-/);
  });

  /** Loads a fresh route module (fresh env, client and rate limiter) and calls it once. */
  async function callRoute(name: RouteName, replies: Partial<Record<Step, Reply | Reply[]>>) {
    const network = fixtureNetwork(replies);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(network.fetchImpl);
    try {
      let route: { POST: (request: Request) => Promise<Response> } | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        route = require(ROUTES[name].path);
      });
      const response = await route!.POST(
        new Request('http://localhost/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ROUTES[name].body),
        }),
      );
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text) as Body, text, sent: network.sent };
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it('claims: a successful analysis, from one OpenRouter request', async () => {
    const { status, body, sent } = await callRoute('claims', {
      claim: structured(claimOutput()),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ extractedClaim: CLAIM, model: OR_MODEL });
    expect(sent.map((request) => request.step)).toEqual(['claim']);
    expect(sent[0]).toMatchObject({ url: ENDPOINT, body: { model: OR_MODEL, provider: ROUTING } });
    expect(warnLog).not.toHaveBeenCalled();
  });

  it('evidence: sources carry the provider cited_text, then are evaluated', async () => {
    const { status, body, sent } = await callRoute('evidence', {
      discovery: goodDiscovery(),
      evaluation: structured(evaluationOutput()),
    });
    expect(status).toBe(200);
    expect(body.sources).toEqual([
      expect.objectContaining({
        id: 'S1',
        url: NCI,
        domain: 'cancer.gov',
        excerpt: CITED,
        relationship: 'contradicts',
      }),
    ]);
    expect(body.evaluation).toMatchObject({ verdict: 'contradicted', model: OR_MODEL });
    expect(body.rejectedSources).toBe(0);
    expect(sent.map((request) => request.step)).toEqual(['discovery', 'evaluation']);
    for (const request of sent) expect(request.body.provider).toEqual(ROUTING);
  });

  it('evidence: a search with no usable citations returns no sources and no verdict', async () => {
    const { status, body, sent } = await callRoute('evidence', {
      discovery: discoveryReply(
        searchUse(),
        results([NCI]),
        citedText(`Coffee prevents cancer, see ${NCI}`, [cite(WHO, 'Not in the results.')]),
      ),
    });
    expect(status).toBe(200);
    expect(body).toEqual({ sources: [], evaluation: null, rejectedSources: 1 });
    expect(sent.map((request) => request.step)).toEqual(['discovery']);
  });

  it('images: a successful reading, from one OpenRouter request with the image block', async () => {
    const { status, body, sent } = await callRoute('images', {
      vision: structured(visionOutput()),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ visibleText: CLAIM, model: OR_MODEL });
    expect(sent.map((request) => request.step)).toEqual(['vision']);
    expect(sent[0].body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: IMAGE_BYTES.png },
    });
  });

  const FIRST_STEP: Record<RouteName, Step> = {
    claims: 'claim',
    evidence: 'discovery',
    images: 'vision',
  };
  const keyEcho = `Invalid key ${FAKE_KEY}`;

  /** [failure, reply, expected status/code per route] */
  const failures: [string, Reply, Record<RouteName, [number, string]>][] = [
    [
      'invalid key (401)',
      orError(401, keyEcho),
      {
        claims: [503, 'not_configured'],
        evidence: [503, 'not_configured'],
        images: [503, 'not_configured'],
      },
    ],
    [
      'insufficient credits (402)',
      orError(402, `Insufficient credits for ${FAKE_KEY}`),
      {
        claims: [503, 'provider_billing'],
        evidence: [503, 'provider_billing'],
        images: [503, 'provider_billing'],
      },
    ],
    [
      'moderation block (403)',
      orError(403, 'Input was flagged by moderation', {
        reasons: ['fixture'],
        flagged_input: CLAIM,
      }),
      {
        claims: [422, 'content_blocked'],
        evidence: [422, 'content_blocked'],
        images: [422, 'content_blocked'],
      },
    ],
    [
      'no endpoint supports the parameters (404, require_parameters)',
      orError(404, 'No endpoints found that can handle the requested parameters.'),
      {
        claims: [502, 'model_unavailable'],
        evidence: [502, 'model_unavailable'],
        images: [502, 'model_unavailable'],
      },
    ],
    [
      'rate limit (429)',
      orError(429, 'Rate limit exceeded'),
      {
        claims: [429, 'rate_limited'],
        evidence: [429, 'rate_limited'],
        images: [429, 'rate_limited'],
      },
    ],
    [
      'upstream error (502)',
      orError(502, 'Provider returned error'),
      {
        claims: [502, 'model_unavailable'],
        evidence: [502, 'model_unavailable'],
        images: [502, 'model_unavailable'],
      },
    ],
    [
      'an error body with HTTP 200',
      { json: { error: { code: 502, message: `Upstream failed (${FAKE_KEY})` } } },
      {
        claims: [502, 'invalid_model_output'],
        evidence: [503, 'search_unavailable'],
        images: [502, 'invalid_model_output'],
      },
    ],
    [
      'a non-JSON body with HTTP 200',
      { raw: '<html>gateway</html>' },
      {
        claims: [502, 'invalid_model_output'],
        evidence: [502, 'invalid_model_output'],
        images: [502, 'invalid_model_output'],
      },
    ],
    [
      'a refusal',
      { json: message([], 'refusal') },
      {
        claims: [422, 'model_refused'],
        evidence: [422, 'model_refused'],
        images: [422, 'model_refused'],
      },
    ],
  ];

  describe.each(Object.keys(ROUTES) as RouteName[])('%s route', (name) => {
    it.each(failures)(
      '%s → an error response, never a result, and no key anywhere',
      async (_failure, reply, expected) => {
        const { status, body, text, sent } = await callRoute(name, { [FIRST_STEP[name]]: reply });

        expect([status, body.error?.code]).toEqual(expected[name]);
        expect(Object.keys(body)).toEqual(['error']);
        expect(text).not.toContain(FAKE_KEY);
        expect(text).not.toMatch(/sk-or-|flagged_input|fixture/);
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe(ENDPOINT);
      },
    );
  });

  it.each([
    ['insufficient credits (402)', orError(402, 'Insufficient credits'), 503, 'provider_billing'],
    [
      'moderation block (403)',
      orError(403, 'Request blocked by guardrail'),
      422,
      'content_blocked',
    ],
    ['schema violation', structured({ verdict: 'definitely_true' }), 502, 'evaluation_failed'],
    ['upstream error (502)', orError(502, 'Provider returned error'), 502, 'evaluation_failed'],
  ])(
    'evidence: a failed evaluation step (%s) returns an error, not unevaluated sources',
    async (_name, reply, status, code) => {
      const result = await callRoute('evidence', { discovery: goodDiscovery(), evaluation: reply });
      expect([result.status, result.body.error?.code]).toEqual([status, code]);
      expect(result.body).not.toHaveProperty('sources');
    },
  );

  it('makes no request at all when OpenRouter is not configured', async () => {
    process.env = { ...saved, TRUSTGUARD_AI_PROVIDER: 'openrouter' };
    for (const name of Object.keys(ROUTES) as RouteName[]) {
      const { status, body, sent } = await callRoute(name, {});
      expect([status, body.error?.code]).toEqual([503, 'not_configured']);
      expect(sent).toHaveLength(0);
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 5. The test environment itself                                                              */
/* ------------------------------------------------------------------------------------------ */

describe('test isolation', () => {
  it('provider credentials from the developer environment are not visible to tests', () => {
    for (const name of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'TRUSTGUARD_AI_PROVIDER']) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  it('a request that does not use an injected fetch is refused', async () => {
    await expect(fetch('https://openrouter.ai/api/v1/messages')).rejects.toThrow(
      /Network access is blocked in tests/,
    );
  });
});
