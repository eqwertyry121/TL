export function startVisiblePolling(action: (signal: AbortSignal) => Promise<void>, intervalMs: number, runImmediately = false): () => void {
  let stopped = false;
  let timer = 0;
  let coalesceTimer = 0;
  let inFlight: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let errorDelayMs = 5000;

  const clearScheduled = () => {
    window.clearTimeout(timer);
    timer = 0;
  };

  const jitter = (delayMs: number) => {
    if (delayMs <= 0) return 0;
    return Math.max(250, Math.round(delayMs * (0.9 + Math.random() * 0.2)));
  };

  const schedule = (delayMs: number) => {
    clearScheduled();
    if (stopped || document.visibilityState === "hidden") return;
    timer = window.setTimeout(run, jitter(delayMs));
  };

  const scheduleAfterError = () => {
    const nextDelay = errorDelayMs;
    errorDelayMs = Math.min(errorDelayMs * 2, 30000);
    schedule(nextDelay);
  };

  const run = () => {
    clearScheduled();
    if (stopped || document.visibilityState === "hidden") return;
    if (inFlight) return;
    const controller = new AbortController();
    activeController = controller;
    inFlight = action(controller.signal)
      .then(() => {
        if (stopped || controller.signal.aborted) return;
        errorDelayMs = 5000;
        schedule(intervalMs);
      })
      .catch(() => {
        if (stopped || controller.signal.aborted) return;
        scheduleAfterError();
      })
      .finally(() => {
        if (activeController === controller) activeController = null;
        inFlight = null;
      });
  };

  const triggerCoalesced = () => {
    if (stopped || document.visibilityState === "hidden") return;
    if (coalesceTimer) return;
    coalesceTimer = window.setTimeout(() => {
      coalesceTimer = 0;
    }, 500);
    run();
  };

  window.addEventListener("focus", triggerCoalesced);
  window.addEventListener("pageshow", triggerCoalesced);
  document.addEventListener("visibilitychange", triggerCoalesced);
  schedule(runImmediately ? 0 : intervalMs);

  return () => {
    stopped = true;
    clearScheduled();
    window.clearTimeout(coalesceTimer);
    activeController?.abort();
    activeController = null;
    window.removeEventListener("focus", triggerCoalesced);
    window.removeEventListener("pageshow", triggerCoalesced);
    document.removeEventListener("visibilitychange", triggerCoalesced);
  };
}
