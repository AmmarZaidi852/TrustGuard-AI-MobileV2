# Design

## Product stance

TrustGuardAI helps people decide whether to trust content **before** believing or sharing it.
It is an analysis aid, not a lie detector. The design follows from that:

- **Probabilistic, not binary.** Six labels: _Likely reliable_, _Possibly misleading_,
  _Needs verification_, _Likely false_, _Cannot verify_, _Insufficient evidence_. Not knowing is
  never presented as "false".
- **Separate questions stay separate.** "Is the claim supported?", "Does the image appear
  authentic?" and "What evidence is available?" are answered independently on every result.
- **Evidence over opinion.** A source-backed check (Phase 3) can reach _Likely reliable_ /
  _Likely false_. The AI's own knowledge alone (Phase 2) cannot. The home screen says so, and it
  also says source checking is not a guarantee of truth.
- **No fabricated output.** If a step did not run, the result says so. Failed source checking
  produces a clearly marked AI-only result ("not source-verified"), never a confident one.

## Result screen hierarchy

Ordered by the questions a user asks:

1. **What is being claimed?** The claim, its category, and whether the AI or the on-device
   heuristic identified it.
2. **How trustworthy does it appear?** Label, one-paragraph summary, trust score (or "Not
   scored"), confidence (with an explanation that it is not the probability of truth), risk.
3. A **partial analysis** notice if any check did not run.
4. **Separate questions**: claim support / image authenticity / evidence availability.
5. **What we found**: indicators, labelled as rule-based or reported by AI.
6. **Why**: short reasoning lines (no raw model output beyond the 2–4 sentence explanation).
7. **Sources**:
   - a headline that makes the situation obvious: _Supporting evidence found_ /
     _Contradicting evidence found_ / _Sources are mixed_ / _Not enough reliable sources_ /
     _Source checking unavailable_;
   - three separated statements: **what the sources say**, **what can be inferred**, **what
     remains uncertain**;
   - one card per source: relationship (Supports / Contradicts / Context), relevance, outlet type
     and heuristic credibility, title, domain and date, a one-line relevance explanation, the
     passage quoted from the source, and an **Open source** link (opens in the system browser);
   - the search queries used, and the evidence that would settle the question.
     The section works with any number of sources, including none.
8. **Recommended next step**, then a collapsible "How this assessment was made" (factor values,
   weights and which checks ran).

## Image analysis

- **Input:** choose an image from the library, see it at its own aspect ratio (capped height),
  then **Replace** or **Remove** it (44 pt controls). Unsupported, damaged or oversized images
  are explained immediately after picking and **Analyze** stays disabled. A short card explains
  what happens: up to 3 claims read, the main one checked against sources, jokes and opinions
  not treated as facts, no judgement of whether the image is AI-generated, and the image not
  stored.
- **Progress:** three steps: reading the image → assessing the main claim → checking sources.
- **Result:** an "Analyzed from an image" header (thumbnail in the current session, otherwise a
  "not stored" placeholder; image type; readability), then the normal hierarchy (claim, verdict,
  confidence, separate questions), a "Claims in the image" card (each claim with status, the
  main claim marked "Checked below", others with **Check this claim**, plus what couldn't be
  read), the transcribed text, findings (including a warning if the image contains instructions
  aimed at AI), and the same Sources section as text.
- If no claim can be checked, the result is _Cannot verify_ with a plain explanation, never a
  verdict about truth.

## Interaction (iOS-first)

- Native multiline input with a capped height, keyboard insets that adjust automatically,
  interactive dismissal, and a dismiss on submit.
- 44 pt minimum touch targets for secondary actions.
- The image picker needs no permission prompt on current iOS (system photo picker); the
  `photosPermission` text is configured for older versions. Text and image entry are separate
  screens, so the keyboard never overlaps image controls.
- Progress is shown as two steps ("Identifying and assessing the claim" → "Searching the web and
  checking sources"), with an honest time estimate for source checking.
- Errors name the cause (network, timeout, rate limit, model declined, search unavailable) and
  offer a retry.

## Visual language

Calm and serious: neutral surfaces, one accent colour, and semantic tones (positive, caution,
negative, info, neutral) that are used consistently for labels, pills and notices. There are no
celebratory visuals for "reliable" results. Light and dark themes are supported.
