import { describe, expect, it, vi } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { BOT_SESSION_IDLE_DAYS, handleRetention, type RetentionPorts } from "./purge.ts";

function setup(over: Partial<RetentionPorts> = {}, filesEnabled = true) {
  const clock = new FakeClock(new Date("2026-10-12T03:30:00+05:00"));
  const { log, lines } = recordingLogger();
  const calls: string[] = [];
  const removed: string[] = [];
  const ports: RetentionPorts = {
    purgeLeads: vi.fn(async () => {
      calls.push("leads");
      return 2;
    }),
    purgeFiles: vi.fn(async (_now, removeBytes) => {
      calls.push("files");
      await removeBytes("a/one.pdf");
      await removeBytes("a/two.jpg");
      return ["a/one.pdf", "a/two.jpg"];
    }),
    purgeAi: vi.fn(async () => {
      calls.push("ai");
      return 3;
    }),
    purgeUpdates: vi.fn(async () => {
      calls.push("updates");
      return 40;
    }),
    purgeSessions: vi.fn(async () => {
      calls.push("sessions");
      return 5;
    }),
    ...over,
  };
  const deps = {
    now: clock.now,
    log,
    ports,
    removeBytes: async (key: string) => {
      removed.push(key);
    },
    filesEnabled,
  };
  return { deps, ports, calls, removed, lines, clock };
}

describe("handleRetention: what is kept for how long (DATA-MAP 9)", () => {
  it("runs the five purges with the clock of the process and reports what each removed", async () => {
    const t = setup();
    const summary = await handleRetention(t.deps);
    expect(summary).toEqual({
      leads: 2,
      files: 2,
      aiConversations: 3,
      processedUpdates: 40,
      botSessions: 5,
      filesSkipped: false,
    });
    expect(t.calls).toEqual(["leads", "files", "ai", "updates", "sessions"]);
    expect(t.ports.purgeLeads).toHaveBeenCalledWith(t.clock.now());
    expect(t.ports.purgeAi).toHaveBeenCalledWith(t.clock.now());
    expect(t.ports.purgeUpdates).toHaveBeenCalledWith(t.clock.now());
  });

  it("removes the bytes of the files it deletes: the port gets the function that does it", async () => {
    const t = setup();
    await handleRetention(t.deps);
    expect(t.removed).toEqual(["a/one.pdf", "a/two.jpg"]);
  });

  it("forgets the sessions of the bot that have been idle for 30 days", async () => {
    const t = setup();
    await handleRetention(t.deps);
    expect(BOT_SESSION_IDLE_DAYS).toBe(30);
    const cutoff = (t.ports.purgeSessions as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Date;
    expect(cutoff).toEqual(new Date(t.clock.now().getTime() - 30 * 86_400_000));
  });

  it("does not touch the files without a place for the bytes (no FILES_DIR): the rows must not go while the bytes stay", async () => {
    const t = setup({}, false);
    const summary = await handleRetention(t.deps);
    expect(t.ports.purgeFiles).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ files: 0, filesSkipped: true, leads: 2, aiConversations: 3 });
    expect(t.lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("runs every purge even when one fails, then fails the job and names the step", async () => {
    const t = setup({
      purgeAi: vi.fn(async () => {
        throw new Error("deadlock detected");
      }),
    });
    await expect(handleRetention(t.deps)).rejects.toThrow(/ai conversations.*deadlock detected/);
    expect(t.calls).toEqual(["leads", "files", "updates", "sessions"]);
  });

  it("names every failed step when several fail", async () => {
    const boom = (m: string) =>
      vi.fn(async () => {
        throw new Error(m);
      });
    const t = setup({ purgeLeads: boom("leads down"), purgeSessions: boom("sessions down") });
    const error = await handleRetention(t.deps).catch((e) => e);
    expect(error.message).toContain("requests");
    expect(error.message).toContain("leads down");
    expect(error.message).toContain("bot sessions");
    expect(error.message).toContain("sessions down");
  });

  it("fails the job when the disk fails: the rows stay, the next run offers the same keys", async () => {
    const t = setup({
      purgeFiles: vi.fn(async (_now, removeBytes) => {
        await removeBytes("a/one.pdf");
        throw new Error("EIO: disk");
      }),
    });
    await expect(handleRetention(t.deps)).rejects.toThrow(/files.*EIO/);
  });
});
