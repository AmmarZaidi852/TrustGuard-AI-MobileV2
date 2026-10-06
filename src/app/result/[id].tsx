import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ResultView } from '@/components/analysis/result-view';
import { AppText, Button, Screen } from '@/components/ui/primitives';
import type { AnalysisResult } from '@/core/types';
import { getAnalysis } from '@/services/history/history-store';
import { spacing, useTheme } from '@/theme/theme';

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [result, setResult] = useState<AnalysisResult | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getAnalysis(String(id)).then((found) => active && setResult(found));
    return () => {
      active = false;
    };
  }, [id]);

  if (result === undefined) {
    return (
      <Screen>
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  if (result === null) {
    return (
      <Screen>
        <View style={{ gap: spacing.md }}>
          <AppText variant="title">Analysis not found</AppText>
          <AppText muted>It may have been cleared from your recent analyses.</AppText>
          <Button label="Back to home" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ResultView result={result} />
    </Screen>
  );
}
