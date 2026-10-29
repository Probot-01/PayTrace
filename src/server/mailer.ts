import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let transport: Transporter | null | undefined;

function getTransport() {
  if (transport === undefined) {
    const url = env().SMTP_URL;
    transport = url ? nodemailer.createTransport(url) : null;
  }
  return transport;
}

export function mailConfigured(): boolean {
  return Boolean(env().SMTP_URL);
}

/** Sends a plain-text email. Returns false (without throwing) when SMTP is not configured or fails. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = getTransport();
  if (!t) return false;
  try {
    await t.sendMail({ from: env().MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "email delivery failed");
    return false;
  }
}
