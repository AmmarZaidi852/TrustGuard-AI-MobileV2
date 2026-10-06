import type { ClaimType, ExtractedClaim } from '../types';

/**
 * Heuristic claim extraction. Runs on-device so every analysis has a
 * claim to show. A model-based extractor can replace or refine it later
 * (see `ModelClaimAnalysis`). Results are marked `method: 'heuristic'`.
 */

const LEADING_TAGS =
  /^\s*(breaking( news)?|just in|urgent|update|alert|news|fact|confirmed|viral)\s*[:!\-–—|]+\s*/i;

const OPINION_MARKERS =
  /\b(i think|i believe|i feel|in my opinion|imo|should|ought to|best|worst|beautiful|ugly|overrated|underrated)\b/i;
const PREDICTION_MARKERS = /\b(will|is going to|are going to|next (year|month|week)|by 20\d\d)\b/i;
const HEALTH_SCIENCE_TERMS =
  /\b(cancer|vaccine|virus|covid|disease|cure[sd]?|health|scientists?|study|studies|research|clinical|doctors?|medic(al|ine)|drug|diet|nasa|climate|species|dna|planet|mars)\b/i;
const NEWS_VERBS =
  /\b(announced|arrested|discovered|confirmed|resigned|banned|launched|killed|died|elected|declared|revealed|signed|approved)\b/i;
const STAT_MARKERS =
  /(\d+(\.\d+)?\s?%|\bpercent\b|\b\d{1,3}(,\d{3})+\b|\b\d+\s?(million|billion|thousand)\b)/i;
const QUOTE_MARKERS =
  /["“”].{6,}["“”].*\b(said|says|stated|wrote|claimed)\b|\b(said|says|stated)\b.*["“”]/i;
const FACTUAL_VERBS =
  /\b(is|are|was|were|has|have|had|causes?|prevents?|cures?|contains?|kills?|leads? to|increases?|reduces?|shows?|found|proves?)\b/i;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(LEADING_TAGS, '').trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 3);
}

function countProperNouns(sentence: string): number {
  // Capitalised words that are not the first word of the sentence.
  const words = sentence.split(/\s+/).slice(1);
  return words.filter((word) => /^[A-Z][a-z]+/.test(word)).length;
}

/** 0..1 — how concrete and therefore checkable a statement is. */
export function scoreSpecificity(sentence: string): number {
  let score = 0.2;
  if (/\d/.test(sentence)) score += 0.2;
  if (
    /\b(19|20)\d{2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      sentence,
    )
  )
    score += 0.15;
  score += Math.min(0.25, countProperNouns(sentence) * 0.1);
  if (/\b(according to|published in|reported by)\b/i.test(sentence)) score += 0.15;
  if (/\b(some|many|they|people|everyone|someone|things)\b/i.test(sentence)) score -= 0.1;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function classifyClaim(sentence: string): ClaimType {
  if (OPINION_MARKERS.test(sentence)) return 'opinion';
  if (QUOTE_MARKERS.test(sentence)) return 'quote_attribution';
  if (PREDICTION_MARKERS.test(sentence) && !NEWS_VERBS.test(sentence)) return 'prediction';
  if (STAT_MARKERS.test(sentence)) return 'statistical';
  if (HEALTH_SCIENCE_TERMS.test(sentence)) return 'scientific_health';
  if (NEWS_VERBS.test(sentence)) return 'event_news';
  if (FACTUAL_VERBS.test(sentence)) return 'factual';
  return 'unknown';
}

function claimWeight(sentence: string): number {
  let weight = scoreSpecificity(sentence);
  if (FACTUAL_VERBS.test(sentence)) weight += 0.3;
  if (NEWS_VERBS.test(sentence)) weight += 0.2;
  if (sentence.trim().endsWith('?')) weight -= 0.5;
  if (OPINION_MARKERS.test(sentence)) weight -= 0.3;
  if (/\b(share|forward|repost|like and)\b/i.test(sentence)) weight -= 0.4;
  return weight;
}

export interface ClaimExtraction {
  claim: ExtractedClaim | null;
  keyStatements: string[];
}

export function extractClaims(text: string, maxStatements = 5): ClaimExtraction {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return { claim: null, keyStatements: [] };
  }

  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, weight: claimWeight(sentence) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  const main = ranked[0].sentence;
  const keyStatements = ranked
    .filter((entry) => entry.weight > 0.3)
    .slice(0, maxStatements)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);

  return { claim: buildClaim(main), keyStatements };
}

/** Treats the whole input as one claim (used by "Analyze Claim"). */
export function extractSingleClaim(text: string): ExtractedClaim | null {
  const cleaned = text.replace(LEADING_TAGS, '').trim();
  if (!cleaned) return null;
  return buildClaim(cleaned);
}

function buildClaim(sentence: string): ExtractedClaim {
  const type = classifyClaim(sentence);
  return {
    text: sentence,
    type,
    checkable: type !== 'opinion' && type !== 'prediction',
    specificity: scoreSpecificity(sentence),
    method: 'heuristic',
  };
}

const EVIDENCE_NEEDED: Record<ClaimType, string[]> = {
  scientific_health: [
    'Peer-reviewed studies or systematic reviews on the topic',
    'Guidance from public health or scientific bodies (e.g. WHO, national health agencies)',
    'Whether the original research is quoted accurately and in full',
  ],
  event_news: [
    'Reports from several independent, established news outlets',
    'An official statement from the people or organisations involved',
    'The original date and location of the event',
  ],
  statistical: [
    'The original dataset or report the number comes from',
    'How the figure was measured and over what period',
    'Independent sources reporting the same figure',
  ],
  quote_attribution: [
    'The original recording, transcript or publication of the quote',
    'The full context in which it was said',
  ],
  factual: [
    'Authoritative reference sources on the subject',
    'Independent sources that confirm or dispute the statement',
  ],
  opinion: [
    'Opinions cannot be verified as true or false — check the facts the opinion relies on instead',
  ],
  prediction: [
    'Predictions cannot be verified until the event happens — check who is making it and on what basis',
  ],
  unknown: ['A clearer statement of what is being claimed', 'Independent sources on the topic'],
};

export function describeEvidenceNeeded(claim: ExtractedClaim | null): string[] {
  return EVIDENCE_NEEDED[claim?.type ?? 'unknown'];
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  factual: 'Factual statement',
  statistical: 'Statistical claim',
  scientific_health: 'Scientific / health claim',
  event_news: 'News or event claim',
  quote_attribution: 'Quote or attribution',
  opinion: 'Opinion',
  prediction: 'Prediction',
  unknown: 'Unclassified',
};
