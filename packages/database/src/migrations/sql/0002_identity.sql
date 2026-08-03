CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text,
  locale text,
  status text NOT NULL DEFAULT 'active',
  preferences_json jsonb,
  profile_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_email_idx ON users (email);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE password_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'unverified',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_identities_user_id_key UNIQUE (user_id)
);

CREATE INDEX password_identities_status_idx ON password_identities (status);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  rotated_from_id uuid,
  CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX auth_sessions_user_id_created_at_idx ON auth_sessions (user_id, created_at);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);
CREATE INDEX auth_sessions_last_active_at_idx ON auth_sessions (last_active_at);
