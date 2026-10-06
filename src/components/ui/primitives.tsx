import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Tone } from '@/core/presentation';
import { MAX_CONTENT_WIDTH, radius, spacing, useTheme } from '@/theme/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'small' | 'caption' | 'overline';

const TEXT_STYLES = StyleSheet.create({
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 16 },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

export function AppText({
  variant = 'body',
  muted,
  subtle,
  color,
  style,
  ...props
}: TextProps & { variant?: TextVariant; muted?: boolean; subtle?: boolean; color?: string }) {
  const theme = useTheme();
  const resolved = color ?? (subtle ? theme.textSubtle : muted ? theme.textMuted : theme.text);
  return <Text {...props} style={[TEXT_STYLES[variant], { color: resolved }, style]} />;
}

export function Screen({
  children,
  scroll = true,
  topInset = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Pad for the status bar on screens without a navigation header. */
  topInset?: boolean;
}) {
  const theme = useTheme();
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView
      edges={topInset ? ['top', 'bottom', 'left', 'right'] : ['bottom', 'left', 'right']}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Card({ style, ...props }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      {...props}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    />
  );
}

export function Section({
  title,
  caption,
  children,
  right,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" muted accessibilityRole="header">
            {title}
          </AppText>
          {caption ? (
            <AppText variant="caption" subtle style={{ marginTop: 2 }}>
              {caption}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
}) {
  const colors = useTheme().tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={colors.fg} /> : null}
      <AppText variant="caption" color={colors.fg} style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary' ? theme.primary : variant === 'secondary' ? theme.surface : 'transparent';
  const fg = variant === 'primary' ? theme.primaryText : theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? theme.border : 'transparent',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <AppText variant="heading" color={fg} style={{ fontSize: 16 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  icon?: IconName;
}) {
  const colors = useTheme().tones[tone];
  const fallbackIcon: IconName =
    tone === 'negative' ? 'alert-circle' : tone === 'caution' ? 'warning' : 'information-circle';
  return (
    <View
      accessibilityRole={tone === 'negative' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: colors.bg }]}>
      <Ionicons name={icon ?? fallbackIcon} size={18} color={colors.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <AppText variant="small" color={colors.fg} style={{ fontWeight: '600' }}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="small" color={colors.fg}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

export function Divider() {
  return <View style={[styles.divider, { backgroundColor: useTheme().border }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  divider: { height: StyleSheet.hairlineWidth },
});
