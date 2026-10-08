import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Tone } from '@/core/presentation';
import type { AnalysisResult, ImageClaim, ImageKind, TextReadability } from '@/core/types';
import { radius, spacing, useTheme } from '@/theme/theme';

import { AppText, Card, Divider, Pill } from '../ui/primitives';

const KIND_LABEL: Record<ImageKind, string> = {
  social_post_screenshot: 'Social media screenshot',
  news_screenshot: 'News screenshot',
  meme: 'Meme',
  infographic: 'Infographic',
  chart: 'Chart',
  photo_with_text: 'Photo with text',
  photo: 'Photo',
  document: 'Document',
  other: 'Image',
};

const READABILITY_META: Record<TextReadability, { label: string; tone: Tone }> = {
  clear: { label: 'Text clearly readable', tone: 'positive' },
  partial: { label: 'Text partly readable', tone: 'caution' },
  unreadable: { label: 'Text unreadable', tone: 'negative' },
  no_text: { label: 'No text', tone: 'neutral' },
};

function claimStatus(claim: ImageClaim, isPrimary: boolean): { label: string; tone: Tone } {
  if (isPrimary) return { label: 'Checked below', tone: 'info' };
  if (!claim.isFactual || claim.claimType === 'opinion' || claim.claimType === 'prediction') {
    return { label: 'Not a factual claim', tone: 'neutral' };
  }
  if (!claim.grounded) return { label: 'Text not confirmed', tone: 'caution' };
  return { label: 'Not checked separately', tone: 'neutral' };
}

/** Header for image analyses: where the result came from and what was read. */
export function ImageOriginCard({ result }: { result: AnalysisResult }) {
  const theme = useTheme();
  const reading = result.imageAnalysis;
  return (
    <Card style={styles.origin} testID="image-origin">
      {result.input.imageUri ? (
        <Image
          source={{ uri: result.input.imageUri }}
          contentFit="cover"
          accessibilityLabel="Analyzed image"
          style={[styles.thumb, { backgroundColor: theme.surfaceMuted }]}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: theme.surfaceMuted }]}>
          <Ionicons name="image-outline" size={22} color={theme.textSubtle} />
        </View>
      )}
      <View style={{ flex: 1, gap: spacing.xs }}>
        <AppText variant="overline" muted>
          Analyzed from an image
        </AppText>
        {reading ? (
          <View style={styles.pills}>
            <Pill label={KIND_LABEL[reading.imageKind]} tone="neutral" />
            <Pill
              label={READABILITY_META[reading.readability].label}
              tone={READABILITY_META[reading.readability].tone}
            />
          </View>
        ) : null}
        {!result.input.imageUri ? (
          <AppText variant="caption" subtle>
            The image itself is not stored, so it can’t be shown here.
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

/** Every claim the image contained, which one was verified, and why the others were not. */
export function ImageClaimsList({ result }: { result: AnalysisResult }) {
  const theme = useTheme();
  const reading = result.imageAnalysis;
  if (!reading) return null;

  return (
    <Card style={{ gap: spacing.md }} testID="image-claims">
      {reading.description ? (
        <AppText variant="small" muted>
          {reading.description}
        </AppText>
      ) : null}
      {reading.claims.length === 0 ? (
        <AppText variant="small" muted>
          No claims were found in this image.
        </AppText>
      ) : (
        <>
          {reading.claims.length > 1 ? (
            <AppText variant="small" style={{ fontWeight: '600' }}>
              This image contains {reading.claims.length} claims. The main factual claim was
              checked; you can check the others separately.
            </AppText>
          ) : null}
          {reading.claims.map((claim, index) => {
            const isPrimary = index === reading.primaryClaimIndex;
            const status = claimStatus(claim, isPrimary);
            const checkable = !isPrimary && claim.checkable;
            return (
              <View key={`${index}-${claim.text}`} style={{ gap: spacing.xs }}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.pills}>
                  <Pill label={status.label} tone={status.tone} />
                  {claim.readability === 'partial' ? (
                    <Pill label="Partly readable" tone="caution" />
                  ) : null}
                </View>
                <AppText variant="small" style={{ fontWeight: isPrimary ? '600' : '400' }}>
                  {claim.text}
                </AppText>
                {claim.context ? (
                  <AppText variant="caption" subtle>
                    Context: {claim.context}
                  </AppText>
                ) : null}
                {checkable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Check this claim: ${claim.text}`}
                    onPress={() =>
                      router.push({ pathname: '/analyze/claim', params: { claim: claim.text } })
                    }
                    style={styles.action}>
                    <AppText variant="small" color={theme.accent} style={{ fontWeight: '600' }}>
                      Check this claim
                    </AppText>
                    <Ionicons name="arrow-forward" size={16} color={theme.accent} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </>
      )}
      {reading.uncertainty ? (
        <View style={[styles.note, { borderLeftColor: theme.tones.caution.fg }]}>
          <AppText variant="caption" subtle>
            What couldn’t be read reliably
          </AppText>
          <AppText variant="small" muted>
            {reading.uncertainty}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  origin: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  note: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: 2 },
});
