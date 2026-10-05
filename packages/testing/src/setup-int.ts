// vitest setupFiles for the integration project: a database per worker, all DATABASE_URL_* overridden.
import { afterAll, beforeAll } from "vitest";
import { createWorkerDatabase, type WorkerDatabase } from "./db.ts";

let db: WorkerDatabase | undefined;

beforeAll(async () => {
  const worker = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "1";
  db = await createWorkerDatabase(worker);
});

afterAll(async () => {
  await db?.drop();
});
