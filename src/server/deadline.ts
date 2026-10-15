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
  const signals = [request.signal, budgetMs === undefined ? undefined : timeoutSignal(budgetMs)];
  // Checked by shape: the runtime's Request may come from another JS realm.
  const active = signals.filter(
    (signal): signal is AbortSignal => typeof signal?.aborted === 'boolean',
  );
  if (active.length === 0) return undefined;
  return active.length === 1 ? active[0] : anySignal(active);
}

/*
 * `AbortSignal.timeout` and `AbortSignal.any` are recent additions. The hosting
 * runtime (EAS Hosting runs on Cloudflare Workers, not Node) is not documented to
 * provide both, and a missing one would fail every AI request, so each has a
 * fallback built from AbortController.
 */

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Like AbortSignal.timeout, never keep the process alive just for this timer (Node only).
  (timer as { unref?: () => void }).unref?.();
  return controller.signal;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
