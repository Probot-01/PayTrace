import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  CATEGORY_LABELS,
  EXCEPTION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SOURCE_SHORT_LABELS,
  type ExceptionCategory,
  type ExceptionStatus,
  type PaymentMethod,
  type Severity,
  type SourceSystem,
} from "@/domain/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: string; description?: ReactNode; actions?: ReactNode; breadcrumb?: { href: string; label: string }[] }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1 text-sm text-ink-3">
            <ol className="flex flex-wrap items-center gap-1">
              {breadcrumb.map((b, i) => (
                <li key={b.href} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>/</span>}
                  <Link href={b.href} className="hover:text-ink hover:underline">
                    {b.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, description, actions, children, className, id }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface", className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title ? (
              <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-ink">
                {title}
              </h2>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 min-h-9";
export const buttonStyles = {
  primary: `${buttonBase} bg-accent text-accent-ink hover:bg-accent-hover`,
  secondary: `${buttonBase} border border-line-strong bg-surface text-ink hover:bg-surface-2`,
  ghost: `${buttonBase} text-ink-2 hover:bg-surface-2 hover:text-ink`,
  danger: `${buttonBase} bg-critical text-white hover:opacity-90`,
};

export function ButtonLink({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link {...props} className={cx(buttonStyles[variant], className)} />;
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "critical" | "good" | "warning" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className={cx("mt-1 text-2xl font-semibold tracking-tight", tone === "critical" ? "text-critical" : tone === "good" ? "text-good" : tone === "warning" ? "text-warning" : "text-ink")}>{value}</dd>
      {sub ? <dd className="mt-0.5 text-xs text-ink-3">{sub}</dd> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "critical" | "good" | "warning"; title?: string; children: ReactNode }) {
  const styles = {
    info: "border-line-strong bg-surface-2 text-ink",
    critical: "border-critical/40 bg-critical-soft text-critical",
    good: "border-good/40 bg-good-soft text-good",
    warning: "border-warning/40 bg-warning-soft text-warning",
  }[tone];
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", styles)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

const SEVERITY_STYLE: Record<Severity, { cls: string; icon: string }> = {
  CRITICAL: { cls: "bg-critical-soft text-critical", icon: "▲" },
  HIGH: { cls: "bg-serious-soft text-serious", icon: "◆" },
  MEDIUM: { cls: "bg-warning-soft text-warning", icon: "●" },
  LOW: { cls: "bg-neutral-soft text-ink-2", icon: "○" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold", s.cls)}>
      <span aria-hidden>{s.icon}</span>
      {severity.charAt(0) + severity.slice(1).toLowerCase()}
    </span>
  );
}

const STATUS_STYLE: Record<ExceptionStatus, string> = {
  OPEN: "border-line-strong text-ink",
  IN_REVIEW: "border-accent/50 text-accent",
  PENDING_APPROVAL: "border-warning/60 text-warning",
  RESOLVED: "border-good/50 text-good",
  DISMISSED: "border-line text-ink-3",
};

export function StatusBadge({ status }: { status: ExceptionStatus }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{EXCEPTION_STATUS_LABELS[status]}</span>;
}

export function JobStatusBadge({ status }: { status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" }) {
  const style = {
    QUEUED: "border-line-strong text-ink-2",
    RUNNING: "border-accent/50 text-accent",
    COMPLETED: "border-good/50 text-good",
    FAILED: "border-critical/50 text-critical",
  }[status];
  const label = { QUEUED: "Queued", RUNNING: "Running", COMPLETED: "Completed", FAILED: "Failed" }[status];
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", style)}>{label}</span>;
}

export function MethodTag({ method }: { method: PaymentMethod }) {
  return <span className="inline-flex rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">{PAYMENT_METHOD_LABELS[method]}</span>;
}

export function CategoryName({ category }: { category: ExceptionCategory }) {
  return <span>{CATEGORY_LABELS[category]}</span>;
}

export function SourceName({ source }: { source: SourceSystem | null }) {
  return <span>{source ? SOURCE_SHORT_LABELS[source] : "—"}</span>;
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm text-ink-2">
      <p className="tabular">
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link className={buttonStyles.secondary} href={hrefFor(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cx(buttonStyles.secondary, "pointer-events-none opacity-50")} aria-disabled="true">
            Previous
          </span>
        )}
        <span className="px-2 tabular">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className={buttonStyles.secondary} href={hrefFor(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className={cx(buttonStyles.secondary, "pointer-events-none opacity-50")} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

export function AccessDenied({ what = "this page" }: { what?: string }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <EmptyState title="You don't have access">
        Your role does not allow you to view {what}. Ask an administrator if you need it for your work.
        <div className="mt-4">
          <ButtonLink href="/" variant="secondary">
            Back to dashboard
          </ButtonLink>
        </div>
      </EmptyState>
    </div>
  );
}

/** Horizontal bar list: one series, magnitude only, labelled directly so colour never carries meaning. */
export function BarList({ items, formatValue, ariaLabel }: { items: { key: string; label: ReactNode; value: number; detail?: string; href?: string }[]; formatValue: (v: number) => string; ariaLabel: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul aria-label={ariaLabel} className="space-y-2.5">
      {items.map((item) => {
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{item.label}</span>
              <span className="shrink-0 tabular text-ink-2">
                {formatValue(item.value)}
                {item.detail ? <span className="ml-2 text-ink-3">{item.detail}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-sm bg-surface-2" aria-hidden>
              <div className="bar-fill h-2 rounded-sm bg-[var(--series-1)]" style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }} />
            </div>
          </>
        );
        return (
          <li key={item.key} title={`${typeof item.label === "string" ? item.label : item.key}: ${formatValue(item.value)}${item.detail ? ` (${item.detail})` : ""}`}>
            {item.href ? (
              <Link href={item.href} className="block rounded-md p-1 -m-1 hover:bg-surface-2">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
