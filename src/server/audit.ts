import { getDb, type Database } from "@/db";
import { auditEvents } from "@/db/schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AuditActor {
  id: string | null;
  email: string | null;
  ip?: string | null;
}

/** Appends an audit event. Pass the transaction so the event commits atomically with the change. */
export async function audit(
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  tx?: Tx | Database,
) {
  await (tx ?? getDb()).insert(auditEvents).values({
    actorId: actor.id,
    actorEmail: actor.email,
    action,
    entityType,
    entityId,
    metadata,
    ip: actor.ip ?? null,
  });
}

export type { Tx };
