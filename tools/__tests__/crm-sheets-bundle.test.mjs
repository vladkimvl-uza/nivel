// The bundle for pasting into the Apps Script editor and the static rules of the sources: one file that equals the
// sources, no modules, no secrets, one place for the network, no emoji, every called function is defined.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildBundle, DIST_DIR, manifestText } from "../crm-sheets/scripts/bundle.mjs";
import { createGas } from "../crm-sheets/scripts/gas-mock.mjs";
import { SRC_DIR, sourceFiles } from "../crm-sheets/scripts/load.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sources = () => sourceFiles().map((f) => [f, readFileSync(join(SRC_DIR, f), "utf8")]);
/** The code without comments and strings (the text of a sidebar form or of a formula is not code of the script). */
const stripped = (text) =>
  text.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_m, str) =>
    str ? '""' : "",
  );

describe("dist/Nivel-CRM.gs", () => {
  it("is the banner and the sources in the order of their prefix, each under its marker", () => {
    const bundle = buildBundle();
    const markers = [...bundle.matchAll(/^\/\/ ===== (\S+) =====$/gm)].map((m) => m[1]);
    expect(markers).toEqual(sourceFiles());
    expect(markers[0]).toBe("00_config.js");
    expect(markers.at(-1)).toBe("90_logo.js");
    for (const [, text] of sources()) expect(bundle).toContain(text.replace(/\r\n/g, "\n").trimEnd());
    expect(bundle.split("\n")[0]).toContain("Apps Script (V8), one file");
  });

  it("the file on disk is up to date (run: node tools/crm-sheets/scripts/bundle.mjs)", () => {
    expect(readFileSync(join(DIST_DIR, "Nivel-CRM.gs"), "utf8")).toBe(buildBundle());
    expect(readFileSync(join(DIST_DIR, "appsscript.json"), "utf8")).toBe(manifestText());
  });

  it("runs as one script and defines the same functions as the separate files", () => {
    const run = (code) => {
      const gas = createGas();
      const ctx = vm.createContext({ console, ...gas.globals });
      vm.runInContext(code, ctx);
      return vm.runInContext(
        "JSON.stringify(Object.getOwnPropertyNames(globalThis).filter((k) => typeof globalThis[k] === 'function' && /^(nv|NIVEL|do|on)/.test(k)).sort())",
        ctx,
      );
    };
    const one = run(buildBundle());
    const many = (() => {
      const gas = createGas();
      const ctx = vm.createContext({ console, ...gas.globals });
      for (const [f, text] of sources()) vm.runInContext(text, ctx, { filename: f });
      return vm.runInContext(
        "JSON.stringify(Object.getOwnPropertyNames(globalThis).filter((k) => typeof globalThis[k] === 'function' && /^(nv|NIVEL|do|on)/.test(k)).sort())",
        ctx,
      );
    })();
    expect(one).toBe(many);
    expect(JSON.parse(one).length).toBeGreaterThan(300);
    for (const entry of [
      "doPost",
      "onOpen",
      "nvOnEdit",
      "nvHourlyJob",
      "nvDailyDigest",
      "nvWeeklyBackup",
      "nvMonthlyJob",
      "nvSetup",
      "nvSetupContinue",
      "NIVEL_PARTS_FROM_BUDGET",
    ]) {
      expect(JSON.parse(one)).toContain(entry);
    }
  });

  it("has no duplicate top-level names (a second declaration would stop the script in the editor)", () => {
    const seen = new Map();
    for (const [f, text] of sources()) {
      for (const m of text.matchAll(
        /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm,
      )) {
        const name = m[1] || m[2];
        expect(seen.has(name), `${name} in ${f} and ${seen.get(name)}`).toBe(false);
        seen.set(name, f);
      }
    }
    expect(seen.size).toBeGreaterThan(400);
  });

  it("every nv function that is called is defined", () => {
    const declared = new Set();
    const text = sources()
      .map(([, t]) => t)
      .join("\n");
    for (const m of text.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm))
      declared.add(m[1] || m[2]);
    const code = stripped(text);
    const missing = new Set();
    for (const m of code.matchAll(/(?<![.\w$])(nv[A-Z]\w*|NV_[A-Z0-9_]+)\b/g))
      if (!declared.has(m[1])) missing.add(m[1]);
    expect([...missing]).toEqual([]);
  });
});

describe("appsscript.json", () => {
  const manifest = JSON.parse(manifestText());
  it("time zone Asia/Tashkent, V8, the web app runs as the owner and takes any caller (the signature is the protection)", () => {
    expect(manifest.timeZone).toBe("Asia/Tashkent");
    expect(manifest.runtimeVersion).toBe("V8");
    expect(manifest.webapp).toEqual({ executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" });
  });

  it("asks for the few scopes the script uses and no broader ones", () => {
    expect(manifest.oauthScopes.sort()).toEqual(
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/script.container.ui",
        "https://www.googleapis.com/auth/script.external_request",
        "https://www.googleapis.com/auth/script.scriptapp",
        "https://www.googleapis.com/auth/script.send_mail",
        "https://www.googleapis.com/auth/spreadsheets",
      ].sort(),
    );
    const all = sources()
      .map(([, t]) => t)
      .join("\n");
    // every service named in the sources has its scope
    expect(all).toContain("UrlFetchApp.fetch");
    expect(all).toContain("MailApp.sendEmail");
    expect(all).toContain("DriveApp.");
    expect(all).not.toMatch(/GmailApp|CalendarApp|DocumentApp|SlidesApp|ContactsApp/);
  });
});

describe("the rules of the sources", () => {
  const all = sources();
  it("no modules, no Node or browser objects: only what Apps Script has", () => {
    for (const [f, text] of all) {
      expect(text, f).not.toMatch(/^\s*(import|export)\s/m);
      expect(stripped(text), f).not.toMatch(
        /\brequire\(|module\.exports|process\.|Buffer\.|window\.|document\.|setTimeout|structuredClone|(?<![.\w])fetch\(|import\(/,
      );
    }
  });

  it("the only address in the sources is the Telegram Bot API (and the examples of the platform fields)", () => {
    for (const [f, text] of all) {
      const urls = [...text.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
      for (const u of urls) {
        const ok = u.startsWith("https://api.telegram.org/bot") || u.startsWith("https://t.me/");
        expect(ok, `${f}: ${u}`).toBe(true);
      }
    }
  });

  it("no secret is stored in the sources: no token, no key, no card number", () => {
    for (const [f, text] of all) {
      expect(text, f).not.toMatch(/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/);
      expect(text, f).not.toMatch(/-----BEGIN|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/);
      expect(text, f).not.toMatch(/\b(?:\d{4}[ -]?){3}\d{4}\b/);
      // the logo file holds base64 images and nothing else that looks like a key
      if (f !== "90_logo.js") expect(text, f).not.toMatch(/[A-Za-z0-9+/]{60,}={0,2}/);
    }
  });

  it("no emoji and no decorative symbols: the look is typography (only the mark ▼ of the title)", () => {
    for (const [f, text] of all) {
      const found = [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
      expect(found, f).toEqual([]);
    }
  });

  it("the money is integers: no toFixed or float arithmetic on sums in the money module", () => {
    const money = readFileSync(join(SRC_DIR, "01_money.js"), "utf8");
    expect(money).not.toMatch(/toFixed|parseFloat|Math\.round|Math\.floor\([^)]*\*/);
  });

  it("the permanent facts of the project are in one place: the brand colours and the fonts", () => {
    const config = readFileSync(join(SRC_DIR, "00_config.js"), "utf8");
    for (const c of ["#1D1D1B", "#D9501A", "#F06A30", "#F1EFEA"]) expect(config).toContain(c);
    expect(config).toContain('"Fira Sans"');
    expect(config).toContain('"IBM Plex Mono"');
  });

  it("the directory holds the sources, the scripts, the preview and the bundle; nothing else", () => {
    const top = readdirSync(join(here, "..", "crm-sheets")).sort();
    expect(top).toEqual(["README.md", "dist", "preview", "scripts", "src"].sort());
  });
});
