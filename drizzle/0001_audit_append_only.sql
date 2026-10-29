-- Audit events are append-only: they can never be edited or deleted through the application
-- role. The only permitted update is the FK cascade that nulls actor_id if a user row is removed.
CREATE OR REPLACE FUNCTION audit_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_events is append-only';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.actor_email IS DISTINCT FROM OLD.actor_email OR NEW.ip IS DISTINCT FROM OLD.ip
     OR NEW.actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'audit_events is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_guard();
