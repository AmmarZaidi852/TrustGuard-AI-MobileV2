import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProgressSteps } from '@/components/analysis/progress-steps';
import { AppText, Button, Card, Notice, Screen } from '@/components/ui/primitives';
import { ValidationError } from '@/core/errors';
import { type ImageInput, validateImageInput } from '@/core/validation';
import { useAnalysisRunner } from '@/hooks/use-analysis-runner';
import { analyzeImage } from '@/services/analysis/pipeline';
import { capabilities } from '@/services/providers';
import { radius, spacing, useTheme } from '@/theme/theme';

const STEPS = [
  { stage: 'reading_image', label: 'Reading the image and finding claims' },
  { stage: 'analyzing_claim', label: 'Assessing the main claim' },
  { stage: 'checking_sources', label: 'Searching the web and checking sources' },
] as const;

const MAX_PREVIEW_HEIGHT = 360;

function formatBytes(bytes?: number | null): string | null {
  if (!bytes) return null;
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Validation message for a picked image, or null if it can be analyzed. */
function checkPicked(image: ImageInput): string | null {
  try {
    validateImageInput(image);
    return null;
  } catch (error) {
    return error instanceof ValidationError ? error.message : 'This image cannot be used.';
  }
}

export default function AnalyzeImageScreen() {
  const theme = useTheme();
  const [image, setImage] = useState<ImageInput | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const { run, isRunning, stage, error, reset } = useAnalysisRunner();

  const pickImage = async () => {
    setPickError(null);
    reset();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        exif: false,
        // iOS: prefer a widely compatible representation (JPEG rather than HEIC).
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const picked: ImageInput = {
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        base64: asset.base64,
      };
      setImage(picked);
      setImageError(checkPicked(picked));
    } catch {
      setPickError('The photo library could not be opened. Check photo permissions and try again.');
    }
  };

  const removeImage = () => {
    setImage(null);
    setImageError(null);
    setPickError(null);
    reset();
  };

  const aspectRatio =
    image?.width && image.height ? Math.max(0.4, Math.min(2.5, image.width / image.height)) : 4 / 3;
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
          Check a claim in an image
        </AppText>
        <AppText variant="small" muted>
          Screenshots, social posts, memes, charts or infographics. TrustGuardAI reads the text,
          finds the claim and checks it against sources.
        </AppText>
      </View>

      {image ? (
        <View style={{ gap: spacing.sm }}>
          <View style={[styles.previewFrame, { backgroundColor: theme.surfaceMuted }]}>
            <Image
              testID="image-preview"
              source={{ uri: image.uri }}
              contentFit="contain"
              accessibilityLabel="Selected image preview"
              style={{ width: '100%', aspectRatio, maxHeight: MAX_PREVIEW_HEIGHT }}
            />
          </View>
          {details ? (
            <AppText variant="caption" subtle>
              {details}
            </AppText>
          ) : null}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                label="Replace"
                variant="secondary"
                icon="images-outline"
                onPress={pickImage}
                disabled={isRunning}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Remove"
                variant="ghost"
                icon="trash-outline"
                onPress={removeImage}
                disabled={isRunning}
                accessibilityHint="Removes the selected image"
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <Card style={[styles.empty, { borderColor: theme.border }]}>
            <AppText variant="small" muted style={{ textAlign: 'center' }}>
              No image selected
            </AppText>
          </Card>
          <Button
            label="Choose image"
            variant="secondary"
            icon="images-outline"
            onPress={pickImage}
            disabled={isRunning}
          />
        </>
      )}

      {!capabilities.imageAnalysis ? (
        <Notice tone="neutral" title="Image analysis not connected">
          Images can’t be analyzed right now. TrustGuardAI won’t show a result it hasn’t computed.
        </Notice>
      ) : null}

      {imageError || pickError || error ? (
        <Notice
          tone="negative"
          title={imageError ? 'This image can’t be used' : 'Analysis didn’t complete'}>
          {imageError ?? pickError ?? error}
        </Notice>
      ) : null}

      <Button
        label={isRunning ? 'Analyzing…' : error ? 'Try again' : 'Analyze image'}
        icon={error ? 'refresh' : 'shield-checkmark-outline'}
        loading={isRunning}
        disabled={!image || imageError !== null}
        onPress={() =>
          run((providers, onProgress) => analyzeImage(image, providers, { onProgress }))
        }
      />

      {isRunning ? (
        <ProgressSteps
          steps={STEPS}
          stage={stage}
          note="Reading the image and checking sources usually takes 30–120 seconds."
        />
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="small" style={{ fontWeight: '600' }}>
          How images are analyzed
        </AppText>
        <AppText variant="small" muted>
          • The AI reads the visible text and finds up to 3 claims. It won’t guess unreadable text.
        </AppText>
        <AppText variant="small" muted>
          • The main factual claim is checked against web sources, like a typed claim.
        </AppText>
        <AppText variant="small" muted>
          • Jokes, opinions and predictions are not treated as facts.
        </AppText>
        <AppText variant="small" muted>
          • It does not judge whether the image itself is AI-generated or edited.
        </AppText>
        <AppText variant="caption" subtle>
          JPEG, PNG, WebP or GIF up to 5 MB. Your image is sent securely for this analysis only. It
          is not stored on the server or in your history.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  previewFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  row: { flexDirection: 'row', gap: spacing.sm },
});
