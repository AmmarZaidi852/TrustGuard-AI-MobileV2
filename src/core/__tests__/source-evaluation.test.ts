import { categorizeDomain, evaluateSource, extractDomain } from '../sources/source-evaluation';

describe('extractDomain', () => {
  it.each([
    ['https://www.bbc.co.uk/news/1', 'bbc.co.uk'],
    ['http://user@Example.com:8080/x', 'example.com'],
    ['reuters.com/article', 'reuters.com'],
    ['not a url', null],
  ])('%s → %s', (url, domain) => expect(extractDomain(url)).toBe(domain));
});

describe('categorizeDomain', () => {
  it.each([
    ['cdc.gov', 'government'],
    ['nhs.gov.uk', 'government'],
    ['mit.edu', 'academic'],
    ['ox.ac.uk', 'academic'],
    ['snopes.com', 'fact_checker'],
    ['edition.reuters.com', 'established_news'],
    ['en.wikipedia.org', 'reference'],
    ['someone.blogspot.com', 'user_generated'],
    ['notgov.com', 'unknown'],
    ['random-news-site.xyz', 'unknown'],
  ])('%s → %s', (host, category) => expect(categorizeDomain(host)).toBe(category));
});

test('user-generated sources rank below fact-checkers and include a rationale', () => {
  const social = evaluateSource('https://x.com/someone/status/1');
  const checker = evaluateSource('https://www.factcheck.org/2024/01/x');
  expect(social.credibility).toBeLessThan(checker.credibility);
  expect(social.rationale).toMatch(/lead, not as evidence/);
});
