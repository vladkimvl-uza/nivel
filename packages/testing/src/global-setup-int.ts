// vitest globalSetup for the integration project: (re)build the template database once per run.
import { prepareTemplate } from "./db.ts";

export default async function setup(): Promise<void> {
  const { name, rebuilt } = await prepareTemplate();
  process.stdout.write(`[testing] template ${name} ${rebuilt ? "rebuilt" : "up to date"}\n`);
}
