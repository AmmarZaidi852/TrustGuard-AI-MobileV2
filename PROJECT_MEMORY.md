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

| Phase                                                                | Status   | Commit      |
| -------------------------------------------------------------------- | -------- | ----------- |
| 1. Foundation: screens, domain model, scoring, heuristics, result UI | Done     | `24da1c1`   |
| 2. Real AI claim analysis via a secure backend route                 | Done     | `ed32179`   |
| 3. Source discovery and source-backed verification                   | Done     | `53f26ae`   |
| 4. Image claim analysis (Claude vision → existing verification)      | Done     | PHASE4_HASH |
| 5. Hardening                                                         | **Next** | –           |

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

## Phase 4: image claim analysis (PHASE4_HASH, pushed to main)

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

## Next: Phase 5, hardening

End-to-end failure-mode testing with a live API key (text, sources and images), native iPhone
testing, limits and latency tuning, and polish. Not started.
