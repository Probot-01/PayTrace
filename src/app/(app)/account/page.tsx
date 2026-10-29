import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/domain/types";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth/current";
import { listSessionsForUser } from "@/server/services/users";
import { ChangePassword, RevokeSession } from "./account-forms";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const session = await requireSession();
  const sessions = await listSessionsForUser(session.user.id);
  return (
    <>
      <PageHeader title="Your account" description={`${session.user.name} · ${session.user.email} · ${ROLE_LABELS[session.user.role]}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Change password" id="password">
          <ChangePassword />
        </Card>
        <Card title="Where you're signed in" description="Sign out of sessions you don't recognise." id="sessions">
          <ul className="divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{s.userAgent ?? "Unknown device"}</p>
                  <p className="text-xs text-ink-3">
                    Signed in {formatDateTime(s.createdAt)}
                    {s.ip ? ` · ${s.ip}` : ""} · expires {formatDateTime(s.expiresAt)}
                  </p>
                </div>
                {s.id === session.sessionId ? (
                  <span className="shrink-0 text-xs font-medium text-good">This device</span>
                ) : (
                  <RevokeSession sessionId={s.id} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
