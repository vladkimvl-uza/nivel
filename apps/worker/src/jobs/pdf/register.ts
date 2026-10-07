import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import { QUEUE } from "../outbox/routes.ts";
import type { JobContext } from "../types.ts";
import { createFsWriter, createPgDocFiles, type DocFiles } from "./files.ts";
import { handlePdfRender, type PdfJobDeps } from "./job.ts";
import { createPgPdfRows } from "./rows.ts";

/** Without FILES_DIR a document has nowhere to go: the job refuses for good before it reads anything (`filesEnabled`). */
const noDisk: Pick<DocFiles, "save"> = {
  async save() {
    throw new Error("FILES_DIR is not set: a document cannot be written");
  },
};

export function pdfDepsOf(rt: WorkerRuntime): PdfJobDeps {
  const dir = rt.settings.filesDir;
  return {
    now: () => rt.now(),
    log: rt.log,
    rows: createPgPdfRows(rt.db),
    files: createPgDocFiles(rt.db, dir === undefined ? noDisk : createFsWriter(dir)),
    ctx: { publicBaseUrl: rt.settings.publicBaseUrl },
    filesEnabled: dir !== undefined,
  };
}

/**
 * Domain "pdf" (ARCHITECTURE 9): the queue pdf.render. The outbox relay sends the job here only while the flag `feature.pdf` is on
 * (the integrator switches it on); the queue itself always exists, so the relay finds it. One document at a time: the renderer
 * shares its fonts between documents. Owner - WP-12.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = pdfDepsOf(ctx.runtime);
  await registerQueue(ctx, {
    name: QUEUE.pdfRender,
    concurrency: 1,
    expireInSeconds: 180,
    handler: async (data) => {
      await handlePdfRender(deps, data);
    },
  });
}
