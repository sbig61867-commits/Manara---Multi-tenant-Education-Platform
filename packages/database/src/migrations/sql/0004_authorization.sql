CREATE TABLE roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roles_tenant_id_name_key ON roles (tenant_id, name);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  key text NOT NULL,
  module text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_key_key UNIQUE (key)
);

CREATE INDEX permissions_module_idx ON permissions (module);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles (id),
  permission_id uuid NOT NULL REFERENCES permissions (id),
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX role_permissions_role_id_idx ON role_permissions (role_id);
CREATE INDEX role_permissions_tenant_id_role_id_idx ON role_permissions (tenant_id, role_id);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES institutions (id),
  role_id uuid NOT NULL REFERENCES roles (id),
  user_id uuid NOT NULL REFERENCES users (id),
  scope_type text NOT NULL,
  scope_unit_id uuid,
  scope_program_id uuid,
  scope_group_id uuid,
  created_by_user_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_assignments_scope_check CHECK (
    (scope_type = 'tenant' AND scope_unit_id IS NULL AND scope_program_id IS NULL AND scope_group_id IS NULL)
    OR (scope_type = 'unit' AND scope_unit_id IS NOT NULL AND scope_program_id IS NULL AND scope_group_id IS NULL)
    OR (scope_type = 'program' AND scope_unit_id IS NULL AND scope_program_id IS NOT NULL AND scope_group_id IS NULL)
    OR (scope_type = 'group' AND scope_unit_id IS NULL AND scope_program_id IS NULL AND scope_group_id IS NOT NULL)
  )
);

CREATE INDEX role_assignments_tenant_id_user_id_idx ON role_assignments (tenant_id, user_id);
CREATE INDEX role_assignments_tenant_id_role_id_idx ON role_assignments (tenant_id, role_id);
