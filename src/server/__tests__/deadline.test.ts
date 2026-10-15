/**
 * @jest-environment node
 */
/**
 * Request deadlines: the server must stop calling the (paid) provider once a
 * request's time budget is spent or the client has gone, including SDK retries and
 * web-search continuations. Runs the real handlers and the real Anthropic SDK
 * against a fixture provider (synthetic key, no network); budgets are scaled down
 * to milliseconds.
 */
import Anthropic from '@anthropic-ai/sdk';

import { config } from '@/services/config';
import { IMAGE_BYTES } from '@/test/fixtures';

import { mapAnthropicError } from '../api-error';
import { createAnthropicClaimAnalyzer } from '../claim-analysis/anthropic-analyzer';
import { createClaimAnalysisHandler } from '../claim-analysis/handler';
import { CLAIM_ANALYSIS_SYSTEM_PROMPT } from '../claim-analysis/prompt';
import { ROUTE_BUDGET_MS, requestDeadline } from '../deadline';
import { DISCOVERY_LIMITS, createSourceDiscoverer } from '../evidence/discovery';
import { createSourceEvaluator } from '../evidence/evaluation';
import { createEvidenceHandler } from '../evidence/handler';
import { DISCOVERY_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT } from '../evidence/prompts';
import { createImageHandler } from '../image/handler';
import { VISION_SYSTEM_PROMPT, createVisionAnalyzer } from '../image/vision-analyzer';
import { REQUEST_EXTRAS, createProviderClient } from '../provider-client';

const FAKE_KEY = ['sk', 'or', 'v1', '3'.repeat(64)].join('-');
const MODEL = 'anthropic/claude-opus-5.5';
const CLAIM = 'Drinking coffee completely prevents cancer.';
const NCI = 'https://www.cancer.gov/about-cancer/causes-prevention/risk/diet/coffee';

type Step = 'claim' | 'discovery' | 'evaluation' | 'vision';
const STEP_BY_SYSTEM: Record<string, Step> = {
  [CLAIM_ANALYSIS_SYSTEM_PROMPT]: 'claim',
  [DISCOVERY_SYSTEM_PROMPT]: 'discovery',
  [EVALUATION_SYSTEM_PROMPT]: 'evaluation',
  [VISION_SYSTEM_PROMPT]: 'vision',
};

/** `hang` never answers (until aborted); otherwise answers after `afterMs`. */
type Behaviour =
  'hang' | { afterMs: number; json: unknown; status?: number; headers?: Record<string, string> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fixtureProvider(plan: Partial<Record<Step, Behaviour | Behaviour[]>>) {
  const calls: { step: Step; signal: AbortSignal | null | undefined }[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { system?: string };
    const step = STEP_BY_SYSTEM[body.system ?? ''];
    if (!step) throw new Error('Unknown request sent to the provider');
    calls.push({ step, signal: init?.signal });
    const planned = plan[step];
    const behaviour = Array.isArray(planned) ? planned.shift() : planned;
    if (!behaviour) throw new Error(`No fixture behaviour for ${step}`);

    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener('abort', abort);
      if (behaviour === 'hang') return;
      setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify(behaviour.json), {
              status: behaviour.status ?? 200,
              headers: { 'content-type': 'application/json', ...behaviour.headers },
            }),
          ),
        behaviour.afterMs,
      );
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'gen-fixture',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const answer = (output: unknown) => message([{ type: 'text', text: JSON.stringify(output) }]);
const claimAnswer = answer({
  extractedClaim: CLAIM,
  claimCategory: 'scientific_health',
  verifiable: true,
  verifiabilityNote: '',
  assessment: 'contradicted',
  confidence: 0.7,
  keyFindings: [],
  reasoning: 'Fixture.',
  evidenceNeeded: [],
  limitations: '',
});
const evaluationAnswer = answer({
  sourceAssessments: [
    { sourceId: 'S1', relationship: 'contradicts', relevance: 'high', explanation: 'NCI.' },
  ],
  verdict: 'contradicted',
  confidence: 0.6,
  whatSourcesSay: 'No evidence coffee prevents cancer.',
  inference: 'Fixture.',
  uncertainty: 'Fixture.',
  missingEvidence: [],
});
const overloaded = (headers?: Record<string, string>) => ({
  afterMs: 0,
  status: 529,
  json: { error: { code: 529, message: 'Overloaded' } },
  headers,
});
const searched = (stop_reason = 'end_turn') =>
  message(
    [
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srv_1',
        content: [{ type: 'web_search_result', url: NCI, title: 'NCI', encrypted_content: 'x' }],
      },
      {
        type: 'text',
        text: 'NCI:',
        citations: [
          {
            type: 'web_search_result_location',
            url: NCI,
            title: 'NCI',
            cited_text: 'No evidence coffee prevents cancer.',
            encrypted_index: 'x',
          },
        ],
      },
    ],
    stop_reason,
  );

/** Real SDK client: generous per-attempt timeout and one retry, as in production. */
function client(fetchImpl: typeof fetch, timeout = 10_000) {
  return createProviderClient(
    { provider: 'openrouter', apiKey: FAKE_KEY },
    { timeout, maxRetries: 1, fetch: fetchImpl },
  );
}
const extras = REQUEST_EXTRAS.openrouter;
const allowRequest = () => true;
const log = () => undefined;

const post = (body: unknown, signal?: AbortSignal) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), signal });
const errorCode = async (response: Response) =>
  ((await response.json()) as { error?: { code: string } }).error?.code;

function claimHandler(
  provider: ReturnType<typeof fixtureProvider>,
  budgetMs: number,
  attemptTimeoutMs?: number,
) {
  return createClaimAnalysisHandler({
    analyzer: createAnthropicClaimAnalyzer({
      apiKey: FAKE_KEY,
      model: MODEL,
      client: client(provider.fetchImpl, attemptTimeoutMs),
      extras,
    }),
    allowRequest,
    budgetMs,
    log,
  });
}
function evidenceHandler(provider: ReturnType<typeof fixtureProvider>, budgetMs: number) {
  const shared = client(provider.fetchImpl);
  return createEvidenceHandler({
    services: {
      discover: createSourceDiscoverer({ client: shared, model: MODEL, extras }),
      evaluate: createSourceEvaluator({ client: shared, model: MODEL, extras }),
    },
    allowRequest,
    budgetMs,
    log,
  });
}

describe('route budgets', () => {
  it("stay below the app's timeout for the same route, with margin", () => {
    expect(ROUTE_BUDGET_MS.claims).toBeLessThanOrEqual(config.requestTimeoutMs - 5_000);
    // The image budget also leaves time to upload up to ~7 MB.
    expect(ROUTE_BUDGET_MS.images).toBeLessThanOrEqual(config.imageTimeoutMs - 15_000);
    expect(ROUTE_BUDGET_MS.evidence).toBeLessThanOrEqual(config.evidenceTimeoutMs - 10_000);
  });

  it('a cancelled call is reported as a timeout, not as a provider error', () => {
    expect(mapAnthropicError(new Anthropic.APIUserAbortError())).toMatchObject({
      code: 'timeout',
    });
  });
});

describe('requestDeadline', () => {
  it('aborts when the budget runs out', async () => {
    const signal = requestDeadline(post({}), 20)!;
    expect(signal.aborted).toBe(false);
    await sleep(60);
    expect(signal.aborted).toBe(true);
  });

  it('aborts when the client goes away', () => {
    const client = new AbortController();
    const signal = requestDeadline(post({}, client.signal), 60_000)!;
    client.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe('the server stops calling the provider at the deadline', () => {
  it('claims: a hanging call is cancelled at the budget, not retried', async () => {
    const provider = fixtureProvider({ claim: ['hang', 'hang'] });
    const started = Date.now();
    const response = await claimHandler(provider, 100)(post({ text: CLAIM, mode: 'claim' }));

    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal?.aborted).toBe(true);
  });

  it('claims: no retry is started after the budget is spent', async () => {
    // A retryable 529 would normally be retried after a backoff; the budget ends first.
    const provider = fixtureProvider({ claim: [overloaded(), 'hang'] });
    const response = await claimHandler(provider, 150)(post({ text: CLAIM, mode: 'claim' }));

    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls).toHaveLength(1);
  });

  it('images: a hanging vision call is cancelled at the budget', async () => {
    const provider = fixtureProvider({ vision: 'hang' });
    const handler = createImageHandler({
      analyzer: createVisionAnalyzer({ client: client(provider.fetchImpl), model: MODEL, extras }),
      allowRequest,
      budgetMs: 100,
      log,
    });
    const response = await handler(post({ image: IMAGE_BYTES.png, mediaType: 'image/png' }));

    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal?.aborted).toBe(true);
  });

  it('evidence: a hanging search is cancelled and evaluation never starts', async () => {
    const provider = fixtureProvider({ discovery: 'hang' });
    const response = await evidenceHandler(
      provider,
      100,
    )(post({ claim: CLAIM, claimType: 'scientific_health' }));

    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls.map((call) => call.step)).toEqual(['discovery']);
  });

  it('evidence: search and evaluation share one budget', async () => {
    const provider = fixtureProvider({
      discovery: { afterMs: 80, json: searched() },
      evaluation: 'hang',
    });
    const response = await evidenceHandler(
      provider,
      200,
    )(post({ claim: CLAIM, claimType: 'scientific_health' }));

    expect(response.status).toBe(504);
    const body = (await response.json()) as Record<string, unknown>;
    // Never sources without their evaluation.
    expect(body).not.toHaveProperty('sources');
    expect(provider.calls.map((call) => call.step)).toEqual(['discovery', 'evaluation']);
    expect(provider.calls[1].signal?.aborted).toBe(true);
  });

  it('evidence: search continuations stop at the budget', async () => {
    const paused = { afterMs: 70, json: searched('pause_turn') };
    const provider = fixtureProvider({ discovery: [paused, paused, paused] });
    const response = await evidenceHandler(
      provider,
      100,
    )(post({ claim: CLAIM, claimType: 'scientific_health' }));

    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls).toHaveLength(2);
  });

  it('a client that disconnects cancels the provider call', async () => {
    const provider = fixtureProvider({ claim: 'hang' });
    const app = new AbortController();
    const pending = claimHandler(
      provider,
      60_000,
    )(post({ text: CLAIM, mode: 'claim' }, app.signal));
    await sleep(30);
    app.abort();
    const response = await pending;

    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal?.aborted).toBe(true);
  });

  it('a call that finishes within the budget is unaffected', async () => {
    const provider = fixtureProvider({ claim: { afterMs: 20, json: claimAnswer } });
    const response = await claimHandler(provider, 1_000)(post({ text: CLAIM, mode: 'claim' }));
    expect(response.status).toBe(200);
  });
});

describe('retries, continuations and partial failures under a deadline', () => {
  const evidence = { claim: CLAIM, claimType: 'scientific_health' };

  it('claims: a retryable failure is still retried while budget remains', async () => {
    const provider = fixtureProvider({
      claim: [overloaded({ 'retry-after-ms': '10' }), { afterMs: 0, json: claimAnswer }],
    });
    const response = await claimHandler(provider, 2_000)(post({ text: CLAIM, mode: 'claim' }));

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  });

  it('claims: a per-attempt timeout is retried within the budget', async () => {
    const provider = fixtureProvider({ claim: ['hang', { afterMs: 0, json: claimAnswer }] });
    // Each attempt may take 50 ms; the request as a whole may take 2 s.
    const response = await claimHandler(provider, 2_000, 50)(post({ text: CLAIM, mode: 'claim' }));

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  });

  it('claims: a Retry-After beyond the budget ends the request at the budget', async () => {
    // The SDK would wait an hour before retrying; the deadline wakes it and no retry is sent.
    // Reported as `timeout`, not `rate_limited`, because the budget is what ended it.
    const provider = fixtureProvider({ claim: [overloaded({ 'retry-after': '3600' }), 'hang'] });
    const started = Date.now();
    const response = await claimHandler(provider, 100)(post({ text: CLAIM, mode: 'claim' }));

    expect(await errorCode(response)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(provider.calls).toHaveLength(1);
  });

  it('claims: an exhausted retry reports the provider error, not a timeout', async () => {
    const provider = fixtureProvider({
      claim: [overloaded({ 'retry-after-ms': '10' }), overloaded()],
    });
    const response = await claimHandler(provider, 2_000)(post({ text: CLAIM, mode: 'claim' }));

    expect(await errorCode(response)).toBe('model_unavailable');
    expect(provider.calls).toHaveLength(2);
  });

  it('evidence: continuations are capped, then the partial search is evaluated', async () => {
    const paused = { afterMs: 0, json: searched('pause_turn') };
    const provider = fixtureProvider({
      discovery: [paused, paused, paused, paused],
      evaluation: { afterMs: 0, json: evaluationAnswer },
    });
    const response = await evidenceHandler(provider, 2_000)(post(evidence));

    expect(response.status).toBe(200);
    expect(provider.calls.map((call) => call.step)).toEqual([
      ...Array(1 + DISCOVERY_LIMITS.maxContinuations).fill('discovery'),
      'evaluation',
    ]);
    const body = (await response.json()) as { sources: unknown[]; evaluation: unknown };
    expect(body.sources).toHaveLength(1);
    expect(body.evaluation).not.toBeNull();
  });

  it('evidence: a failed continuation fails the request without partial sources', async () => {
    const provider = fixtureProvider({
      discovery: [
        { afterMs: 0, json: searched('pause_turn') },
        overloaded({ 'retry-after-ms': '10' }),
        overloaded(),
      ],
    });
    const response = await evidenceHandler(provider, 2_000)(post(evidence));

    const body = (await response.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe('model_unavailable');
    expect(body).not.toHaveProperty('sources');
    // The first turn, then the continuation and its single retry; never an evaluation.
    expect(provider.calls.map((call) => call.step)).toEqual([
      'discovery',
      'discovery',
      'discovery',
    ]);
  });

  it('evidence: a client that disconnects during evaluation cancels it', async () => {
    const provider = fixtureProvider({
      discovery: { afterMs: 0, json: searched() },
      evaluation: 'hang',
    });
    const app = new AbortController();
    const pending = evidenceHandler(provider, 60_000)(post(evidence, app.signal));
    await sleep(50);
    app.abort();
    const response = await pending;

    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls.map((call) => call.step)).toEqual(['discovery', 'evaluation']);
    expect(provider.calls[1].signal?.aborted).toBe(true);
  });
});

describe('requestDeadline without AbortSignal.timeout / AbortSignal.any', () => {
  const { timeout, any } = AbortSignal;
  beforeEach(() => {
    // As on a runtime that lacks them.
    Object.assign(AbortSignal, { timeout: undefined, any: undefined });
  });
  afterEach(() => {
    Object.assign(AbortSignal, { timeout, any });
  });

  it('still aborts when the budget runs out', async () => {
    const signal = requestDeadline(post({}), 20)!;
    expect(signal.aborted).toBe(false);
    await sleep(60);
    expect(signal.aborted).toBe(true);
  });

  it('still aborts when the client goes away', () => {
    const app = new AbortController();
    const signal = requestDeadline(post({}, app.signal), 60_000)!;
    app.abort();
    expect(signal.aborted).toBe(true);
  });

  it('is already aborted when the client left before the call', () => {
    const app = new AbortController();
    app.abort();
    expect(requestDeadline(post({}, app.signal), 60_000)!.aborted).toBe(true);
  });

  it('still cancels a hanging provider call end to end', async () => {
    const provider = fixtureProvider({ claim: 'hang' });
    const response = await claimHandler(provider, 100)(post({ text: CLAIM, mode: 'claim' }));

    expect(await errorCode(response)).toBe('timeout');
    expect(provider.calls).toHaveLength(1);
  });
});
