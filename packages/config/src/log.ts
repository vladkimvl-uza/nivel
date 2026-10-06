// Personal data never reaches logs (ARCHITECTURE 10.3): pino `redact` paths shared by all apps.
const PII_KEYS = ["phone", "name", "address", "passport", "initData", "authorization", "cookie"] as const;

/**
 * Top-level `name` is pino's own logger name, so it is not redacted at the top level; a person's name is
 * redacted one level down (`customer.name`, `from.name`) and in request headers.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  ...PII_KEYS.filter((k) => k !== "name"),
  ...PII_KEYS.map((k) => `*.${k}`),
  "req.headers.authorization",
  "req.headers.cookie",
];
