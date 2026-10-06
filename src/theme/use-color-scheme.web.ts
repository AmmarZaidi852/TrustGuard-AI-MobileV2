import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const noopSubscribe = () => () => {};

/**
 * Static web rendering has no colour scheme on the server. Render light during
 * server rendering and hydration, then the real scheme, so every component agrees.
 */
export function useColorScheme() {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const scheme = useRNColorScheme();
  return isClient ? scheme : 'light';
}
