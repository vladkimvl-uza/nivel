// Frozen list of job domains (WP-00, ARCHITECTURE 9). Each domain registers its queues in jobs/<domain>/register.ts.

import { register as aftercare } from "./aftercare/register.ts";
import { register as ai } from "./ai/register.ts";
import { register as fx } from "./fx/register.ts";
import { register as ideas } from "./ideas/register.ts";
import { register as ops } from "./ops/register.ts";
import { register as orders } from "./orders/register.ts";
import { register as outbox } from "./outbox/register.ts";
import { register as pdf } from "./pdf/register.ts";
import { register as prices } from "./prices/register.ts";
import { register as retention } from "./retention/register.ts";
import { register as threshold } from "./threshold/register.ts";
import type { JobContext } from "./types.ts";
import { register as warranty } from "./warranty/register.ts";

export const JOB_DOMAINS = {
  outbox,
  fx,
  prices,
  orders,
  warranty,
  aftercare,
  threshold,
  pdf,
  ideas,
  retention,
  ops,
  ai,
} as const;
export type JobDomain = keyof typeof JOB_DOMAINS;

export async function registerAll(ctx: JobContext): Promise<JobDomain[]> {
  const done: JobDomain[] = [];
  for (const [name, register] of Object.entries(JOB_DOMAINS) as [JobDomain, (c: JobContext) => Promise<void>][]) {
    await register(ctx);
    done.push(name);
  }
  return done;
}
