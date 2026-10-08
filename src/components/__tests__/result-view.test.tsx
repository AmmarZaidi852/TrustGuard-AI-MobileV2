import { render, screen } from '@testing-library/react-native';

import {
  describeAuthenticity,
  describeClaimVerification,
  describeEvidence,
  joinList,
} from '@/core/presentation';
import { analyzeImage, analyzeText } from '@/services/analysis/pipeline';
import {
  mockImageReading,
  mockImageReadingNoClaim,
  mockContradictingEvidence,
  mockModelContradicted,
  mockModelUnverifiable,
  testImage,
  mockProviders,
} from '@/test/fixtures';

import { ResultView } from '../analysis/result-view';

const COFFEE =
  'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.';

describe('ResultView', () => {
  it('shows the AI claim, a model-only assessment and the partial-analysis notice', async () => {
    const result = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted }),
    );
    await render(<ResultView result={result} />);

    expect(screen.getByTestId('claim-text')).toHaveTextContent(
      `“${mockModelContradicted.extractedClaim}”`,
    );
    expect(screen.getByText(/identified by AI/)).toBeTruthy();
    expect(screen.getByTestId('assessment-label')).toHaveTextContent('Possibly misleading');
    expect(screen.getByText(/No independent sources were checked yet/)).toBeTruthy();
    expect(screen.getByText(mockModelContradicted.reasoning)).toBeTruthy();
    expect(screen.getByText('[mock] Overstates a modest association')).toBeTruthy();
    expect(screen.getByText('Reported by AI model')).toBeTruthy();
    expect(screen.getByText('Partial analysis')).toBeTruthy();
    expect(screen.getByText('Sources not checked')).toBeTruthy();
    // No image dimension for text analyses.
    expect(screen.queryByTestId('dimension-authenticity')).toBeNull();
  });

  it('renders evidence and image findings separately from the claim verdict', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: mockModelContradicted,
        evidence: mockContradictingEvidence,
      }),
    );
    await render(<ResultView result={result} />);

    expect(screen.getByTestId('dimension-claim')).toBeTruthy();
    expect(screen.getByTestId('dimension-authenticity')).toHaveTextContent(/Not assessed/);
    expect(screen.getByTestId('image-origin')).toBeTruthy();
    expect(screen.getByText(mockContradictingEvidence[0].title)).toBeTruthy();
  });
});

describe('dimension wording', () => {
  it('keeps "AI-generated", "false" and "cannot verify" as distinct statements', async () => {
    const noClaim = await analyzeImage(
      testImage,
      mockProviders({ vision: mockImageReadingNoClaim }),
    );
    // Authenticity wording, for when an authenticity model provides findings.
    const image = {
      ...noClaim,
      authenticity: {
        aiGeneration: { likelihood: 'high' as const, signals: ['[mock] Inconsistent hands'] },
        manipulation: { likelihood: 'low' as const, signals: [] },
        misleadingContext: { likelihood: 'undetermined' as const, signals: [] },
        description: '[mock] A crowd scene.',
        model: 'mock-vision',
      },
    };
    const falseClaim = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelContradicted, evidence: mockContradictingEvidence }),
    );
    const unverified = await analyzeText(
      COFFEE,
      'text',
      mockProviders({ model: mockModelUnverifiable }),
    );

    const authenticity = describeAuthenticity(image)!.answer;
    expect(authenticity).toMatch(/commonly associated with AI generation/);
    expect(authenticity).toMatch(/cannot be confirmed with certainty/);
    // An image looking AI-generated says nothing about a claim being false.
    expect(describeClaimVerification(image).answer).toBe('No factual claim was found to check.');

    expect(describeClaimVerification(falseClaim).answer).toMatch(/appears to be false/);
    expect(describeClaimVerification(unverified).answer).toBe(
      'The claim cannot currently be verified.',
    );
    expect(describeEvidence(unverified).answer).toMatch(/not checked/);
  });
});

test('joinList reads naturally', () => {
  expect(joinList(['A'])).toBe('A');
  expect(joinList(['A', 'B'])).toBe('A and B');
  expect(joinList(['A', 'B', 'C'])).toBe('A, B and C');
});
