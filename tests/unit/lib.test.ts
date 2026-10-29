import { describe, expect, it } from "vitest";
import { formatINR, formatINRCompact, formatPercent, paiseToPlain, parseRupeesToPaise } from "@/lib/money";
import { safeNextPath } from "@/lib/safe-redirect";
import { can, PERMISSIONS } from "@/server/auth/permissions";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";
import { generateToken, hashToken, safeEqual } from "@/server/auth/tokens";
import { USER_ROLES } from "@/domain/types";

describe("money", () => {
  it("parses rupee strings into integer paise", () => {
    expect(parseRupeesToPaise("1234.5")).toBe(123_450);
    expect(parseRupeesToPaise("1,23,456.78")).toBe(12_345_678);
    expect(parseRupeesToPaise("0.1")).toBe(10);
    expect(parseRupeesToPaise("1.234")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("1e5")).toBeNull();
  });
  it("avoids floating-point drift", () => {
    expect(parseRupeesToPaise("0.29")).toBe(29); // 0.29 * 100 = 28.999… in floating point
  });
  it("formats in Indian grouping", () => {
    expect(formatINR(12_345_678)).toBe("₹1,23,456.78");
    expect(paiseToPlain(-5)).toBe("-0.05");
    expect(formatINRCompact(4_900_000_000)).toBe("₹4.9 Cr");
    expect(formatINRCompact(190_900_000)).toBe("₹19.09 L");
    expect(formatPercent(0.9781)).toBe("97.8%");
    expect(formatPercent(NaN)).toBe("—");
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/exceptions?status=OPEN", "/exceptions?status=OPEN"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/login", "/"],
    ["/api/v1/runs", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("permissions", () => {
  it("is monotonic: a higher role can do everything a lower role can", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      let allowedBefore = false;
      for (const role of ["viewer", "analyst", "supervisor", "admin"] as const) {
        const allowed = can(role, p);
        if (allowedBefore) expect(allowed).toBe(true);
        allowedBefore ||= allowed;
      }
    }
    expect(USER_ROLES).toHaveLength(4);
  });
  it("keeps approval and administration away from analysts", () => {
    expect(can("analyst", "exceptions:work")).toBe(true);
    expect(can("analyst", "exceptions:approve")).toBe(false);
    expect(can("supervisor", "users:manage")).toBe(false);
    expect(can("viewer", "files:upload")).toBe(false);
  });
});

describe("passwords and tokens", () => {
  it("hashes with Argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong horse battery")).toBe(false);
    expect(await verifyPassword(null, "anything at all")).toBe(false);
  });
  it("enforces length and blocks common choices", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("Password1234").success).toBe(false);
    expect(passwordSchema.safeParse("aaaaaaaaaaaaaa").success).toBe(false);
    expect(passwordSchema.safeParse("ledger-tram-87-violet").success).toBe(true);
  });
  it("generates unguessable tokens and stores only their hash", () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(hashToken(a), hashToken(a))).toBe(true);
    expect(safeEqual(hashToken(a), hashToken(generateToken()))).toBe(false);
  });
});
