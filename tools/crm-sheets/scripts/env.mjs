// A ready environment for tests and the preview: the sources of the project in a vm context with the mock of Apps Script.
import vm from "node:vm";
import { createGas, pinClock } from "./gas-mock.mjs";
import { loadSources } from "./load.mjs";

/** Creates {ctx, env, gas, run, call}. `now` pins the clock of `new Date()` in the scripts. */
export function createProject(opts = {}) {
  const gas = createGas({
    now: opts.now,
    scriptProps: opts.scriptProps,
    userEmail: opts.userEmail,
    scopes: opts.scopes,
    fetchHandler: opts.fetchHandler,
  });
  const ctx = loadSources(gas.globals);
  pinClock(ctx, gas.env);
  const run = (code) => vm.runInContext(code, ctx);
  const call = (fn, ...args) => {
    ctx.__a = args;
    return vm.runInContext(`${fn}(...__a)`, ctx);
  };
  // The result of a call as plain data: Dates survive as {"$d": ms} inside the context and are restored here.
  const callJson = (fn, ...args) => {
    ctx.__a = args;
    const text = vm.runInContext(
      `JSON.stringify(${fn}(...__a), function (k, v) { return this[k] instanceof Date ? { $d: this[k].getTime() } : v; })`,
      ctx,
    );
    return text === undefined
      ? undefined
      : JSON.parse(text, (_k, v) => (v && typeof v === "object" && "$d" in v ? new Date(v.$d) : v));
  };
  /** A Date of the project realm (the sources test dates with instanceof Date). */
  const date = (iso) => run(`new Date(${JSON.stringify(iso)})`);
  return { ctx, env: gas.env, gas, run, call, callJson, date };
}
