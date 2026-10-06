import { describe, expect, it } from "vitest";
import { createWorkerDatabase } from "../../packages/testing/src/db.ts";
import {
  assertTestClusterUrl,
  assertTestDatabaseUrl,
  TestDbGuardError,
  testDatabaseNames,
  withDatabase,
} from "../../packages/testing/src/db-guard.ts";

const ok = "postgres://nivel_web:x@127.0.0.1:54339/nivel_s0_w1_test";

describe("test database harness guards", () => {
  it("refuses the development port 54329", () => {
    expect(() => assertTestDatabaseUrl("postgres://nivel_web:x@127.0.0.1:54329/nivel_s0_w1_test")).toThrow(
      /54329 is the development cluster/,
    );
    expect(() => assertTestClusterUrl("postgres://postgres:x@127.0.0.1:54329/postgres")).toThrow(TestDbGuardError);
  });

  it("refuses databases without the _test suffix and non-loopback hosts", () => {
    expect(() => assertTestDatabaseUrl("postgres://a:b@127.0.0.1:54339/nivel")).toThrow(/must end with "_test"/);
    expect(() => assertTestDatabaseUrl("postgres://a:b@localhost:54339/x_test")).toThrow(/host must be 127.0.0.1/);
    expect(() => assertTestDatabaseUrl("postgres://a:b@10.0.0.5:54339/x_test")).toThrow(TestDbGuardError);
    expect(() => withDatabase(ok, "nivel")).toThrow(TestDbGuardError);
  });

  it("accepts the test cluster and names databases per slot and worker", () => {
    expect(assertTestDatabaseUrl(ok).port).toBe("54339");
    expect(testDatabaseNames(1, 3)).toEqual({ template: "nivel_s1_template_test", worker: "nivel_s1_w3_test" });
  });

  it("refuses to create a worker database when the env points at 54329, before connecting", async () => {
    const dev = (role) => `postgres://${role}:x@127.0.0.1:54329/nivel_s0_test`;
    const env = {
      NIVEL_SLOT: "0",
      TEST_DATABASE_URL_SUPER: "postgres://postgres:x@127.0.0.1:54329/postgres",
      TEST_DATABASE_URL_MIGRATOR: dev("nivel_migrator"),
      TEST_DATABASE_URL_WEB: dev("nivel_web"),
      TEST_DATABASE_URL_ADMIN: dev("nivel_admin"),
      TEST_DATABASE_URL_BOT: dev("nivel_bot"),
      TEST_DATABASE_URL_WORKER: dev("nivel_worker"),
    };
    const target = {};
    await expect(createWorkerDatabase(1, env, target)).rejects.toThrow(/54329 is the development cluster/);
    expect(target).toEqual({});
  });
});
