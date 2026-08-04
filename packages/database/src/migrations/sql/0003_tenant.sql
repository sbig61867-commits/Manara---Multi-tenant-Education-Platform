CREATE TABLE institutions (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX institutions_status_idx ON institutions (status);
CREATE INDEX institutions_created_at_idx ON institutions (created_at);

CREATE TABLE institution_settings (
  tenant_id uuid PRIMARY KEY REFERENCES institutions (id),
  branding_json jsonb NOT NULL,
  terminology_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL DEFAULT 'ar',
  rtl boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memberships_tenant_id_user_id_active_key
  ON memberships (tenant_id, user_id)
  WHERE status = 'active';

CREATE INDEX memberships_tenant_id_user_id_idx ON memberships (tenant_id, user_id);
CREATE INDEX memberships_tenant_id_user_id_status_idx ON memberships (tenant_id, user_id, status);
CREATE INDEX memberships_tenant_id_status_idx ON memberships (tenant_id, status);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_by_user_id uuid REFERENCES users (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX invitations_tenant_id_status_expires_at_idx ON invitations (tenant_id, status, expires_at);
