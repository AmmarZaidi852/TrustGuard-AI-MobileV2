import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnalysisResult } from '@/core/types';

/** Recent analyses, stored on-device only. */

const STORAGE_KEY = 'trustguard:recent-analyses:v1';
export const MAX_HISTORY = 20;

let cache: AnalysisResult[] | null = null;
const listeners = new Set<(items: AnalysisResult[]) => void>();

function isResult(value: unknown): value is AnalysisResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnalysisResult).id === 'string' &&
    typeof (value as AnalysisResult).assessment === 'object'
  );
}

/**
 * Images are never written to storage: only the in-memory copy of a result keeps
 * the picker's image URI, so the preview disappears when the app restarts.
 */
function withoutImage(item: AnalysisResult): AnalysisResult {
  return item.input.imageUri ? { ...item, input: { ...item.input, imageUri: undefined } } : item;
}

export async function loadHistory(): Promise<AnalysisResult[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isResult) : [];
  } catch {
    // Corrupt or unreadable storage should never block analysis.
    cache = [];
  }
  return cache;
}

async function persist(items: AnalysisResult[]): Promise<void> {
  cache = items;
  listeners.forEach((listener) => listener(items));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items.map(withoutImage)));
  } catch {
    // Keep the in-memory copy; history is a convenience, not critical data.
  }
}

export async function saveAnalysis(result: AnalysisResult): Promise<void> {
  const items = await loadHistory();
  await persist([result, ...items.filter((item) => item.id !== result.id)].slice(0, MAX_HISTORY));
}

export async function getAnalysis(id: string): Promise<AnalysisResult | null> {
  const items = await loadHistory();
  return items.find((item) => item.id === id) ?? null;
}

export async function clearHistory(): Promise<void> {
  await persist([]);
}

export function subscribeToHistory(listener: (items: AnalysisResult[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: drop the in-memory cache. */
export function resetHistoryCache(): void {
  cache = null;
}
