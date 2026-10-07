import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUE_INSTALLED_SQL } from "../health.ts";
import { APP_ROLES } from "../index.ts";
import { connectAs, one, pgError, type Role, uniq } from "./testkit.ts";

// The final review of WP-00, third item: the worker held CREATE on the database (pg-boss creates its schema), so a holder of
// its password could make a schema of its own, even one named like another role: "$user" is the first schema of every
// search_path, and what the schema holds (a table, an operator, a function) stands in for the real one. Now the schema of
// the queue is made by the migration, nobody but the owner creates a schema, and the test databases carry the rights of
// the production database (a clone of the template keeps none of them: its rights are those of a plain CREATE DATABASE).
const DENIED = "42501";
const APP = ["WEB", "ADMIN", "BOT", "WORKER"] as const;
const roleName = (r: Role) => `nivel_${r.toLowerCase()}`;

const clients = {} as Record<Role, pg.Client>;
beforeAll(async () => {
  for (const role of ["MIGRATOR", ...APP] as const) clients[role] = await connectAs(role);
});
afterAll(async () => {
  for (const c of Object.values(clients)) await c.end();
});

describe("the rights on the database itself repeat those of `nivel` (infra/postgres/init/01-roles.sh)", () => {
  it.each(APP)("%s may connect and nothing else: no CREATE, no TEMP", async (role) => {
    const r = await one<{ connect: boolean; create: boolean; temp: boolean }>(
      clients.MIGRATOR,
      `select has_database_privilege($1, current_database(), 'CONNECT') as connect,
              has_database_privilege($1, current_database(), 'CREATE') as create,
              has_database_privilege($1, current_database(), 'TEMP') as temp`,
      [roleName(role)],
    );
    expect(r).toEqual({ connect: true, create: false, temp: false });
  });

  it("gives PUBLIC nothing on the database", async () => {
    const r = await one<{ connect: boolean; create: boolean; temp: boolean }>(
      clients.MIGRATOR,
      `select has_database_privilege('public', current_database(), 'CONNECT') as connect,
              has_database_privilege('public', current_database(), 'CREATE') as create,
              has_database_privilege('public', current_database(), 'TEMP') as temp`,
    );
    expect(r).toEqual({ connect: false, create: false, temp: false });
  });

  it("is owned by the migrator, which holds the whole set", async () => {
    const r = await one<{ owner: string; create: boolean; temp: boolean }>(
      clients.MIGRATOR,
      `select datdba::regrole::text as owner,
              has_database_privilege('nivel_migrator', current_database(), 'CREATE') as create,
              has_database_privilege('nivel_migrator', current_database(), 'TEMP') as temp
         from pg_database where datname = current_database()`,
    );
    expect(r).toEqual({ owner: "nivel_migrator", create: true, temp: true });
  });

  it("leaves CREATE on a schema to the worker in pgboss and to no other application role anywhere", async () => {
    const { rows } = await clients.MIGRATOR.query<{ rolname: string; nspname: string }>(
      `select r.rolname, n.nspname
         from pg_roles r cross join pg_namespace n
        where r.rolname = any($1) and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
          and has_schema_privilege(r.rolname, n.oid, 'CREATE')
        order by 1, 2`,
      [APP.map(roleName)],
    );
    expect(rows).toEqual([{ rolname: "nivel_worker", nspname: "pgboss" }]);
  });

  it("leaves no application role with CREATE on the schema public", async () => {
    for (const role of APP) {
      const r = await one<{ ok: boolean }>(
        clients.MIGRATOR,
        "select has_schema_privilege($1, 'public', 'CREATE') as ok",
        [roleName(role)],
      );
      expect(r.ok, role).toBe(false);
    }
  });
});

describe("pgboss: the schema of the queue is made by the migration", () => {
  it("exists, and the worker holds USAGE and CREATE on it", async () => {
    const r = await one<{ usage: boolean; create: boolean }>(
      clients.MIGRATOR,
      `select has_schema_privilege('nivel_worker', 'pgboss', 'USAGE') as usage,
              has_schema_privilege('nivel_worker', 'pgboss', 'CREATE') as create`,
    );
    expect(r).toEqual({ usage: true, create: true });
  });

  it.each(["WEB", "ADMIN", "BOT"] as const)("gives %s and PUBLIC nothing on it", async (role) => {
    const r = await one<{ usage: boolean; create: boolean; pub_usage: boolean; pub_create: boolean }>(
      clients.MIGRATOR,
      `select has_schema_privilege($1, 'pgboss', 'USAGE') as usage,
              has_schema_privilege($1, 'pgboss', 'CREATE') as create,
              has_schema_privilege('public', 'pgboss', 'USAGE') as pub_usage,
              has_schema_privilege('public', 'pgboss', 'CREATE') as pub_create`,
      [roleName(role)],
    );
    expect(r).toEqual({ usage: false, create: false, pub_usage: false, pub_create: false });
    const e = await pgError(clients[role], `create table pgboss.probe_${uniq()} (id int)`);
    expect(e.code).toBe(DENIED);
  });

  it("lets the worker make, use and drop its own tables there, which is all the queue does", async () => {
    const table = `pgboss.probe_${uniq()}`;
    const w = clients.WORKER;
    await w.query(`create table ${table} (id int primary key, payload jsonb)`);
    try {
      await w.query(`insert into ${table} values (1, '{}')`);
      expect((await w.query(`select * from ${table}`)).rowCount).toBe(1);
      await w.query(`create function ${table}_f() returns int language sql as 'select 1'`);
      await w.query(`drop function ${table}_f()`);
    } finally {
      await w.query(`drop table ${table}`);
    }
  });

  it("does not let the worker drop or rename the schema, nor give its rights to others", async () => {
    const w = clients.WORKER;
    expect((await pgError(w, "drop schema pgboss")).code).toBe(DENIED);
    expect((await pgError(w, "alter schema pgboss rename to pgboss_old")).code).toBe(DENIED);
    // A GRANT by a role that holds a right without the grant option is a warning that grants nothing, not an error.
    await w.query("grant usage on schema pgboss to nivel_web");
    const r = await one<{ ok: boolean }>(
      clients.MIGRATOR,
      "select has_schema_privilege('nivel_web', 'pgboss', 'USAGE') as ok",
    );
    expect(r.ok).toBe(false);
  });

  it("is told apart from an installed queue: /healthz says `not_installed` until pg-boss made its tables, for every role", async () => {
    // to_regnamespace('pgboss') would say `ok` from the moment of the migration; the tables are what shows the queue.
    for (const role of ["MIGRATOR", ...APP] as const) {
      const r = await one<{ q: boolean }>(clients[role], QUEUE_INSTALLED_SQL);
      expect(r.q, role).toBe(false);
    }
  });
});

describe("no application role can make a schema", () => {
  it.each(APP)("%s: CREATE SCHEMA is refused", async (role) => {
    const e = await pgError(clients[role], `create schema probe_${uniq()}`);
    expect(e.code).toBe(DENIED);
    expect(e.message).toMatch(/permission denied for database/);
  });

  it.each(APP_ROLES.flatMap((target) => APP.map((role) => [role, target] as const)))(
    '%s cannot make a schema named like the role %s (the first stop of a search_path through "$user")',
    async (role, target) => {
      const e = await pgError(clients[role], `create schema ${target}`);
      expect(e.code).toBe(DENIED);
    },
  );

  it("does not even let the worker run the statement pg-boss runs by default: IF NOT EXISTS checks the right first", async () => {
    // PostgreSQL asks for CREATE on the database before it looks whether the schema is there. So the worker starts pg-boss
    // with createSchema: false (apps/worker/src/queue.ts); the schema is made by the migration.
    const e = await pgError(clients.WORKER, "create schema if not exists pgboss");
    expect(e.code).toBe(DENIED);
    expect(e.message).toMatch(/permission denied for database/);
  });

  it("refuses a schema made for another owner as well", async () => {
    for (const role of APP) {
      const e = await pgError(clients[role], `create schema probe_${uniq()} authorization ${roleName(role)}`);
      expect(e.code, role).toBe(DENIED);
    }
  });
});
