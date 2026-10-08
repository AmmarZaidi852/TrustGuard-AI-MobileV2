import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { AnalysisStage } from '@/services/analysis/pipeline';
import { spacing, useTheme } from '@/theme/theme';

import { AppText } from '../ui/primitives';

export interface ProgressStep {
  stage: AnalysisStage;
  label: string;
}

/** Step-by-step progress for long-running analyses. */
export function ProgressSteps({
  steps,
  stage,
  note,
}: {
  steps: readonly ProgressStep[];
  stage: AnalysisStage | null;
  note?: string;
}) {
  const theme = useTheme();
  const current = steps.findIndex((step) => step.stage === stage);
  return (
    <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite" testID="analysis-progress">
      {steps.map((step, index) => {
        const done = current > index;
        const active = current === index;
        return (
          <View key={step.stage} style={styles.step}>
            {active ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <Ionicons
                name={done ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={done ? theme.tones.positive.fg : theme.textSubtle}
              />
            )}
            <AppText
              variant="small"
              muted={!active}
              style={active ? { fontWeight: '600' } : undefined}>
              {step.label}
            </AppText>
          </View>
        );
      })}
      {note ? (
        <AppText variant="caption" subtle>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
});
