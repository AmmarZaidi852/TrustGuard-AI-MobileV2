import type { SourceAssessment, SourceCategory } from '../types';

/**
 * Heuristic source evaluation based on the *type* of outlet. It is a prior, not a
 * judgment of any specific article, and is intended to be combined with (or
 * replaced by) a maintained credibility dataset later.
 */

const FACT_CHECKERS = [
  'snopes.com',
  'factcheck.org',
  'politifact.com',
  'fullfact.org',
  'africacheck.org',
  'leadstories.com',
  'healthfeedback.org',
  'sciencefeedback.co',
];

const ESTABLISHED_NEWS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'npr.org',
  'theguardian.com',
  'nytimes.com',
  'washingtonpost.com',
  'aljazeera.com',
  'ft.com',
  'economist.com',
  'bloomberg.com',
  'wsj.com',
  'cbc.ca',
  'abc.net.au',
];

const REFERENCE = [
  'wikipedia.org',
  'britannica.com',
  'who.int',
  'un.org',
  'nature.com',
  'science.org',
  'thelancet.com',
  'nejm.org',
  'bmj.com',
  'pubmed.ncbi.nlm.nih.gov',
  'cochranelibrary.com',
];

const USER_GENERATED = [
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'youtube.com',
  'medium.com',
  'substack.com',
  'blogspot.com',
  'wordpress.com',
  'quora.com',
  't.me',
];

const CATEGORY_PROFILE: Record<SourceCategory, { credibility: number; rationale: string }> = {
  government: {
    credibility: 0.8,
    rationale: 'Official government domain. Generally reliable for official data and statements.',
  },
  academic: {
    credibility: 0.8,
    rationale: 'Academic institution. Generally reliable, though individual pages vary.',
  },
  fact_checker: {
    credibility: 0.85,
    rationale: 'Established fact-checking organisation with published methodology.',
  },
  established_news: {
    credibility: 0.75,
    rationale: 'Established news organisation with editorial standards and corrections policies.',
  },
  reference: {
    credibility: 0.75,
    rationale: 'Recognised reference or scientific publisher.',
  },
  user_generated: {
    credibility: 0.25,
    rationale:
      'User-generated platform. Anyone can publish here; treat as a lead, not as evidence.',
  },
  unknown: {
    credibility: 0.45,
    rationale: 'Unrecognised source. Its reliability could not be assessed automatically.',
  },
};

export function extractDomain(url: string): string | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?([^/:?#]+)/i.exec(url.trim());
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/^www\./, '');
  return host.includes('.') ? host : null;
}

function matchesDomain(host: string, list: string[]): boolean {
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function categorizeDomain(host: string): SourceCategory {
  if (matchesDomain(host, FACT_CHECKERS)) return 'fact_checker';
  if (matchesDomain(host, REFERENCE)) return 'reference';
  if (/(^|\.)(gov|mil)(\.[a-z]{2})?$/.test(host) || /\.gov\.[a-z]{2}$/.test(host))
    return 'government';
  if (/(^|\.)edu(\.[a-z]{2})?$/.test(host) || /\.ac\.[a-z]{2}$/.test(host)) return 'academic';
  if (matchesDomain(host, ESTABLISHED_NEWS)) return 'established_news';
  if (matchesDomain(host, USER_GENERATED)) return 'user_generated';
  return 'unknown';
}

export function evaluateSource(url: string): SourceAssessment {
  const domain = extractDomain(url);
  const category = domain ? categorizeDomain(domain) : 'unknown';
  const profile = CATEGORY_PROFILE[category];
  return {
    domain: domain ?? 'unknown',
    category,
    credibility: profile.credibility,
    rationale: profile.rationale,
  };
}

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  government: 'Government',
  academic: 'Academic',
  fact_checker: 'Fact-checker',
  established_news: 'Established news',
  reference: 'Reference / scientific',
  user_generated: 'User-generated',
  unknown: 'Unrecognised',
};
