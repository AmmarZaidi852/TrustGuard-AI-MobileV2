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

## Interaction (iOS-first)

- Native multiline input with a capped height, keyboard insets that adjust automatically,
  interactive dismissal, and a dismiss on submit.
- 44 pt minimum touch targets for secondary actions.
- Progress is shown as two steps ("Identifying and assessing the claim" → "Searching the web and
  checking sources"), with an honest time estimate for source checking.
- Errors name the cause (network, timeout, rate limit, model declined, search unavailable) and
  offer a retry.

## Visual language

Calm and serious: neutral surfaces, one accent colour, and semantic tones (positive, caution,
negative, info, neutral) that are used consistently for labels, pills and notices. There are no
celebratory visuals for "reliable" results. Light and dark themes are supported.
