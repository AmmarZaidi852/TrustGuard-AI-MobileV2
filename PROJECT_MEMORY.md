# Project memory

Running log of phase status, decisions and verification for TrustGuardAI-mobile. Only verified
facts go here; limitations are stated explicitly.

## Direction

- iOS-first Expo app (SDK 57). Android/web work only where the stack gives it for free; the web
  build is used for verification on the Windows dev machine.
- Compact MVP: no accounts, social features, notifications, dashboards or chat.
- Never present uncertain AI judgements as fact; never fabricate results when a service fails.
- One model family: Claude, called only from Expo API routes, either through the Anthropic API
  (`claude-opus-5-5`) or OpenRouter's Anthropic-compatible endpoint (`anthropic/claude-opus-5.5`,
  routed only to Anthropic). Selected with `TRUSTGUARD_AI_PROVIDER`; model overridable with
  `TRUSTGUARD_CLAIM_MODEL`. Keys come from the process environment only, never `.env` files.

## Phases

| Phase                                                                | Status                               | Commit    |
| -------------------------------------------------------------------- | ------------------------------------ | --------- |
| 1. Foundation: screens, domain model, scoring, heuristics, result UI | Done                                 | `24da1c1` |
| 2. Real AI claim analysis via a secure backend route                 | Done                                 | `ed32179` |
| 3. Source discovery and source-backed verification                   | Done                                 | `53f26ae` |
| 4. Image claim analysis (Claude vision → existing verification)      | Done                                 | `cab1ce1` |
| 5. Hardening                                                         | **In progress** (security gate done) | –         |

## Phase 3: source discovery and claim checking (`53f26ae`, pushed to main)

**Architecture:** app → `POST /api/v1/evidence/search` → Claude with `web_search_20260209`
(source discovery; sources only from API citations; URLs validated; max 6) → Claude structured
evaluation against the excerpts → shared guard rails (`core/evidence/source-guards.ts`) → app,
which re-validates and re-applies the guards → scoring. Details are in ARCHITECTURE.md.

**Provider decision:** Claude's web search tool keeps a single provider and adds no dependency.
The search runs on Anthropic's side, so there's no server-side URL fetching. Citations give real
URLs and quoted page text, so sources can't be invented by the model. `web_fetch` is not used.

**Tests/build status (at the Phase 3 commit):** 20 Jest suites / 270 tests, all passing, plus format check,
lint, typecheck and `expo export` (iOS, Android and web bundles, plus 2 API routes). The client
bundles were scanned for API key references, prompt text and tool config. _Correction (Phase 4):_
that scan only covered the web bundle in `dist/client`; with server output the iOS/Android
bundles are written to `dist/_expo/`. They were scanned for the first time in Phase 4 and are
clean.

**Verified in this environment:**

- Evidence route over HTTP against the production build: input validation (opinion, unknown
  type, empty claim → 400) and missing key → 503 `not_configured`.
- With a deliberately invalid key, the route sent a real request to Anthropic and mapped the
  authentication failure to 503. Authentication is checked before the request body, so this does
  **not** prove that the web-search tool configuration is accepted.
- Web build in Chrome, with **controlled mock responses injected into `window.fetch` in the
  browser session** (nothing mocked in the codebase):
  - the two progress stages;
  - a contradicting-sources result (_Likely false_, 72% confidence, 3 sources with metadata,
    relationship, relevance, explanation and excerpt; an injected `javascript:` source was dropped);
  - "Open source" calls `window.open(url, '_blank', 'noopener')`;
  - mixed sources (_Needs verification_), no sources (_Insufficient evidence_), search failure and
    malformed source data (both: AI-only, "not source-verified");
  - no console errors from the app;
  - 390px-wide layout (iframe) without horizontal overflow, alongside the desktop layout.
  - A thrown `fetch` (a bug in the test mock) was handled as a network failure, which incidentally
    confirmed that path.

**Not verified:**

- **Live provider behaviour.** No Anthropic API key is available on the dev machine, so the real
  web-search call, citation content, evaluation quality, latency and cost per check are untested.
  Before relying on Phase 3, run a live check with a real key (set in the process environment;
  _correction:_ never in `.env.local`).
- Whether `web_search_20260209` with `blocked_domains` and server-side fallbacks is accepted by
  the live API for this account (web search may need enabling in the Console).
- Native iOS behaviour (no Mac/iPhone available here): keyboard, safe areas, opening links in
  Safari, and long-request behaviour on mobile networks.
- Hosting limits: whether the deployment target (e.g. EAS Hosting) allows API-route requests of
  up to ~150 s.
- During browser testing the automation tool sometimes missed the first click after a page
  load. React handlers were attached and nothing overlaid the buttons, so this looks like a tool
  artifact, but it was not confirmed on a real device.

## Phase 4: image claim analysis (`cab1ce1`, pushed to main)

**Architecture:** image → validated in the app (format from magic bytes, ≤ 5 MB, base64
integrity, non-image metadata rejected) → `POST /api/v1/images/analyze` with only
`{ image, mediaType }` → validated again on the server (Content-Length, body size, same payload
checks, declared type must match the bytes) → Claude vision with structured output (image kind,
transcription with `[illegible]`, readability, up to 3 separate claims with exact quotes,
factual vs. commentary, injection flag, uncertainty) → shared guard rails
(`core/image/image-guards.ts`: grounding of each claim's quote in the transcription, opinions
and predictions never checkable, unreadable images have no checkable claim, max 3) → the
**primary claim goes through the unchanged Phase 2 + Phase 3 pipeline** (`verifyContent` with
`mode: 'claim'`) → scoring. Partly readable text lowers confidence (× 0.75). Image authenticity
(AI-generated or edited images) is **not** assessed. No new dependency and no OCR provider: Claude
vision does the reading.

**Multiple claims:** a bounded primary-claim design. Up to 3 claims are shown separately; only the
primary claim is verified, and the others have "Check this claim" (opens the claim screen
prefilled). This is shown to the user and documented in ARCHITECTURE.md.

**Privacy:** images are processed in memory for one request and never stored or logged by
TrustGuardAI (they are sent to Anthropic for analysis). Logs contain only the error code,
detected type and byte count (tested). Saved history never contains the image or its URI, so the
result shows a "not stored" placeholder after a restart. EXIF is not requested; only the bytes and
the detected type are uploaded.

**Tests/build status (at the Phase 4 commit):** 26 Jest suites / 372 tests, all passing; format,
lint, typecheck and `expo export` (iOS/Android/web plus 3 API routes). All three client bundles
(web in `dist/client`, iOS/Android `.hbc` in `dist/_expo`) were scanned and contain no API key
reference, prompt text, Anthropic SDK, model/search config or `src/server` paths. The server
bundle contains the key reference, which confirms the scan works.

Phase 1–3 image tests that targeted the removed OCR/authenticity design were ported to the new
design (same intents: no result without a service, failures surfaced, validation, no-claim). The
claim-analyzer timeout test was already updated in Phase 3.

**Verified in this environment:**

- Real image route over HTTP (production build, no key): a real 799 KB PNG passed validation and
  then returned 503 `not_configured`; a type mismatch gave 400, a PDF disguised as PNG 415,
  malformed base64 400, an empty image 400, and a ~9.8 MB body 413. Nothing image-related appeared
  in the server log.
- Web build in Chrome with **mocked API responses injected into `window.fetch`** and the web
  picker's file input intercepted to supply a real canvas-generated PNG (the app's own picker
  code read it with FileReader):
  - selection and preview (aspect ratio kept, size shown); replace and remove;
  - a disguised PDF and a 12.4 MB image rejected immediately, with Analyze disabled;
  - upload body contained only `image` + `mediaType` (detected `image/png`);
  - three-step progress;
  - a source-backed _Likely false_ result with thumbnail, image type, readability, 2 claims (the
    prediction marked "Not a factual claim"), transcribed text and Sources;
  - no-claim and unreadable → _Cannot verify_ with explanation;
  - vision failure → error with "Try again";
  - source failure after a successful read → claim kept, "not source-verified";
  - no console errors; stored history contained no image or blob URI;
  - 390px layouts (result and image screen) without horizontal overflow.
- **Not verified:** the image screen at phone width with an image selected.
- The automation tool's mouse clicks were unreliable on these pages, so buttons were pressed via
  DOM `click()`. Rendering was checked with screenshots.

**Not verified:**

- **Live Claude vision.** No API key is available, so reading accuracy, refusal behaviour,
  grounding in practice, latency and cost are untested. Live web search and evaluation (Phase 3)
  also remain untested.
- **Native iPhone.** No iPhone or Mac was used. Untested: the iOS photo picker (including HEIC →
  JPEG base64 conversion and `preferredAssetRepresentationMode`), large photos from the camera
  roll (which may exceed 5 MB even at quality 0.7), preview sizing, safe areas, and upload
  over mobile networks.
- Hosting request-size limits for ~7 MB image uploads on the eventual deployment target.
- One transient failure was seen: a verification run immediately after `prettier --write .`
  found 23/26 suites and a missing file. It passed on the next run. It is probably OneDrive sync
  in the project folder, but that is not confirmed.

## Phase 5: hardening (in progress)

### Security gate (before any provider change)

Run before considering a switch to OpenRouter. All existing protections were kept; nothing was
loosened. **The provider was not changed and no live test was run.**

**Gaps found and fixed (all provider-agnostic):**

- Key isolation: the Anthropic SDK silently reads `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`
  and `ANTHROPIC_LOG` from the environment, so the key could be redirected, a second credential
  sent, or request bodies (user text and images) debug-logged. All clients are now created by
  `server/provider-client.ts` with the host, auth and log level pinned.
- Key isolation: an OpenRouter-format key (`sk-or-`) in `ANTHROPIC_API_KEY` would have been sent
  to Anthropic. It is now refused (`not_configured`, with a start-up warning that never contains
  the key).
- Logs: unexpected errors were logged with their raw message, so provider or request text could
  reach the logs. Now only the error type is logged.
- Prompt injection: claim analysis put user text, and text read from images, into `<content>`
  unescaped, so `</content>` could break out of the tag. It is now escaped, as the source
  prompts already were.
- Image injection: detection relied only on the model's own flag. A deterministic detector now
  also flags it, and a claim that is itself an instruction is never checkable.
- Source integrity: a citation whose URL never appeared in the search results was accepted. Such
  citations are now rejected as fabricated. The blocked low-accountability domains are also
  enforced in code, not only through the search tool option.
- Source integrity: a discovery response where no search ran was shown as "searched, found
  nothing". It is now `search_unavailable`.
- Errors: insufficient credits (402) and HTTP 408 fell through to a generic "provider returned an
  error". They now map to the new `provider_billing` code (with a specific message) and to
  `timeout`. A malformed 200 body (non-JSON, or not a message) became a generic 500; it is now
  `invalid_model_output`.
- Search error codes from the provider are echoed to the app only if they are well-formed.

**Security tests** (`src/server/__tests__/security-gate.test.ts`, 78 tests): app providers →
real handlers → real Anthropic SDK → mocked provider HTTP. They cover image prompt injection
(compromised reading, instruction-only image, tag breakout, image only in the image block),
source integrity (missing, malformed and fabricated citations, fabricated source ids,
unsupported and low-relevance verdicts, tampered backend response), key isolation (pinned host
despite env overrides, the key echoed in 401/402/403/429/500/529 bodies never reaching
responses, logs or user messages, the OpenRouter key refused by the real route modules with no
outbound request) and provider failures (14 failure kinds × claim, image, search and evaluation
steps: never a result, or never a verified one). These are **mocked**: they prove the code's
handling, not live provider behaviour.

**Bundle scan:** web (`dist/client`) and iOS/Android Hermes bundles (`dist/_expo`) contain no key
pattern (`sk-ant-`, `sk-or-v1-`), key names, `x-api-key`, the Anthropic host or SDK, search tool
config, prompts or `src/server` paths. The server bundle references the key name (control) but
holds no key value.

**Commit note:** the gate was first committed locally as `58a5b8e`. GitHub push protection
(GH013) rejected it because two synthetic test keys looked like real OpenRouter keys. The commit
was amended (fixtures built at runtime) to `fdd8bb0`, which differs only in that test file. The
original is kept as the local tag `backup/58a5b8e-original`.

### OpenRouter support (branch `phase5/openrouter-provider`)

Implemented as described in ARCHITECTURE.md ("AI provider"): provider selection and key/model
validation in `server/env.ts`, one shared client in `server/provider-client.ts` (OpenRouter's
Anthropic-compatible endpoint, Bearer auth, `anthropic/claude-opus-5.5`, routing pinned to
Anthropic with `require_parameters`), OpenRouter-aware error mapping (402 credits, 403
moderation vs. permissions, 408, 429, 404/502/503 routing) and a new `content_blocked` code.
The security-gate suite now runs every security test against both providers, plus provider
selection, endpoint and error-mapping tests, and proxy-style citation shapes (`url_citation`
annotations, stripped citations, URL-only citations, malformed search results): 184 tests.

**No live call has been made.** Still unverified with the live provider:

- whether OpenRouter passes Anthropic's `web_search_20260209` tool (with `max_uses` and
  `blocked_domains`) through and returns Anthropic's `web_search_result_location` citations with
  `cited_text` (if not, source checks fail closed as "search unavailable");
- whether `output_config.format` (structured outputs) and `output_config.effort` are accepted with
  `require_parameters: true` (if not, requests fail with 404/503 → "temporarily unavailable");
- how refusals arrive (`stop_reason: "refusal"` is not in OpenRouter's documented list; anything
  else fails closed as malformed output);
- the exact 403 body for moderation and guardrail blocks, and how `anthropic-beta` headers are
  treated;
- Anthropic's in-call fallback for safety-classifier refusals is not used via OpenRouter, so
  some sensitive health claims may be refused more often.

### OpenRouter mocked compatibility suite (zero spend)

The live probe was **not** run: the user set a zero-spending constraint (2026-10-14), so no
OpenRouter, Anthropic or other billable request was made. Instead,
`src/server/__tests__/openrouter-provider.test.ts` (67 tests) runs `readServerEnv` →
`createAiProvider` → the analyzers and the **real API route modules** → the real Anthropic SDK →
a deterministic fixture network that answers in OpenRouter's documented shapes and fails on any
other host.

`jest.setup.ts` now guarantees that no test can reach a provider: it removes all provider
variables (`ANTHROPIC_*`, `OPENROUTER_API_KEY`, `TRUSTGUARD_*`) from the test process and
replaces the global `fetch` with one that refuses every request. Tests only reach a network
through a fetch they inject themselves. Keys in tests are synthetic and built at runtime.
Verification was also run with those variables cleared in the shell.

**Mock-verified (what our code sends and how it handles replies):**

- Requests: every step (claim, discovery, evaluation, vision) is a `POST` to
  `https://openrouter.ai/api/v1/messages?beta=true` with `Authorization: Bearer` only (no
  `x-api-key`), the OpenRouter model id (or a validated override), and
  `provider: { only: ['anthropic'], allow_fallbacks: false, require_parameters: true }`. No
  Anthropic `fallbacks`/`betas`, and no streaming. Token budgets per step. Requests are
  deterministic. A mutation check (`require_parameters: false`) made 4 tests fail.
- Structured outputs and effort: claim, evaluation and vision send `effort: "medium"` and exactly
  the JSON schema generated from their Zod schemas (all fields required). Discovery sends
  `effort: "low"`, no format and only `web_search_20260209` with `max_uses` and
  `blocked_domains`. Schema-violating output is rejected. A `require_parameters` 404 or an
  unsupported-parameter 400 fails the request (never silently degraded).
- Citations: `cited_text` becomes the source excerpt (whitespace normalized, clipped to 400
  characters). Up to 2 distinct excerpts are kept per page across text blocks, and the title
  falls back to the search result. Empty, whitespace-only, non-string or missing `cited_text`
  is rejected and counted. Blocked domains are rejected even if the search returned them.
  `pause_turn` continuations keep the routing. Search tool errors become `search_unavailable`,
  with only well-formed codes echoed.
- Routes (with OpenRouter configured): successful claim, evidence and image responses. For
  each route, 401, 402, 403 moderation, 404 routing, 429, 502, an error body with HTTP 200, a
  non-JSON body and a refusal all give an error response, never a result. A failed evaluation
  step after successful discovery returns an error, not unevaluated sources. No key appears in
  any response body or log. With no key configured, no request is made.

**Still unverified (needs a live provider, deliberately not done):** everything listed above
under "No live call has been made". In short: whether OpenRouter accepts these exact requests
(web search tool, `output_config` format and effort with `require_parameters`), whether it
returns `web_search_result_location` citations with `cited_text`, the real refusal and
moderation shapes, and latency and cost. The fixtures encode our expectation of those shapes,
not observed responses.

**Tests/build status:** 28 Jest suites / 625 tests, all passing; format, lint, typecheck and
`expo export` (3 API routes) pass.

### Remaining Phase 5 work

A live end-to-end probe (text, sources and images), once spending is approved. Also native
iPhone testing, limits and latency tuning, and polish.
