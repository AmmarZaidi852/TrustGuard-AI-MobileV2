import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { AnalysisResult } from '@/core/types';
import { analyzeText } from '@/services/analysis/pipeline';
import type { RetrievedEvidence } from '@/services/providers/types';
import {
  mockContradictingEvidence,
  mockEvaluationContradicted,
  mockEvaluationMixed,
  mockModelContradicted,
  mockProviders,
  sourceSearch,
} from '@/test/fixtures';

import { EvidenceList, openSource } from '../analysis/evidence-list';
import { ResultView } from '../analysis/result-view';

const COFFEE =
  'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.';

async function resultWith(
  evidence: Parameters<typeof mockProviders>[0]['evidence'],
): Promise<AnalysisResult> {
  return analyzeText(COFFEE, 'text', mockProviders({ model: mockModelContradicted, evidence }));
}

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

describe('Sources section', () => {
  it('renders zero sources with a clear "not enough sources" state', async () => {
    await render(<EvidenceList result={await resultWith(sourceSearch([], null))} />);
    expect(screen.getByText('Not enough reliable sources')).toBeTruthy();
    expect(screen.queryByTestId(/^source-evidence/)).toBeNull();
    expect(screen.queryByTestId('source-evaluation')).toBeNull();
  });

  it('renders one source with metadata, relationship, explanation and excerpt', async () => {
    const result = await resultWith(
      sourceSearch([mockContradictingEvidence[0]], mockEvaluationContradicted),
    );
    await render(<EvidenceList result={result} />);
    const item = mockContradictingEvidence[0];
    expect(screen.getByText('Contradicting evidence found')).toBeTruthy();
    expect(screen.getByText(item.title)).toBeTruthy();
    expect(screen.getByText('Contradicts')).toBeTruthy();
    expect(screen.getByText('High relevance')).toBeTruthy();
    expect(screen.getByText(item.explanation!)).toBeTruthy();
    expect(screen.getByText(`“${item.snippet}”`)).toBeTruthy();
    expect(screen.getByText(/cancer\.gov|National Cancer Institute/)).toBeTruthy();
    expect(screen.getByText(mockEvaluationContradicted.whatSourcesSay)).toBeTruthy();
    expect(screen.getByText(mockEvaluationContradicted.inference)).toBeTruthy();
    expect(screen.getByText(mockEvaluationContradicted.uncertainty)).toBeTruthy();
    expect(screen.getByText(/Searched for: “coffee prevents cancer”/)).toBeTruthy();
  });

  it('renders multiple and conflicting sources', async () => {
    const result = await resultWith(sourceSearch(mockContradictingEvidence, mockEvaluationMixed));
    await render(<EvidenceList result={result} />);
    expect(screen.getByText('Sources are mixed')).toBeTruthy();
    expect(screen.getAllByText('Contradicts')).toHaveLength(2);
    expect(screen.getAllByText('Supports')).toHaveLength(1);
    for (const item of mockContradictingEvidence) {
      expect(screen.getByText(item.title)).toBeTruthy();
    }
  });

  it('opens source links externally', async () => {
    const result = await resultWith(
      sourceSearch([mockContradictingEvidence[0]], mockEvaluationContradicted),
    );
    await render(<EvidenceList result={result} />);
    const link = screen.getByTestId('source-link-evidence-0');
    expect(link.props.accessibilityRole).toBe('link');
    fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith(mockContradictingEvidence[0].url);
  });

  it('never opens an unsafe URL, even from stored data', async () => {
    expect(await openSource('javascript:alert(1)')).toBe(false);
    expect(openURL).not.toHaveBeenCalled();

    const result = await resultWith(
      sourceSearch([mockContradictingEvidence[0]], mockEvaluationContradicted),
    );
    const tampered: AnalysisResult = {
      ...result,
      evidence: [{ ...result.evidence[0], url: 'http://localhost/admin' }],
    };
    await render(<EvidenceList result={tampered} />);
    expect(screen.queryByTestId('source-link-evidence-0')).toBeNull();
  });

  it('explains when source checking was unavailable', async () => {
    const { networkError } = jest.requireActual('@/test/fixtures');
    await render(<EvidenceList result={await resultWith(networkError())} />);
    expect(screen.getByText('Source checking unavailable')).toBeTruthy();
    expect(screen.getByText(/not source-verified/)).toBeTruthy();
  });

  it('renders inside the full result view without depending on a fixed source count', async () => {
    const sources: RetrievedEvidence[] = Array.from({ length: 5 }, (_, i) => ({
      ...mockContradictingEvidence[0],
      title: `[mock] Source ${i}`,
      url: `https://www.nih.gov/s${i}`,
    }));
    await render(
      <ResultView result={await resultWith(sourceSearch(sources, mockEvaluationContradicted))} />,
    );
    expect(screen.getByText('Sources')).toBeTruthy();
    expect(screen.getAllByText(/\[mock\] Source \d/)).toHaveLength(5);
  });

  it('still renders results stored before source checking existed', async () => {
    const result = await resultWith(sourceSearch([], null));
    const legacy = { ...result } as Partial<AnalysisResult>;
    delete legacy.sourceEvaluation;
    await render(<ResultView result={legacy as AnalysisResult} />);
    expect(screen.getByText('Sources')).toBeTruthy();
  });
});
