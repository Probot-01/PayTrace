import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
const ARGON2_OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// A dummy hash so failed logins for unknown emails take as long as real ones (no user enumeration).
let dummyHash: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hashPassword("paytrace-timing-equaliser");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

const COMMON = new Set([
  "password1234", "123456789012", "qwertyuiop12", "paytrace1234", "letmein12345", "welcome12345",
  "administrator", "password@123", "admin@123456", "india@123456", "changeme1234", "iloveyou1234",
]);

/** NIST SP 800-63B style: length over complexity rules, plus a blocklist of obvious choices. */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((p) => !COMMON.has(p.toLowerCase()), "This password is too common. Choose another.")
  .refine((p) => new Set(p).size >= 5, "Use a less repetitive password.");
