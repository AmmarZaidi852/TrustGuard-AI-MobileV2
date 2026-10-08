# Architecture

TrustGuardAI is an iOS-first Expo (SDK 57) app with a thin server layer implemented as Expo
Router API routes. All model and search calls happen on the server; the app never holds an API
key.

```
iOS app ── POST /api/v1/claims/analyze ──► Claude: claim analysis (structured output)
   │
   └──── POST /api/v1/evidence/search ──► Claude + web_search: source discovery
                                       └► Claude: source-backed evaluation (structured output)
                                       └► code guard rails ──► compact JSON ──► app
```

## Layers

| Layer         | Location          | Responsibility                                                                                                 |
| ------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Screens       | `src/app/`        | Expo Router screens; API routes in `src/app/api/v1/**/+api.ts`                                                 |
| UI components | `src/components/` | Primitives, result view, Sources section, input form                                                           |
| Domain core   | `src/core/`       | Pure, shared by app and server: types, API contract, scoring, guard rails, URL validation, heuristics, wording |
| App services  | `src/services/`   | Analysis pipeline, typed HTTP client, provider contracts + remote implementations, on-device history           |
| Server        | `src/server/`     | Env, Anthropic calls, prompts, schemas, handlers, rate limiting. ESLint forbids app code from importing it     |

## Analysis pipeline (`src/services/analysis/pipeline.ts`)

1. **Validate** input (`core/validation`), run on-device claim extraction and language signals
   (labelled `heuristic`).
2. **AI claim analysis** (`/api/v1/claims/analyze`): extracts the central claim, its category,
   verifiability, a knowledge-based stance and calibrated confidence. Required for text/claim
   checks: if it fails the user gets a retryable error, never a degraded result.
3. **Source check** (`/api/v1/evidence/search`), only for checkable claims (opinions and
   predictions are skipped): returns sources plus a source-backed evaluation.
4. **Scoring** (`core/scoring/trust-scoring.ts`) combines everything into a label, score,
   confidence and risk level.
5. The result is stored on-device and rendered by `ResultView`.

The pipeline reports progress stages (`analyzing_claim`, `checking_sources`) for the loading UI.

## Source discovery and evaluation (Phase 3)

### Provider / search decision

Claude's server-side **web search tool** (`web_search_20260209`) is used, so Anthropic remains the
single provider and no new dependency or search API was added. Reasons:

- The search runs on Anthropic's infrastructure; this server never fetches arbitrary URLs, so
  there is no server-side request forgery surface from user input.
- Search responses carry **provider-generated citations** (`web_search_result_location` with
  `url`, `title`, `cited_text`), which give a real URL and a passage quoted from the page without
  trusting model-written text.
- `blocked_domains` excludes social/user-generated platforms at the search layer.

`web_fetch` is deliberately **not** enabled.

### Step 1: discovery (`src/server/evidence/discovery.ts`)

- One Claude call with the web search tool (max 3 searches, low effort), handling `pause_turn`
  continuations (max 2) by re-sending the accumulated assistant content.
- Sources are built only from citations, enriched with `page_age` from search results. URLs the
  model writes in prose are ignored, so the model cannot invent a source or an excerpt.
- Every URL is validated (`core/sources/url-safety.ts`); invalid or unsafe ones are dropped and
  counted in `rejectedSources`.
- Excerpts are clipped (400 chars, max 2 per source); max 6 sources, max 2 per domain, ranked by
  outlet credibility, then citation order.
- If every search errored, the result is `search_unavailable`. If searches ran but nothing was
  cited, the result is an empty source list (not an error).

### Step 2: evaluation (`src/server/evidence/evaluation.ts`)

- A second Claude call with **structured output** (Zod schema): per-source `relationship`
  (`supports`/`contradicts`/`context`/`irrelevant`), `relevance` (`high`/`medium`/`low`) and
  explanation; an overall `verdict` (`supported`/`contradicted`/`mixed`/
  `insufficient_evidence`/`cannot_verify`); confidence; and three separate fields: what the sources
  say, what can be inferred, what remains uncertain.
- The model judges **only against the provided excerpts**. Assessments for unknown source ids are
  dropped (the model cannot add sources), as are `irrelevant` sources.

### Step 3: guard rails (`src/core/evidence/source-guards.ts`)

Applied on the server and again in the app:

1. `supported`/`contradicted` must be backed by at least one source with that relationship and
   medium/high relevance; otherwise the verdict becomes `insufficient_evidence`.
2. If credible opposing evidence is at least 50% of the backing evidence (relevance × outlet
   credibility), the verdict becomes `mixed`.
3. Confidence ≤ model ceiling (0.9) and ≤ the **evidence strength**: a noisy-OR of
   relevance × credibility of agreeing sources, reduced by opposing evidence. A pile of weak
   sources does not raise confidence.
4. `mixed`/`insufficient_evidence`/`cannot_verify` are capped at 0.5 confidence.

### Verdict logic (`core/scoring/trust-scoring.ts`)

| Source-backed verdict                                       | Label                                             |
| ----------------------------------------------------------- | ------------------------------------------------- |
| supported, confidence ≥ 0.55, no conflict with AI knowledge | Likely reliable                                   |
| contradicted, confidence ≥ 0.55, no conflict                | Likely false                                      |
| contradicted, weaker evidence                               | Possibly misleading                               |
| supported, weaker evidence                                  | Needs verification                                |
| mixed, or sources vs. AI knowledge conflict                 | Needs verification (confidence × 0.6 on conflict) |
| insufficient_evidence / search found nothing                | Insufficient evidence                             |
| cannot_verify                                               | Cannot verify                                     |

Without a source evaluation (search failed or unavailable), the Phase 2 rules apply: model
knowledge alone can never produce _Likely reliable_ or _Likely false_, and the summary states
that external source verification was unavailable. Opinions and predictions are always
_Cannot verify_ and are never searched.

## Failure behaviour

| Failure                                                                           | Where detected                                    | Result                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Missing/invalid API key                                                           | server (`not_configured`, 503)                    | AI analysis: error + retry. Source check: "not connected"                         |
| AI claim analysis fails (network, timeout, rate limit, refusal, malformed output) | app                                               | Error with retry; no result                                                       |
| Web search unavailable                                                            | server (`search_unavailable`, 503)                | AI-only result, downgraded, marked "not source-verified"                          |
| Search/model timeout                                                              | server (`timeout`, 504) or client timeout (150 s) | Same as above                                                                     |
| No useful sources                                                                 | server (200, `sources: []`)                       | _Insufficient evidence_                                                           |
| Evaluation fails after search                                                     | server (`evaluation_failed`, 502)                 | AI-only result, downgraded                                                        |
| Malformed source data                                                             | app (`invalid_response`) or per-source drop       | Whole response rejected if structurally invalid; bad sources dropped individually |
| Invalid/unsafe URL                                                                | server and app                                    | Source dropped; links are re-validated before opening                             |
| Network failure                                                                   | app (`network`)                                   | AI-only result (sources) or retryable error (analysis)                            |

## Security

- **Secrets:** only `src/server` and `+api.ts` files read `ANTHROPIC_API_KEY`. An ESLint
  `no-restricted-imports` rule blocks app imports of server code, and the built iOS, Android and
  web bundles were scanned to confirm they contain no key reference or prompt text.
- **Prompt injection:** claims, titles, excerpts and dates are escaped (`<`, `>` and `&`) and
  wrapped in tags (`src/server/evidence/untrusted.ts`), so content cannot close its tag. System
  prompts tell the model never to follow instructions inside them. The code-level guard rails
  mean that even an obeyed injection cannot produce a verdict the sources do not back, cannot add
  sources, and cannot exceed evidence-based confidence.
- **URLs:** `validateSourceUrl` accepts only public `http(s)` URLs on ports 80/443. It rejects
  other schemes, embedded credentials, IP literals, localhost/`.local` hosts, malformed labels
  and URLs over 2 KB. It is regex-based so it behaves identically in Node and Hermes.
- **Abuse:** the server re-validates all input; per-client in-memory rate limits (claim analysis
  20 per 10 min, source checks 10 per 10 min) are best-effort per instance.

## Testing

Jest (`jest-expo`); server tests run in the `node` environment. The tests cover URL safety,
guard rails, discovery extraction (citations only, unsafe URLs, caps, `pause_turn`, search
errors), evaluation merging (invented ids, injection, conflicts), both API handlers, client
parsing, pipeline verdicts/failures/progress, and the Sources UI (0/1/many/conflicting sources,
external links, unsafe links, legacy stored results).
