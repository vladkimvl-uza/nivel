// Runs an app command with the root .env.local loaded and PORT set from NIVEL_SLOT.
// Usage (from an app folder): node ../../tools/dev-run.mjs <web|admin|worker|bot> -- <command> [args]
import { spawn } from "node:child_process";
import { APP_PORT_OFFSETS, appPort, loadRootEnv, slotFromEnv } from "./lib/env.mjs";

const [app, sep, ...command] = process.argv.slice(2);
if (!app || sep !== "--" || command.length === 0) {
  console.error("usage: dev-run.mjs <app> -- <command> [args]");
  process.exit(2);
}

loadRootEnv();
const slot = slotFromEnv();
// Long-running apps get PORT_BASE + offset; one-off processes (migrator) get no port.
if (app in APP_PORT_OFFSETS) process.env.PORT = String(appPort(app, slot));
process.env.NIVEL_APP = app;

// Run "node" with the same Node binary (24.x from devEngines), other commands through the shell (.cmd shims on Windows).
const [bin, ...args] = command;
const child =
  bin === "node"
    ? spawn(process.execPath, args, { stdio: "inherit", env: process.env })
    : spawn(command.join(" "), { stdio: "inherit", env: process.env, shell: true });

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
