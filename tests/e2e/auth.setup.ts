import { expect, test as setup } from "@playwright/test";

// Signs each demo role in once and saves the session, so tests don't hit the login rate limits.
for (const role of ["admin", "supervisor", "analyst", "viewer"] as const) {
  setup(`sign in as ${role}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(`${role}@demo.paytrace.test`);
    await page.getByLabel("Password").fill("PayTrace-Demo-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Reconciliation overview" })).toBeVisible();
    await page.context().storageState({ path: `tests/e2e/.auth/${role}.json` });
  });
}
