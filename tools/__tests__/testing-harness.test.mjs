import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_ROLES_WITH_CONNECT, createWorkerDatabase, productionRightsSql } from "../../packages/testing/src/db.ts";
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

describe("the rights of a test database", () => {
  it("repeat those of the production database: PUBLIC nothing, CONNECT for the four roles, no CREATE for anybody", () => {
    expect(productionRightsSql("nivel_s0_w1_test")).toEqual([
      'revoke all on database "nivel_s0_w1_test" from public',
      'grant connect on database "nivel_s0_w1_test" to nivel_web, nivel_admin, nivel_bot, nivel_worker',
    ]);
    expect(productionRightsSql("nivel_s0_w1_test").join(" ")).not.toMatch(/create|temp/i);
    expect(() => productionRightsSql('x"; drop database y; --')).toThrow(/unsafe identifier/);
  });

  it("say what infra/postgres/init/01-roles.sh says for `nivel`: the harness copies the script, a clone does not inherit it", () => {
    const init = readFileSync(new URL("../../infra/postgres/init/01-roles.sh", import.meta.url), "utf8");
    expect(init).toMatch(/REVOKE ALL ON DATABASE nivel FROM PUBLIC;/);
    const granted = /GRANT CONNECT ON DATABASE nivel TO ([^;]+);/.exec(init)?.[1];
    expect(granted?.split(",").map((r) => r.trim())).toEqual([...APP_ROLES_WITH_CONNECT]);
  });
});
