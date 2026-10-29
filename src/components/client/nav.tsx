"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { cx } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  group: "Operations" | "Data" | "Reference" | "Administration";
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g}</p>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "block rounded-md px-3 py-1.5 text-sm",
                        active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          window.location.assign("/login");
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AppNav({ items, user }: { items: NavItem[]; user: { name: string; role: string } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  const brand = (
    <Link href="/" className="flex items-center gap-2 px-3">
      <svg aria-hidden width="24" height="24" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M8 21l5-6 4 3 7-9" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-semibold tracking-tight">PayTrace</span>
    </Link>
  );

  const account = (
    <div className="border-t border-line px-3 pt-3 text-sm">
      <Link href="/account" className="block truncate font-medium text-ink hover:underline">
        {user.name}
      </Link>
      <p className="text-xs capitalize text-ink-3">{user.role}</p>
      <SignOutButton className="mt-2 text-sm text-accent hover:underline" />
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface py-4 lg:flex">
        <div className="space-y-6 overflow-y-auto">
          {brand}
          <nav aria-label="Main">
            <div className="px-2">
              <NavList items={items} />
            </div>
          </nav>
        </div>
        {account}
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2 lg:hidden">
        {brand}
        <button type="button" className="rounded-md border border-line-strong px-3 py-1.5 text-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          Menu
        </button>
      </div>
      <dialog
        ref={dialogRef}
        aria-label="Main menu"
        onClose={() => setOpen(false)}
        className="m-0 ml-auto h-dvh max-h-dvh w-72 max-w-[85vw] border-l border-line bg-surface p-0 text-ink"
      >
        <div className="flex h-full flex-col justify-between py-4">
          <div className="space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" className="rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-surface-2" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <nav aria-label="Main" className="px-2">
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
          {account}
        </div>
      </dialog>
    </>
  );
}
