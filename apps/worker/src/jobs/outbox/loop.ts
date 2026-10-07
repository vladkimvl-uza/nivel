// The polling of outbox.relay: a pass at once, then one every `intervalMs` (ARCHITECTURE 9: "LISTEN/NOTIFY and a poll every 5 s";
// the database has no trigger that notifies yet, so the poll is the whole of it, and `wake()` is the hook for the day it has).
// Passes never overlap; a full batch means more rows are waiting, so the next pass starts at once.

export interface PollingOptions {
  pass: () => Promise<{ claimed: number }>;
  intervalMs: number;
  /** A pass that claims this many rows is followed at once by another. */
  fullBatch: number;
  onError: (error: unknown) => void;
}

export interface Polling {
  /** Runs a pass now (or right after the one that runs). */
  wake(): void;
  /** Stops the loop and waits for the pass that is running. */
  stop(): Promise<void>;
}

export function startPolling(o: PollingOptions): Polling {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const schedule = (ms: number): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };

  function run(): void {
    if (stopped) return;
    if (running !== undefined) {
      again = true;
      return;
    }
    running = (async () => {
      let next = o.intervalMs;
      try {
        const { claimed } = await o.pass();
        if (claimed >= o.fullBatch) next = 0;
      } catch (error) {
        o.onError(error);
      }
      if (again) {
        again = false;
        next = 0;
      }
      running = undefined;
      schedule(next);
    })();
  }

  timer = setTimeout(run, 0);

  return {
    wake: run,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
