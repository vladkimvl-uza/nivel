// The variables of the worker that the schema of @nivel/config does not list yet (packages/config is the integrator's: request in
// the report of WP-14). They are read here in one place and checked as strictly as the schema would: a value that is not
// understood stops the start, it does not turn a check off in silence.
export interface ExtraEnv {
  /** BOT_MODE of the installation; in `webhook` mode ops.selfcheck looks at the last error of the webhook. */
  botMode: "polling" | "webhook";
  /** NIVEL_SHEETS_URL and NIVEL_SHEETS_SECRET: the CRM of the owner in Google Sheets. */
  sheetsUrl: string | undefined;
  sheetsSecret: string | undefined;
  /** BACKUP_MARK_FILE: the file the backup container touches after a good copy (ops.selfcheck). */
  backupMarkFile: string | undefined;
}

const text = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t === undefined || t === "" ? undefined : t;
};

export function readExtraEnv(source: Record<string, string | undefined> = process.env): ExtraEnv {
  const mode = text(source.BOT_MODE) ?? "polling";
  if (mode !== "polling" && mode !== "webhook") {
    throw new Error(
      `Invalid environment for "worker": BOT_MODE must be polling or webhook, got "${mode.slice(0, 20)}"`,
    );
  }
  return {
    botMode: mode,
    sheetsUrl: text(source.NIVEL_SHEETS_URL),
    sheetsSecret: text(source.NIVEL_SHEETS_SECRET),
    backupMarkFile: text(source.BACKUP_MARK_FILE),
  };
}
