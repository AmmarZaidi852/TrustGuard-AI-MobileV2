import type { ImageClaim, ImageClaimAnalysis } from '../types';

/**
 * Guard rails for Claude's reading of an image, applied on the server and again
 * in the app. They stop the model from turning unreadable or invented text into
 * a claim that then gets "verified":
 *
 * - at most `MAX_IMAGE_CLAIMS` claims;
 * - a claim is only checkable if it is presented as fact, is not an opinion or
 *   prediction, and its quote actually appears in the transcribed text;
 * - nothing is checkable when the text is unreadable or there is no text;
 * - claims must be complete statements (3+ words), like typed claims;
 * - the primary claim must be checkable, otherwise the first checkable one is used.
 */

export const MAX_IMAGE_CLAIMS = 3;
const MAX_FIELD = 600;
const MAX_TRANSCRIPT = 2000;

const clip = (text: string, max = MAX_FIELD) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Lower-case, punctuation-free, single-spaced text for robust substring checks. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quoted text really appears in the transcription. */
export function isGrounded(quote: string, visibleText: string): boolean {
  const needle = normalizeForMatch(quote.replace(/\[illegible\]/gi, ' '));
  if (needle.length < 8) return false;
  return normalizeForMatch(visibleText).includes(needle);
}

function guardClaim(claim: ImageClaim, visibleText: string, textUsable: boolean): ImageClaim {
  const quote = clip(claim.quote);
  const grounded = textUsable && isGrounded(quote, visibleText);
  const partial = claim.readability === 'partial' || /\[illegible\]/i.test(quote);
  const notCheckableType = claim.claimType === 'opinion' || claim.claimType === 'prediction';
  return {
    ...claim,
    text: clip(claim.text, 500),
    context: clip(claim.context),
    quote,
    readability: partial ? 'partial' : 'clear',
    grounded,
    // Must also be a complete statement, as typed claims are (see validateTextInput).
    checkable:
      grounded &&
      claim.isFactual &&
      !notCheckableType &&
      claim.text.trim().split(/\s+/).length >= 3,
  };
}

export function guardImageAnalysis(analysis: ImageClaimAnalysis): ImageClaimAnalysis {
  const visibleText = analysis.visibleText.trim().slice(0, MAX_TRANSCRIPT);
  const textUsable = analysis.readability === 'clear' || analysis.readability === 'partial';
  const claims = analysis.claims
    .filter((claim) => claim.text.trim().length > 0)
    .slice(0, MAX_IMAGE_CLAIMS)
    .map((claim) => guardClaim(claim, visibleText, textUsable));

  const requested = analysis.primaryClaimIndex;
  const primaryClaimIndex =
    requested !== null && requested >= 0 && requested < claims.length && claims[requested].checkable
      ? requested
      : (() => {
          const first = claims.findIndex((claim) => claim.checkable);
          return first >= 0 ? first : null;
        })();

  return {
    ...analysis,
    description: clip(analysis.description),
    visibleText,
    claims,
    primaryClaimIndex,
    uncertainty: clip(analysis.uncertainty),
  };
}

export function primaryImageClaim(analysis: ImageClaimAnalysis): ImageClaim | null {
  return analysis.primaryClaimIndex === null
    ? null
    : (analysis.claims[analysis.primaryClaimIndex] ?? null);
}
