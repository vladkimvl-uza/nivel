// How a queue of the worker is made (ARCHITECTURE 9): five attempts with a growing pause, a schedule in the calendar of
// Tashkent for the queues that run by the clock, and a failure after the last attempt that goes to ops.app_errors and to the
// owner as an alert. Handlers are idempotent; pg-boss may run one twice.
import type { Job, JobWithMetadata, Queue } from "pg-boss";
import { sanitizeMessage } from "./failures.ts";
import type { WorkerContext } from "./runtime.ts";

export const TASHKENT_TZ = "Asia/Tashkent";

export interface RetryOptions {
  /** Retries after the first attempt: the job runs `limit + 1` times at most. */
  limit: number;
  delaySec: number;
  backoff: boolean;
  maxDelaySec: number;
}

/** Five attempts in all: 30 s, about 1 min, 2 min, 4 min between them. */
export const DEFAULT_RETRY: Readonly<RetryOptions> = { limit: 4, delaySec: 30, backoff: true, maxDelaySec: 3600 };

/** The job cannot succeed however often it is run (a sum that is not the one in the database): it is written down at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export interface JobMeta {
  id: string;
  /** 1 for the first run. */
  attempt: number;
  /** How many runs the job gets in all. */
  attempts: number;
  /** The last run: a failure now is a failure for good. */
  final: boolean;
}

export interface QueueSpec<D extends object = Record<string, unknown>> {
  name: string;
  /** Cron expression in the calendar of Tashkent; absent for a queue that is fed by the outbox or by the code. */
  cron?: string;
  retry?: Partial<RetryOptions>;
  /** Seconds a run may last before pg-boss gives it up. */
  expireInSeconds?: number;
  /** How many jobs of this queue run at once in this process (pg-boss: one worker). */
  concurrency?: number;
  /** How often the worker looks for a job, in seconds (pg-boss: 2 by default, 0.5 at least); the tests make it short. */
  pollSeconds?: number;
  handler: (data: D, meta: JobMeta) => Promise<void>;
}

type RunningJob<D extends object> = Job<D> & Partial<Pick<JobWithMetadata<D>, "retryLimit">>;

export async function registerQueue<D extends object = Record<string, unknown>>(
  ctx: WorkerContext,
  spec: QueueSpec<D>,
): Promise<void> {
  const retry: RetryOptions = { ...DEFAULT_RETRY, ...spec.retry };
  const options: Omit<Queue, "name"> = {
    retryLimit: retry.limit,
    retryDelay: retry.delaySec,
    retryBackoff: retry.backoff,
    // pg-boss refuses a cap on the pause when the pause does not grow.
    ...(retry.backoff ? { retryDelayMax: retry.maxDelaySec } : {}),
    ...(spec.expireInSeconds === undefined ? {} : { expireInSeconds: spec.expireInSeconds }),
  };
  await ctx.boss.createQueue(spec.name, options);
  // createQueue leaves a queue that exists as it is: a change of the options in a new release must reach it too.
  await ctx.boss.updateQueue(spec.name, { ...options, retryDelayMax: retry.backoff ? retry.maxDelaySec : null });
  if (spec.cron !== undefined) await ctx.boss.schedule(spec.name, spec.cron, null, { tz: TASHKENT_TZ });
  await ctx.boss.work<D>(
    spec.name,
    {
      includeMetadata: true,
      ...(spec.pollSeconds === undefined ? {} : { pollingIntervalSeconds: spec.pollSeconds }),
      ...(spec.concurrency === undefined ? {} : { localConcurrency: spec.concurrency }),
    },
    async (jobs: RunningJob<D>[]) => {
      for (const job of jobs) await runJob(ctx, spec, job, retry);
    },
  );
}

async function runJob<D extends object>(
  ctx: WorkerContext,
  spec: QueueSpec<D>,
  job: RunningJob<D>,
  retry: RetryOptions,
): Promise<void> {
  const limit = job.retryLimit ?? retry.limit;
  const meta: JobMeta = {
    id: job.id,
    attempt: job.retryCount + 1,
    attempts: limit + 1,
    final: job.retryCount >= limit,
  };
  const { log } = ctx.runtime;
  try {
    await spec.handler(job.data, meta);
  } catch (error) {
    if (error instanceof PermanentJobError) {
      log.error({ queue: spec.name, jobId: job.id, err: sanitizeMessage(error) }, "job refused for good");
      await record(ctx, spec.name, job.id, meta.attempt, error);
      return;
    }
    if (meta.final) {
      log.error({ queue: spec.name, jobId: job.id, err: sanitizeMessage(error) }, "job failed for good");
      await record(ctx, spec.name, job.id, meta.attempt, error);
    } else {
      log.warn(
        { queue: spec.name, jobId: job.id, attempt: meta.attempt, err: sanitizeMessage(error) },
        "job failed, will retry",
      );
    }
    throw error;
  }
}

async function record(
  ctx: WorkerContext,
  queue: string,
  jobId: string,
  attempts: number,
  error: unknown,
): Promise<void> {
  try {
    await ctx.runtime.failures.recordFinal({ queue, jobId, attempts, error });
  } catch (recordError) {
    // The record is the last line: if the database is the thing that is down, the log still says what happened.
    ctx.runtime.log.error({ queue, jobId, err: sanitizeMessage(recordError) }, "the failure could not be recorded");
  }
}
