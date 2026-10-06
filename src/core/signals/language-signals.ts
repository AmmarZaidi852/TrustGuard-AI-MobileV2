import type { Indicator } from '../types';

/**
 * Deterministic language heuristics. These detect *framing patterns* that are
 * common in misleading content. They say nothing about whether a claim is true,
 * and are always labelled with origin `heuristic`.
 */

interface PatternRule {
  id: string;
  label: string;
  description: string;
  weight: number;
  pattern: RegExp;
}

const RULES: PatternRule[] = [
  {
    id: 'sensational_framing',
    label: 'Sensational framing',
    description:
      'Headline-style hooks such as "BREAKING" or "shocking" are used to grab attention.',
    weight: 0.3,
    pattern:
      /\b(breaking|shocking|bombshell|you won'?t believe|mind[- ]blowing|explosive|jaw[- ]dropping)\b/i,
  },
  {
    id: 'absolute_language',
    label: 'Absolute language',
    description:
      'Words like "completely", "always" or "100%" overstate certainty. Real findings are rarely absolute.',
    weight: 0.3,
    pattern:
      /\b(completely|totally|always|never|guarantee[ds]?|100\s?%|proven|definitively|cures?|eliminates?|every single)\b/i,
  },
  {
    id: 'urgency_or_share_pressure',
    label: 'Pressure to share or act',
    description:
      'Urging people to share quickly is a common tactic for spreading unverified content.',
    weight: 0.35,
    pattern:
      /\b(share (this|now|before|with everyone)|before (it'?s|they) (deleted|removed|taken down)|forward (this|to)|urgent(ly)?|act now|spread the word)\b/i,
  },
  {
    id: 'vague_authority',
    label: 'Vague or unnamed authority',
    description:
      'Appeals to unnamed "scientists", "experts" or "studies" without saying who or where.',
    weight: 0.25,
    pattern:
      /\b((some |many |top )?(scientists|experts|doctors|researchers|studies|sources|insiders)( have)? (say|says|said|confirm(ed|s)?|show(ed|s)?|found|reveal(ed|s)?|prove[ds]?))\b/i,
  },
  {
    id: 'conspiracy_framing',
    label: 'Suppression narrative',
    description:
      'Claims that information is being hidden ("they don\'t want you to know") cannot easily be checked.',
    weight: 0.35,
    pattern:
      /\b(they don'?t want you to know|what (they|the media) (won'?t|aren'?t) tell(ing)? you|cover[- ]?up|mainstream media (hides|won'?t)|wake up)\b/i,
  },
  {
    id: 'emotional_language',
    label: 'Emotionally charged language',
    description: 'Strong emotional wording can push readers to react before evaluating.',
    weight: 0.2,
    pattern:
      /\b(outrageous|terrifying|disgusting|horrifying|evil|destroy(s|ed)?|disaster|panic)\b/i,
  },
];

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function detectLanguageSignals(text: string): Indicator[] {
  const indicators: Indicator[] = [];

  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      indicators.push({
        id: rule.id,
        label: rule.label,
        description: rule.description,
        direction: 'raises_concern',
        weight: rule.weight,
        origin: 'heuristic',
        excerpt: excerptAround(text, match.index, match[0].length),
      });
    }
  }

  const letters = text.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 20 && upper.length / letters.length > 0.5) {
    indicators.push({
      id: 'excessive_capitals',
      label: 'Excessive capital letters',
      description: 'Large amounts of capitalised text are typical of attention-seeking posts.',
      direction: 'raises_concern',
      weight: 0.15,
      origin: 'heuristic',
    });
  }

  if (/!{2,}|(!.*){3,}/.test(text)) {
    indicators.push({
      id: 'excessive_punctuation',
      label: 'Excessive exclamation marks',
      description: 'Repeated exclamation marks signal emotional rather than informative framing.',
      direction: 'raises_concern',
      weight: 0.1,
      origin: 'heuristic',
    });
  }

  if (
    /\b(according to|published in|reported by|data from)\b/i.test(text) ||
    /https?:\/\//.test(text)
  ) {
    indicators.push({
      id: 'cites_source',
      label: 'Cites a source',
      description:
        'The text attributes information to a specific source. The source still needs to be checked.',
      direction: 'supports_reliability',
      weight: 0.15,
      origin: 'heuristic',
    });
  }

  return indicators;
}

/**
 * Combined 0..1 intensity of concerning language signals, using a noisy-OR so that
 * several weak signals add up without any single one dominating.
 */
export function languageConcernIntensity(indicators: Indicator[]): number {
  let product = 1;
  for (const indicator of indicators) {
    if (indicator.origin === 'heuristic') {
      const w = indicator.direction === 'raises_concern' ? indicator.weight : -indicator.weight / 2;
      product *= 1 - Math.max(-0.5, Math.min(1, w));
    }
  }
  return Math.max(0, Math.min(1, 1 - product));
}
