// Command line of the admin: the first owner has to come from somewhere (there is no public sign-up). Run on the
// server or on the developer machine, through the same connection settings as the app:
//
//   node ../../tools/dev-run.mjs admin -- node src/auth/cli.ts create-user --email owner@nivel.uz --role owner
//
// The way in (password, key for the authenticator app, recovery codes) is printed once and stored nowhere in the clear.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createNodeArgon2Hasher } from "./password.ts";
import { isRole, ROLES } from "./roles.ts";
import { parseDataKey } from "./secrets.ts";
import { type AuthService, createAuthService } from "./service.ts";

const USAGE = `Использование:
  create-user --email <e-mail> --role <${ROLES.join("|")}> [--password <пароль от 14 знаков>] [--telegram <id>]`;

export async function runCli(
  argv: readonly string[],
  deps: { service: AuthService; print: (line: string) => void },
): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "create-user") {
    deps.print(USAGE);
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: "string" },
      role: { type: "string" },
      password: { type: "string" },
      telegram: { type: "string" },
    },
    strict: false,
  });
  const email = typeof values.email === "string" ? values.email : "";
  const role = values.role;
  if (email === "" || !isRole(role)) {
    deps.print(USAGE);
    return 2;
  }
  let telegramUserId: number | null = null;
  if (typeof values.telegram === "string") {
    if (!/^[1-9]\d{0,15}$/.test(values.telegram)) {
      deps.print("Telegram id — число без знаков и пробелов.");
      return 2;
    }
    telegramUserId = Number(values.telegram);
  }
  const result = await deps.service.provisionUser({
    email,
    role,
    ...(typeof values.password === "string" ? { password: values.password } : {}),
    telegramUserId,
    actor: "cli",
  });
  if (!result.ok) {
    for (const problem of result.problems) deps.print(problem);
    return 1;
  }
  deps.print(`Создана учётная запись ${result.email} (${role}).`);
  if (typeof values.password !== "string") deps.print(`Пароль: ${result.password}`);
  deps.print(`Ключ для приложения: ${result.totpSecret}`);
  deps.print(`Ссылка для приложения: ${result.totpUri}`);
  deps.print("Коды восстановления (каждый работает один раз):");
  for (const code of result.recoveryCodes) deps.print(`  ${code}`);
  deps.print("Это показано один раз: сохраните в менеджере паролей.");
  return 0;
}

// Started as a script: connect with the role of the admin and run. The database parts are loaded only here, so that
// the tests of `runCli` do not pay for them.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const url = process.env.DATABASE_URL_ADMIN;
    const key = process.env.DATA_ENC_KEY;
    if (!url || !key) {
      console.error("Нужны DATABASE_URL_ADMIN и DATA_ENC_KEY (запускайте через tools/dev-run.mjs).");
      return 2;
    }
    const { createDb } = await import("@nivel/db");
    const { createPgAuthStore } = await import("./store.pg.ts");
    const db = createDb(url, { max: 1, applicationName: "nivel-admin-cli" });
    try {
      const service = createAuthService({
        store: createPgAuthStore(db),
        hasher: createNodeArgon2Hasher(),
        dataKey: parseDataKey(key),
        issuer: "Nivel admin",
      });
      return await runCli(process.argv.slice(2), { service, print: (line) => console.info(line) });
    } finally {
      await db.$client.end();
    }
  })()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
