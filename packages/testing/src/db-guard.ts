// Guards that keep tests away from the dev cluster and from anything that is not a throwaway database
// (ARCHITECTURE 11.3). Pure functions: covered by tools/__tests__/testing-harness.test.mjs.

export const DEV_PORT = 54329;
export const TEST_PORT = 54339;
export const TEST_HOST = "127.0.0.1";

export class TestDbGuardError extends Error {
  constructor(message: string) {
    super(`Test database guard: ${message}`);
    this.name = "TestDbGuardError";
  }
}

/** Throws unless the URL points to the test cluster: host 127.0.0.1 and never the dev port 54329. */
export function assertTestClusterUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TestDbGuardError("not a valid URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol))
    throw new TestDbGuardError(`protocol ${parsed.protocol} is not postgres`);
  if (parsed.hostname !== TEST_HOST) throw new TestDbGuardError(`host must be ${TEST_HOST}, got ${parsed.hostname}`);
  const port = Number(parsed.port || "5432");
  if (port === DEV_PORT)
    throw new TestDbGuardError(`port ${DEV_PORT} is the development cluster; tests use ${TEST_PORT}`);
  return parsed;
}

/** Throws unless the URL points to the test cluster and a database whose name ends with "_test". */
export function assertTestDatabaseUrl(url: string): URL {
  const parsed = assertTestClusterUrl(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) throw new TestDbGuardError(`database name "${name}" must end with "_test"`);
  return parsed;
}

/** Same URL with another database name; the result is guarded too. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  const next = parsed.toString();
  assertTestDatabaseUrl(next);
  return next;
}

/** nivel_s<slot>_template_test and nivel_s<slot>_w<worker>_test (ARCHITECTURE 11.3). */
export function testDatabaseNames(slot: number, worker: number | string): { template: string; worker: string } {
  return { template: `nivel_s${slot}_template_test`, worker: `nivel_s${slot}_w${worker}_test` };
}
