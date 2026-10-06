import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CLAIM_LIMITS, TEXT_LIMITS } from '@/core/validation';
import { useAnalysisRunner } from '@/hooks/use-analysis-runner';
import { analyzeText } from '@/services/analysis/pipeline';
import { radius, spacing, useTheme } from '@/theme/theme';

import { AppText, Button, Notice, Screen } from '../ui/primitives';

const COPY = {
  text: {
    title: 'Paste the content you want to check',
    hint: 'Posts, messages, headlines or article excerpts. TrustGuardAI identifies the main claim and how it is framed.',
    placeholder: 'Paste text here…',
    example: 'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.',
    minHeight: 200,
    limits: TEXT_LIMITS,
  },
  claim: {
    title: 'Enter one specific claim',
    hint: 'A single factual statement works best, e.g. who did what, when, or a specific number.',
    placeholder: 'e.g. NASA discovered life on Mars.',
    example: 'NASA discovered life on Mars.',
    minHeight: 110,
    limits: CLAIM_LIMITS,
  },
} as const;

/** Shared input screen for "Analyze text" and "Analyze claim". */
export function TextAnalysisForm({ mode }: { mode: 'text' | 'claim' }) {
  const theme = useTheme();
  const copy = COPY[mode];
  const [value, setValue] = useState('');
  const { run, isRunning, error, reset } = useAnalysisRunner();

  const tooLong = value.length > copy.limits.max;

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title" accessibilityRole="header">
          {copy.title}
        </AppText>
        <AppText variant="small" muted>
          {copy.hint}
        </AppText>
      </View>

      <View style={{ gap: spacing.sm }}>
        <TextInput
          testID="analysis-input"
          accessibilityLabel={copy.title}
          value={value}
          onChangeText={(next) => {
            setValue(next);
            if (error) reset();
          }}
          placeholder={copy.placeholder}
          placeholderTextColor={theme.textSubtle}
          multiline
          textAlignVertical="top"
          editable={!isRunning}
          style={[
            styles.input,
            {
              minHeight: copy.minHeight,
              color: theme.text,
              backgroundColor: theme.surface,
              borderColor: tooLong ? theme.tones.negative.fg : theme.border,
            },
          ]}
        />
        <View style={styles.meta}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setValue(copy.example)}
            disabled={isRunning}
            hitSlop={8}>
            <AppText variant="caption" color={theme.accent} style={{ fontWeight: '600' }}>
              Try an example
            </AppText>
          </Pressable>
          <AppText variant="caption" color={tooLong ? theme.tones.negative.fg : theme.textSubtle}>
            {value.length}/{copy.limits.max}
          </AppText>
        </View>
      </View>

      {error ? (
        <Notice tone="negative" title="Could not analyze">
          {error}
        </Notice>
      ) : null}

      <Button
        label={isRunning ? 'Analyzing…' : 'Analyze'}
        icon="shield-checkmark-outline"
        loading={isRunning}
        disabled={value.trim().length === 0}
        onPress={() => run((providers) => analyzeText(value, mode, providers))}
      />

      <AppText variant="caption" subtle>
        Results are an assessment of the available signals, not a final verdict on what is true.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    lineHeight: 22,
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
