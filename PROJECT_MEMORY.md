# Project memory

Running log of phase status, decisions and verification for TrustGuardAI-mobile. Only verified
facts go here; limitations are stated explicitly.

## Direction

- iOS-first Expo app (SDK 57). Android/web work only where the stack gives it for free; the web
  build is used for verification on the Windows dev machine.
- Compact MVP: no accounts, social features, notifications, dashboards or chat.
- Never present uncertain AI judgements as fact; never fabricate results when a service fails.
- Single AI provider: Anthropic Claude (`claude-opus-5-5`, overridable with
  `TRUSTGUARD_CLAIM_MODEL`), called only from Expo API routes.

## Phases

| Phase                                                                | Status      | Commit    |
| -------------------------------------------------------------------- | ----------- | --------- |
| 1. Foundation: screens, domain model, scoring, heuristics, result UI | Done        | `24da1c1` |
| 2. Real AI claim analysis via a secure backend route                 | Done        | `ed32179` |
| 3. Source discovery and source-backed verification                   | Done        | `53f26ae` |
| 4. Image analysis (vision + OCR feeding claims into verification)    | **Next**    | –         |
| 5. Hardening                                                         | Not started | –         |

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
bundles were scanned: no API key reference, prompt text or tool config.

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
  Before relying on Phase 3, run a live check with a real key (`.env.local`).
- Whether `web_search_20260209` with `blocked_domains` and server-side fallbacks is accepted by
  the live API for this account (web search may need enabling in the Console).
- Native iOS behaviour (no Mac/iPhone available here): keyboard, safe areas, opening links in
  Safari, and long-request behaviour on mobile networks.
- Hosting limits: whether the deployment target (e.g. EAS Hosting) allows API-route requests of
  up to ~150 s.
- During browser testing the automation tool sometimes missed the first click after a page
  load. React handlers were attached and nothing overlaid the buttons, so this looks like a tool
  artifact, but it was not confirmed on a real device.

## Next: Phase 4, image analysis

Vision model for AI-generation and manipulation signals, plus OCR (text in images) feeding
extracted claims into the existing claim → sources pipeline. The `VisionAnalyzer`/`OcrProvider`
contracts and the image screen already exist; the backend routes do not.
