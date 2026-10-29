import type { Metadata } from "next";
import { AccessDenied, Card, PageHeader } from "@/components/ui";
import { requirePage } from "@/server/auth/current";
import { mailConfigured } from "@/server/mailer";
import { listUsers } from "@/server/services/users";
import { UsersAdmin } from "./users-admin";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { user, allowed } = await requirePage("users:manage");
  if (!allowed) return <AccessDenied what="user management" />;
  const users = await listUsers();
  return (
    <>
      <PageHeader title="Users" description="Invite people and set what they can do. Changing someone's role or deactivating them signs them out everywhere immediately." />
      <Card id="roles" className="mb-4" title="Roles">
        <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <li><strong>Viewer</strong>: read dashboards, exceptions and files; export.</li>
          <li><strong>Analyst</strong>: upload files, simulate, run reconciliations, work and resolve exceptions (large ones need approval).</li>
          <li><strong>Supervisor</strong>: everything an analyst can do, plus approve, send back and reopen; view the audit log.</li>
          <li><strong>Administrator</strong>: everything, plus users, settings and deletions.</li>
        </ul>
      </Card>
      <UsersAdmin
        currentUserId={user.id}
        mailConfigured={mailConfigured()}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(), lockedUntil: u.lockedUntil?.toISOString() ?? null }))}
      />
    </>
  );
}
