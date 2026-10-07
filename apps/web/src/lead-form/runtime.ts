// The process-wide parts of the request form: one limiter and one gateway for the whole site. The gateway is `unavailableGateway`
// until the services are wired in (the integrator request in the report of WP-16): the form then tells the visitor to write to
// the bot, nothing is lost and nothing breaks.
import { consentFromDatabase } from "./consent-source.ts";
import { createSubmitDeps, type LeadGateway, type SubmitDeps, unavailableGateway } from "./submit.ts";

const shared = globalThis as { __nivelLeadDeps?: SubmitDeps };

/** Replaces the gateway (the composition root of the site, and tests). The limiter is kept by the new dependencies. */
export function configureLeadGateway(gateway: LeadGateway): SubmitDeps {
  shared.__nivelLeadDeps = createSubmitDeps({ gateway, consentFor: consentFromDatabase });
  return shared.__nivelLeadDeps;
}

export function leadDeps(): SubmitDeps {
  shared.__nivelLeadDeps ??= createSubmitDeps({ gateway: unavailableGateway, consentFor: consentFromDatabase });
  return shared.__nivelLeadDeps;
}
