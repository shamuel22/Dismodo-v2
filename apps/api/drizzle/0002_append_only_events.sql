-- Session events are an append-only log: the evidence must not change after it is written.
CREATE FUNCTION session_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'session_events is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER session_events_no_update_delete
  BEFORE UPDATE OR DELETE ON session_events
  FOR EACH ROW EXECUTE FUNCTION session_events_append_only();
--> statement-breakpoint
-- Package content is immutable too; only status, visibility, publication and attestation may change.
CREATE FUNCTION packages_content_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.experience_id IS DISTINCT FROM OLD.experience_id OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'package content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER packages_no_content_change
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION packages_content_immutable();
