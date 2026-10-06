# TrustGuardAI Mobile

**Check what you see before you trust it.**

TrustGuardAI is an iOS app that helps people question digital content before trusting or sharing
it. It is an analysis and verification assistant, not an AI lie detector. Every result says what
is being claimed, how trustworthy it appears, why, and what evidence supports that assessment,
without claiming more certainty than the evidence allows.

Built iOS-first with Expo (SDK 57), React Native, Expo Router and TypeScript. AI analysis uses
Claude via the Anthropic API, called only from the backend.

```
iOS app ──► /api/v1/claims/analyze (Expo API route, holds the API key) ──► Claude
        ◄── validated, structured analysis ◄──────────────────────────────┘
```

## Running on iPhone (development)

```bash
npm install
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
npm start                    # scan the QR code with the iPhone Camera (Expo Go), or press i for the simulator
```

The dev server also serves the API routes, and the app calls them with relative URLs, so no
extra backend process is needed. The API key stays on your computer and is never sent to the
phone.

## Installable build (demo)

1. Deploy the API routes: `npx expo export -p web && npx eas-cli@latest deploy`, then set
   `ANTHROPIC_API_KEY` as a secret environment variable in EAS Hosting.
2. Point the app at it in `app.json`: `"plugins": [["expo-router", { "origin": "https://<your-deployment>.expo.app" }]]`.
3. Build for iOS: `npx eas-cli@latest build --platform ios` (bundle ID `com.ammarzaidi.trustguardai`).

## Quality checks

```bash
npm test             # Jest: unit, component and API-route tests
npm run lint         # ESLint (also blocks app code from importing src/server)
npm run typecheck    # tsc --noEmit
npm run format:check # Prettier
npm run build        # expo export (iOS/Android bundles + server API routes)
npm run verify       # all of the above
```

## Architecture

```
src/
  app/                    Expo Router screens (home, analyze/{text,claim,image}, result/[id])
    api/v1/claims/        API route: POST /api/v1/claims/analyze (server only)
  server/                 Server-only code: env, Claude analyzer, prompt, schema, rate limit
  components/
    ui/                   Design primitives (text, cards, buttons, notices)
    analysis/             Reusable ResultView, assessment header, evidence list, input form
  core/                   Pure domain logic shared by app and server (fully unit tested)
    api-contract.ts       Wire contract between app and backend
    model/                Guard rails applied to every AI analysis
    claims/ signals/      On-device heuristics (claim extraction, language signals)
    sources/              Source credibility evaluation (heuristic, by outlet type)
    scoring/              Transparent trust scoring
    presentation.ts       User-facing wording for each separate question
  services/
    analysis/pipeline.ts  Orchestrates an analysis end to end
    providers/            Contracts for LLM, evidence search, vision and OCR
                          + remote (backend) and "unavailable" implementations
    http/                 Typed HTTP client (timeouts, network/HTTP/invalid-response errors)
    history/              Recent analyses (on-device AsyncStorage)
```

### How a claim is assessed

1. The app validates the input and runs on-device language checks (sensational framing,
   absolute language, pressure to share and similar), which are labelled as rule-based.
2. The backend asks Claude for a **structured analysis** (JSON schema enforced): the central
   claim, its category, whether it is verifiable at all, a stance
   (`supported` / `contradicted` / `disputed` / `unverifiable`), a calibrated confidence, key
   findings, reasoning, the evidence that would settle it, and the model's limitations.
3. The output is validated and passed through guard rails (`core/model`): confidence is capped
   at 0.9, opinions and predictions are never "verifiable", and an unverifiable claim cannot also
   be "contradicted".
4. `core/scoring` combines the signals into the final label. **The model never decides alone.**
   _Likely reliable_ and _Likely false_ require independent evidence. Until evidence search exists
   (Phase 3), the strongest outcomes are _Possibly misleading_ and _Needs verification_.

### Principles in the code

- **Separate questions stay separate.** Claim support, image authenticity and evidence
  availability are reported independently.
- **No fabricated output.** If AI analysis fails (network, timeout, rate limit, refusal,
  malformed output, missing key), the user gets a specific error and a retry, never a degraded
  "result". Missing services are reported as not connected.
- **API keys never ship in the app.** Only `src/server` and `+api.ts` files read secrets. ESLint
  forbids app code from importing them, and the client bundles have been checked to contain no
  key or prompt.
- **Untrusted input.** Submitted content is passed to the model as data inside `<content>` tags,
  with instructions not to follow anything inside it. The server re-validates input and applies a
  per-client rate limit.

### Backend API

| Endpoint                      | Request                           | Response                                                                                                                                          |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/claims/analyze` | `{ text, mode: "text"\|"claim" }` | `{ extractedClaim, claimType, verifiable, verifiabilityNote, stance, confidence, reasoning, indicators[], evidenceNeeded[], limitations, model }` |

Errors use `{ error: { code, message } }`, where `code` is one of `invalid_request` (400),
`not_configured` (503), `rate_limited` (429), `model_refused` (422), `model_unavailable` (502),
`invalid_model_output` (502) or `internal` (500).

## Roadmap

1. **Foundation (done):** app shell, screens, domain model, modular services, transparent scoring.
2. **AI claim analysis (done):** secure backend route, structured Claude analysis, guard rails.
3. **Evidence retrieval:** web/news search and fact-check lookup, with stance classification.
4. **Image analysis:** vision model for AI-generation/manipulation signals, plus OCR feeding
   extracted claims into verification.
5. **Hardening:** end-to-end failure-mode testing and polish.
