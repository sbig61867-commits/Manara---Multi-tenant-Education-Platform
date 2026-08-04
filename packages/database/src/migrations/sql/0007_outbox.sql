CREATE TABLE outbox_messages (
  id uuid NOT NULL,
  event_id text NOT NULL,
  source text NOT NULL,
  type text NOT NULL,
  scope text NOT NULL,
  tenant_id uuid REFERENCES institutions (id),
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT outbox_messages_event_id_unique UNIQUE (event_id),
  CONSTRAINT outbox_messages_scope_check CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT outbox_messages_status_check CHECK (status IN ('pending', 'claimed', 'delivered', 'failed', 'dead_letter')),
  CONSTRAINT outbox_messages_platform_tenant_mark_check CHECK ((scope = 'platform') = (tenant_id IS NULL)),
  CONSTRAINT outbox_messages_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE INDEX outbox_messages_pending_dispatch_idx ON outbox_messages (tenant_id, status, next_attempt_at);
CREATE INDEX outbox_messages_lease_expiry_idx ON outbox_messages (lease_expires_at) WHERE status = 'claimed';
CREATE INDEX outbox_messages_tenant_idx ON outbox_messages (tenant_id);
CREATE INDEX outbox_messages_next_attempt_idx ON outbox_messages (next_attempt_at) WHERE status = 'pending';

CREATE TABLE outbox_dead_letters (
  message_id uuid NOT NULL REFERENCES outbox_messages (id),
  event_id text NOT NULL,
  source text NOT NULL,
  type text NOT NULL,
  scope text NOT NULL,
  tenant_id uuid REFERENCES institutions (id),
  attempt_count integer NOT NULL,
  payload jsonb NOT NULL,
  failure jsonb NOT NULL,
  dead_lettered_at timestamptz NOT NULL,
  PRIMARY KEY (message_id),
  CONSTRAINT outbox_dead_letters_scope_check CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT outbox_dead_letters_platform_tenant_mark_check CHECK ((scope = 'platform') = (tenant_id IS NULL))
);

CREATE INDEX outbox_dead_letters_event_id_idx ON outbox_dead_letters (event_id);
