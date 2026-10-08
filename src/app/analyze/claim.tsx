import { useLocalSearchParams } from 'expo-router';

import { TextAnalysisForm } from '@/components/analysis/text-analysis-form';

export default function AnalyzeClaimScreen() {
  // Optional prefill, e.g. "Check this claim" for a secondary claim found in an image.
  const { claim } = useLocalSearchParams<{ claim?: string }>();
  return <TextAnalysisForm mode="claim" initialValue={typeof claim === 'string' ? claim : ''} />;
}
