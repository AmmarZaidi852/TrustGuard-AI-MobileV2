import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Notice, Screen } from '@/components/ui/primitives';
import type { ImageInput } from '@/core/validation';
import { useAnalysisRunner } from '@/hooks/use-analysis-runner';
import { analyzeImage } from '@/services/analysis/pipeline';
import { capabilities } from '@/services/providers';
import { radius, spacing, useTheme } from '@/theme/theme';

const CHECKS = [
  'Signs of AI generation',
  'Signs of editing or manipulation',
  'Edited or fabricated screenshots',
  'Images reused out of context',
  'Text and claims inside the image',
];

function formatBytes(bytes?: number | null): string | null {
  if (!bytes) return null;
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export default function AnalyzeImageScreen() {
  const theme = useTheme();
  const [image, setImage] = useState<ImageInput | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const { run, isRunning, error, reset } = useAnalysisRunner();

  const pickImage = async () => {
    setPickError(null);
    reset();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setImage({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        base64: asset.base64,
      });
    } catch {
      setPickError('The image could not be opened. Check photo permissions and try again.');
    }
  };

  const details = image
    ? [
        image.width && image.height ? `${image.width}×${image.height}` : null,
        formatBytes(image.fileSize),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title" accessibilityRole="header">
          Select an image to check
        </AppText>
        <AppText variant="small" muted>
          Photos, screenshots or images shared with a claim.
        </AppText>
      </View>

      {image ? (
        <View style={{ gap: spacing.sm }}>
          <Image
            source={{ uri: image.uri }}
            contentFit="contain"
            accessibilityLabel="Selected image preview"
            style={[styles.preview, { backgroundColor: theme.surfaceMuted }]}
          />
          {details ? (
            <AppText variant="caption" subtle>
              {details}
            </AppText>
          ) : null}
        </View>
      ) : (
        <Card style={[styles.empty, { borderColor: theme.border }]}>
          <AppText variant="small" muted style={{ textAlign: 'center' }}>
            No image selected
          </AppText>
        </Card>
      )}

      <Button
        label={image ? 'Choose a different image' : 'Choose image'}
        variant="secondary"
        icon="images-outline"
        onPress={pickImage}
        disabled={isRunning}
      />

      {!capabilities.imageAnalysis ? (
        <Notice tone="neutral" title="Image analysis not connected">
          The image model and text extraction aren’t connected yet, so images can’t be analyzed.
          TrustGuardAI won’t show a result it hasn’t actually computed.
        </Notice>
      ) : null}

      {pickError || error ? (
        <Notice tone="negative" title="Could not analyze">
          {pickError ?? error}
        </Notice>
      ) : null}

      <Button
        label={isRunning ? 'Analyzing…' : 'Analyze image'}
        icon="shield-checkmark-outline"
        loading={isRunning}
        disabled={!image}
        onPress={() => run((providers) => analyzeImage(image, providers))}
      />

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="small" style={{ fontWeight: '600' }}>
          What image analysis checks
        </AppText>
        {CHECKS.map((check) => (
          <AppText key={check} variant="small" muted>
            • {check}
          </AppText>
        ))}
        <AppText variant="caption" subtle>
          Whether an image looks AI-generated is assessed separately from whether a claim in it is
          true.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg },
  empty: {
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
});
