import { z } from "zod";

/** Server configuration, validated once at first use. Never import this from client components. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine((v) => v.startsWith("postgres"), "must be a postgres:// URL"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Public origin of the app, used for CSRF origin checks and links in emails. */
  APP_URL: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** Run the background worker inside the web process (single-container deployments, dev). */
  EMBEDDED_WORKER: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("PayTrace <no-reply@paytrace.local>"),
  /** Number of trusted reverse proxies in front of the app (for client IP extraction). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
