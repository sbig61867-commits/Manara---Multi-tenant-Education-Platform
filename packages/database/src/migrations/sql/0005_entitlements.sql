CREATE TABLE plans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_name_key UNIQUE (name)
);

CREATE TABLE plan_versions (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans (id),
  version integer NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'draft',
  effective_from timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CONSTRAINT plan_versions_plan_id_version_key UNIQUE (plan_id, version)
);

CREATE INDEX plan_versions_plan_id_idx ON plan_versions (plan_id);

ALTER TABLE plans
  ADD CONSTRAINT plans_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES plan_versions (id);

CREATE TABLE feature_definitions (
  id uuid PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  hard_restriction text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_definitions_key_key UNIQUE (key)
);

CREATE INDEX feature_definitions_hard_restriction_idx ON feature_definitions (hard_restriction);

CREATE TABLE feature_entitlements (
  plan_version_id uuid NOT NULL REFERENCES plan_versions (id),
  feature_key text NOT NULL,
  enabled boolean NOT NULL,
  overridable boolean NOT NULL DEFAULT true,
  quota_key text,
  quota_limit bigint,
  PRIMARY KEY (plan_version_id, feature_key)
);

CREATE INDEX feature_entitlements_plan_version_id_idx ON feature_entitlements (plan_version_id);

CREATE FUNCTION prevent_plan_version_mutation_after_activation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'active' THEN
    RAISE EXCEPTION 'activated plan versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_versions_immutable_after_activation
  BEFORE UPDATE OR DELETE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_plan_version_mutation_after_activation();

CREATE TABLE tenant_plan_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  plan_id uuid NOT NULL REFERENCES plans (id),
  plan_version_id uuid NOT NULL REFERENCES plan_versions (id),
  status text NOT NULL DEFAULT 'active',
  assigned_by_user_id uuid REFERENCES users (id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_plan_assignments_tenant_id_active_key
  ON tenant_plan_assignments (tenant_id)
  WHERE status = 'active';

CREATE INDEX tenant_plan_assignments_tenant_id_idx ON tenant_plan_assignments (tenant_id);

CREATE TABLE tenant_feature_overrides (
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  feature_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE usage_quotas (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  quota_key text NOT NULL,
  period text NOT NULL DEFAULT 'monthly',
  limit_value bigint,
  consumed bigint NOT NULL DEFAULT 0,
  reserved bigint NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_quotas_tenant_id_quota_key_key UNIQUE (tenant_id, quota_key),
  CONSTRAINT usage_quotas_non_negative_check CHECK (consumed >= 0 AND reserved >= 0)
);

CREATE INDEX usage_quotas_tenant_id_idx ON usage_quotas (tenant_id);

CREATE TABLE usage_meters (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  quota_key text NOT NULL,
  amount bigint NOT NULL,
  kind text NOT NULL,
  operation_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_meters_positive_amount_check CHECK (amount > 0)
);

CREATE INDEX usage_meters_tenant_id_quota_key_idx ON usage_meters (tenant_id, quota_key);
CREATE INDEX usage_meters_tenant_id_idx ON usage_meters (tenant_id);
