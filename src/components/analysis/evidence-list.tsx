import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';

import { describeEvidence, type Tone } from '@/core/presentation';
import { SOURCE_CATEGORY_LABELS } from '@/core/sources/source-evaluation';
import type { AnalysisResult, EvidenceStance } from '@/core/types';
import { spacing, useTheme } from '@/theme/theme';

import { AppText, Card, Divider, Pill } from '../ui/primitives';

const STANCE_META: Record<EvidenceStance, { label: string; tone: Tone }> = {
  supports: { label: 'Supports', tone: 'positive' },
  contradicts: { label: 'Contradicts', tone: 'negative' },
  mixed: { label: 'Mixed', tone: 'caution' },
  unrelated: { label: 'Not relevant', tone: 'neutral' },
};

function credibilityTone(credibility: number): Tone {
  if (credibility >= 0.7) return 'positive';
  if (credibility >= 0.4) return 'neutral';
  return 'caution';
}

export function EvidenceList({ result }: { result: AnalysisResult }) {
  const theme = useTheme();
  const items = [...result.evidence].sort(
    (a, b) => Number(a.stance === 'unrelated') - Number(b.stance === 'unrelated'),
  );

  return (
    <View style={{ gap: spacing.md }}>
      {items.length === 0 ? (
        <Card>
          <AppText variant="small" muted testID="evidence-status">
            {describeEvidence(result).answer}
          </AppText>
        </Card>
      ) : (
        items.map((item) => {
          const stance = STANCE_META[item.stance];
          return (
            <Pressable
              key={item.id}
              accessibilityRole="link"
              accessibilityHint="Opens the source in your browser"
              onPress={() => WebBrowser.openBrowserAsync(item.url)}>
              {({ pressed }) => (
                <Card style={{ gap: spacing.sm, opacity: pressed ? 0.85 : 1 }}>
                  <View style={styles.row}>
                    <Pill label={stance.label} tone={stance.tone} />
                    <Pill
                      label={`${SOURCE_CATEGORY_LABELS[item.source.category]} · ${Math.round(item.source.credibility * 100)}%`}
                      tone={credibilityTone(item.source.credibility)}
                    />
                  </View>
                  <AppText variant="heading" style={{ fontSize: 15 }}>
                    {item.title}
                  </AppText>
                  {item.snippet ? (
                    <AppText variant="small" muted numberOfLines={4}>
                      {item.snippet}
                    </AppText>
                  ) : null}
                  <AppText variant="caption" color={theme.accent}>
                    {item.publisher}
                    {item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ''}
                  </AppText>
                  <AppText variant="caption" subtle>
                    {item.source.rationale}
                  </AppText>
                </Card>
              )}
            </Pressable>
          );
        })
      )}

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="small" style={{ fontWeight: '600' }}>
          Evidence that would verify this
        </AppText>
        <Divider />
        {result.evidenceNeeded.map((need) => (
          <View key={need} style={styles.bullet}>
            <AppText variant="small" muted>
              •
            </AppText>
            <AppText variant="small" muted style={{ flex: 1 }}>
              {need}
            </AppText>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  bullet: { flexDirection: 'row', gap: spacing.sm },
});
