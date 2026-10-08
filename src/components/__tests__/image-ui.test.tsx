import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import AnalyzeImageScreen from '@/app/analyze/image';
import { analyzeImage } from '@/services/analysis/pipeline';
import {
  IMAGE_BYTES,
  mockContradictingEvidence,
  mockEvaluationContradicted,
  mockImageReading,
  mockImageReadingMultiple,
  mockImageReadingUnreadable,
  mockModelContradicted,
  mockProviders,
  sourceSearch,
  testImage,
} from '@/test/fixtures';

import { ResultView } from '../analysis/result-view';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));

const pick = ImagePicker.launchImageLibraryAsync as jest.Mock;
const previewUri = () => JSON.stringify(screen.getByTestId('image-preview').props.source);

const asset = (patch: Record<string, unknown> = {}) => ({
  canceled: false,
  assets: [
    {
      uri: 'file:///cache/one.png',
      mimeType: 'image/png',
      fileName: 'one.png',
      fileSize: 120_000,
      width: 1170,
      height: 2532,
      base64: IMAGE_BYTES.png,
      ...patch,
    },
  ],
});

describe('Analyze image screen', () => {
  beforeEach(() => pick.mockReset());

  it('picks, previews, replaces and removes an image', async () => {
    pick.mockResolvedValueOnce(asset());
    await render(<AnalyzeImageScreen />);
    expect(screen.getByText('No image selected')).toBeTruthy();

    await fireEvent.press(screen.getByText('Choose image'));
    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeTruthy());
    expect(previewUri()).toContain('file:///cache/one.png');
    expect(screen.getByText('1170×2532 · 117 KB')).toBeTruthy();
    expect(pick).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], base64: true }),
    );

    pick.mockResolvedValueOnce(asset({ uri: 'file:///cache/two.jpg', base64: IMAGE_BYTES.jpeg }));
    await fireEvent.press(screen.getByText('Replace'));
    await waitFor(() => expect(previewUri()).toContain('file:///cache/two.jpg'));

    await fireEvent.press(screen.getByText('Remove'));
    expect(screen.queryByTestId('image-preview')).toBeNull();
    expect(screen.getByText('No image selected')).toBeTruthy();
  });

  it('explains an unusable image immediately and blocks analysis', async () => {
    pick.mockResolvedValueOnce(asset({ base64: IMAGE_BYTES.pdf, fileName: 'scan.png' }));
    await render(<AnalyzeImageScreen />);
    await fireEvent.press(screen.getByText('Choose image'));
    await waitFor(() => expect(screen.getByText('This image can’t be used')).toBeTruthy());
    expect(screen.getByText(/PDF files are not supported/)).toBeTruthy();
    const analyze = screen.getByRole('button', { name: /Analyze image/ });
    expect(analyze.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps the previous state when the picker is cancelled', async () => {
    pick.mockResolvedValueOnce({ canceled: true, assets: null });
    await render(<AnalyzeImageScreen />);
    await fireEvent.press(screen.getByText('Choose image'));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(screen.getByText('No image selected')).toBeTruthy();
  });
});

describe('Result view for image analyses', () => {
  it('renders the image-derived claim, its origin and source-backed sources', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReading,
        model: mockModelContradicted,
        evidence: sourceSearch(mockContradictingEvidence.slice(0, 2), mockEvaluationContradicted),
      }),
    );
    await render(<ResultView result={result} />);
    expect(screen.getByText('Analyzed from an image')).toBeTruthy();
    expect(screen.getByText('Social media screenshot')).toBeTruthy();
    expect(screen.getByTestId('claim-text')).toHaveTextContent(
      `“${mockModelContradicted.extractedClaim}”`,
    );
    expect(screen.getByTestId('assessment-label')).toHaveTextContent('Likely false');
    expect(screen.getByText('Checked below')).toBeTruthy();
    expect(screen.getByText(mockContradictingEvidence[0].title)).toBeTruthy();
    expect(screen.getByText('Contradicting evidence found')).toBeTruthy();
    expect(screen.getByText(mockImageReading.visibleText)).toBeTruthy();
  });

  it('shows every claim and lets the user check the others separately', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    const result = await analyzeImage(
      testImage,
      mockProviders({
        vision: mockImageReadingMultiple,
        model: mockModelContradicted,
        evidence: sourceSearch(mockContradictingEvidence.slice(0, 2), mockEvaluationContradicted),
      }),
    );
    await render(<ResultView result={result} />);
    expect(screen.getByText(/This image contains 2 claims/)).toBeTruthy();
    const second = mockImageReadingMultiple.claims[1].text;
    await fireEvent.press(screen.getByRole('button', { name: `Check this claim: ${second}` }));
    expect(push).toHaveBeenCalledWith({ pathname: '/analyze/claim', params: { claim: second } });
    push.mockRestore();
  });

  it('explains an unreadable image instead of guessing', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({ vision: mockImageReadingUnreadable }),
    );
    await render(<ResultView result={result} />);
    expect(screen.getByTestId('assessment-label')).toHaveTextContent('Cannot verify');
    expect(screen.getByText('Text unreadable')).toBeTruthy();
    expect(screen.getByText(mockImageReadingUnreadable.uncertainty)).toBeTruthy();
  });

  it('shows a placeholder when the image is no longer available (not stored)', async () => {
    const result = await analyzeImage(
      testImage,
      mockProviders({ vision: mockImageReadingUnreadable }),
    );
    await render(
      <ResultView result={{ ...result, input: { ...result.input, imageUri: undefined } }} />,
    );
    expect(screen.getByText(/image itself is not stored/)).toBeTruthy();
  });
});
