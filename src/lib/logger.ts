import pino from "pino";

/**
 * Structured JSON logger. Secrets and personal data are redacted by path so that accidental
 * logging of a request body or header never leaks credentials.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "paytrace" },
  redact: {
    paths: [
      "password",
      "*.password",
      "newPassword",
      "*.newPassword",
      "currentPassword",
      "*.currentPassword",
      "token",
      "*.token",
      "req.headers.cookie",
      "req.headers.authorization",
      "headers.cookie",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
