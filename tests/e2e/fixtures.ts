import { test as base, expect, type Page } from "@playwright/test";

export type Role = "admin" | "supervisor" | "analyst" | "viewer";
export const storage = (role: Role) => `tests/e2e/.auth/${role}.json`;

/** Fails the test on any console error or uncaught exception, including CSP violations. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        // Expected 4xx API answers (e.g. a wrong password) are logged by the browser; they are not app errors.
        if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openFirstException(page: Page, query = "") {
  await page.goto(`/exceptions${query}`);
  await page.locator("table.data-table tbody tr a").first().click();
  await page.waitForURL(/\/exceptions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
