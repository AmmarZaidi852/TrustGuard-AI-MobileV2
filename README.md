# TrustGuardAI Mobile

**Check what you see before you trust it.**

TrustGuardAI is an iOS app that helps people question digital content before trusting or sharing
it. It is an analysis and verification assistant, not an AI lie detector. Every result says what
is being claimed, how trustworthy it appears, why, and what evidence supports that assessment,
without claiming more certainty than the evidence allows.

Built iOS-first with Expo (SDK 57), React Native, Expo Router and TypeScript. AI analysis and
web source checking use Claude via the Anthropic API, called only from the backend.

```
iOS app ──► /api/v1/claims/analyze ──► Claude: what is claimed, knowledge-based assessment
        ──► /api/v1/evidence/search ──► Claude web search ──► sources (provider citations)
                                    ──► Claude evaluates the claim against those sources
                                    ──► code guard rails ──► sources + source-backed verdict
```

**AI opinion → external evidence → source-aware evaluation → transparent uncertainty.**
Source-backed checks can reach _Likely reliable_ or _Likely false_; the AI's own knowledge alone
cannot. Neither is a guarantee of truth.

Further docs: [ARCHITECTURE.md](ARCHITECTURE.md) (pipeline, source discovery, verdict logic,
failure behaviour, security) · [DESIGN.md](DESIGN.md) (product stance, result screen) ·
[PROJECT_MEMORY.md](PROJECT_MEMORY.md) (phase status and verification log).

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

1. On-device checks: input validation, language signals (labelled rule-based).
2. **AI claim analysis** (structured output): the central claim, its category, whether it is
   verifiable, a knowledge-based stance and calibrated confidence. Required: if it fails, the user
   gets a specific error and a retry.
3. **Source discovery**: Claude's server-side web search, with social and user-generated
   platforms blocked. Sources are built only from API-generated citations (real URL plus a
   passage quoted from the page). URLs are validated, and at most 6 compact sources are returned.
4. **Source-backed evaluation**: Claude judges the claim only against those excerpts, per source
   (supports / contradicts / context, relevance) and overall (supported / contradicted / mixed /
   insufficient evidence / cannot verify), separating what the sources say, what can be
   inferred, and what remains uncertain.
5. **Guard rails** in code: a verdict must be backed by a matching source; credible
   disagreement becomes "mixed"; confidence is capped by evidence strength (relevance × outlet
   credibility) and by 0.9 overall, so more sources do not mean more confidence.
6. **Scoring** maps all of this to the final label (see ARCHITECTURE.md → Verdict logic).

If source checking fails, the result is an AI-only assessment, clearly marked as not
source-verified, and it can never be _Likely reliable_ or _Likely false_.

### Principles in the code

- **Separate questions stay separate.** Claim support, image authenticity and evidence
  availability are reported independently.
- **No fabricated output.** Failed steps are reported as failed or unavailable, never filled in.
- **API keys never ship in the app.** Only `src/server` and `+api.ts` files read secrets. ESLint
  forbids app imports of them, and the client bundles have been checked to contain no key or prompt.
- **Untrusted input, untrusted sources.** Claims and retrieved page text are escaped and tagged
  as data in prompts. Code-level guard rails mean an injected instruction cannot produce an
  unbacked verdict, add sources, or raise confidence. Source URLs are validated on the server and
  again before the app opens them.

### Backend API

| Endpoint                       | Request                           | Response                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/claims/analyze`  | `{ text, mode: "text"\|"claim" }` | `{ extractedClaim, claimType, verifiable, verifiabilityNote, stance, confidence, reasoning, indicators[], evidenceNeeded[], limitations, model }`                                                                                                         |
| `POST /api/v1/evidence/search` | `{ claim, claimType }`            | `{ sources: [{ id, title, url, domain, excerpt, relationship, relevance, explanation, publishedAt? }], evaluation: { verdict, confidence, whatSourcesSay, inference, uncertainty, missingEvidence[], searchQueries[], model } \| null, rejectedSources }` |

Errors use `{ error: { code, message } }` with `code` in `invalid_request` (400),
`not_configured` (503), `rate_limited` (429), `model_refused` (422), `model_unavailable` (502),
`invalid_model_output` (502), `timeout` (504), `search_unavailable` (503), `evaluation_failed`
(502) or `internal` (500).

## Roadmap

1. **Foundation (done):** app shell, screens, domain model, modular services, transparent scoring.
2. **AI claim analysis (done):** secure backend route, structured Claude analysis, guard rails.
3. **Source discovery and source-backed verification (done):** Claude web search, citation-only
   sources, structured evaluation, guard rails, Sources UI.
4. **Image analysis:** vision model for AI-generation/manipulation signals, plus OCR feeding
   extracted claims into verification.
5. **Hardening:** end-to-end failure-mode testing and polish.
