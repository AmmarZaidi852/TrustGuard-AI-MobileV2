import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { CLAIM_TYPE_LABELS } from '@/core/claims/claim-extraction';
import { ASSESSMENT_META, RISK_META, confidenceLabel, type Tone } from '@/core/presentation';
import type { AnalysisResult } from '@/core/types';
import { radius, spacing, useTheme } from '@/theme/theme';

import { AppText, Card, type IconName, Pill } from '../ui/primitives';

const TONE_ICON: Record<Tone, IconName> = {
  positive: 'checkmark-circle',
  caution: 'warning',
  negative: 'close-circle',
  neutral: 'help-circle',
  info: 'search-circle',
};

/** Answers "What is being claimed?" and "How trustworthy does it appear?" at a glance. */
export function AssessmentHeader({ result }: { result: AnalysisResult }) {
  const theme = useTheme();
  const { assessment, claim } = result;
  const meta = ASSESSMENT_META[assessment.label];
  const tone = theme.tones[meta.tone];
  const risk = RISK_META[assessment.riskLevel];

  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="overline" muted>
          What is being claimed
        </AppText>
        {claim ? (
          <>
            <AppText variant="heading" testID="claim-text">
              “{claim.text}”
            </AppText>
            <AppText variant="caption" subtle>
              {CLAIM_TYPE_LABELS[claim.type]}
              {claim.method === 'model' ? ' · identified by AI' : ' · identified on-device'}
            </AppText>
          </>
        ) : (
          <AppText muted>No factual claim was identified.</AppText>
        )}
      </View>

      <View
        style={[styles.verdict, { backgroundColor: tone.bg }]}
        accessible
        accessibilityLabel={`Assessment: ${meta.title}. ${assessment.summary}`}>
        <View style={styles.verdictTitle}>
          <Ionicons name={TONE_ICON[meta.tone]} size={24} color={tone.fg} />
          <AppText variant="title" color={tone.fg} testID="assessment-label">
            {meta.title}
          </AppText>
        </View>
        <AppText variant="small" color={tone.fg}>
          {assessment.summary}
        </AppText>
      </View>

      <View style={styles.metrics}>
        <Metric
          label="Trust score"
          value={assessment.score === null ? 'Not scored' : `${assessment.score}/100`}
          hint={assessment.score === null ? 'No verification signal' : undefined}
        />
        <Metric
          label="Confidence"
          value={confidenceLabel(assessment.confidence)}
          hint={`${Math.round(assessment.confidence * 100)}%`}
          bar={assessment.confidence}
        />
        <View style={styles.metric}>
          <AppText variant="caption" subtle>
            Risk
          </AppText>
          <Pill label={risk.title} tone={risk.tone} />
        </View>
      </View>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  bar,
}: {
  label: string;
  value: string;
  hint?: string;
  bar?: number;
}) {
  const theme = useTheme();
  return (
    <View style={styles.metric}>
      <AppText variant="caption" subtle>
        {label}
      </AppText>
      <AppText variant="heading">{value}</AppText>
      {bar !== undefined ? (
        <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(bar * 100)}%`, backgroundColor: theme.accent },
            ]}
          />
        </View>
      ) : null}
      {hint ? (
        <AppText variant="caption" subtle>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  verdict: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  verdictTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metrics: { flexDirection: 'row', gap: spacing.md },
  metric: { flex: 1, gap: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
