# Architecture

TrustGuardAI is an iOS-first Expo (SDK 57) app with a thin server layer implemented as Expo
Router API routes. All model and search calls happen on the server; the app never holds an API
key.

```
TEXT:   typed text/claim ─────────────────────────────┐
IMAGE:  image ─► POST /api/v1/images/analyze ─► Claude vision: text + claims (structured)
                 (validated again on the server)      │  primary checkable claim
                                                      ▼
        POST /api/v1/claims/analyze ─► Claude: claim analysis (structured output)
                                                      ▼
        POST /api/v1/evidence/search ─► Claude + web_search: source discovery
                                     └► Claude: source-backed evaluation (structured output)
                                     └► code guard rails ─► compact JSON ─► scoring ─► result
```

Text and images share one verification pipeline; an image only adds a reading step in front.

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

## Image claim analysis (Phase 4)

### Flow (`analyzeImage` in `src/services/analysis/pipeline.ts`)

1. **Validate in the app** (`core/image/image-payload.ts` via `validateImageInput`): format
   detected from the bytes, size, base64 integrity, non-image metadata. Invalid images are
   rejected right after picking, with a specific message, and are never uploaded.
2. **Upload** `POST /api/v1/images/analyze` with only `{ image (base64), mediaType }` (the
   detected type). No file name, URI or EXIF data is sent.
3. **Validate again on the server** (`src/server/image/handler.ts`), independently of the app:
   declared `Content-Length` and actual body size, the same payload checks, and the declared
   `mediaType` must match the type detected from the bytes (a mismatch means the client was
   bypassed or tampered with).
4. **Claude vision** (`src/server/image/vision-analyzer.ts`), with structured output: image kind,
   short description, transcription of the visible text (`[illegible]` for unreadable parts),
   readability (`clear`/`partial`/`unreadable`/`no_text`), up to 3 separate claims (text, exact
   quote, factual vs. commentary, type, readability, visible context), the primary claim,
   whether the image contains instructions aimed at AI, and what could not be interpreted.
5. **Guard rails** (`core/image/image-guards.ts`, server and app): max 3 claims; a claim is
   _checkable_ only if it is presented as fact, is not an opinion or prediction, is a complete
   statement, and its quote actually appears in the transcription (**grounding**: the model
   cannot invent text and then have it verified). Unreadable images or images without text have
   no checkable claim. The primary claim must be checkable, otherwise the first checkable claim is
   used.
6. **The primary claim enters the normal pipeline** exactly like a typed claim:
   `verifyContent({ text: claim, mode: 'claim' })` runs the Phase 2 claim analysis and then the
   Phase 3 source discovery, evaluation, guards and scoring. Nothing is duplicated.
7. **Result:** `kind: 'image'`, with `imageAnalysis` (the reading), the transcribed text, all
   claims, and the usual verdict, sources and uncertainty.

### Multiple claims

Bounded design: up to 3 claims are extracted and shown separately (never merged). **Only the
primary claim is verified**, to bound latency and cost. The others are labelled "Not checked
separately" (or "Not a factual claim" / "Text not confirmed") and have a **Check this claim**
action that opens the claim screen prefilled, running the same pipeline. This limitation is
shown to the user ("This image contains N claims. The main factual claim was checked…").

### Image-specific verdict rules

- No checkable claim (unreadable, no text, only opinion/humour, or ungrounded) → **Cannot
  verify**, nothing searched, with an explicit statement that this says nothing about whether
  anything in the image is true. Unreadability is never treated as evidence of falsity.
- Partly readable text → confidence × 0.75 (`IMAGE_UNCERTAINTY_FACTOR`) and an explanation line.
- Everything else (90% ceiling, evidence requirements for strong labels, mixed and insufficient
  evidence, source-failure downgrade, opinions never verified) is the unchanged Phase 2/3 logic.
- Image authenticity (AI-generated or edited images) is **not assessed** in this version; the
  "Does the image appear authentic?" row says so.

### Supported input and limits

|          |                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formats  | JPEG, PNG, WebP, GIF, detected from magic bytes. HEIC/HEIF, PDF, BMP, TIFF, SVG and others are rejected with a specific message. The iOS picker's base64 output is JPEG, and `preferredAssetRepresentationMode: Compatible` is requested         |
| Size     | ≤ 5 MB decoded (the Claude API per-image limit); request body ≤ ~7 MB. No client-side resizing (no extra dependency); the picker compresses at quality 0.7                                                                                       |
| Minimum  | 64 bytes; anything smaller is treated as invalid                                                                                                                                                                                                 |
| Metadata | The client MIME type and extension are never trusted for the format. Metadata claiming a non-image file (e.g. `text/html`, `.exe`) is rejected. Image-to-image differences (HEIC metadata with JPEG bytes) are expected from pickers and allowed |

### Privacy

- The image is sent over the existing API route, processed **in memory for that request only**,
  passed to Anthropic for analysis, and never written to disk or stored by TrustGuardAI.
- Server logs contain only the error code, the detected type and the byte count. They never
  contain image bytes or base64 (a test asserts this, including on unexpected errors). Error
  responses never echo image data.
- The app keeps the picked image only in memory for the current session. Saved history never
  contains the image or its URI (`withoutImage` in the history store), so after a restart the
  result shows a "not stored" placeholder.
- Only the image and its detected type are uploaded; EXIF is not requested (`exif: false`).

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

| Failure                                                                           | Where detected                                                          | Result                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Missing/invalid API key                                                           | server (`not_configured`, 503)                                          | AI analysis: error + retry. Source check: "not connected"                         |
| AI claim analysis fails (network, timeout, rate limit, refusal, malformed output) | app                                                                     | Error with retry; no result                                                       |
| Web search unavailable                                                            | server (`search_unavailable`, 503)                                      | AI-only result, downgraded, marked "not source-verified"                          |
| Search/model timeout                                                              | server (`timeout`, 504) or client timeout (150 s)                       | Same as above                                                                     |
| No useful sources                                                                 | server (200, `sources: []`)                                             | _Insufficient evidence_                                                           |
| Evaluation fails after search                                                     | server (`evaluation_failed`, 502)                                       | AI-only result, downgraded                                                        |
| Malformed source data                                                             | app (`invalid_response`) or per-source drop                             | Whole response rejected if structurally invalid; bad sources dropped individually |
| Invalid/unsafe URL                                                                | server and app                                                          | Source dropped; links are re-validated before opening                             |
| Network failure                                                                   | app (`network`)                                                         | AI-only result (sources) or retryable error (analysis)                            |
| Unsupported image format                                                          | app, then server (`unsupported_image`, 415)                             | Rejected before upload with a specific message                                    |
| Image too large                                                                   | app, then server (`image_too_large`, 413; Content-Length checked first) | Rejected before upload                                                            |
| Invalid/empty/malformed image or type mismatch                                    | app, then server (`invalid_image` / `empty_image`, 400)                 | Rejected                                                                          |
| Vision model failure / timeout / refusal / malformed reading                      | server or app                                                           | Error with retry; **no text-only guess**                                          |
| Unreadable image / no claim / only opinion                                        | vision guard rails                                                      | _Cannot verify_ with explanation; nothing searched                                |
| Claim analysis fails after the image was read                                     | app                                                                     | Error: "A claim was read from the image, but AI claim analysis failed…"           |
| Source checking fails after the image was read                                    | app                                                                     | The extracted claim is kept; AI-only result marked "not source-verified"          |

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
- **Images:** image text is untrusted data. The vision prompt tells the model never to follow
  it and to flag it (`containsInstructions`, shown as a concern). Grounding means injected text
  cannot become a verified claim unless it is literally in the image, and even then it only
  enters the normal guarded verification pipeline. Payloads are validated by bytes on both
  sides; the server never trusts the client's validation. The vision prompt forbids
  identifying people from their faces.
- **Abuse:** the server re-validates all input; per-client in-memory rate limits (claim analysis
  20 per 10 min, source checks 10 per 10 min, image analyses 10 per 10 min) are best-effort per instance.

## Testing

Jest (`jest-expo`); server tests run in the `node` environment. The tests cover URL safety,
guard rails, discovery extraction (citations only, unsafe URLs, caps, `pause_turn`, search
errors), evaluation merging (invented ids, injection, conflicts), both API handlers, client
parsing, pipeline verdicts/failures/progress, and the Sources UI (0/1/many/conflicting sources,
external links, unsafe links, legacy stored results), and for Phase 4: payload validation
(formats, size, malformed, empty, metadata), image guard rails (grounding, caps, opinion,
unreadable), the image API handler (bypass attempts, size limits, error mapping, no logging of
image bytes), the vision analyzer (request shape, injection, errors), the image pipeline (all
verdicts through Phase 3, failures, multiple claims, progress, privacy of stored history) and
the image UI (pick/preview/replace/remove, invalid image, result rendering).
