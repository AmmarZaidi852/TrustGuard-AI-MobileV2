import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { describeSourceFindings, type Tone } from '@/core/presentation';
import { SOURCE_CATEGORY_LABELS } from '@/core/sources/source-evaluation';
import { validateSourceUrl } from '@/core/sources/url-safety';
import type { AnalysisResult, EvidenceItem, EvidenceStance, SourceRelevance } from '@/core/types';
import { spacing, useTheme } from '@/theme/theme';

import { AppText, Card, Divider, type IconName, Notice, Pill } from '../ui/primitives';

const STANCE_META: Record<EvidenceStance, { label: string; tone: Tone; icon: IconName }> = {
  supports: { label: 'Supports', tone: 'positive', icon: 'checkmark-circle' },
  contradicts: { label: 'Contradicts', tone: 'negative', icon: 'close-circle' },
  context: { label: 'Context', tone: 'info', icon: 'information-circle' },
  mixed: { label: 'Mixed', tone: 'caution', icon: 'remove-circle' },
  unrelated: { label: 'Not relevant', tone: 'neutral', icon: 'ellipse-outline' },
};

const RELEVANCE_LABEL: Record<SourceRelevance, string> = {
  high: 'High relevance',
  medium: 'Medium relevance',
  low: 'Low relevance',
};

const STANCE_ORDER: Record<EvidenceStance, number> = {
  supports: 0,
  contradicts: 0,
  mixed: 1,
  context: 2,
  unrelated: 3,
};

function credibilityTone(credibility: number): Tone {
  if (credibility >= 0.7) return 'positive';
  if (credibility >= 0.4) return 'neutral';
  return 'caution';
}

/** Opens a source in the system browser — only if its URL passes validation. */
export async function openSource(url: string): Promise<boolean> {
  const safe = validateSourceUrl(url);
  if (!safe) return false;
  try {
    await Linking.openURL(safe);
    return true;
  } catch {
    return false;
  }
}

/** The "Sources" section of the result screen. Renders any number of sources (including none). */
export function EvidenceList({ result }: { result: AnalysisResult }) {
  const findings = describeSourceFindings(result);
  const evaluation = result.sourceEvaluation ?? null;
  const items = [...result.evidence]
    .filter((item) => item.stance !== 'unrelated')
    .sort((a, b) => STANCE_ORDER[a.stance] - STANCE_ORDER[b.stance]);

  return (
    <View style={{ gap: spacing.md }}>
      <Notice
        tone={findings.tone}
        title={findings.title}
        icon={
          findings.kind === 'supporting'
            ? 'checkmark-circle'
            : findings.kind === 'contradicting'
              ? 'close-circle'
              : undefined
        }>
        {findings.text}
      </Notice>

      {evaluation && items.length > 0 ? (
        <Card style={{ gap: spacing.md }} testID="source-evaluation">
          <EvaluationRow title="What the sources say" text={evaluation.whatSourcesSay} />
          <Divider />
          <EvaluationRow title="What can be inferred" text={evaluation.inference} />
          <Divider />
          <EvaluationRow title="What remains uncertain" text={evaluation.uncertainty} />
        </Card>
      ) : null}

      {items.map((item) => (
        <SourceCard key={item.id} item={item} />
      ))}

      {evaluation && evaluation.searchQueries.length > 0 ? (
        <AppText variant="caption" subtle>
          Searched for: {evaluation.searchQueries.map((query) => `“${query}”`).join(', ')}
        </AppText>
      ) : null}

      {result.evidenceNeeded.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="small" style={{ fontWeight: '600' }}>
            Evidence that would settle this
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
      ) : null}
    </View>
  );
}

function EvaluationRow({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="small" style={{ fontWeight: '600' }}>
        {title}
      </AppText>
      <AppText variant="small" muted>
        {text}
      </AppText>
    </View>
  );
}

function SourceCard({ item }: { item: EvidenceItem }) {
  const theme = useTheme();
  const stance = STANCE_META[item.stance];
  const linkable = validateSourceUrl(item.url) !== null;

  return (
    <Card style={{ gap: spacing.sm }} testID={`source-${item.id}`}>
      <View style={styles.row}>
        <Pill label={stance.label} tone={stance.tone} icon={stance.icon} />
        {item.relevance ? <Pill label={RELEVANCE_LABEL[item.relevance]} tone="neutral" /> : null}
        <Pill
          label={`${SOURCE_CATEGORY_LABELS[item.source.category]} · ${Math.round(item.source.credibility * 100)}%`}
          tone={credibilityTone(item.source.credibility)}
        />
      </View>

      <AppText variant="heading" style={{ fontSize: 15 }}>
        {item.title}
      </AppText>
      <AppText variant="caption" subtle>
        {item.publisher}
        {item.publishedAt ? ` · ${item.publishedAt}` : ''}
      </AppText>

      {item.explanation ? <AppText variant="small">{item.explanation}</AppText> : null}

      {item.snippet ? (
        <View style={[styles.quote, { borderLeftColor: theme.border }]}>
          <AppText variant="caption" subtle>
            From the source
          </AppText>
          <AppText variant="small" muted numberOfLines={5}>
            “{item.snippet}”
          </AppText>
        </View>
      ) : null}

      {linkable ? (
        <Pressable
          testID={`source-link-${item.id}`}
          accessibilityRole="link"
          accessibilityLabel={`Open source: ${item.title}`}
          accessibilityHint="Opens the source in your browser"
          onPress={() => openSource(item.url)}
          style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
          <AppText variant="small" color={theme.accent} style={{ fontWeight: '600', flex: 1 }}>
            Open source
          </AppText>
          <Ionicons name="open-outline" size={16} color={theme.accent} />
        </Pressable>
      ) : null}

      <AppText variant="caption" subtle>
        {item.source.rationale}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  bullet: { flexDirection: 'row', gap: spacing.sm },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.xs },
});
