// WP-06: APP_MODE as the seed reads it. The same three values as packages/config (development | staging |
// production), unset or empty is development; every other spelling is refused, because "Production" or "prod" must
// never be taken for a harmless mode.
export type AppMode = "development" | "staging" | "production";

export class UnknownAppMode extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`unknown APP_MODE "${value}": expected development, staging or production`);
    this.name = "UnknownAppMode";
    this.value = value;
  }
}

export function readAppMode(env: Record<string, string | undefined> = process.env): AppMode {
  const raw = env.APP_MODE;
  if (raw === undefined || raw === "") return "development";
  if (raw === "development" || raw === "staging" || raw === "production") return raw;
  throw new UnknownAppMode(raw);
}
