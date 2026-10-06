import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useIsDark, useTheme } from '@/theme/theme';

export default function RootLayout() {
  const isDark = useIsDark();
  const theme = useTheme();
  const navigationTheme = isDark ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...navigationTheme,
        colors: {
          ...navigationTheme.colors,
          background: theme.background,
          card: theme.background,
          text: theme.text,
          border: theme.border,
          primary: theme.primary,
        },
      }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: theme.primary,
          headerTitleStyle: { color: theme.text, fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false, title: 'TrustGuardAI' }} />
        <Stack.Screen name="analyze/text" options={{ title: 'Analyze text' }} />
        <Stack.Screen name="analyze/claim" options={{ title: 'Analyze claim' }} />
        <Stack.Screen name="analyze/image" options={{ title: 'Analyze image' }} />
        <Stack.Screen name="result/[id]" options={{ title: 'Assessment' }} />
      </Stack>
    </ThemeProvider>
  );
}
