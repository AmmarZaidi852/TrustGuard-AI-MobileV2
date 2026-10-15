/**
 * Total server-side time per request, across every provider call, retry and search
 * continuation it makes. Each budget is kept below the app's timeout for the same
 * route (`src/services/config.ts`), so the server stops calling the paid provider
 * before the app gives up waiting, never after. A test enforces the margins.
 */
export const ROUTE_BUDGET_MS = {
  /** App waits 60 s. */
  claims: 55_000,
  /** App waits 90 s, which also covers uploading up to ~7 MB on a mobile network. */
  images: 75_000,
  /** App waits 150 s; shared by web search (with continuations) and evaluation. */
  evidence: 140_000,
} as const;

/** Per-call options the analyzers pass through to the provider SDK. */
export interface CallOptions {
  /** Aborts every outstanding and future provider call of this request. */
  signal?: AbortSignal;
}

/**
 * A signal that aborts when the request's budget runs out or the client goes away
 * (if the server runtime reports disconnects through `request.signal`).
 */
export function requestDeadline(
  request: Request,
  budgetMs: number | undefined,
): AbortSignal | undefined {
  const signals = [
    request.signal,
    budgetMs === undefined ? undefined : AbortSignal.timeout(budgetMs),
  ];
  // Checked by shape: the runtime's Request may come from another JS realm.
  const active = signals.filter(
    (signal): signal is AbortSignal => typeof signal?.aborted === 'boolean',
  );
  if (active.length === 0) return undefined;
  return active.length === 1 ? active[0] : AbortSignal.any(active);
}
