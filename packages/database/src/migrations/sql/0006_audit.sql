CREATE TABLE audit_log (
  id uuid NOT NULL,
  scope text NOT NULL,
  tenant_id uuid REFERENCES institutions (id),
  actor_user_id uuid REFERENCES users (id),
  actor_platform_role text,
  action text NOT NULL,
  target_entity_type text NOT NULL,
  target_entity_id text NOT NULL,
  reason text,
  request_id text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT audit_log_scope_check CHECK (scope IN ('tenant', 'platform', 'cross_tenant')),
  CONSTRAINT audit_log_platform_tenant_mark_check CHECK ((scope = 'platform') = (tenant_id IS NULL)),
  CONSTRAINT audit_log_actor_exactly_one_check CHECK ((actor_user_id IS NOT NULL) <> (actor_platform_role IS NOT NULL))
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

CREATE INDEX audit_log_tenant_id_occurred_at_idx ON audit_log (tenant_id, occurred_at);
CREATE INDEX audit_log_actor_user_id_occurred_at_idx ON audit_log (actor_user_id, occurred_at);
CREATE INDEX audit_log_target_entity_idx ON audit_log (target_entity_type, target_entity_id, occurred_at);
CREATE INDEX audit_log_request_id_idx ON audit_log (request_id);

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
