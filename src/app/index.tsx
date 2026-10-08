import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Card,
  type IconName,
  Notice,
  Pill,
  Section,
  Screen,
} from '@/components/ui/primitives';
import { ASSESSMENT_META, formatRelativeTime, resultTitle } from '@/core/presentation';
import type { AnalysisKind, AnalysisResult } from '@/core/types';
import { useHistory } from '@/hooks/use-history';
import { capabilities } from '@/services/providers';
import { clearHistory } from '@/services/history/history-store';
import { radius, spacing, useTheme } from '@/theme/theme';

const OPTIONS: {
  kind: AnalysisKind;
  title: string;
  description: string;
  icon: IconName;
  href: Href;
}[] = [
  {
    kind: 'text',
    title: 'Analyze text',
    description: 'Paste a post, message or article excerpt.',
    icon: 'document-text-outline',
    href: '/analyze/text',
  },
  {
    kind: 'image',
    title: 'Analyze image',
    description: 'Check a photo or screenshot for signs of editing.',
    icon: 'image-outline',
    href: '/analyze/image',
  },
  {
    kind: 'claim',
    title: 'Analyze claim',
    description: 'Check one specific factual statement.',
    icon: 'search-outline',
    href: '/analyze/claim',
  },
];

const KIND_ICON: Record<AnalysisKind, IconName> = {
  text: 'document-text-outline',
  claim: 'search-outline',
  image: 'image-outline',
};

export default function HomeScreen() {
  const theme = useTheme();
  const history = useHistory();

  return (
    <Screen topInset>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: theme.primary }]}>
          <Ionicons name="shield-checkmark" size={22} color={theme.primaryText} />
        </View>
        <AppText variant="heading">TrustGuardAI</AppText>
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="display" accessibilityRole="header">
          Check what you see before you trust it.
        </AppText>
        <AppText muted>
          See what a piece of content claims, how well the evidence supports it, and why.
        </AppText>
      </View>

      {capabilities.evidenceSearch ? (
        <Notice tone="info" title="Checked against real sources" icon="library-outline">
          Claims are checked against sources found on the web, which is stronger than an AI’s
          opinion alone. It is still not a guarantee of truth: sources can be incomplete or wrong,
          so open them and judge for yourself.
        </Notice>
      ) : (
        <Notice tone="neutral" title="Source checking unavailable">
          AI analysis is live, but claims are not checked against independent sources, so
          TrustGuardAI won’t mark a claim as “Likely reliable” or “Likely false”.
        </Notice>
      )}

      <View style={{ gap: spacing.md }}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.kind}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            accessibilityHint={option.description}
            onPress={() => router.push(option.href)}>
            {({ pressed }) => (
              <Card style={[styles.option, { opacity: pressed ? 0.85 : 1 }]}>
                <View style={[styles.optionIcon, { backgroundColor: theme.tones.info.bg }]}>
                  <Ionicons name={option.icon} size={22} color={theme.tones.info.fg} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="heading">{option.title}</AppText>
                  <AppText variant="small" muted>
                    {option.description}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSubtle} />
              </Card>
            )}
          </Pressable>
        ))}
      </View>

      <Section
        title="Recent analyses"
        right={
          history && history.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear recent analyses"
              onPress={clearHistory}
              style={{
                minHeight: 44,
                minWidth: 44,
                justifyContent: 'center',
                alignItems: 'flex-end',
              }}>
              <AppText variant="caption" color={theme.accent} style={{ fontWeight: '600' }}>
                Clear
              </AppText>
            </Pressable>
          ) : null
        }>
        {history === null ? null : history.length === 0 ? (
          <Card>
            <AppText variant="small" muted>
              Your analyses will appear here. They are stored only on this device.
            </AppText>
          </Card>
        ) : (
          <Card style={{ paddingVertical: spacing.xs }}>
            {history.slice(0, 8).map((item, index) => (
              <RecentRow key={item.id} item={item} first={index === 0} />
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}

function RecentRow({ item, first }: { item: AnalysisResult; first: boolean }) {
  const theme = useTheme();
  const meta = ASSESSMENT_META[item.assessment.label];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meta.title}: ${resultTitle(item)}`}
      onPress={() => router.push({ pathname: '/result/[id]', params: { id: item.id } })}
      style={({ pressed }) => [
        styles.recent,
        { borderTopColor: theme.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth },
        pressed && { opacity: 0.7 },
      ]}>
      <Ionicons name={KIND_ICON[item.kind]} size={18} color={theme.textSubtle} />
      <View style={{ flex: 1, gap: 4 }}>
        <AppText variant="small" numberOfLines={2}>
          {resultTitle(item)}
        </AppText>
        <View style={styles.recentMeta}>
          <Pill label={meta.title} tone={meta.tone} />
          <AppText variant="caption" subtle>
            {formatRelativeTime(item.createdAt)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recent: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'flex-start',
  },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
