import { useEffect, useState } from 'react';

import type { AnalysisResult } from '@/core/types';
import { loadHistory, subscribeToHistory } from '@/services/history/history-store';

export function useHistory() {
  const [items, setItems] = useState<AnalysisResult[] | null>(null);

  useEffect(() => {
    let active = true;
    loadHistory().then((loaded) => active && setItems(loaded));
    const unsubscribe = subscribeToHistory((next) => active && setItems(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return items;
}
