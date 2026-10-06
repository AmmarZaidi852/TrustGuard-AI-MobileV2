# TrustGuardAI Mobile

**Check what you see before you trust it.**

TrustGuardAI helps people question digital content before trusting or sharing it. It is an
analysis and verification assistant, not an AI lie detector. Every result says what is being
claimed, how trustworthy it appears, why, and what evidence supports that assessment, without
claiming more certainty than the evidence allows.

Built with Expo (SDK 57), React Native, Expo Router and TypeScript.

## Running

```bash
npm install
npm start            # Expo dev server (press a / i / w for Android, iOS, web)
```

Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` once the backend proxy exists.
Without it, the app runs with on-device heuristics only and reports AI, evidence and image checks
as **not connected**. It never fills the gap with invented results.

## Quality checks

```bash
npm test             # Jest (jest-expo) unit + component tests
npm run lint         # ESLint (expo config + prettier)
npm run typecheck    # tsc --noEmit
npm run format:check # Prettier
npm run build        # expo export (Android, iOS and web bundles)
npm run verify       # all of the above
```

## Architecture

```
src/
  app/                    Expo Router screens (home, analyze/{text,claim,image}, result/[id])
  components/
    ui/                   Design primitives (text, cards, buttons, notices)
    analysis/             Reusable ResultView, assessment header, evidence list, input form
  core/                   Pure, platform-agnostic domain logic (fully unit tested)
    types.ts              Domain model
    claims/               Claim extraction + classification (heuristic)
    signals/              Language / manipulation indicators (heuristic)
    sources/              Source credibility evaluation (heuristic, by outlet type)
    scoring/              Transparent trust scoring
    presentation.ts       User-facing wording for each separate question
    validation.ts         Input validation
  services/
    analysis/pipeline.ts  Orchestrates an analysis end to end
    providers/            Contracts for LLM, evidence search, vision and OCR
                          + remote (backend proxy) and "unavailable" implementations
    http/                 Typed HTTP client (timeouts, network/HTTP/invalid-response errors)
    history/              Recent analyses (on-device AsyncStorage)
```

### Principles in the code

- **Separate questions are kept separate.** Whether a claim is supported, whether an image looks
  AI-generated or edited, and whether evidence exists are reported independently.
  "Appears AI-generated", "appears false" and "cannot currently be verified" are different
  statements.
- **No fabricated output.** If a service is not connected or fails, the step is recorded as
  `unavailable` / `failed`, the assessment is downgraded (e.g. _Cannot verify_) and the UI shows a
  partial-analysis notice. Image analysis refuses to produce a result if no image service ran.
- **Heuristics are labelled as heuristics.** On-device signals have `origin: 'heuristic'` and never
  produce a trust score on their own.
- **Transparent scoring.** `core/scoring/trust-scoring.ts` combines model assessment, credibility-
  weighted evidence balance, language signals and image-authenticity signals with explicit
  weights. Strong labels (_Likely reliable_ / _Likely false_) require sufficient confidence.
  It is a pure function and can be replaced by a model-based scorer.
- **API keys never ship in the app.** The client only knows the backend URL. Model and search keys
  belong to the backend proxy.

### Backend contract (implemented in Phase 2)

| Endpoint                   | Request                        | Response                                                                   |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `POST /v1/claims/analyze`  | `{ claim, type, context }`     | `{ stance, confidence, reasoning, indicators[], evidenceNeeded[], model }` |
| `POST /v1/evidence/search` | `{ claim }`                    | `{ results: [{ title, url, publisher, snippet, stance, publishedAt? }] }`  |
| `POST /v1/images/analyze`  | `{ image (base64), mimeType }` | `{ aiGeneration, manipulation, misleadingContext, description, model }`    |
| `POST /v1/images/ocr`      | `{ image (base64), mimeType }` | `{ text, confidence, engine }`                                             |

Responses are validated at runtime (`services/providers/remote.ts`). Malformed responses are
rejected, not partially trusted.

## Roadmap

1. **Foundation (done):** app shell, screens, domain model, modular services, transparent
   scoring, on-device heuristics, result UI, error states, tests.
2. **Backend proxy + AI claim analysis:** secure server holding API keys; LLM claim analysis.
3. **Evidence retrieval:** web/news search and fact-check lookup, with stance classification.
4. **Image analysis:** vision model for AI-generation/manipulation signals, plus OCR feeding
   extracted claims into verification.
5. **Hardening:** end-to-end testing of failure modes, rate limiting, polish.
