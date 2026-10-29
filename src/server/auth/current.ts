import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE, validateSessionToken, type ValidSession } from "./session";

/** Data Access Layer entry point: the validated session for this request (memoised per render). */
export const getSession = cache(async (): Promise<ValidSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  return validateSessionToken(token);
});

/** Redirects to sign-in when there is no valid session; returns the session otherwise. */
export async function requireSession(): Promise<ValidSession> {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get("x-pathname") ?? "/";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return session;
}

/** For pages: the session plus whether the user may see this page. */
export async function requirePage(permission: Permission) {
  const session = await requireSession();
  return { session, user: session.user, allowed: can(session.user.role, permission) };
}
