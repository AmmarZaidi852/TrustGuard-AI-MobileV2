import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CLAIM_LIMITS, TEXT_LIMITS } from '@/core/validation';
import { useAnalysisRunner } from '@/hooks/use-analysis-runner';
import { analyzeText } from '@/services/analysis/pipeline';
import { radius, spacing, useIsDark, useTheme } from '@/theme/theme';

import { AppText, Button, Notice, Screen } from '../ui/primitives';

const COPY = {
  text: {
    title: 'Paste the content you want to check',
    hint: 'Posts, messages, headlines or article excerpts. TrustGuardAI finds the main claim and assesses it.',
    placeholder: 'Paste text here…',
    example: 'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.',
    minHeight: 180,
    maxHeight: 320,
    limits: TEXT_LIMITS,
  },
  claim: {
    title: 'Enter one specific claim',
    hint: 'A single factual statement works best, e.g. who did what, when, or a specific number.',
    placeholder: 'e.g. NASA discovered life on Mars.',
    example: 'NASA discovered life on Mars.',
    minHeight: 110,
    maxHeight: 220,
    limits: CLAIM_LIMITS,
  },
} as const;

/** Shared input screen for "Analyze text" and "Analyze claim". */
export function TextAnalysisForm({ mode }: { mode: 'text' | 'claim' }) {
  const theme = useTheme();
  const isDark = useIsDark();
  const copy = COPY[mode];
  const [value, setValue] = useState('');
  const { run, isRunning, error, reset } = useAnalysisRunner();

  const tooLong = value.length > copy.limits.max;

  const submit = () => {
    Keyboard.dismiss();
    run((providers) => analyzeText(value, mode, providers));
  };

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

      <View style={{ gap: spacing.xs }}>
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
          scrollEnabled
          textAlignVertical="top"
          autoCapitalize="sentences"
          keyboardAppearance={isDark ? 'dark' : 'light'}
          editable={!isRunning}
          style={[
            styles.input,
            {
              minHeight: copy.minHeight,
              maxHeight: copy.maxHeight,
              color: theme.text,
              backgroundColor: theme.surface,
              borderColor: tooLong ? theme.tones.negative.fg : theme.border,
            },
          ]}
        />
        <View style={styles.meta}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Fills in an example to analyze"
            onPress={() => {
              setValue(copy.example);
              reset();
            }}
            disabled={isRunning}
            style={styles.touchTarget}>
            <AppText variant="small" color={theme.accent} style={{ fontWeight: '600' }}>
              Try an example
            </AppText>
          </Pressable>
          <View style={styles.meta}>
            {value.length > 0 && !isRunning ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear text"
                onPress={() => {
                  setValue('');
                  reset();
                }}
                style={styles.touchTarget}>
                <AppText variant="small" color={theme.accent} style={{ fontWeight: '600' }}>
                  Clear
                </AppText>
              </Pressable>
            ) : null}
            <AppText
              variant="caption"
              color={tooLong ? theme.tones.negative.fg : theme.textSubtle}
              style={{ marginLeft: spacing.md }}>
              {value.length}/{copy.limits.max}
            </AppText>
          </View>
        </View>
      </View>

      {error ? (
        <Notice tone="negative" title="Analysis didn’t complete">
          {error}
        </Notice>
      ) : null}

      <Button
        label={isRunning ? 'Analyzing…' : error ? 'Try again' : 'Analyze'}
        icon={error ? 'refresh' : 'shield-checkmark-outline'}
        loading={isRunning}
        disabled={value.trim().length === 0}
        onPress={submit}
      />

      {isRunning ? (
        <AppText
          variant="small"
          muted
          style={{ textAlign: 'center' }}
          accessibilityLiveRegion="polite">
          The AI is reading the content and assessing the claim. This usually takes 5–30 seconds.
        </AppText>
      ) : (
        <AppText variant="caption" subtle>
          Results are an assessment of the available signals, not a final verdict on what is true.
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    paddingTop: spacing.md,
    fontSize: 17,
    lineHeight: 23,
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  touchTarget: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
});
