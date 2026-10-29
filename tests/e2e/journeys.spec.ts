import { expect, openFirstException, storage, test } from "./fixtures";

test.describe("maker-checker on a high-value exception", () => {
  test("an analyst proposes, a different supervisor approves", async ({ browser }) => {
    // Highest amount first, open items only, so it is above the ₹50,000 approval threshold.
    const analyst = await browser.newContext({ storageState: storage("analyst") });
    const page = await analyst.newPage();
    await openFirstException(page, "?sort=amount&status=OPEN");
    const url = page.url();

    await page.getByRole("button", { name: "Resolve…" }).click();
    await expect(page.getByText(/approval threshold/)).toBeVisible();
    await page.getByLabel("Resolution").selectOption("MANUAL_REVERSAL_ISSUED");
    await page.getByLabel("Note").fill("Reversal confirmed with the issuing bank, ref E2E-1");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Sent for supervisor approval.").first()).toBeVisible();
    await expect(page.getByText(/Waiting for a supervisor/)).toBeVisible();
    await analyst.close();

    const supervisor = await browser.newContext({ storageState: storage("supervisor") });
    const sp = await supervisor.newPage();
    await sp.goto(url);
    await sp.getByRole("button", { name: "Approve" }).click();
    await expect(sp.getByText("Approved.").first()).toBeVisible();
    await expect(sp.getByText("Resolved", { exact: true }).first()).toBeVisible();
    await expect(sp.getByText(/Reversal confirmed with the issuing bank/).first()).toBeVisible();
    await supervisor.close();
  });
});

test.describe("viewer", () => {
  test.use({ storageState: storage("viewer") });

  test("sees exceptions read-only and no admin navigation", async ({ page }) => {
    await openFirstException(page);
    await expect(page.getByText("You have read-only access.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resolve…" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Users" })).toHaveCount(0);
  });

  test("is refused on admin pages", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
  });
});

test.describe("analyst data journeys", () => {
  test.use({ storageState: storage("analyst") });

  test("uploads a participant file, and a broken file is rejected with row errors", async ({ page }) => {
    await page.goto("/files");
    const header =
      "txn_ref,parent_ref,record_type,payment_method,amount,currency,status,customer_id,merchant_id,issuing_bank,acquiring_bank,event_at";
    const good = `${header}\nE2E000000001,,PAYMENT,UPI,150.00,INR,SUCCESS,CUSTE2E,MERE2E,HDFC,ICIC,2026-10-27T10:00:00+05:30\nE2E000000002,,PAYMENT,NEFT,90000.00,INR,FAILED,CUSTE2E,MERE2E,SBIN,UTIB,2026-10-27T11:00:00+05:30\n`;
    const form = page.locator("form", { has: page.getByRole("button", { name: "Upload" }) });
    await form.getByLabel("Participant").selectOption("ISSUER");
    await form.getByLabel("Business date").fill("2026-10-27");
    await form.getByLabel("CSV file").setInputFiles({ name: "issuer-e2e.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Imported 2 records.")).toBeVisible();

    const bad = `${header}\nE2E000000003,,PAYMENT,UPI,abc,INR,SUCCESS,4111111111111111,MERE2E,HDFC,ICIC,2026-10-27T10:00:00+05:30\n`;
    // A successful upload resets the form.
    await form.getByLabel("Participant").selectOption("ISSUER");
    await form.getByLabel("CSV file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText(/problem\(s\) found/).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "amount", exact: true })).toBeVisible();
  });

  test("generates a simulated day, reconciles it and sees detection accuracy", async ({ page }) => {
    await page.goto("/simulator");
    await page.getByLabel("Scenario").selectOption({ index: 1 });
    await page.getByLabel("Name").fill("E2E outage day");
    await page.getByLabel("Payment intents").fill("400");
    await page.getByRole("button", { name: "Generate business day" }).click();
    await expect(page).toHaveURL(/\/simulator\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Reconcile this day" }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/);
    await expect(page.getByText(/^Recall /).first()).toBeVisible({ timeout: 30_000 });
  });

  test("traces a transaction across participants", async ({ page }) => {
    await page.goto("/exceptions");
    const ref = (await page.locator("table.data-table tbody tr a").first().textContent())!.trim();
    await page.goto("/transactions");
    await page.locator("input[name=trace]").fill(ref);
    await page.getByRole("button", { name: "Trace" }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${ref}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ref);
  });

  test("filters exceptions and exports CSV", async ({ page }) => {
    await page.goto("/exceptions");
    await page.getByLabel("Category").selectOption("FAILED_BUT_DEBITED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/category=FAILED_BUT_DEBITED/);
    const rows = page.locator("table.data-table tbody tr");
    await expect(rows.first()).toContainText("Failed but amount debited");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
  });
});

test.describe("admin", () => {
  test.use({ storageState: storage("admin") });

  test("invites a user and gets a one-time link", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByLabel("Name").fill("Esha E2E");
    await page.getByLabel("Work email").fill(`esha.${Date.now()}@example.test`);
    await page.getByLabel("Role", { exact: true }).selectOption("analyst");
    await page.getByRole("button", { name: /invite|create/i }).click();
    await expect(page.getByLabel("One-time link")).toHaveValue(/reset-password\?token=/);
  });
});
