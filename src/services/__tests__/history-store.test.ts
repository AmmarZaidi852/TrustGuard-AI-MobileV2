import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockModelContradicted, mockProviders } from '@/test/fixtures';

import { analyzeText } from '../analysis/pipeline';
import {
  MAX_HISTORY,
  clearHistory,
  getAnalysis,
  loadHistory,
  resetHistoryCache,
  saveAnalysis,
} from '../history/history-store';

let counter = 0;
const makeResult = () =>
  analyzeText(
    'NASA discovered life on Mars.',
    'claim',
    mockProviders({ model: mockModelContradicted }),
    {
      createId: () => `id-${counter++}`,
    },
  );

beforeEach(async () => {
  await AsyncStorage.clear();
  resetHistoryCache();
});

test('saves newest first and survives a cache reset', async () => {
  const first = await makeResult();
  const second = await makeResult();
  await saveAnalysis(first);
  await saveAnalysis(second);

  resetHistoryCache();
  const items = await loadHistory();
  expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
  expect(await getAnalysis(first.id)).toMatchObject({ id: first.id });
  expect(await getAnalysis('missing')).toBeNull();
});

test('caps history length', async () => {
  for (let i = 0; i < MAX_HISTORY + 3; i++) {
    await saveAnalysis(await makeResult());
  }
  expect(await loadHistory()).toHaveLength(MAX_HISTORY);
});

test('recovers from corrupt storage', async () => {
  await AsyncStorage.setItem('trustguard:recent-analyses:v1', '{not json');
  expect(await loadHistory()).toEqual([]);
});

test('clears history', async () => {
  await saveAnalysis(await makeResult());
  await clearHistory();
  expect(await loadHistory()).toEqual([]);
});
