import { AppNav, type NavItem } from "@/components/client/nav";
import { requireSession } from "@/server/auth/current";
import { can, type Permission } from "@/server/auth/permissions";

const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/", label: "Dashboard", group: "Operations", permission: "dashboard:view" },
  { href: "/exceptions", label: "Exceptions", group: "Operations", permission: "exceptions:view" },
  { href: "/transactions", label: "Transaction trace", group: "Operations", permission: "runs:view" },
  { href: "/runs", label: "Reconciliation runs", group: "Operations", permission: "runs:view" },
  { href: "/files", label: "Participant files", group: "Data", permission: "files:view" },
  { href: "/simulator", label: "Simulator", group: "Data", permission: "simulations:view" },
  { href: "/insights", label: "Industry context", group: "Reference", permission: "dashboard:view" },
  { href: "/audit", label: "Audit log", group: "Administration", permission: "audit:view" },
  { href: "/admin/users", label: "Users", group: "Administration", permission: "users:manage" },
  { href: "/admin/settings", label: "Settings", group: "Administration", permission: "settings:manage" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const items: NavItem[] = NAV.filter((n) => can(user.role, n.permission)).map((n) => ({ href: n.href, label: n.label, group: n.group }));
  return (
    <div className="lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <AppNav items={items} user={{ name: user.name, role: user.role }} />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
