import { useColorScheme } from './use-color-scheme';

import type { Tone } from '@/core/presentation';

const palette = {
  light: {
    background: '#F5F6F8',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF0F3',
    border: '#E2E5EA',
    text: '#0F172A',
    textMuted: '#475467',
    textSubtle: '#667085',
    primary: '#12355B',
    primaryText: '#FFFFFF',
    accent: '#1B6FB3',
    tones: {
      positive: { fg: '#1D6B45', bg: '#E5F3EB' },
      caution: { fg: '#9A4A06', bg: '#FCF0E1' },
      negative: { fg: '#B42318', bg: '#FDECEA' },
      neutral: { fg: '#475467', bg: '#EEF0F3' },
      info: { fg: '#1B5E9E', bg: '#E6F0FA' },
    },
  },
  dark: {
    background: '#0B0F14',
    surface: '#141A21',
    surfaceMuted: '#1C242D',
    border: '#26303B',
    text: '#F1F4F8',
    textMuted: '#A9B2BF',
    textSubtle: '#8892A0',
    primary: '#8CC2F2',
    primaryText: '#0B0F14',
    accent: '#7DB8EC',
    tones: {
      positive: { fg: '#6FD3A0', bg: '#13291F' },
      caution: { fg: '#F2B266', bg: '#2E2213' },
      negative: { fg: '#F48B82', bg: '#331A18' },
      neutral: { fg: '#B4BDC9', bg: '#1E262F' },
      info: { fg: '#8CC2F2', bg: '#142538' },
    },
  },
} as const;

export type Theme = (typeof palette)['light'] | (typeof palette)['dark'];
export type ToneColors = Theme['tones'][Tone];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const MAX_CONTENT_WIDTH = 640;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
