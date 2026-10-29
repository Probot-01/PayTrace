import type { UserRole } from "@/domain/types";

const RANK: Record<UserRole, number> = { viewer: 0, analyst: 1, supervisor: 2, admin: 3 };

/** Minimum role for each capability. Checked on the server for every read and write. */
export const PERMISSIONS = {
  "dashboard:view": "viewer",
  "exceptions:view": "viewer",
  "exceptions:export": "viewer",
  "exceptions:work": "analyst",
  "exceptions:approve": "supervisor",
  "files:view": "viewer",
  "files:upload": "analyst",
  "files:delete": "admin",
  "runs:view": "viewer",
  "runs:create": "analyst",
  "runs:delete": "admin",
  "simulations:view": "viewer",
  "simulations:create": "analyst",
  "simulations:delete": "admin",
  "audit:view": "supervisor",
  "users:manage": "admin",
  "settings:manage": "admin",
} as const satisfies Record<string, UserRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return RANK[role] >= RANK[PERMISSIONS[permission]];
}

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return RANK[role] >= RANK[minimum];
}
