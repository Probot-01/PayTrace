"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/components/client/api";
import { Field, FormError, Select, Textarea } from "@/components/client/form";
import { buttonStyles } from "@/components/ui";
import { RESOLUTION_CODES, RESOLUTION_LABELS, type ExceptionStatus, type UserRole } from "@/domain/types";
import { formatINR } from "@/lib/money";

type Mode = null | "resolve" | "dismiss" | "reject" | "reopen";

export function ExceptionActions({
  exception,
  approvalThresholdPaise,
  user,
  canWork,
  canApprove,
  assignable,
}: {
  exception: { id: string; status: ExceptionStatus; version: number; assigneeId: string | null; proposedBy: string | null; affectedPaise: number };
  approvalThresholdPaise: number;
  user: { id: string; role: UserRole };
  canWork: boolean;
  canApprove: boolean;
  assignable: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const commentRef = useRef<HTMLFormElement>(null);

  if (!canWork) return <p className="text-sm text-ink-3">You have read-only access.</p>;

  const { id, status, version } = exception;
  const open = status === "OPEN" || status === "IN_REVIEW";
  const needsApproval = exception.affectedPaise >= approvalThresholdPaise && !canApprove;

  async function run(path: string, body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api(`/api/v1/exceptions/${id}/${path}`, { json: body });
      setMode(null);
      setNotice(success);
      router.refresh();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors());
      } else setError("Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const transition = (action: string, extra: Record<string, unknown> = {}, success = "Saved.") =>
    run("transition", { action, version, ...extra }, success);

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="sr-only">
        {notice}
      </div>
      {notice ? <p className="rounded-md border border-good/40 bg-good-soft px-3 py-2 text-sm text-good">{notice}</p> : null}
      <FormError message={error} />

      {open || status === "PENDING_APPROVAL" ? (
        <div>
          <label htmlFor="assignee" className="mb-1 block text-xs font-medium text-ink-3">
            Assign to
          </label>
          <div className="flex gap-2">
            <Select
              id="assignee"
              defaultValue={exception.assigneeId ?? ""}
              disabled={busy}
              onChange={(e) => run("assign", { assigneeId: e.target.value || null, version }, "Assignment updated.")}
            >
              <option value="">Unassigned</option>
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === user.id ? " (you)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {status === "OPEN" ? (
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={busy}
              onClick={() => transition("start_review", {}, "Review started.")}
            >
              Start review
            </button>
          ) : null}
          {open ? (
            <>
              <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => setMode("resolve")}>
                Resolve…
              </button>
              <button type="button" className={buttonStyles.ghost} disabled={busy} onClick={() => setMode("dismiss")}>
                Dismiss as not a break…
              </button>
            </>
          ) : null}
          {status === "PENDING_APPROVAL" && canApprove && exception.proposedBy !== user.id ? (
            <>
              <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => transition("approve", {}, "Approved.")}>
                Approve
              </button>
              <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setMode("reject")}>
                Send back…
              </button>
            </>
          ) : null}
          {status === "PENDING_APPROVAL" && (!canApprove || exception.proposedBy === user.id) ? (
            <p className="text-sm text-ink-2">
              Waiting for {canApprove && exception.proposedBy === user.id ? "another" : "a"} supervisor to approve.
            </p>
          ) : null}
          {(status === "RESOLVED" || status === "DISMISSED") && canApprove ? (
            <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setMode("reopen")}>
              Reopen…
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-3 rounded-md border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const note = String(f.get("note") ?? "");
            if (mode === "resolve")
              transition("resolve", { resolutionCode: f.get("resolutionCode"), note }, needsApproval ? "Sent for supervisor approval." : "Resolved.");
            else if (mode === "dismiss") transition("dismiss", { note }, needsApproval ? "Sent for supervisor approval." : "Dismissed.");
            else if (mode === "reject") transition("reject", { note }, "Sent back to the analyst.");
            else transition("reopen", { note }, "Reopened.");
          }}
        >
          <p className="text-sm font-medium">
            {mode === "resolve"
              ? "Resolve exception"
              : mode === "dismiss"
                ? "Dismiss as not a real break"
                : mode === "reject"
                  ? "Send back for more work"
                  : "Reopen exception"}
          </p>
          {(mode === "resolve" || mode === "dismiss") && needsApproval ? (
            <p className="text-xs text-warning">
              This affects {formatINR(exception.affectedPaise)}, at or above the {formatINR(approvalThresholdPaise)} approval threshold. A supervisor
              must approve it.
            </p>
          ) : null}
          {mode === "resolve" ? (
            <Field label="Resolution" error={fieldErrors.resolutionCode?.[0]}>
              {(p) => (
                <Select {...p} name="resolutionCode" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {RESOLUTION_CODES.map((c) => (
                    <option key={c} value={c}>
                      {RESOLUTION_LABELS[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={mode === "reject" ? "What is missing" : "Note"} error={fieldErrors.note?.[0]} hint="Kept in the audit trail.">
            {(p) => <Textarea {...p} name="note" required minLength={5} maxLength={2000} />}
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonStyles.primary} disabled={busy}>
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button type="button" className={buttonStyles.ghost} disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form
        ref={commentRef}
        className="space-y-2 border-t border-line pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = String(new FormData(e.currentTarget).get("body") ?? "");
          if (await run("comment", { body }, "Comment added.")) commentRef.current?.reset();
        }}
      >
        <Field label="Add a comment" error={fieldErrors.body?.[0]}>
          {(p) => <Textarea {...p} name="body" maxLength={2000} className="min-h-16" />}
        </Field>
        <button type="submit" className={buttonStyles.secondary} disabled={busy}>
          Comment
        </button>
      </form>
    </div>
  );
}
