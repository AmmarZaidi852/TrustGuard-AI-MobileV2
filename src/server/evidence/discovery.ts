import type Anthropic from '@anthropic-ai/sdk';

import type { EvidenceSearchRequest } from '@/core/api-contract';
import { evaluateSource, extractDomain } from '@/core/sources/source-evaluation';
import { validateSourceUrl } from '@/core/sources/url-safety';

import { ApiError, mapAnthropicError } from '../api-error';
import {
  BLOCKED_SEARCH_DOMAINS,
  DISCOVERY_SYSTEM_PROMPT,
  buildDiscoveryUserMessage,
} from './prompts';
import { clipText } from './untrusted';

/**
 * Source discovery with Claude's server-side web search tool. The search runs on
 * Anthropic's infrastructure; this server never fetches URLs itself.
 *
 * Sources are built ONLY from provider-generated data: `web_search_tool_result`
 * blocks (real search results) and `web_search_result_location` citations, whose
 * `cited_text` is quoted from the page by the API. URLs or text the model writes
 * in prose are ignored, so the model cannot invent a source or an excerpt.
 */

export interface DiscoveredSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  excerpts: string[];
  pageAge?: string;
}

export interface DiscoveryResult {
  sources: DiscoveredSource[];
  queries: string[];
  /** Cited sources dropped for unsafe URLs or missing data. */
  rejected: number;
}

export const DISCOVERY_LIMITS = {
  maxSearches: 3,
  maxSources: 6,
  maxPerDomain: 2,
  maxExcerptsPerSource: 2,
  maxExcerptLength: 400,
  maxTitleLength: 200,
  maxContinuations: 2,
} as const;

type Block = Record<string, unknown>;
const isBlock = (value: unknown): value is Block => typeof value === 'object' && value !== null;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

interface Candidate {
  url: string;
  title: string;
  excerpts: string[];
  pageAge?: string;
  order: number;
}

/** Pure extraction of sources from response content blocks. Exported for tests. */
export function extractDiscoveredSources(content: unknown[]): DiscoveryResult & {
  searchErrors: string[];
  successfulSearches: number;
} {
  const queries: string[] = [];
  const searchErrors: string[] = [];
  const results = new Map<string, { title: string; pageAge?: string }>();
  const cited = new Map<string, Candidate>();
  let successfulSearches = 0;
  let rejected = 0;
  const rejectedUrls = new Set<string>();

  for (const block of content) {
    if (!isBlock(block)) continue;

    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const query = isBlock(block.input) ? text(block.input.query) : '';
      if (query) queries.push(clipText(query, 200));
    }

    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        successfulSearches += 1;
        for (const result of block.content) {
          if (!isBlock(result) || result.type !== 'web_search_result') continue;
          const url = validateSourceUrl(result.url);
          if (url && !results.has(url)) {
            results.set(url, {
              title: text(result.title),
              pageAge: text(result.page_age) || undefined,
            });
          }
        }
      } else if (isBlock(block.content)) {
        searchErrors.push(text(block.content.error_code) || 'unknown');
      }
    }

    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const citation of block.citations) {
        if (!isBlock(citation) || citation.type !== 'web_search_result_location') continue;
        const rawUrl = text(citation.url);
        const url = validateSourceUrl(rawUrl);
        const excerpt = clipText(text(citation.cited_text), DISCOVERY_LIMITS.maxExcerptLength);
        if (!url || !excerpt) {
          if (rawUrl && !rejectedUrls.has(rawUrl)) {
            rejectedUrls.add(rawUrl);
            rejected += 1;
          }
          continue;
        }
        const existing = cited.get(url);
        if (existing) {
          if (
            existing.excerpts.length < DISCOVERY_LIMITS.maxExcerptsPerSource &&
            !existing.excerpts.includes(excerpt)
          ) {
            existing.excerpts.push(excerpt);
          }
        } else {
          cited.set(url, {
            url,
            title: text(citation.title),
            excerpts: [excerpt],
            order: cited.size,
          });
        }
      }
    }
  }

  // Prefer authoritative outlets, then first-cited order; cap per domain and overall.
  const ranked = [...cited.values()].sort(
    (a, b) =>
      evaluateSource(b.url).credibility - evaluateSource(a.url).credibility || a.order - b.order,
  );
  const perDomain = new Map<string, number>();
  const sources: DiscoveredSource[] = [];
  for (const candidate of ranked) {
    const domain = extractDomain(candidate.url);
    if (!domain) {
      rejected += 1;
      continue;
    }
    const count = perDomain.get(domain) ?? 0;
    if (count >= DISCOVERY_LIMITS.maxPerDomain || sources.length >= DISCOVERY_LIMITS.maxSources) {
      continue;
    }
    perDomain.set(domain, count + 1);
    const result = results.get(candidate.url);
    sources.push({
      id: `S${sources.length + 1}`,
      title: clipText(candidate.title || result?.title || domain, DISCOVERY_LIMITS.maxTitleLength),
      url: candidate.url,
      domain,
      excerpts: candidate.excerpts,
      pageAge: candidate.pageAge ?? result?.pageAge,
    });
  }

  return { sources, queries, rejected, searchErrors, successfulSearches };
}

/** The subset of the SDK client this module uses, so tests can substitute it. */
export type CreateClient = Pick<Anthropic, 'beta'>;

export type SourceDiscoverer = (request: EvidenceSearchRequest) => Promise<DiscoveryResult>;

export function createSourceDiscoverer({
  client,
  model,
  now = () => new Date(),
}: {
  client: CreateClient;
  model: string;
  now?: () => Date;
}): SourceDiscoverer {
  return async (request) => {
    const userMessage = {
      role: 'user' as const,
      content: buildDiscoveryUserMessage(request, now().toISOString().slice(0, 10)),
    };
    const collected: Anthropic.Beta.BetaContentBlock[] = [];
    let messages: Anthropic.Beta.BetaMessageParam[] = [userMessage];

    for (let attempt = 0; attempt <= DISCOVERY_LIMITS.maxContinuations; attempt += 1) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 8000,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: DISCOVERY_SYSTEM_PROMPT,
          tools: [
            {
              type: 'web_search_20260209',
              name: 'web_search',
              max_uses: DISCOVERY_LIMITS.maxSearches,
              blocked_domains: BLOCKED_SEARCH_DOMAINS,
            },
          ],
          messages,
        });
      } catch (error) {
        throw mapAnthropicError(error);
      }

      if (response.stop_reason === 'refusal') {
        throw new ApiError('model_refused', 'The AI model declined to search for this claim.');
      }
      collected.push(...response.content);

      // The server-side search loop can pause; resume by sending the turn back as-is.
      if (response.stop_reason !== 'pause_turn') break;
      messages = [userMessage, { role: 'assistant', content: [...collected] }];
    }

    const result = extractDiscoveredSources(collected);
    if (result.successfulSearches === 0 && result.searchErrors.length > 0) {
      throw new ApiError(
        'search_unavailable',
        `Web search failed (${[...new Set(result.searchErrors)].join(', ')}).`,
      );
    }
    return { sources: result.sources, queries: result.queries, rejected: result.rejected };
  };
}
