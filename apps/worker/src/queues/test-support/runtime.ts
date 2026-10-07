// The runtime of the worker for the integration tests (not part of the product): the real database as the role nivel_worker, the
// fake clock of the world, and fakes for every door that reaches outside (Telegram, the site, the disk, pg-boss).
import type { PgBoss } from "pg-boss";
import type { FileStore, MessageRenderer, Probes, WorkerRuntime, WorkerSettings } from "../runtime.ts";
import { createWorkerRuntime } from "../wire.ts";
import { FakeJobs, FakeTelegram, recordingLogger } from "./fakes.ts";
import type { World } from "./world.ts";

export const TEST_KEY = "integration-test-key-0123456789-0123456789"; // gitleaks:allow fake key of the tests

export interface TestRuntime {
  rt: WorkerRuntime;
  telegram: FakeTelegram;
  jobs: FakeJobs;
  lines: ReturnType<typeof recordingLogger>["lines"];
  fetchCalls: { url: string; init: RequestInit }[];
}

export function testRuntime(
  w: World,
  over: {
    settings?: Partial<WorkerSettings>;
    fetch?: typeof fetch;
    files?: FileStore;
    probes?: Probes;
    renderer?: MessageRenderer;
    boss?: Pick<PgBoss, "send" | "getQueue">;
  } = {},
): TestRuntime {
  const telegram = new FakeTelegram(w.clock);
  const jobs = new FakeJobs();
  const { log, lines } = recordingLogger();
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const rt = createWorkerRuntime({
    db: w.workerDb,
    boss:
      over.boss ??
      ({
        send: (queue: string, data: object, opts: object) => jobs.send(queue, data, opts),
        getQueue: async (q: string) => ((await jobs.hasQueue(q)) ? {} : null),
      } as unknown as Pick<PgBoss, "send" | "getQueue">),
    log,
    settings: {
      appMode: "production",
      publicBaseUrl: "http://web.test:3100",
      revalidateKey: TEST_KEY,
      botToken: "test-token-not-real",
      filesDir: undefined,
      ...over.settings,
    },
    now: w.clock.now,
    fetch: over.fetch ?? fakeFetch,
    telegram,
    ...(over.files ? { files: over.files } : {}),
    ...(over.probes ? { probes: over.probes } : {}),
    ...(over.renderer ? { renderer: over.renderer } : {}),
  });
  return { rt, telegram, jobs, lines, fetchCalls };
}
