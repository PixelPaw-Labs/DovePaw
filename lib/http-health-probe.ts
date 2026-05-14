/**
 * Recursive-promise HTTP health probe. Used to wait for child Python
 * processes (OpenViking sidecar, OpenViking console) to become reachable
 * after spawn. Resolves on the first non-5xx response; rejects on timeout.
 *
 * Implemented with `setTimeout`-chained `.then` rather than `await` inside
 * a `while` loop so it doesn't trip the no-await-in-loop lint while keeping
 * the retry semantics identical to a polling loop.
 */
export function httpHealthProbe(
  url: string,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const { timeoutMs, intervalMs } = options;
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const probe = (): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`Health probe at ${url} did not respond within ${timeoutMs}ms`));
        return;
      }
      fetch(url)
        .then((res) => {
          if (res.ok || res.status < 500) {
            resolve();
            return;
          }
          setTimeout(probe, intervalMs);
        })
        .catch(() => setTimeout(probe, intervalMs));
    };
    probe();
  });
}
