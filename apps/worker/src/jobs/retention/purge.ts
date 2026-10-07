// retention.purge (ARCHITECTURE 9, DATA-MAP 9): once a day the worker removes what has been kept long enough. The worker has no
// right to DELETE from requests, customers or files; the functions of the database do it under their owner (sales.purge_expired_leads,
// ops.purge_expired_files, ai.purge_expired), never for a moment later than the clock of the database. The bytes of the
// files are removed BEFORE the transaction commits (ops.purgeExpiredFilesAndRemoveBytes): a failed disk rolls the rows back and the
// next run offers the same keys, so a key is never lost.
import type { Db } from "@nivel/db";
import { ai, bot, ops, sales } from "@nivel/db/repos";
import type { Logger } from "pino";
import { sanitizeMessage } from "../../queues/failures.ts";

/** A session of the bot nobody has touched for this long is forgotten (DATA-MAP 9: "by inactivity"; the term is the worker's assumption). */
export const BOT_SESSION_IDLE_DAYS = 30;
const PROCESSED_UPDATES_DAYS = 7;
const DAY_MS = 86_400_000;

export interface RetentionPorts {
  /** Requests older than 12 months without an order: the contact and the comment are cleared, the customer is made anonymous. */
  purgeLeads(now: Date): Promise<number>;
  /** Deletes the rows of the files whose time has run out and calls `removeBytes` for every key before the commit. */
  purgeFiles(now: Date, removeBytes: (storageKey: string) => Promise<void>): Promise<string[]>;
  /** Conversations of the AI consultant past their 90 days, with their messages. */
  purgeAi(now: Date): Promise<number>;
  /** Updates of Telegram older than 7 days. */
  purgeUpdates(now: Date): Promise<number>;
  purgeSessions(cutoff: Date): Promise<number>;
}

export interface RetentionDeps {
  now(): Date;
  log: Logger;
  ports: RetentionPorts;
  removeBytes(storageKey: string): Promise<void>;
  /** False without FILES_DIR: the files are not purged at all. */
  filesEnabled: boolean;
}

export interface RetentionSummary {
  leads: number;
  files: number;
  aiConversations: number;
  processedUpdates: number;
  botSessions: number;
  filesSkipped: boolean;
}

export async function handleRetention(deps: RetentionDeps): Promise<RetentionSummary> {
  const now = deps.now();
  const summary: RetentionSummary = {
    leads: 0,
    files: 0,
    aiConversations: 0,
    processedUpdates: 0,
    botSessions: 0,
    filesSkipped: false,
  };
  const failures: string[] = [];
  const step = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures.push(`${name}: ${sanitizeMessage(error)}`);
      deps.log.error({ step: name, err: sanitizeMessage(error) }, "retention step failed");
    }
  };

  await step("requests", async () => {
    summary.leads = await deps.ports.purgeLeads(now);
  });
  if (deps.filesEnabled) {
    await step("files", async () => {
      summary.files = (await deps.ports.purgeFiles(now, deps.removeBytes)).length;
    });
  } else {
    summary.filesSkipped = true;
    deps.log.warn(
      "retention.purge: FILES_DIR is not set, the files are not purged (the rows must not go while the bytes stay)",
    );
  }
  await step("ai conversations", async () => {
    summary.aiConversations = await deps.ports.purgeAi(now);
  });
  await step("processed updates", async () => {
    summary.processedUpdates = await deps.ports.purgeUpdates(now);
  });
  await step("bot sessions", async () => {
    summary.botSessions = await deps.ports.purgeSessions(new Date(now.getTime() - BOT_SESSION_IDLE_DAYS * DAY_MS));
  });

  deps.log.info(summary, "retention.purge");
  if (failures.length > 0) throw new Error(`retention.purge: ${failures.join("; ")}`);
  return summary;
}

export function createPgRetentionPorts(db: Db): RetentionPorts {
  return {
    purgeLeads: (now) => sales.purgeExpiredLeads(db, now),
    purgeFiles: (now, removeBytes) => ops.purgeExpiredFilesAndRemoveBytes(db, removeBytes, now),
    purgeAi: (now) => ai.purgeExpiredConversations(db, now),
    purgeUpdates: (now) => bot.purgeProcessedUpdates(db, PROCESSED_UPDATES_DAYS, now),
    async purgeSessions(cutoff) {
      const { rowCount } = await db.$client.query("delete from bot.sessions where updated_at < $1", [cutoff]);
      return rowCount ?? 0;
    },
  };
}
