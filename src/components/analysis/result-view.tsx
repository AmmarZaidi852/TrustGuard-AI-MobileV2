import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  COMPONENT_LABELS,
  COMPONENT_STATUS_LABELS,
  type Dimension,
  describeAuthenticity,
  describeClaimVerification,
  describeEvidence,
  joinList,
  type Tone,
} from '@/core/presentation';
import type { AnalysisResult, AuthenticityFinding, ComponentStatus, Indicator } from '@/core/types';
import { radius, spacing, useTheme } from '@/theme/theme';

import { AppText, Card, Divider, Notice, Pill, Section } from '../ui/primitives';
import { AssessmentHeader } from './assessment-header';
import { EvidenceList } from './evidence-list';

/**
 * The single, reusable result screen body for text, claim and image analyses.
 * Order follows the questions a user asks: what is claimed → how trustworthy →
 * why → what evidence → what to do next.
 */
export function ResultView({ result }: { result: AnalysisResult }) {
  const dimensions = [
    describeClaimVerification(result),
    describeAuthenticity(result),
    describeEvidence(result),
  ].filter((dimension): dimension is Dimension => dimension !== null);

  const unavailable = result.components.filter(
    (component) => component.status === 'unavailable' || component.status === 'failed',
  );

  return (
    <View style={{ gap: spacing.xl }}>
      {result.input.imageUri ? <ImagePreview uri={result.input.imageUri} /> : null}

      <AssessmentHeader result={result} />

      {unavailable.length > 0 ? (
        <Notice tone="caution" title="Partial analysis">
          {joinList(unavailable.map((c) => COMPONENT_LABELS[c.component]))}{' '}
          {unavailable.length === 1 ? 'was' : 'were'} not available for this analysis. The
          assessment only reflects the checks that ran.
        </Notice>
      ) : null}

      <Section title="Separate questions" caption="These are assessed independently.">
        <Card style={{ gap: spacing.md }}>
          {dimensions.map((dimension, index) => (
            <View key={dimension.key} style={{ gap: spacing.md }}>
              {index > 0 ? <Divider /> : null}
              <DimensionRow dimension={dimension} />
            </View>
          ))}
        </Card>
      </Section>

      {result.authenticity ? (
        <Section title="Image authenticity" caption={`Model: ${result.authenticity.model}`}>
          <Card style={{ gap: spacing.md }}>
            {result.authenticity.description ? (
              <AppText variant="small" muted>
                {result.authenticity.description}
              </AppText>
            ) : null}
            <FindingRow title="AI generation" finding={result.authenticity.aiGeneration} />
            <Divider />
            <FindingRow
              title="Editing or manipulation"
              finding={result.authenticity.manipulation}
            />
            <Divider />
            <FindingRow
              title="Misleading context"
              finding={result.authenticity.misleadingContext}
            />
          </Card>
        </Section>
      ) : null}

      {result.extractedText?.text ? (
        <Section title="Text found in the image" caption={`OCR: ${result.extractedText.engine}`}>
          <Card>
            <AppText variant="small" selectable>
              {result.extractedText.text}
            </AppText>
          </Card>
        </Section>
      ) : null}

      <Section title="What we found">
        <IndicatorList indicators={result.indicators} />
        {result.keyStatements.length > 1 ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="small" style={{ fontWeight: '600' }}>
              Key statements detected
            </AppText>
            {result.keyStatements.map((statement) => (
              <AppText key={statement} variant="small" muted>
                • {statement}
              </AppText>
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="Why">
        <Card style={{ gap: spacing.sm }}>
          {result.reasoning.map((line) => (
            <AppText key={line} variant="small">
              {line}
            </AppText>
          ))}
        </Card>
      </Section>

      <Section title="Evidence">
        <EvidenceList result={result} />
      </Section>

      <Section title="Recommended next step">
        <Notice tone="info" icon="arrow-forward-circle">
          {result.assessment.recommendation}
        </Notice>
      </Section>

      <HowCalculated result={result} />

      <AppText variant="caption" subtle style={{ textAlign: 'center' }}>
        TrustGuardAI is an analysis aid, not a lie detector. Assessments are probabilistic and can
        be wrong.
      </AppText>
    </View>
  );
}

function ImagePreview({ uri }: { uri: string }) {
  const theme = useTheme();
  return (
    <Image
      source={{ uri }}
      contentFit="contain"
      accessibilityLabel="Analyzed image"
      style={[styles.image, { backgroundColor: theme.surfaceMuted }]}
    />
  );
}

function DimensionRow({ dimension }: { dimension: Dimension }) {
  const colors = useTheme().tones[dimension.tone];
  return (
    <View style={styles.dimension} testID={`dimension-${dimension.key}`}>
      <View style={[styles.dot, { backgroundColor: colors.fg }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="small" style={{ fontWeight: '600' }}>
          {dimension.question}
        </AppText>
        <AppText variant="small" muted>
          {dimension.answer}
        </AppText>
      </View>
    </View>
  );
}

const LIKELIHOOD_TONE: Record<AuthenticityFinding['likelihood'], Tone> = {
  low: 'positive',
  moderate: 'caution',
  high: 'negative',
  undetermined: 'neutral',
};

function FindingRow({ title, finding }: { title: string; finding: AuthenticityFinding }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.findingHeader}>
        <AppText variant="small" style={{ fontWeight: '600', flex: 1 }}>
          {title}
        </AppText>
        <Pill
          label={`${finding.likelihood} likelihood`}
          tone={LIKELIHOOD_TONE[finding.likelihood]}
        />
      </View>
      {finding.signals.length > 0 ? (
        finding.signals.map((signal) => (
          <AppText key={signal} variant="small" muted>
            • {signal}
          </AppText>
        ))
      ) : (
        <AppText variant="small" subtle>
          No specific signals reported.
        </AppText>
      )}
    </View>
  );
}

function IndicatorList({ indicators }: { indicators: Indicator[] }) {
  if (indicators.length === 0) {
    return (
      <Card>
        <AppText variant="small" muted>
          No notable indicators were detected in the wording.
        </AppText>
      </Card>
    );
  }
  return (
    <Card style={{ gap: spacing.md }}>
      {indicators.map((indicator, index) => (
        <View key={`${indicator.id}-${index}`} style={{ gap: spacing.xs }}>
          {index > 0 ? <Divider /> : null}
          <View style={styles.findingHeader}>
            <AppText variant="small" style={{ fontWeight: '600', flex: 1 }}>
              {indicator.label}
            </AppText>
            <Pill
              label={indicator.direction === 'raises_concern' ? 'Concern' : 'Supports'}
              tone={indicator.direction === 'raises_concern' ? 'caution' : 'positive'}
            />
          </View>
          <AppText variant="small" muted>
            {indicator.description}
          </AppText>
          {indicator.excerpt ? (
            <AppText variant="caption" subtle style={{ fontStyle: 'italic' }}>
              {indicator.excerpt}
            </AppText>
          ) : null}
          <AppText variant="caption" subtle>
            {indicator.origin === 'heuristic'
              ? 'Rule-based language check'
              : 'Reported by AI model'}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

const STATUS_TONE: Record<ComponentStatus, Tone> = {
  completed: 'positive',
  unavailable: 'neutral',
  failed: 'negative',
  skipped: 'neutral',
};

function HowCalculated({ result }: { result: AnalysisResult }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.disclosure}>
        <AppText variant="overline" muted style={{ flex: 1 }}>
          How this assessment was made
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textMuted} />
      </Pressable>
      {open ? (
        <Card style={{ gap: spacing.md }}>
          <AppText variant="small" style={{ fontWeight: '600' }}>
            Signals
          </AppText>
          {result.assessment.factors.map((factor) => (
            <View key={factor.id} style={{ gap: 2 }}>
              <View style={styles.findingHeader}>
                <AppText variant="small" style={{ flex: 1 }}>
                  {factor.label}
                </AppText>
                <AppText variant="caption" subtle>
                  {factor.value === null
                    ? 'Not available'
                    : `${Math.round(factor.value * 100)}/100 · ${factor.weight > 0 ? `weight ${factor.weight}` : 'not scored'}`}
                </AppText>
              </View>
              <AppText variant="caption" subtle>
                {factor.explanation}
              </AppText>
            </View>
          ))}
          <Divider />
          <AppText variant="small" style={{ fontWeight: '600' }}>
            Checks run
          </AppText>
          {result.components.map((component) => (
            <View key={component.component} style={{ gap: 2 }}>
              <View style={styles.findingHeader}>
                <AppText variant="small" style={{ flex: 1 }}>
                  {COMPONENT_LABELS[component.component]}
                </AppText>
                <Pill
                  label={COMPONENT_STATUS_LABELS[component.status]}
                  tone={STATUS_TONE[component.status]}
                />
              </View>
              {component.detail ? (
                <AppText variant="caption" subtle>
                  {component.detail}
                </AppText>
              ) : null}
            </View>
          ))}
          <Divider />
          <AppText variant="caption" subtle>
            Confidence describes how much signal the assessment rests on. It is not the probability
            that the claim is true.
          </AppText>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg },
  dimension: { flexDirection: 'row', gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  findingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disclosure: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
});
