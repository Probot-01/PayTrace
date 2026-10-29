import { test as base, expect, type Page } from "@playwright/test";

export type Role = "admin" | "supervisor" | "analyst" | "viewer";
export const storage = (role: Role) => `tests/e2e/.auth/${role}.json`;

/** Fails the test on any console error or uncaught exception, including CSP violations. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
