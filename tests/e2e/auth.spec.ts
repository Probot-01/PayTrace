import { expect, test } from "./fixtures";

test.describe("signed out", () => {
  test("protected pages redirect to sign in and return afterwards", async ({ page }) => {
    await page.goto("/exceptions?status=OPEN");
    await expect(page).toHaveURL(/\/login\?next=%2Fexceptions/);
    await page.getByLabel("Work email").fill("analyst@demo.paytrace.test");
    await page.getByLabel("Password").fill("PayTrace-Demo-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Exceptions", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/exceptions\?status=OPEN/);
  });

  test("a wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("viewer@demo.paytrace.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
  });

  test("an open redirect in ?next is ignored", async ({ page }) => {
    await page.goto("/login?next=//evil.example/");
    await page.getByLabel("Work email").fill("viewer@demo.paytrace.test");
    await page.getByLabel("Password").fill("PayTrace-Demo-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Reconciliation overview" })).toBeVisible();
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
  });

  test("security headers are set on pages", async ({ page }) => {
    const res = await page.goto("/login");
    const h = res!.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("the session cookie is host-only, secure and httpOnly", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("viewer@demo.paytrace.test");
    await page.getByLabel("Password").fill("PayTrace-Demo-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Reconciliation overview" })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name.includes("paytrace_session"))!;
    expect(cookie.name).toBe("__Host-paytrace_session");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
  });
});
