// Playwright fixtures of the admin tests: one harness per worker (a database, a server, a stand-in for the site) and
// the helpers every spec uses. Imported by e2e/admin-*.spec.ts; the network guard of e2e/fixtures.ts stays in force.
import { expect, type Page } from "@playwright/test";
import { test as guarded } from "../../../../../e2e/fixtures.ts";
import { type AdminHarness, startAdminHarness, type TestUser } from "./harness.ts";

export const test = guarded.extend<object, { admin: AdminHarness }>({
  admin: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies of a fixture from its first argument
    async ({}, use, workerInfo) => {
      const harness = await startAdminHarness(workerInfo.parallelIndex);
      try {
        await use(harness);
      } finally {
        await harness.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});
export { expect };

/** The admin is tested in the desktop profile; the specs that need a phone say so and run in the other one. */
export function onlyDesktop(): void {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies of a hook from its first argument
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "проверяется в профиле desktop");
  });
}

export function onlyPhone(): void {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies of a hook from its first argument
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "pixel7", "проверяется в профиле pixel7");
  });
}

export async function fillSignIn(page: Page, admin: AdminHarness, email: string, password: string, code: string) {
  await page.goto(`${admin.baseURL}/sign-in`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByLabel("Код из приложения").fill(code);
  await page.getByRole("button", { name: "Войти" }).click();
}

/** Signs a user in and waits for the first screen of the role. */
export async function signIn(page: Page, admin: AdminHarness, user: TestUser) {
  await fillSignIn(page, admin, user.email, user.password, user.code());
  await expect(page.getByTestId("who")).toContainText(user.email);
}

/** The date of today in Tashkent (UTC+5), as the admin counts it. */
export function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
}
