// The process-wide parts of the request form: one limiter and one gateway for the whole site. The gateway is the one of the
// services when the database of the role `web` and the key of the consent hash are configured; otherwise it is
// `unavailableGateway`: the form then tells the visitor to write to the bot, nothing is lost and nothing breaks.
import { createDb, type Db } from "@nivel/db";
import { consentFromDatabase } from "./consent-source.ts";
import { createServicesGateway } from "./gateway.ts";
import { createSubmitDeps, type LeadGateway, type SubmitDeps, unavailableGateway } from "./submit.ts";

const shared = globalThis as { __nivelLeadDeps?: SubmitDeps; __nivelWebDb?: Db };

/** Replaces the gateway (the composition root of the site, and tests). The limiter is kept by the new dependencies. */
export function configureLeadGateway(gateway: LeadGateway): SubmitDeps {
  shared.__nivelLeadDeps = createSubmitDeps({ gateway, consentFor: consentFromDatabase });
  return shared.__nivelLeadDeps;
}

/** The gateway of the environment: the services when `DATABASE_URL_WEB` and `DATA_ENC_KEY` are set. */
export function gatewayFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): LeadGateway {
  const url = env.DATABASE_URL_WEB;
  const key = env.DATA_ENC_KEY;
  if (!url || !key) return unavailableGateway;
  // the same pool as the pages of the site read with (app/[locale]/(marketing)/_data/server.ts)
  shared.__nivelWebDb ??= createDb(url, { max: 3, applicationName: "nivel-web" });
  return createServicesGateway({ db: shared.__nivelWebDb, subjectKey: key });
}

export function leadDeps(): SubmitDeps {
  shared.__nivelLeadDeps ??= createSubmitDeps({ gateway: gatewayFromEnv(), consentFor: consentFromDatabase });
  return shared.__nivelLeadDeps;
}
