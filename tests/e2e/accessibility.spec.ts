import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, storage, test } from "./fixtures";

const PAGES = [
  "/",
  "/exceptions",
  "/runs",
  "/runs/new",
  "/files",
  "/simulator",
  "/transactions",
  "/insights",
  "/audit",
  "/admin/users",
  "/admin/settings",
  "/account",
];

async function axe(page: Page) {
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
}

test.describe("WCAG 2.2 AA (axe)", () => {
  test.use({ storageState: storage("admin") });

  for (const path of PAGES) {
    test(`light: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test("drill-down pages: exception, run, file, simulation, trace", async ({ page }) => {
    await page.goto("/exceptions");
    await page.locator("table.data-table tbody tr a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.goto("/runs");
    await page.locator("table.data-table tbody tr a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.goto("/files");
    await page.locator("table.data-table tbody tr a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.goto("/simulator");
    await page.locator("table.data-table tbody tr a, ul a[href^='/simulator/']").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.goto("/exceptions");
    const ref = (await page.locator("table.data-table tbody tr a").first().textContent())!.trim();
    await page.goto(`/transactions/${ref}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test.describe("dark mode", () => {
    test.use({ colorScheme: "dark" });
    for (const path of ["/", "/exceptions", "/insights"]) {
      test(`dark: ${path}`, async ({ page }) => {
        await page.goto(path);
        expect(await axe(page)).toEqual([]);
      });
    }
  });

  test("sign-in page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto("/login");
    expect(await axe(page)).toEqual([]);
    await context.close();
  });
});

test.describe("responsive and keyboard", () => {
  test.use({ storageState: storage("analyst"), viewport: { width: 375, height: 800 } });

  for (const path of ["/", "/exceptions", "/runs", "/insights"]) {
    test(`no horizontal page scroll at 375px: ${path}`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("the mobile menu opens, traps nothing and closes with Escape", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /menu/i }).click();
    const nav = page.getByRole("dialog");
    await expect(nav.getByRole("link", { name: "Exceptions" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
  });

  test("a skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/exceptions");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /skip to/i });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });
});
