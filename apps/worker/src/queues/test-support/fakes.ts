// Fakes for the unit tests of the worker (not part of the product; excluded from coverage): a clock the test moves by hand,
// a logger that says nothing, a Telegram that remembers what it was asked to send, a queue sink, an outbox in memory.
import type { Logger } from "pino";
import type { FailureInfo, FailureSink } from "../failures.ts";
import type { JobSink, SendMessageInput, TelegramGateway } from "../runtime.ts";

/** 2026-10-12 10:00 in Tashkent, a Monday. */
export const T0 = new Date("2026-10-12T10:00:00+05:00");

export class FakeClock {
  #ms: number;
  constructor(start: Date = T0) {
    this.#ms = start.getTime();
  }
  now = (): Date => new Date(this.#ms);
  ms = (): number => this.#ms;
  set(at: Date): void {
    this.#ms = at.getTime();
  }
  advance(ms: number): void {
    this.#ms += ms;
  }
  /** `sleep` for code under test: moves the clock instead of waiting. */
  sleep = async (ms: number): Promise<void> => {
    this.#ms += ms;
  };
}

export interface LogLine {
  level: string;
  data: unknown;
  message?: string;
}

/** A pino-shaped logger that keeps its lines in a list. */
export function recordingLogger(): { log: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const make = (level: string) => (a: unknown, b?: unknown) => {
    lines.push(
      typeof a === "string" ? { level, data: undefined, message: a } : { level, data: a, message: b as string },
    );
  };
  const log = {
    trace: make("trace"),
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    fatal: make("fatal"),
    child: () => log,
  } as unknown as Logger;
  return { log, lines };
}

export class FakeTelegram implements TelegramGateway {
  enabled = true;
  sent: (SendMessageInput & { at: number })[] = [];
  /** What the next calls do, in order; `undefined` means success. */
  failures: (Error | undefined)[] = [];
  #id = 1000;
  readonly #clock: FakeClock;
  constructor(clock: FakeClock) {
    this.#clock = clock;
  }
  async sendMessage(input: SendMessageInput): Promise<{ messageId: number }> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push({ ...input, at: this.#clock.ms() });
    this.#id += 1;
    return { messageId: this.#id };
  }
  async getWebhookInfo() {
    return { url: "https://nivel.test/tg/x", lastErrorDate: null, lastErrorMessage: null };
  }
}

export class FakeJobs implements JobSink {
  sent: { queue: string; data: object; opts: { singletonKey?: string; startAfter?: Date } | undefined }[] = [];
  queues = new Set<string>();
  /** The answer of the next `send`; `null` means pg-boss found the job already queued. */
  answers: (string | null)[] = [];
  async send(queue: string, data: object, opts?: { singletonKey?: string; startAfter?: Date }) {
    this.sent.push({ queue, data, opts });
    return this.answers.length > 0 ? (this.answers.shift() as string | null) : `job-${this.sent.length}`;
  }
  async hasQueue(queue: string) {
    return this.queues.has(queue);
  }
}

export function recordingFailures(): FailureSink & { recorded: FailureInfo[] } {
  const recorded: FailureInfo[] = [];
  return {
    recorded,
    async recordFinal(info) {
      recorded.push(info);
      return { count: recorded.length, fingerprint: `fp-${recorded.length}` };
    },
  };
}
