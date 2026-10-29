"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Input, Select } from "@/components/client/form";
import { Card, buttonStyles } from "@/components/ui";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/domain/types";
import { formatDateTime } from "@/lib/format";

interface Row {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  lockedUntil: string | null;
}

function LinkNotice({ url, emailed, onClose }: { url: string; emailed: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-md border border-good/40 bg-good-soft p-3 text-sm text-good">
      <p className="font-medium">
        {emailed
          ? "Link emailed. You can also share it directly:"
          : "Email is not configured. Share this one-time link with the person through a trusted channel:"}
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="One-time link"
          className="w-full rounded border border-line-strong bg-surface px-2 py-1 font-mono text-xs text-ink"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-ink-2">The link works once and expires (invites: 72 hours, resets: 30 minutes). It is not shown again.</p>
      <button type="button" className="text-xs text-accent underline" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}

export function UsersAdmin({ users, currentUserId, mailConfigured }: { users: Row[]; currentUserId: string; mailConfigured: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-3 xl:col-span-2">
        <FormError message={error} />
        {link ? <LinkNotice {...link} onClose={() => setLink(null)} /> : null}
        <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === currentUserId;
                const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                return (
                  <tr key={u.id}>
                    <td>
                      <p className="font-medium">
                        {u.name}
                        {self ? <span className="ml-1 text-xs text-ink-3">(you)</span> : null}
                      </p>
                      <p className="text-xs text-ink-3">{u.email}</p>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`role-${u.id}`}>
                        Role for {u.name}
                      </label>
                      <Select
                        id={`role-${u.id}`}
                        value={u.role}
                        disabled={self || busy !== null}
                        onChange={(e) => act(`role-${u.id}`, () => api(`/api/v1/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }))}
                        className="w-36"
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="text-sm">
                      {!u.isActive ? (
                        <span className="text-ink-3">Deactivated</span>
                      ) : !u.hasPassword ? (
                        <span className="text-warning">Invited</span>
                      ) : locked ? (
                        <span className="text-critical">Locked</span>
                      ) : (
                        <span className="text-good">Active</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink-2">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {u.isActive ? (
                          <button
                            type="button"
                            className={buttonStyles.ghost}
                            disabled={busy !== null}
                            onClick={() =>
                              act(`link-${u.id}`, async () => {
                                const r = await api<{ url: string; emailed: boolean }>(`/api/v1/users/${u.id}/reset-link`, { method: "POST" });
                                setLink(r);
                              })
                            }
                          >
                            {u.hasPassword ? "Reset link" : "New invite link"}
                          </button>
                        ) : null}
                        {!self ? (
                          <button
                            type="button"
                            className={buttonStyles.ghost}
                            disabled={busy !== null}
                            onClick={() => {
                              if (
                                u.isActive &&
                                !window.confirm(`Deactivate ${u.name}? They will be signed out immediately and cannot sign in until reactivated.`)
                              )
                                return;
                              void act(`active-${u.id}`, () => api(`/api/v1/users/${u.id}`, { method: "PATCH", json: { isActive: !u.isActive } }));
                            }}
                          >
                            {u.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Card
        title="Invite a person"
        id="invite"
        description={
          mailConfigured ? "They receive an email with a link to set their password." : "Email is not configured: you will get a link to share."
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            setFieldErrors({});
            void act("invite", async () => {
              const r = await api<{ inviteUrl: string; emailed: boolean }>("/api/v1/users", {
                json: { name: f.get("name"), email: f.get("email"), role: f.get("role") },
              });
              setLink({ url: r.inviteUrl, emailed: r.emailed });
              form.reset();
            });
          }}
        >
          <Field label="Name" error={fieldErrors.name?.[0]}>
            {(p) => <Input {...p} name="name" required minLength={2} maxLength={100} autoComplete="off" />}
          </Field>
          <Field label="Work email" error={fieldErrors.email?.[0]}>
            {(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}
          </Field>
          <Field label="Role" error={fieldErrors.role?.[0]}>
            {(p) => (
              <Select {...p} name="role" defaultValue="analyst">
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className={buttonStyles.primary} disabled={busy !== null}>
            {busy === "invite" ? "Inviting…" : "Send invite"}
          </button>
        </form>
      </Card>
    </div>
  );
}
