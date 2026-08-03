# Manara — Logical Database Model

> **نموذج قاعدة البيانات المنطقي لمنصة منارة**
> This document defines the **logical database model** of the Manara platform: every logical table/aggregate, its purpose, fields, keys, indexes, tenant ownership, lifecycle, deletion policy, RLS expectations, and audit requirements — plus the cross-cutting data design topics.
>
> **Scope:** Logical design only. No SQL, no migrations, no implementation code. Physical choices (exact data types, DDL) are deferred to migrations.
> **Sources:** `docs/PRODUCT_VISION.md` (business scope), `docs/TECHNICAL_GUIDE.md` (architecture decisions, Decision Log #1–#7), `docs/DOMAIN_MODEL.md` (business entities), `docs/ARCHITECTURE_REVIEW.md` (review findings — OPEN findings are respected: nothing here silently resolves them).
> **Status:** Draft — logical model for review.

---

## 1. Foundations

### 1.1 Shared-Schema Multi-Tenancy Strategy

- **Shared database, shared schema, row-level isolation** (TECHNICAL_GUIDE §8): every tenant-scoped table carries `tenant_id`; isolation is enforced at the database layer via Row Level Security (RLS) as the **second line of defense** — service-layer validation and authorization remain the first (TECHNICAL_GUIDE §3, §7).
- **Tenant-Context Contract (mandatory)** governs every tenant-scoped query (TECHNICAL_GUIDE §5):
  - Transaction-mode pooling only; session-mode pooling rejected.
  - Tenant context set transaction-locally (`app.tenant_id`) inside the same transaction as the queries; autocommit forbidden.
  - **Fail-closed**: missing/empty tenant context aborts the operation; RLS returns zero rows.
  - Applies equally to API requests, background workers, and MCP tool calls.
- RLS policies are **simple and direct**: `tenant_id = current_setting('app.tenant_id')` — no multi-level joins in policies (project rule).
- **Canonical identifier: `tenant_id`** — the single column name used everywhere in this model. It maps 1:1 to the domain term **Institution (Tenant)** (DOMAIN_MODEL A2) and to the project rule's `organization_id`. One name everywhere; no aliases.
- **Hyperscale escape hatch**: a single tenant may move to a dedicated database later (TECHNICAL_GUIDE §8, §22) — the model must keep every tenant-scoped table self-contained (own FKs, no cross-tenant references) so such a migration stays mechanical.

### 1.2 tenant_id Rules

1. Never client-supplied — derived exclusively from the authenticated context (auth session → membership) and carried through AsyncLocalStorage (TECHNICAL_GUIDE §3, §4).
2. `NOT NULL` on every tenant-scoped table; no nullable "system-wide" rows in tenant tables.
3. Leading column of every composite index on tenant tables (project rule).
4. Background jobs carry `tenant_id` explicitly in the job row and payload (TECHNICAL_GUIDE §12).
5. Cache keys, log lines, rate-limit keys, search documents, and storage prefixes are all namespaced by `tenant_id`.
6. Absent context is fail-closed everywhere — it never implicitly means "platform level".
7. Platform-level (privileged) operations do not run "without" a tenant: cross-tenant actions state their **target tenant** explicitly and are audit-logged (Super Admin Access Model, Decision Log #2).

### 1.3 Platform-Level vs Tenant-Scoped Tables

| Level | Tables | Notes |
|---|---|---|
| **Platform-level** (no `tenant_id`) | `users`, `identities`, `auth_sessions`, `auth_tokens`, `permissions`, `subscription_plans`, `feature_flag_definitions` | Global identity and platform catalog. Reachable from tenant context **only** through membership/entitlement resolution — never directly. |
| **Mixed** (platform rows `tenant_id` NULL + tenant rows) | `roles`, `role_permissions` (per-grant level), `notification_templates` | Platform rows are unique via **partial unique indexes** scoped to `tenant_id IS NULL` (H4); tenant rows keep composite uniqueness per tenant (B.6, F.5). |
| **Tenant-scoped** (carry `tenant_id`) | everything else | All business data; RLS-enforced; `tenant_id` NOT NULL. |
| **Platform-managed, tenant-attributed** | `audit_log` (tenant_id nullable for platform-only entries), `jobs`, `rate_limit_counters`, `metering_events`, `deletion_journal` | Written by platform/worker code; tenants see only their own rows via scoped views/queries. |

### 1.4 Shared Field Conventions (every table)

- `id` — surrogate primary key, UUID (v7 preferred for write-heavy, partitioned candidates to improve insert locality).
- `created_at`, `updated_at` — timestamps; `created_at` defaults to transaction time.
- `status` — lifecycle state where applicable, as a constrained value set (text/enum), never free-form.
- `deleted_at` — soft-delete marker where soft-delete applies (see 1.7).
- `version` — optimistic concurrency counter on tables with concurrent edits (settings, grades, templates).
- `tenant_id` — on every tenant-scoped table (rule 1.2).
- **Cursor pagination** (F38): every list query orders by a unique, stable key — `(tenant_id, created_at, id)` — and paginates with a cursor on `id`.

### 1.5 Primary Key Strategy

- Single-column surrogate UUID PK (`id`) on all tables — no natural/composite PKs except for pure link/counter tables where the composite itself is the identity (`role_permissions`, `user_roles` scope, `rate_limit_counters`, `notification_preferences`, `usage_quota_meters`, `attendance_records`, `assessment_audiences`), and except **time-partitioned tables**, whose PK is `(id, <partition key>)` per the partitioning contract (Section 4).
- Uniqueness of business identity is expressed through **unique constraints** (see each table), never by making natural keys the PK.
- Time-ordered UUID v7 for: `attempts`, `responses`, `audit_log`, `notifications`, `notification_outbox`, `metering_events` — aligns with partitioning (Section 4).

### 1.6 Indexing & Pagination Rules

- Composite indexes always lead with `tenant_id` (project rule; F22 — also per-partition indexes when partitioned).
- Index the real query patterns: `(tenant_id, created_at)`, `(tenant_id, status)`, `(tenant_id, parent_id)`, `(tenant_id, program_id, status)`, `(assessment_id, status)`, `(section/group_id, user_id)` equivalents, `(user_id, created_at)` for history views.
- No `SELECT *`; paginated lists everywhere (project rules).
- Index-usage review as part of the performance discipline (TECHNICAL_GUIDE §21).

### 1.7 Soft-Delete vs Hard-Delete Policy

- **Soft-delete** (`deleted_at` + status) for every reversible, interactive decision: revoked memberships, hidden content, retired roles, archived programs, deactivated units. App code **only** soft-deletes.
- **Hard-delete** exclusively for irreversible tenant termination (Decision Log #5) and law/storage-driven physical removal — executed **only by purge jobs**, batched and throttled; never by application requests.
- The two never interleave in application code.

### 1.8 RLS Expectations (template)

For every tenant-scoped table:

- Policy: `tenant_id = current_setting('app.tenant_id')` (transaction-local), evaluated on SELECT/INSERT/UPDATE/DELETE.
- Normal application and worker roles are subject to RLS; the dedicated privileged role bypasses RLS **only** on the isolated privileged path (Decision Log #2), with mandatory audit.
- Fail-closed: missing context → zero rows / abort.
- Isolation test suite in CI attempts cross-tenant access and must fail (TECHNICAL_GUIDE §18).

### 1.9 Audit Conventions

- The **database audit table is the sole source of truth** for audit (per F2: DB table is authoritative; logs are for troubleshooting). Audit rows are append-only; app roles have **no** update/delete privileges on `audit_log`.
- Sensitive operations audit-logged per module contracts (see each table's "Audit" line).
- Audit entries survive tenant deletion (retention default **7 years**, PII-bearing fields purged per policy, tenant reference kept as an opaque identifier — the retained Tenant Closure record, §5.1 — Decision Log #5).
- Tamper-evidence (hash-chaining / outbox-to-object-storage) is a later compliance refinement (F2 remains OPEN).

### 1.10 Naming Conventions

- Tables: `snake_case`, plural (e.g., `learning_programs`).
- Columns: `snake_case`, full words; FKs named `{referenced_table_singular}_id`; the tenant FK is always `tenant_id`.
- Status values: `snake_case` lowercase (e.g., `draft`, `published`, `in_progress`).
- Constraint names: `{table}_{column(s)}_key` / `_unique` / `_check`; index names: `{table}_{columns}_idx`.
- JSON columns: `*_json` suffix where a payload/settings structure is stored (`settings_json`, `payload_json`).
- Booleans: `is_*` / `has_*` / `can_*` prefixes.
- Timestamps: `*_at`; counters/amounts: plain nouns (`attempts_count`, `amount`, `tokens_in`).
- Soft-delete: `deleted_at`; versioning: `version`.

---

## 2. Logical Tables / Aggregates

### Traceability Matrix (domain entity → tables)

| Domain entity (DOMAIN_MODEL) | Logical table(s) |
|---|---|
| Institution (A2), Settings (A3), Org Structure (A4) | `institutions`, `institution_settings`, `organization_units` |
| Subscription (A5), Entitlement (A6), Plan | `subscription_plans`, `subscriptions`, `feature_flag_definitions`, `tenant_feature_flags`, `entitlements`, `usage_quota_meters`, `metering_events`, `invoices`, `payment_events` |
| User (B1), Identity (B2), Auth Session (B3) | `users`, `identities`, `auth_sessions`, `auth_tokens` |
| Membership (B4), Role (B5), Permission (B6) | `memberships`, `roles`, `permissions`, `role_permissions`, `user_roles` |
| Invitation (F1) | `invitations` |
| Learning Program (C1–C3), Module (C4), Lesson (C5) | `learning_programs`, `content_items` |
| Group (C8), Team (D7), Enrollment (C9) | `groups`, `teams`, `team_members`, `team_attempt_members`, `enrollments` |
| Training Session (C6), Attendance (C7) | `training_sessions`, `attendance_records` |
| Practical Lab (C10) | `practical_labs` |
| Assessment (D1), Exam (D2), Question Bank (D3), Attempt (D4), Grade (D5), Assignment (D6) | `assessments`, `assessment_audiences`, `question_bank_items`, `assessment_questions`, `attempts`, `responses`, `grades` |
| Certificate (E1) | `certificate_templates`, `certificates` |
| File (F3) | `files` |
| Notification (F2) | `notifications`, `notification_outbox`, `notification_preferences`, `notification_templates` |
| Audit Log (G1), AI Interaction (G2) | `audit_log`, `ai_interactions` |
| — (cross-cutting) | `jobs`, `exports`, `deletion_journal`, `legal_holds`, `api_keys`, `rate_limit_counters` |

---

### Part A — Platform & Tenancy

#### A.1 institutions

**Purpose:** The tenant root. One row per institution (DOMAIN_MODEL A2); the lifecycle owner of the tenant (Decision Log #5).

**Main fields:** `id`, `name`, `type` (University/School/Training Centre/Corporate/Non-Profit/Government/Academy/Custom — starting preset only), `template_ref` (starting template snapshot), `status` (draft → trial → active → suspended → grace → archived → deleted), `trial_ends_at`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID `id`.

**FK relationships:** Referenced by every tenant-scoped table (`tenant_id`); references `subscription_plans` indirectly via `subscriptions`.

**Tenant ownership:** This IS the tenant root — `tenant_id` of all other tables points here. Itself platform-scoped (no `tenant_id` column).

**Required indexes:** `(status)` for lifecycle sweeps; `(created_at)` for onboarding queues.

**Unique constraints:** none beyond `id` (name is not unique — institutions may share names).

**Lifecycle/status fields:** `status` implements the full Decision Log #5 lifecycle; transitions only via authorized platform actions; `trial_ends_at` for trial expiry.

**Soft-delete or hard-delete:** The root row is **never physically deleted**. The final purge (after Archived + retention window) **converts** the row into the permanent **Tenant Closure record** (§5.1): business/PII fields stripped, `status` set to `deleted`; the row and its id are retained forever so survivor records keep valid references. Suspended/Grace/Archived are **status values**, not deletes.

**RLS expectations:** No tenant RLS (platform-owned); tenant-scoped rows reference it via `tenant_id`.

**Audit requirements:** Every lifecycle transition (Draft→Active→Suspended→Grace→Archived→Deleted) audit-logged with actor, target tenant, action, reason, timestamp, request id (Decision Log #5).

---

#### A.2 institution_settings

**Purpose:** 1:1 configuration space of an institution (DOMAIN_MODEL A3): branding, language, terminology dictionary, defaults, dashboard layout. **Not** the place where feature availability is decided (that is `entitlements`).

**Main fields:** `tenant_id` (PK/FK), `branding_json` (name, logo, colors, language, RTL), `terminology_json` (display labels), `defaults_json` (program/registration/evaluation/certificate defaults), `dashboard_json`, `version`.

**PK strategy:** `tenant_id` as PK (1:1).

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Tenant-scoped; `tenant_id` NOT NULL.

**Required indexes:** PK `(tenant_id)` suffices.

**Unique constraints:** PK only.

**Lifecycle/status fields:** `version` for optimistic concurrency; no independent status — follows the institution lifecycle.

**Soft-delete or hard-delete:** Purged with the tenant (hard delete by purge job only).

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Changes to branding/terminology/security-affecting defaults are audit-logged (actor, tenant, field, timestamp).

---

#### A.3 organization_units

**Purpose:** Recursive institutional hierarchy — colleges, departments, branches, divisions (DOMAIN_MODEL A4); the scoping object for unit-level roles.

**Main fields:** `id`, `tenant_id`, `parent_id` (self-ref, nullable — root units have NULL), `name`, `kind` (college/department/branch/division/unit/custom), `sort_order`, `status` (active/deactivated), `deleted_at`.

**PK strategy:** Surrogate UUID `id`.

**FK relationships:** `parent_id` → `organization_units.id` (same tenant); referenced by `user_roles.unit_id`, `learning_programs.unit_id`, member-unit links.

**Tenant ownership:** Tenant-scoped; `tenant_id` NOT NULL.

**Required indexes:** `(tenant_id, parent_id, sort_order)` (tree traversal); `(tenant_id, status)`.

**Unique constraints:** `(tenant_id, parent_id, name)` — unit name unique within its parent.

**Lifecycle/status fields:** `status` active/deactivated; renames/moves/merges keep history for audit.

**Soft-delete or hard-delete:** Soft-delete (`deleted_at`) for restructuring; hard-delete only in tenant purge. Restructuring must not orphan programs (validated in service layer).

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Creation, rename, move, merge, deactivation audit-logged (actor, tenant, unit, change, reason).

---

#### A.4 subscription_plans

**Purpose:** Platform catalog: plans as **data** — pricing, period, entitlements, quotas, versioned and effective-dated (Decision Log #7). Starter, Professional, Enterprise, Custom (PRODUCT_VISION).

**Main fields:** `id`, `code`, `name`, `version`, `effective_from`, `effective_to` (nullable — current), `period` (monthly/annual), `pricing_json`, `limits_json` (students/teachers/admins, units, courses, sections, exams, storage, monthly AI requests, API quota), `feature_set_json` (default flags), `status` (draft/active/retired).

**PK strategy:** Surrogate UUID `id`.

**FK relationships:** Referenced by `subscriptions.plan_version_id`.

**Tenant ownership:** **Platform-level** (no `tenant_id`).

**Required indexes:** `(code, version)`; `(effective_from)` for resolution.

**Unique constraints:** `(code, version)` — one version per code; `(effective_from, code)` effective window.

**Lifecycle/status fields:** `status` + effective dating; changing a plan never requires a deployment.

**Soft-delete or hard-delete:** Soft-delete/retire only (historical versions must remain resolvable).

**RLS expectations:** No tenant RLS; readable by entitlement resolution code only (not exposed directly to tenants).

**Audit requirements:** Plan creation/versioning/retirement audit-logged (platform actor, plan, effective date, reason).

---

#### A.5 subscriptions

**Purpose:** The tenant's commercial relationship: exactly one active subscription per tenant referencing a plan version, with billing state (Decision Log #7; DOMAIN_MODEL A5).

**Main fields:** `id`, `tenant_id`, `plan_version_id`, `status` (trial/active/past_due/suspended/grace/cancelled), `period_start`, `period_end`, `trial` (bool), `trial_converted_at`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID `id`.

**FK relationships:** → `institutions.tenant_id`; → `subscription_plans.plan_version_id`.

**Tenant ownership:** Tenant-scoped; `tenant_id` NOT NULL.

**Required indexes:** `(tenant_id, status)` (resolution of the active subscription); `(plan_version_id)`.

**Unique constraints:** **Partial unique on exactly one active subscription per tenant** (status in active set). Historical/cancelled rows allowed.

**Lifecycle/status fields:** Billing lifecycle per Decision Log #7: trial → active → past_due → suspended → grace → reactivated/terminated; integrated with institution lifecycle.

**Soft-delete or hard-delete:** Retained as **permanent billing history** — never purged with the tenant (Decision Log #7; §5.1). The FK to `institutions.tenant_id` stays valid after closure because the tenant root row is retained as the Tenant Closure record (§5.1).

**RLS expectations:** Standard tenant policy (tenants see their own subscription); writes via platform billing path only.

**Audit requirements:** Plan changes, subscription changes, suspensions, trial conversions audit-logged (actor, tenant, plan, amount, status, timestamp, request id).

---

#### A.6 feature_flag_definitions + tenant_feature_flags

**Purpose:** Platform catalog of feature flags (AI Question Generator, AI Course Builder, Online Exams, Live Proctoring, Attendance, Certificates, Analytics, API Access, White Label, Custom Domain, Mobile App, SSO) plus **per-tenant overrides** — the input to entitlement resolution (Decision Log #7; DOMAIN_MODEL A6). Separate from rollout/deployment flags (F5 remains OPEN — terminology split respected).

**Main fields (definitions):** `id`, `key`, `name`, `description`, `status` (draft/active/retired). **Main fields (tenant flags):** `id`, `tenant_id`, `flag_key`, `enabled`, `reason`, `updated_by`, `updated_at`.

**PK strategy:** Surrogate UUIDs; natural identity via unique constraints.

**FK relationships:** `tenant_feature_flags.flag_key` → `feature_flag_definitions.key`; `tenant_id` → `institutions`.

**Tenant ownership:** Definitions platform-level; tenant flags tenant-scoped.

**Required indexes:** `tenant_feature_flags (tenant_id, flag_key)`.

**Unique constraints:** `feature_flag_definitions (key)`; `tenant_feature_flags (tenant_id, flag_key)`.

**Lifecycle/status fields:** Definition lifecycle (draft/active/retired); overrides are effective-dated by `updated_at` + entitlement recompute.

**Soft-delete or hard-delete:** Definitions retired (never deleted); overrides purged with tenant.

**RLS expectations:** Definitions no tenant RLS; overrides standard tenant policy (write via platform path).

**Audit requirements:** Flag changes and overrides audit-logged (actor, tenant, flag, state, reason).

---

#### A.7 entitlements

**Purpose:** Derived per-tenant cache of "what this institution may do right now" — resolved plan limits + flags snapshot (DOMAIN_MODEL A6). **Not a source of truth**: recomputed from `subscriptions` + `subscription_plans` + `tenant_feature_flags`.

**Main fields:** `tenant_id` (PK), `plan_version_id`, `flags_json` (resolved flags), `limits_json` (resolved quotas), `computed_at`, `source_version` (for invalidation).

**PK strategy:** `tenant_id` PK (1:1).

**FK relationships:** → `institutions`; → `subscription_plans`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** PK only.

**Unique constraints:** PK only.

**Lifecycle/status fields:** Recalculated immediately on plan/flag change (Decision Log #7); no independent lifecycle.

**Soft-delete or hard-delete:** Purged with tenant; always regenerable.

**RLS expectations:** Standard tenant policy; the application reads the cache but **always** re-verifies via plan data on sensitive paths.

**Audit requirements:** Entitlement recompute triggered by plan/flag changes is covered by the audit of those changes.

---

#### A.8 usage_quota_meters

**Purpose:** Per-tenant consumption counters per limit dimension (seats, courses, sections, exams, storage bytes, monthly AI requests, API quota) — enforced atomically with the business action at the service layer (Decision Log #7).

**Main fields:** `id`, `tenant_id`, `dimension` (seats_students/seats_teachers/seats_admins/units/courses/sections/exams/storage_bytes/ai_requests_monthly/api_calls), `period` (null for cumulative; year-month for monthly), `used`, `limit_ref` (plan version the limit came from), `updated_at`.

**PK strategy:** Composite `(tenant_id, dimension, period)`; surrogate `id` optional.

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** PK composite.

**Unique constraints:** `(tenant_id, dimension, period)`.

**Lifecycle/status fields:** Window rollover for monthly dimensions via scheduled job; no business status.

**Soft-delete or hard-delete:** Purged with tenant; counters are derived/rebuildable from `metering_events` where the meter needs rebuild.

**RLS expectations:** Write by platform/worker only; tenant reads via scoped view.

**Audit requirements:** Quota overrides audit-logged (actor, tenant, dimension, value, reason).

---

#### A.9 metering_events

**Purpose:** Append-only per-tenant usage stream (AI requests, API calls, storage deltas, email volume) feeding quota meters and cost attribution (Decision Log #7; TECHNICAL_GUIDE §14, §26, §27). Written only by platform metering pipeline, never by tenant code.

**Main fields:** `id`, `tenant_id`, `event_type` (ai_request/api_call/storage/email/...), `dimension`, `amount`, `user_id`, `attribution_json` (request id, feature, context ref), `occurred_at`.

**PK strategy:** Composite `(id, occurred_at)` — partition key in PK (partitioning contract, Section 4; day-one partitioned).

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Tenant-attributed (platform-managed).

**Required indexes:** `(tenant_id, occurred_at)`; `(occurred_at)` for rollup jobs.

**Unique constraints:** none (append-only stream; idempotency by attribution key enforced at producer).

**Lifecycle/status fields:** None (immutable stream); retention per cost/usage policy.

**Soft-delete or hard-delete:** Never soft-deleted; purged with tenant per retention; audit-irrelevant.

**RLS expectations:** Not exposed to tenants directly; tenant usage surfaced via scoped rollups.

**Audit requirements:** None per event (metering, not audit); producers logged at platform level.

---

#### A.10 invoices + A.11 payment_events

**Purpose (invoices):** Per-tenant billing records: number, period, amount, status, PDF artifact (Decision Log #7). **Purpose (payment_events):** Raw provider events ingested via signed, idempotent webhook endpoint (dedupe by provider event id, processed via queue).

**Main fields (invoices):** `id`, `tenant_id`, `number` (per-tenant), `status` (draft/issued/paid/failed/void), `amount`, `currency`, `period_start`, `period_end`, `due_at`, `paid_at`, `pdf_file_id`. **Main fields (payment_events):** `id`, `tenant_id`, `provider`, `provider_event_id`, `event_type`, `payload_json`, `status` (received/verified/processed), `processed_at`.

**PK strategy:** Surrogate UUIDs.

**FK relationships:** `pdf_file_id` → `files.id`; `payment_events` → `invoices.id` (via payload/verified link).

**Tenant ownership:** Tenant-scoped; `tenant_id` NOT NULL.

**Required indexes:** `invoices (tenant_id, status)`; `payment_events (provider_event_id)`.

**Unique constraints:** `invoices (tenant_id, number)`; `payment_events (provider, provider_event_id)` — the webhook idempotency key.

**Lifecycle/status fields:** Invoice lifecycle draft→issued→paid/failed/void; payment events received→verified→processed (Decision Log #7).

**Soft-delete or hard-delete:** Retained as **permanent, immutable commercial records** — never purged with the tenant (billing audit policy, Decision Log #7; §5.1); FKs stay valid after closure via the retained Tenant Closure record (§5.1).

**RLS expectations:** Standard tenant policy (tenants read own invoices); writes via platform billing path.

**Audit requirements:** Invoice generation, payments, refunds, webhook events audit-logged (actor/event, tenant, plan, amount, status, timestamp, request id).

---

#### A.12 legal_holds

**Purpose:** Legal hold records that freeze retention/deletion timelines for a tenant or specific objects (Decision Log #5 item 11) — the only override of retention and deletion.

**Main fields:** `id`, `tenant_id`, `object_type` (tenant or specific object), `object_id` (nullable — tenant-wide hold), `reason`, `placed_by`, `placed_at`, `revoked_by`, `revoked_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Platform-managed, tenant-attributed.

**Required indexes:** `(tenant_id, revoked_at)` (open holds).

**Unique constraints:** None (multiple holds possible).

**Lifecycle/status fields:** open → revoked (via authorized platform action only).

**Soft-delete or hard-delete:** Never deleted (audit requirement); purged only per platform legal policy.

**RLS expectations:** No tenant visibility; platform path only.

**Audit requirements:** Placement and revocation audit-logged (actor, tenant, object, reason, timestamp).

---

### Part B — Identity & Access

#### B.1 users

**Purpose:** One global account per person (DOMAIN_MODEL B1) — the single, tenant-agnostic identity.

**Main fields:** `id`, `email` (unique, case-insensitive), `display_name`, `locale`, `status` (pending_verification/active/suspended/closed), `preferences_json`, `profile_json`, `created_at`, `updated_at`, `deleted_at`.

**PK strategy:** Surrogate UUID `id`.

**FK relationships:** Referenced by `identities`, `auth_sessions`, `memberships`, `enrollments`, `notifications`, `audit_log.actor_user_id`, `ai_interactions`.

**Tenant ownership:** **Platform-level** — no `tenant_id`. Tenant visibility exists only through `memberships`.

**Required indexes:** `(email)`; `(status)`.

**Unique constraints:** `(email)`.

**Lifecycle/status fields:** pending_verification → active → suspended → closed; global suspension overrides all memberships (DOMAIN_MODEL B1).

**Soft-delete or hard-delete:** Soft-delete (closure) — audit records and memberships history retained; hard-delete never (identity records are required for audit).

**RLS expectations:** Not tenant-scoped; exposed to tenants only via membership-scoped projections (no direct read).

**Audit requirements:** Account creation, closure, global suspension audit-logged.

---

#### B.2 identities

**Purpose:** Credentials and verification evidence per user — email+password today; social/SSO future kinds behind the SSO flag (DOMAIN_MODEL B2).

**Main fields:** `id`, `user_id`, `kind` (password/social/sso/future), `credential_ref` (password hash for `password` kind — Argon2id; external subject ref for others), `verified_at`, `status` (unverified/verified/reset_required/closed), `last_login_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `users.id`.

**Tenant ownership:** Platform-level.

**Required indexes:** `(user_id, kind)`; `(credential_ref)` where applicable.

**Unique constraints:** `(user_id, kind)` — one credential per kind.

**Lifecycle/status fields:** verification → active; reset flows; closed with account.

**Soft-delete or hard-delete:** Soft-delete; credential hashes never exposed outside identity services.

**RLS expectations:** No tenant RLS; institutions never read credentials (DOMAIN_MODEL B2).

**Audit requirements:** Verification, password reset, new-device events audit-logged (no credential material).

---

#### B.3 auth_sessions

**Purpose:** Opaque, server-side auth sessions stored in PostgreSQL (Decision Log #1; DOMAIN_MODEL B3 — Auth Session). Browser cookie holds only the session reference; revocation is a row delete.

**Main fields:** `id`, `user_id`, `token_hash` (hashed opaque token), `created_at`, `expires_at` (absolute expiry — 24h default), `last_active_at` (idle timeout — 30m default), `ip`, `user_agent`, `revoked_at`, `rotated_from_id` (rotation chain).

**PK strategy:** Surrogate UUID `id` (becomes `(id, created_at)` if partitioned — later candidate only, Section 4).

**FK relationships:** → `users.id`.

**Tenant ownership:** **Platform-level** — the session is global to the account; tenant access resolves through memberships per request.

**Required indexes:** `(token_hash)` unique; `(user_id, created_at)` (user's device list); `(expires_at)` (cleanup sweep); `(last_active_at)` (idle-timeout sweep).

**Unique constraints:** `(token_hash)` (becomes `(token_hash, created_at)` when partitioned — Section 4; 256-bit token entropy makes collisions cryptographically negligible).

**Lifecycle/status fields:** active → expired (absolute or idle) → revoked (logout, password change, privilege change, security event). Rotation after login and after privilege changes (Decision Log #1).

**Soft-delete or hard-delete:** Hard-delete on logout/revocation (that IS the revocation mechanism); expired rows purged by scheduled cleanup job.

**RLS expectations:** Not tenant-scoped; validated by auth module on every request; never carries tenant decisions (re-evaluated per request).

**Audit requirements:** Login, logout, revocation, rotation audit-logged (actor, session event, request id). Session content itself is not audit-logged (PII-minimal).

**Provider note:** sits behind a provider-neutral interface; PostgreSQL → Redis move triggered only by the measured thresholds in Decision Log #1.

---

#### B.4 auth_tokens

**Purpose:** Short-lived, single-use, hashed tokens for recovery/verification flows: password reset, email verification, invitation acceptance.

**Main fields:** `id`, `user_id`, `purpose` (reset_password/verify_email/accept_invite), `token_hash`, `expires_at`, `used_at`, `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `users.id`.

**Tenant ownership:** Platform-level (invite tokens are tenant-attributed via the invitation row).

**Required indexes:** `(token_hash)` unique; `(expires_at)`.

**Unique constraints:** `(token_hash)`.

**Lifecycle/status fields:** issued → used/expired (single-use).

**Soft-delete or hard-delete:** Hard-delete on use/expiry (sweep job).

**RLS expectations:** None (auth module only).

**Audit requirements:** Token issuance and use logged; tokens never stored in plaintext.

---

#### B.5 memberships

**Purpose:** The user ↔ institution bridge; the sole tenant-access mechanism (DOMAIN_MODEL B4).

**Main fields:** `id`, `tenant_id`, `user_id`, `status` (pending/invited → active → inactive/suspended → ended), `started_at`, `ended_at`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `users.user_id`; referenced by `user_roles`, `enrollments`, `invitations`.

**Tenant ownership:** Tenant-scoped (carries `tenant_id`).

**Required indexes:** `(tenant_id, user_id)`; `(user_id, tenant_id, status)`; `(tenant_id, status)`.

**Unique constraints:** `(tenant_id, user_id)` — one membership per user per institution.

**Lifecycle/status fields:** invitation flows; suspension per-membership vs global; ending revokes all tenant-derived access (records retained).

**Soft-delete or hard-delete:** Soft-delete for ended memberships (history needed); hard-delete only in tenant purge (enrollments/records retained per retention).

**RLS expectations:** Standard tenant policy — but note: this table is read by the **membership resolution path** (which must run with tenant context from the session).

**Audit requirements:** Membership creation, role/status changes, ending audit-logged (actor, tenant, user, change, reason).

---

#### B.6 roles

**Purpose:** Named permission sets; platform roles (tenant_id NULL) + institution-defined roles (DOMAIN_MODEL B5).

**Main fields:** `id`, `tenant_id` (NULL = platform role), `name`, `display_name` (per-tenant labels), `is_system`, `status` (active/retired), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** Linked to permissions via `role_permissions`; assigned via `user_roles`.

**Tenant ownership:** Mixed: platform rows tenant_id NULL; institution roles tenant-scoped (uniqueness per level enforced by partial unique indexes — see Unique constraints).

**Required indexes:** `(tenant_id, name)` (tenant roles); partial unique index on `name` scoped to rows where `tenant_id IS NULL` (platform roles).

**Unique constraints:** Platform roles: partial unique index on `name` among rows where `tenant_id IS NULL`. Tenant roles: `(tenant_id, name)` unique within each tenant. PostgreSQL treats NULLs as distinct in a plain composite unique, so the partial index is required to prevent duplicate platform role names.

**Lifecycle/status fields:** active → retired (retired roles keep assignments readable but grant nothing new).

**Soft-delete or hard-delete:** Soft-delete/retire only (assignments and audit depend on the row).

**RLS expectations:** Institution roles standard tenant policy; platform roles never visible on tenant paths.

**Audit requirements:** Role creation/retirement and label changes audit-logged.

---

#### B.7 permissions + role_permissions

**Purpose:** The atomic capability catalog (permissions, platform-level) and the role↔permission grant links (DOMAIN_MODEL B6).

**Main fields (permissions):** `id`, `key` (e.g., `assessments:create`), `module`, `description`, `status`. **Main fields (role_permissions):** `role_id`, `permission_id`, `tenant_id` (NULL = platform-role grant; matches `roles.tenant_id`), `granted_at`.

**PK strategy:** permissions: surrogate UUID; role_permissions: composite `(role_id, permission_id)`.

**FK relationships:** `role_permissions.role_id` → `roles.id`; `permission_id` → `permissions.id`.

**Tenant ownership:** Permissions catalog platform-level; role_permissions inherits the role's tenant level — tenant grants carry `tenant_id` (rule 1.2#2), platform-role grants NULL (platform roles grant platform permissions only).

**Required indexes:** `(module)`; `role_permissions (role_id)`; `(tenant_id, role_id)` (tenant grants).

**Unique constraints:** `permissions (key)`; `role_permissions (role_id, permission_id)`.

**Lifecycle/status fields:** Permission catalog evolves with features (draft/active/retired); no per-grant lifecycle.

**Soft-delete or hard-delete:** Retire only — historical grants must remain resolvable for audit.

**RLS expectations:** Catalog readable by the central permission module; not exposed directly to tenant code.

**Audit requirements:** Grant/revoke changes audit-logged (actor, role, permission, change).

---

#### B.8 user_roles

**Purpose:** Role assignments with explicit scope — the RBAC+ABAC hybrid's persistence (TECHNICAL_GUIDE §7): a role is effective within a scope context (tenant / unit / program / group).

**Main fields:** `id`, `user_id`, `membership_id` (null for platform roles), `tenant_id` (null for platform roles), `role_id`, `unit_id` (null), `program_id` (null), `group_id` (null), `effective_from`, `effective_to` (null), `status` (active/inactive).

**PK strategy:** Surrogate UUID (scope combinations may repeat over time).

**FK relationships:** → `users`; → `memberships`; → `roles`; → `organization_units`/`learning_programs`/`groups` (scope refs, all same tenant).

**Tenant ownership:** Tenant-scoped for tenant roles; platform rows tenant_id NULL.

**Required indexes:** `(user_id, tenant_id, status)` (session resolution); `(tenant_id, role_id)`; `(program_id, group_id)` (scoped lookups).

**Unique constraints:** No unique on scope combination (effective-dated rows); application enforces no duplicate active scope assignments.

**Lifecycle/status fields:** effective_from/effective_to + status; changes rotate the user's auth session (Decision Log #1).

**Soft-delete or hard-delete:** Soft-delete/inactivate only — audit history required.

**RLS expectations:** Tenant rows standard policy; platform rows platform path only.

**Audit requirements:** Role assignment/change/revocation audit-logged (actor, tenant, user, role, scope, reason).

---

#### B.9 invitations

**Purpose:** The controlled front door: join methods (direct, link, code, public registration, approval request, manual, bulk import, future integration) producing memberships and optional enrollments (DOMAIN_MODEL F1).

**Main fields:** `id`, `tenant_id`, `program_id` (nullable), `method` (invite/link/code/public/approval/manual/bulk), `code` (for link/code methods), `target_email` (nullable), `role_intent_json` (roles/enrollments to grant), `created_by`, `expires_at`, `accepted_by_user_id`, `accepted_at`, `status` (pending/accepted/expired/revoked), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `learning_programs.program_id`; → `users.accepted_by_user_id`; → `memberships`/`enrollments` (produced rows).

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, status, expires_at)`; `(code)` unique where applicable; `(target_email, tenant_id)`.

**Unique constraints:** single-use codes: `(code)` unique per method; pending uniqueness per (tenant, target_email, method) enforced at service layer.

**Lifecycle/status fields:** pending → accepted/expired/revoked; expiry via sweep job.

**Soft-delete or hard-delete:** Soft-delete/revoke; records retained for audit.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Creation, acceptance, expiry, revocation audit-logged; invitations granting high-privilege roles require approval + audit (DM-L6 respected — rule belongs to service layer).

---

#### B.10 api_keys

**Purpose:** Tenant-scoped M2M / public API access (TECHNICAL_GUIDE §4, §6 — JWTs reserved for explicitly designed M2M access; keys are the standing credential for tenant integrations).

**Main fields:** `id`, `tenant_id`, `name`, `key_hash` (never plaintext), `scopes_json`, `rate_profile`, `expires_at`, `last_used_at`, `status` (active/revoked/expired), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(key_hash)` unique; `(tenant_id, status)`.

**Unique constraints:** `(key_hash)`.

**Lifecycle/status fields:** active → revoked/expired; rotation supported.

**Soft-delete or hard-delete:** Revoke only (audit); purge with tenant.

**RLS expectations:** Standard tenant policy (tenant admins manage own keys).

**Audit requirements:** Key creation, rotation, revocation audit-logged; usage metered via `metering_events` (API quota).

---

### Part C — Programs & Delivery

#### C.1 learning_programs

**Purpose:** The generic program container (DOMAIN_MODEL C1) with archetype as data (`kind`): academic_course, training_program, self_paced, instructor_led, live, cohort_based, corporate, onboarding, compliance, certification_path, practical_lab, internship, project_based, blended, external, custom.

**Main fields:** `id`, `tenant_id`, `unit_id` (nullable), `kind`, `title`, `code`, `settings_json` (enrollment method, grading policy, completion rules, certificate conditions), `term_start`, `term_end` (academic/training timing), `status` (draft/published/running/completed/archived), `deleted_at`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `organization_units.unit_id`; referenced by `content_items`, `groups`, `enrollments`, `assessments`, `training_sessions`, `practical_labs`, `teams`.

**Tenant ownership:** Tenant-scoped (core tenant unit; everything nested inherits it).

**Required indexes:** `(tenant_id, status)`; `(tenant_id, kind)`; `(tenant_id, unit_id)`.

**Unique constraints:** `(tenant_id, code)` — program code unique per tenant.

**Lifecycle/status fields:** draft → published → running → completed → archived (archived = read-only; grading/certificates follow archive rules).

**Soft-delete or hard-delete:** Soft-delete (hidden content); hard-delete only in tenant purge.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Create/publish/archive state changes audit-logged (actor, tenant, program, change, reason).

---

#### C.2 content_items

**Purpose:** The recursive content tree — modules and lessons (DOMAIN_MODEL C4/C5) in one self-referential aggregate with `kind` (module/lesson/topic/custom), stable ordering, and per-item lifecycle. Inline lesson material lives on the item; media attach via `files`.

**Main fields:** `id`, `tenant_id`, `program_id`, `parent_id` (self-ref, nullable), `kind`, `title`, `body` (inline text content), `position` (stable explicit order), `status` (draft/published/archived), `version`, `completion_rule_json`, `search_vector` (FTS — Phase 1 search, TECHNICAL_GUIDE §13), `deleted_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** `parent_id` → `content_items.id` (same program, same tenant); `program_id` → `learning_programs.id`; referenced by `files` (attachments), `assessments`, `practical_labs`, `training_sessions.module_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, parent_id, position)` (tree navigation); `(tenant_id, program_id, status)`; GIN `(search_vector)`.

**Unique constraints:** `(program_id, parent_id, position)` — stable ordering; parent must share program/tenant (service-enforced).

**Lifecycle/status fields:** draft → published → archived; versioned so completion/audit records remain meaningful.

**Soft-delete or hard-delete:** Soft-delete for hidden/removed content; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Publication, version changes, archive audit-logged.

---

#### C.3 groups

**Purpose:** Delivery structure only — sections (شعب), cohorts/batches (دفعات), study groups (DOMAIN_MODEL C8). Collaboration grouping lives in `teams`, never here.

**Main fields:** `id`, `tenant_id`, `program_id`, `kind` (section/cohort/study_group), `name`, `capacity`, `status` (active/closed), `deleted_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `learning_programs.program_id`; referenced by `enrollments.group_id`, `user_roles.group_id`, `training_sessions.group_id`, `assessment_audiences`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, status)`; `(tenant_id, program_id, kind)`.

**Unique constraints:** `(program_id, name)`.

**Lifecycle/status fields:** active → closed (with program end).

**Soft-delete or hard-delete:** Soft-delete; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Creation/closure audit-logged.

---

#### C.4 teams + C.5 team_members

**Purpose:** Learners collaborating on a joint deliverable — assignment, project, or practical lab (DOMAIN_MODEL D7). Membership is independent of group membership.

**Main fields (teams):** `id`, `tenant_id`, `program_id`, `deliverable_type` (assignment/practical_lab), `deliverable_id`, `name`, `status` (formed/active/submitted/evaluated/closed), `created_at`. **Main fields (team_members):** `id`, `tenant_id` (NOT NULL, matches `teams.tenant_id`), `team_id`, `enrollment_id`, `joined_at`, `role_in_team` (nullable).

**PK strategy:** Surrogate UUIDs.

**FK relationships:** `deliverable_id` → `assessments.id` (assignment kind) or `practical_labs.id` (constrained by deliverable_type); `team_members.team_id` → `teams.id` with `team_members.tenant_id` matching `teams.tenant_id` (direct column, per rule 1.2#2); `team_members.enrollment_id` → `enrollments.id` (same tenant). Referenced by `attempts.team_id` and `team_attempt_members.team_id` (D.5).

**Tenant ownership:** Tenant-scoped (direct `tenant_id` on `team_members`, per rule 1.2#2).

**Required indexes:** `teams (tenant_id, program_id, deliverable_type, deliverable_id)`; `team_members (tenant_id, team_id)`; `team_members (tenant_id, enrollment_id)`.

**Unique constraints:** `team_members (team_id, enrollment_id)`; service-enforced: one team per member per deliverable.

**Lifecycle/status fields:** formed → active → submitted → evaluated → closed (per deliverable flow).

**Soft-delete or hard-delete:** Soft-delete (closed teams retained for grading history); purge with tenant.

**Submission interplay:** team membership changes after a shared submission never affect the attempt or its snapshot (`team_attempt_members`, D.5); the snapshot is taken at submission time and is immutable.

**RLS expectations:** Standard tenant policy — direct `tenant_id = current_setting('app.tenant_id')` check on `team_members` (no join to `teams`); worker/team operations set tenant context per the Tenant-Context Contract.

**Audit requirements:** Team formation, membership changes, submission audit-logged (actor, tenant, team, member, change, reason).

---

#### C.6 enrollments

**Purpose:** Member's registration and participation in a program (+ optional group) (DOMAIN_MODEL C9); the learner-side anchor of attempts, attendance, grades, certificates.

**Main fields:** `id`, `tenant_id`, `membership_id`, `program_id`, `group_id` (nullable), `source` (invitation/link/code/public/approval/manual/bulk), `status` (pending/enrolled/active/completed/withdrawn), `enrolled_at`, `completed_at`, `withdrawn_at`, `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `memberships.membership_id`; → `learning_programs.program_id`; → `groups.group_id` (same program); referenced by `attempts`, `attendance_records`, `grades`, `certificates`, `team_members`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, status)`; `(membership_id, program_id)`; `(tenant_id, group_id)`.

**Unique constraints:** `(membership_id, program_id)` — one enrollment per member per program (group assignment may change within it).

**Lifecycle/status fields:** pending → enrolled/active → completed/withdrawn; feeds plan seat quotas (updated atomically).

**Soft-delete or hard-delete:** Soft-delete for withdrawals (records retained); purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Enrollment, withdrawal, completion transitions audit-logged.

---

#### C.7 training_sessions

**Purpose:** Scheduled learning events — live/instructor-led sessions, lectures, class meetings (DOMAIN_MODEL C6 — Training Session). Distinct from auth sessions by construction.

**Main fields:** `id`, `tenant_id`, `program_id`, `module_id` (nullable), `group_id` (nullable), `title`, `starts_at`, `ends_at`, `mode` (live/in_person/recorded), `location_link`, `status` (scheduled/live/completed/cancelled), `cancelled_reason`, `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `learning_programs.program_id`; → `content_items.module_id`; → `groups.group_id`; referenced by `attendance_records.training_session_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, starts_at)`; `(tenant_id, status)`; `(tenant_id, group_id, starts_at)`.

**Unique constraints:** None beyond id (multiple sessions may coincide per program).

**Lifecycle/status fields:** scheduled → live → completed / cancelled (cancellation before/within window; exceptional post-completion cancellation audited).

**Soft-delete or hard-delete:** Soft-delete; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Cancellation and exceptional changes audit-logged.

---

#### C.8 attendance_records

**Purpose:** One participation record per learner per scheduled event, with statuses Present / Absent / Excused / Late / Partially Attended; feeds attendance evaluation, certificate conditions, and reports (DOMAIN_MODEL C7 — Attendance).

**Main fields:** `id`, `tenant_id`, `training_session_id`, `enrollment_id`, `status` (present/absent/excused/late/partially_attended), `justification` (nullable), `recorded_by`, `recorded_at`, `correction_state` (final/correction_pending/correction_approved), `approved_by`, `approved_at`, `created_at`, `updated_at`.

**PK strategy:** Composite `(training_session_id, enrollment_id)`; surrogate `id` optional.

**FK relationships:** → `training_sessions.training_session_id`; → `enrollments.enrollment_id`; → `users.recorded_by`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** PK composite; `(tenant_id, enrollment_id, created_at)` (history/ratio); `(tenant_id, training_session_id, status)`.

**Unique constraints:** `(training_session_id, enrollment_id)` — one record per learner per event.

**Lifecycle/status fields:** expected → recorded → corrected (approved) → closed (finalized after period/program close); corrections require justification and approval (routine by instructor; disputes escalate to trainer/supervisor); every change audited.

**Soft-delete or hard-delete:** Never soft-deleted (attendance is evidence); purged with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Recording, corrections, approvals, and finalization audit-logged (actor, tenant, session, enrollment, status change, reason).

---

#### C.9 practical_labs

**Purpose:** Hands-on training tasks with environments and evaluated outcomes (DOMAIN_MODEL C10). Integration levels 1–2 now; level 3 explicitly out of the first release.

**Main fields:** `id`, `tenant_id`, `program_id`, `module_id` (nullable), `title`, `task_description`, `instructions`, `steps_json`, `prerequisites_json`, `expected_result`, `integration_level` (1/2/3), `external_link`, `access_json` (structured, expiring temporary credentials — never stored as a file), `starts_at`, `ends_at`, `duration`, `status` (draft/published/open/submitted/evaluated/closed), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `learning_programs.program_id`; → `content_items.module_id`; referenced by `teams.deliverable_id`, `files` (attachments), `attempts` (lab submissions).

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, status)`; `(tenant_id, integration_level)`.

**Unique constraints:** None beyond id.

**Lifecycle/status fields:** draft → published → open (time-bound access) → submitted → evaluated → closed.

**Soft-delete or hard-delete:** Soft-delete; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Publication, access-window changes, credential issuance/expiry audit-logged (no credential material in audit).

---

### Part D — Assessments

#### D.1 assessments

**Purpose:** The unified assessment aggregate (DOMAIN_MODEL D1/D2/D6): kind covers exam, quiz, assignment, project, report, presentation, practical evaluation, attendance-based evaluation.

**Main fields:** `id`, `tenant_id`, `program_id`, `module_id` (nullable), `kind`, `title`, `settings_json` (timing, window, retake policy, evaluation scale numeric/percentage/pass_fail/descriptive/multi-stage, late policy, team policy), `status` (draft/published/running/grading/results_published/archived), `results_published_at`, `deleted_at`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `learning_programs.program_id`; → `content_items.module_id`; referenced by `assessment_audiences`, `assessment_questions`, `attempts`, `grades`, `teams.deliverable_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, program_id, status)`; `(tenant_id, status)`.

**Unique constraints:** `(program_id, code)` where a per-program code exists.

**Lifecycle/status fields:** draft → published → running → grading → results_published → archived; results confidential until explicit publication; grading/analytics run out-of-band (queue), never in the learner's request path.

**Soft-delete or hard-delete:** Soft-delete; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Publication, result publication, settings changes, archive audit-logged.

---

#### D.2 assessment_audiences

**Purpose:** Who an assessment targets: whole groups (sections/cohorts) or specific members (DOMAIN_MODEL D1).

**Main fields:** `id`, `tenant_id`, `assessment_id`, `target_type` (group/member), `target_id`, `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** `target_id` → `groups.id` or `memberships.id` (constrained by target_type, same tenant); `tenant_id` matches `assessments.tenant_id`.

**Tenant ownership:** Tenant-scoped (direct `tenant_id` on the row, per rule 1.2#2).

**Required indexes:** `(tenant_id, assessment_id)`; `(tenant_id, target_type, target_id)`.

**Unique constraints:** `(assessment_id, target_type, target_id)`.

**Lifecycle/status fields:** None (membership in audience follows assessment lifecycle).

**Soft-delete or hard-delete:** Purged with assessment/tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Audience changes audit-logged.

---

#### D.3 question_bank_items

**Purpose:** The institution's reusable question repository (DOMAIN_MODEL D3): types, options, points, metadata; versioned; AI-generated items are drafts until human acceptance.

**Main fields:** `id`, `tenant_id`, `program_id` (nullable — bank may be institution-wide), `kind` (mcq/true_false/written/...), `prompt`, `options_json`, `default_points`, `difficulty`, `topic`, `version`, `ai_generated` (bool), `human_accepted_at` (null until accepted), `status` (draft/active/deprecated/archived), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; referenced by `assessment_questions.question_bank_item_id`.

**Tenant ownership:** Tenant-scoped (strictly per-institution; no cross-tenant bank).

**Required indexes:** `(tenant_id, status)`; `(tenant_id, topic)`; `(tenant_id, kind)`.

**Unique constraints:** None beyond id (versions may repeat prompts).

**Lifecycle/status fields:** draft → active → deprecated → archived; versioning preserves exact question text used in past exams.

**Soft-delete or hard-delete:** Soft-delete; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Creation, AI acceptance, deprecation audit-logged.

---

#### D.4 assessment_questions

**Purpose:** The exact question set of an assessment: links bank items or ad-hoc questions, with a **snapshot** of the question text/points at exam time.

**Main fields:** `id`, `tenant_id`, `assessment_id`, `question_bank_item_id` (nullable), `position`, `points`, `snapshot_json` (text, options, type as used), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `assessments.assessment_id`; → `question_bank_items.question_bank_item_id` (nullable, same tenant); `tenant_id` matches `assessments.tenant_id`.

**Tenant ownership:** Tenant-scoped (direct `tenant_id` on the row, per rule 1.2#2).

**Required indexes:** `(tenant_id, assessment_id, position)`.

**Unique constraints:** `(assessment_id, position)`.

**Lifecycle/status fields:** None (fixed at publication; later edits create new versions).

**Soft-delete or hard-delete:** Purged with assessment/tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Question-set changes before publication audit-logged.

---

#### D.5 attempts + team_attempt_members

**Purpose:** One learner's sitting of an assessment — exam sittings and assignment/lab submissions unified (DOMAIN_MODEL D4). Progressive save, final submission, retake tracking. **Team-attempt contract:** a Team submits one **shared Attempt** for its deliverable (assignment/project/practical lab); the shared Attempt belongs to the Team, and every member receives an individual Grade derived from it. `team_attempt_members` is the membership **snapshot at submission time** backing those per-member grades.

**Main fields (attempts):** `id`, `tenant_id`, `assessment_id`, `enrollment_id` (**the submitter** — individual attempt: the learner; team attempt: the team member who submits), `team_id` (nullable — set for shared team attempts), `kind` (exam/assignment/lab), `started_at`, `submitted_at` (nullable), `deadline`, `submission_ref` (file refs/payload for assignments/labs), `retake_count`, `status` (in_progress/submitted/graded/reviewed), `created_at`. **Main fields (team_attempt_members):** `id`, `tenant_id`, `attempt_id`, `team_id`, `enrollment_id` (member), `snapshot_role_in_team` (nullable — role at submission time), `joined_before_submission` (bool), `created_at`.

**PK strategy:** Surrogate UUIDs.

**FK relationships:** attempts → `assessments.assessment_id`; → `enrollments.enrollment_id` (submitter, same tenant); → `teams.team_id` (nullable, same tenant); → `files` via submission_ref; referenced by `responses`, `grades`. `team_attempt_members.attempt_id` → `attempts.attempt_id` with `tenant_id` matching `attempts.tenant_id`; → `teams.team_id`; → `enrollments.enrollment_id` (all same tenant as the attempt).

**Tenant ownership:** Tenant-scoped (direct `tenant_id` on both tables, per rule 1.2#2).

**Required indexes:** attempts `(tenant_id, assessment_id, status)`; `(tenant_id, enrollment_id, created_at)`; `(tenant_id, team_id, assessment_id)` (active shared-attempt resolution); `(assessment_id, status)`; `(team_id)`. team_attempt_members `(tenant_id, attempt_id)`; `(tenant_id, enrollment_id)`.

**Unique constraints:** attempts — service-enforced plus DB partial unique on active status, including the partition key (Section 4): **individual attempts: one active attempt per (assessment, enrollment, created_at)**; **team attempts: one active shared attempt per (assessment, team, created_at)** — exact because `created_at` (attempt start) is immutable per attempt. team_attempt_members: `(attempt_id, enrollment_id)` — one snapshot row per member per attempt (table not partitioned).

**Lifecycle/status fields:** attempts: started → in_progress → submitted (final and irreversible for that attempt row) → graded → reviewed/appealed (appeal resolution lives on `grades`). **Resubmission** within policy creates a **new attempt row** (`retake_count` incremented) with a **fresh `team_attempt_members` snapshot**; prior attempts and their snapshots remain immutable (grading history preserved). Snapshot rows are immutable after capture — team membership changes after submission never alter them.

**Soft-delete or hard-delete:** Attempts and snapshots never soft-deleted (evidence); purged with tenant.

**RLS expectations:** Standard tenant policy — direct `tenant_id` check on both tables (no join); exam anti-spam (start/submission rate limits) enforced at service layer; grading workers set tenant context per job (Tenant-Context Contract).

**Audit requirements:** Start, submission, team-membership snapshot capture (members, roles), and any exceptional reopening audit-logged.

---

#### D.6 responses

**Purpose:** Answers captured during an attempt, per question (DOMAIN_MODEL D4).

**Main fields:** `id`, `tenant_id` (NOT NULL, matches `attempts.tenant_id`), `attempt_id`, `assessment_question_id`, `answer_json`, `is_correct` (nullable until auto-graded), `auto_score`, `graded_by` (nullable — manual), `graded_at`, `created_at`.

**PK strategy:** Composite `(id, created_at)` — `created_at` inherits the parent attempt's value (partitioning contract, Section 4; day-one partitioned).

**FK relationships:** → `attempts.attempt_id`; `tenant_id` matches `attempts.tenant_id` (direct column, per rule 1.2#2); → `assessment_questions.assessment_question_id` (snapshot preserved by D.4, same tenant).

**Tenant ownership:** Tenant-scoped (direct `tenant_id` on the row, per rule 1.2#2).

**Required indexes:** `(tenant_id, attempt_id)`; `(tenant_id, assessment_question_id)` for analytics.

**Unique constraints:** `(attempt_id, assessment_question_id, created_at)` — with `created_at` copied from the attempt (Section 4), one-per-(attempt, question) remains exact; the FK to `attempts` uses `(attempt_id, created_at)`.

**Lifecycle/status fields:** answered → auto-graded → manually reviewed.

**Soft-delete or hard-delete:** Never soft-deleted; purged with tenant.

**RLS expectations:** Standard tenant policy — direct `tenant_id = current_setting('app.tenant_id')` check (no join to `attempts`); grading workers set tenant context per job (Tenant-Context Contract).

**Audit requirements:** None per row (grading events on `grades` are audited); rows carry `tenant_id` so tenant-scoped audit correlation and purges remain direct (rule 1.2#5, 1.2#6).

---

#### D.7 grades

**Purpose:** The recorded outcome of an attempt or assessment — gradebook input, certificate eligibility, appeal lifecycle (DOMAIN_MODEL D5).

**Main fields:** `id`, `tenant_id`, `assessment_id`, `enrollment_id`, `attempt_id` (nullable — non-attempt evaluations e.g. attendance-based), `score`, `scale` (numeric/percentage/pass_fail/descriptive), `status` (pending/provisional/final/adjusted/appealed/resolved), `graded_by`, `graded_at`, `appeal_reason`, `appeal_resolved_by`, `appeal_resolved_at`, `version`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `assessments.assessment_id`; → `enrollments.enrollment_id`; → `attempts.attempt_id` (nullable); → `users.graded_by`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, assessment_id, status)`; `(tenant_id, enrollment_id)` (gradebook); `(tenant_id, status)` (result publication fan-out).

**Unique constraints:** Attempt-linked grades: **one grade per enrolled member per attempt** — unique `(attempt_id, enrollment_id)`. Individual attempts produce one row (the learner); team attempts produce one row per member in the `team_attempt_members` snapshot of the shared attempt (D.5). Service-enforced: one grade per (assessment, enrollment) for non-attempt evaluations.

**Lifecycle/status fields:** pending → provisional → final → adjusted → appealed/resolved; changes require justification; confidential until results published.

**Team-attempt grading:** the grading job derives one Grade per `team_attempt_members` row of the shared attempt; members may receive **different scores** (per-member manual evaluation, per-member appeals); each member's Grade is individual and independently appealable.

**Soft-delete or hard-delete:** Never soft-deleted (academic record); purged with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Every grade issue/change/appeal decision audit-logged (actor, tenant, enrollment, grade, before/after, reason).

---

### Part E — Outcomes & Evidence

#### E.1 certificate_templates

**Purpose:** Per-institution certificate designs: issuance conditions and branding (DOMAIN_MODEL E1 — template layer).

**Main fields:** `id`, `tenant_id`, `name`, `conditions_json` (attendance ratio, passing assessments, content completion, project/lab completion, supervisor approval), `design_json` (branding, signature blocks), `version`, `status` (draft/active/retired), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; referenced by `certificates.template_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, status)`.

**Unique constraints:** `(tenant_id, name)`.

**Lifecycle/status fields:** draft → active → retired; versioned so issued certificates remain tied to the design used.

**Soft-delete or hard-delete:** Retire only; purge with tenant.

**RLS expectations:** Standard tenant policy.

**Audit requirements:** Template creation, versioning, retirement audit-logged.

---

#### E.2 certificates

**Purpose:** Issued credentials with unique public verification (data-minimal, no cross-tenant exposure) and revocation (DOMAIN_MODEL E1).

**Main fields:** `id`, `tenant_id`, `template_id`, `enrollment_id`, `number` (per-tenant numbering), `verify_code` (unique, public-facing), `issued_at`, `issued_by`, `status` (issued/revoked), `revoked_at`, `revoked_by`, `revoked_reason`, `file_id` (PDF artifact), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `certificate_templates.template_id`; → `enrollments.enrollment_id`; → `files.file_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, status)`; `(enrollment_id)`; `(verify_code)` unique.

**Unique constraints:** `(tenant_id, number)`; `(verify_code)` globally unique.

**Lifecycle/status fields:** issued → revoked (policy violations, audited); issuance only when all conditions verified (automatic) or explicitly approved (manual).

**Soft-delete or hard-delete:** Never deleted (credential record); purged with tenant per retention policy.

**RLS expectations:** Standard tenant policy for management; verification is a deliberate, minimal, public read path (separate from content access rules).

**Audit requirements:** Issuance, revocation, verification lookups audit-logged.

---

### Part F — Files & Notifications

#### F.1 files

**Purpose:** File metadata + lifecycle state (quarantine → scan → publish) per the File Upload Security Architecture (Decision Log #4; DOMAIN_MODEL F3). Storage objects live in tenant-prefixed object storage; the DB holds metadata and state only.

**Main fields:** `id`, `tenant_id`, `owner_user_id`, `category` (content/submission/lab/branding/certificate/import), `storage_key` (tenant-prefixed), `filename`, `size_bytes`, `content_type` (magic-byte derived — never client MIME alone), `checksum`, `state` (uploading/quarantined/published/rejected/expired), `scan_status` (pending/clean/infected/error), `expires_at` (nullable — temporary files), `object_version`, `created_at`, `updated_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `users.owner_user_id`; referenced by content items, assignments (submissions), labs, certificates, invoices (PDFs).

**Tenant ownership:** Tenant-scoped; storage key always under the tenant's prefix.

**Required indexes:** `(tenant_id, state)`; `(tenant_id, category)`; `(tenant_id, owner_user_id)`; `(storage_key)` unique.

**Unique constraints:** `(storage_key)`.

**Lifecycle/status fields:** uploading → quarantined → published / rejected (scan failure/infected — fail-closed); expired for temporary files; **no file is servable outside `published`**.

**Soft-delete or hard-delete:** Soft-delete for hidden files; hard-delete by tenant purge jobs (storage objects + metadata) per Decision Log #5; orphan sweep within the deleted tenant's scope only.

**RLS expectations:** Standard tenant policy; presigned URLs tenant-scoped; files never served from the application domain (dedicated storage/CDN domain).

**Audit requirements:** Upload, scan result, publication, quarantine decisions, and access attempts to quarantined files audit-logged (actor, tenant, file, type, size, verdict, timestamp).

---

#### F.2 notifications

**Purpose:** Tenant-scoped, typed notification records — the persistent in-app channel and dispatch record (Decision Log #6; DOMAIN_MODEL F2).

**Main fields:** `id`, `tenant_id`, `recipient_user_id`, `category` (content/assessment/membership/billing/system), `priority` (low/normal/high/urgent), `template_ref`, `payload_json` (PII-minimal), `status` (pending/delivered/read/dismissed/dead_letter), `created_at`, `read_at`, `dismissed_at`.

**PK strategy:** Composite `(id, created_at)` — partition key in PK (partitioning contract, Section 4; day-one partitioned).

**FK relationships:** → `institutions.tenant_id`; → `users.recipient_user_id`; → `notification_outbox` (per-channel dispatch records).

**Tenant ownership:** Tenant-scoped end to end (recipients always resolved within one tenant context).

**Required indexes:** `(tenant_id, recipient_user_id, created_at)` (feed); `(tenant_id, status)`; `(recipient_user_id, status)`.

**Unique constraints:** None beyond id (delivery uniqueness via outbox).

**Lifecycle/status fields:** pending → delivered → read/dismissed → archived (retention policy); dead-letter on terminal failure.

**Soft-delete or hard-delete:** Retention-based purge (archive then delete per policy); with tenant on purge.

**RLS expectations:** Standard tenant policy; realtime (SSE) delivery pushes only notifications for the connected user's current tenant context.

**Audit requirements:** Production, preference changes, DDL re-enqueue/discard audit-logged (content itself not audit-logged — PII-minimal).

---

#### F.3 notification_outbox

**Purpose:** The mandatory outbox: notification + outbox rows written **in the same transaction** as the triggering business action (Decision Log #6) — at-least-once delivery.

**Main fields:** `id`, `tenant_id`, `notification_id` (deterministic — event source + sequence), `channel` (in_app/email/future push/SMS), `attempts`, `next_attempt_at`, `status` (pending/claimed/delivered/failed/dead_letter), `last_error`, `delivered_at`, `created_at`.

**PK strategy:** Composite `(id, created_at)` — `created_at` inherits the parent notification's value (partitioning contract, Section 4; day-one partitioned).

**FK relationships:** → `institutions.tenant_id`; → `notifications.notification_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, status, next_attempt_at)` (dispatcher claim — `FOR UPDATE SKIP LOCKED`); `(notification_id)`.

**Unique constraints:** `(notification_id, channel, created_at)` — with `created_at` inherited from the parent notification (Section 4), idempotent dispatch per channel stays exact; the FK to `notifications` uses `(notification_id, created_at)`.

**Lifecycle/status fields:** pending → claimed → delivered / failed (retries with backoff: 5 attempts 1m/5m/15m/1h/6h) → dead_letter; non-transient failures skip retries.

**Soft-delete or hard-delete:** Dead-letter rows retained for admin inspection; purged per retention/with tenant.

**RLS expectations:** Worker-only writes; tenant admin dead-letter visibility via scoped view.

**Audit requirements:** DDL inspect/re-enqueue/discard audit-logged.

---

#### F.4 notification_preferences

**Purpose:** Per-user, per-tenant, per-channel, per-category preferences (Decision Log #6) — enforced at dispatch time, never at production time.

**Main fields:** `id`, `tenant_id`, `user_id`, `channel`, `category`, `mode` (on/off/digest), `updated_at`.

**PK strategy:** Composite `(tenant_id, user_id, channel, category)`.

**FK relationships:** → `institutions.tenant_id`; → `users.user_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** PK composite.

**Unique constraints:** PK.

**Lifecycle/status fields:** None (config rows).

**Soft-delete or hard-delete:** Purged with tenant.

**RLS expectations:** Standard tenant policy (users manage own preferences).

**Audit requirements:** Preference changes audit-logged (actor, tenant, channel, category, mode).

---

#### F.5 notification_templates

**Purpose:** Versioned, localized (Arabic-first, RTL-aware) notification templates; platform catalog with tenant branding applied at render time (Decision Log #6).

**Main fields:** `id`, `tenant_id` (nullable — platform default), `key`, `channel`, `version`, `subject` (email), `body`, `locale`, `status` (draft/active/retired), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** `tenant_id` nullable (platform defaults + tenant overrides).

**Tenant ownership:** Mixed (platform rows + tenant overrides).

**Required indexes:** `(key, channel, locale, version)` (platform lookup); partial unique index on `(key, channel, locale, version)` scoped to rows where `tenant_id IS NULL` (platform defaults); `(tenant_id, key, channel, locale, version)` (tenant overrides).

**Unique constraints:** Platform defaults: partial unique index on `(key, channel, locale, version)` among rows where `tenant_id IS NULL`. Tenant overrides: `(tenant_id, key, channel, locale, version)` unique within each tenant. Same NULL-semantics rationale as `roles` (B.6) — a plain composite unique cannot enforce platform-row uniqueness.

**Lifecycle/status fields:** draft → active → retired; rendering is tenant-isolated.

**Soft-delete or hard-delete:** Retire only.

**RLS expectations:** Tenant overrides standard policy; platform defaults platform-only.

**Audit requirements:** Template changes audit-logged.

---

### Part G — Trust & Operations

#### G.1 audit_log

**Purpose:** The append-only, authoritative audit record (F2: DB table is the sole audit source of truth; TECHNICAL_GUIDE §16; DOMAIN_MODEL G1). Records who did what, in which tenant, with reason and request id.

**Main fields:** `id`, `tenant_id` (nullable — platform-level entries; tenant entries always set), `actor_user_id` (nullable), `actor_platform_role` (nullable), `action`, `target_entity_type`, `target_entity_id`, `reason`, `request_id`, `metadata_json` (PII-minimal), `occurred_at`.

**PK strategy:** Composite `(id, occurred_at)` — partition key in PK (partitioning contract, Section 4; day-one partitioned).

**FK relationships:** → `institutions.tenant_id` (nullable); → `users.actor_user_id` (nullable).

**Tenant ownership:** Platform-managed, tenant-attributed (see 1.3).

**Required indexes:** `(tenant_id, occurred_at)`; `(actor_user_id, occurred_at)`; `(target_entity_type, target_entity_id, occurred_at)`; `(request_id)`.

**Unique constraints:** None (append-only).

**Lifecycle/status fields:** Immutable — no status; retention default **7 years**; PII-bearing fields purged per policy; entries survive tenant deletion.

**Soft-delete or hard-delete:** **No update, no delete** by any app role (append-only enforced by privileges); never purged with the tenant.

**RLS expectations:** Tenant rows visible to the tenant's scoped audit queries; full visibility via the privileged path only; platform entries never visible to tenants.

**Audit requirements:** Self-evident (it IS the audit log); hash-chaining/tamper-evidence deferred (F2 OPEN).

---

#### G.2 ai_interactions

**Purpose:** Recorded, metered AI usage (DOMAIN_MODEL G2): gated by entitlement, metered monthly per tenant, audit-trailed; feeds quotas and cost attribution.

**Main fields:** `id`, `tenant_id`, `user_id`, `feature` (question_generator/course_builder/summarizer/future), `context_ref` (program_id/assessment_id, nullable), `provider`, `model`, `tokens_in`, `tokens_out`, `cost_units`, `status` (requested/processing/completed/failed), `created_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `users.user_id`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, created_at)` (quota/cost rollups); `(tenant_id, feature, created_at)`; `(user_id, created_at)`.

**Unique constraints:** None beyond id.

**Lifecycle/status fields:** requested → processing → completed/failed → metered (feeds `usage_quota_meters` and `metering_events`).

**Soft-delete or hard-delete:** Retained per metering retention; purged with tenant.

**RLS expectations:** Not directly tenant-writable; tenant usage surfaced via scoped rollups.

**Audit requirements:** AI usage and over-quota blocks audit-logged; AI output is draft until human acceptance (enforced at service layer, question bank flag `ai_generated`).

---

#### G.3 rate_limit_counters

**Purpose:** Distributed rate-limit counters — shared backend, Phase 1 PostgreSQL (Decision Log #3). Never in-memory; fail-closed (503) on backend failure.

**Main fields:** `id`, `scope` (auth/public_api/tenant_api/upload/ai/admin/exam), `tenant_id` (nullable — unauthenticated flows), `user_id` (nullable), `ip` (nullable), `bucket_key`, `window_start`, `count`, `updated_at`.

**PK strategy:** Composite `(scope, bucket_key, window_start)`; surrogate `id` optional.

**FK relationships:** → `institutions.tenant_id` (nullable); → `users.user_id` (nullable).

**Tenant ownership:** Mixed (tenant-aware keys; anonymous flows keyed by IP).

**Required indexes:** PK composite; `(window_start)` for cleanup sweeps.

**Unique constraints:** PK.

**Lifecycle/status fields:** None (windowed counters; stale-window cleanup via scheduled job).

**Soft-delete or hard-delete:** Deleted by cleanup sweeps (hard delete, harmless data).

**RLS expectations:** Worker/internal access only; never tenant-visible.

**Audit requirements:** Rejection events metriced, not audit-logged per event (monitoring per Decision Log #3).

---

#### G.4 jobs (pg-boss queue)

**Purpose:** Background job queue (pg-boss on PostgreSQL — TECHNICAL_GUIDE §12): grading, email/notification dispatch, malware scans, exports, purge jobs, certificate generation, AI requests. Every job carries `tenant_id`; workers enforce the Tenant-Context Contract per job.

**Main fields:** `id` (queue-internal), `tenant_id`, `job_type` (grade/email/scan/export/purge/notification_dispatch/certificate/ai/...), `priority`, `payload_json`, `idempotency_key`, `state` (created/retry/active/completed/failed/cancelled), `retry_count`, `started_at`, `completed_at`, `created_at`.

**PK strategy:** Queue-managed (pg-boss native rows).

**FK relationships:** → `institutions.tenant_id` (job-level attribution column).

**Tenant ownership:** Platform-managed, tenant-attributed.

**Required indexes:** `(state, priority, created_at)`; `(tenant_id, state)`.

**Unique constraints:** `(idempotency_key)` where applicable (at-least-once safe).

**Lifecycle/status fields:** Queue states + retry policy; dead-letter per job type.

**Soft-delete or hard-delete:** Jobs drained/cancelled at tenant offboarding; purged for the tenant **before** DB purge (Decision Log #5); completed jobs retained briefly.

**RLS expectations:** Worker-only access (dedicated small pool, not the request pool — F24 respected).

**Audit requirements:** Job failures/alerts monitored; tenant-scoped job activity traceable via `tenant_id` + request id.

---

#### G.5 exports

**Purpose:** Tenant data export requests (Decision Log #5): queued, tenant-scoped packages (CSV/JSON + manifest) in a tenant-scoped export location with bounded lifetime (14-day default).

**Main fields:** `id`, `tenant_id`, `requested_by`, `scope_json` (members/programs/content/assessments/grades/certificates/files-manifest), `status` (queued/running/completed/failed), `package_ref`, `size_bytes`, `requested_at`, `completed_at`, `expires_at`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`; → `users.requested_by`.

**Tenant ownership:** Tenant-scoped.

**Required indexes:** `(tenant_id, status)`.

**Unique constraints:** None beyond id.

**Lifecycle/status fields:** queued → running → completed (expires_at enforces the window) / failed.

**Soft-delete or hard-delete:** Package + row purged at expiry or tenant purge.

**RLS expectations:** Standard tenant policy (export contains only the requesting tenant's data — Tenant-Context Contract); rate/quota-limited.

**Audit requirements:** Export requests and completions audit-logged (actor, tenant, scope, timestamp).

---

#### G.6 deletion_journal

**Purpose:** Staged tenant-deletion progress (Decision Log #5): purge jobs per feature in dependency order; any failure aborts with alert (fail-closed — partial deletion never silent).

**Main fields:** `id`, `tenant_id`, `phase` (queue_purge/children/content/assessments/enrollments/memberships/roles/tenant_scope/closure), `status` (pending/running/completed/failed), `started_at`, `completed_at`, `rows_affected`, `error`.

**PK strategy:** Surrogate UUID.

**FK relationships:** → `institutions.tenant_id`.

**Tenant ownership:** Platform-managed, tenant-attributed.

**Required indexes:** `(tenant_id, phase)`.

**Unique constraints:** `(tenant_id, phase)`.

**Lifecycle/status fields:** pending → running → completed/failed; journal itself never deleted (survives the tenant).

**Soft-delete or hard-delete:** Never deleted — the journal and audit records are the only traces after tenant deletion.

**RLS expectations:** Platform path only.

**Audit requirements:** Journal entries ARE the audit of the deletion process (plus audit_log entries for the authorized trigger).

---

## 3. Cross-Cutting Design Topics

### 3.1 Auth Session Storage

- `auth_sessions` (B.3) is the browser-session store: opaque hashed tokens, absolute + idle expiry, rotation chain, immediate revocation by row delete (Decision Log #1).
- Sits behind a provider-neutral store interface; PostgreSQL is the initial implementation. Move to Redis only on the measured triggers (session queries > 20% of primary queries, auth p95 > 100 ms, session-attributed CPU > 50% — sustained), never by forecast.
- Sessions are global (no `tenant_id`); per-request tenant context resolves from the user's chosen membership; session data never caches tenant decisions.

### 3.2 Role/Permission Model (RBAC + ABAC)

- `permissions` (catalog) ← `role_permissions` → `roles` (platform or tenant) ← `user_roles` (assignments with scope: tenant / unit / program / group).
- Access = role × scope × entitlement (`entitlements`) × entity status — evaluated by the central permission module at the service layer; RLS is the safety net.
- Platform roles have `tenant_id` NULL and operate only on the privileged path with mandatory audit (Decision Log #2).
- Session rotation on privilege changes (Decision Log #1) is triggered by `user_roles`/membership mutations.

### 3.3 Subscription/Entitlement Model

- `subscription_plans` (catalog, versioned) → `subscriptions` (one active per tenant) → `entitlements` (derived cache) + `usage_quota_meters` (enforced counters) + `metering_events` (append-only usage stream).
- Quota enforcement happens atomically **before** the business action at the service layer; over-quota = clear error, no data deletion (Decision Log #7).
- Trial (14 days default): explicit consent to convert; never silent auto-charge. Unpaid → Past Due → Suspended → Grace integrated with the institution lifecycle; legal hold freezes progression.

### 3.4 Learning Program Structure

- `learning_programs` (archetype = `kind`) → `content_items` (recursive modules/lessons/topics, stable `position`, versioned) → attachable `assessments`, `practical_labs`, `training_sessions`.
- Delivery grouping via `groups`; collaboration via `teams` (independent of groups); participation via `enrollments`.
- Program-level items may exist without a module (parent NULL); everything inherits the program's `tenant_id`.

### 3.5 Assessment/Attempt/Grade Structure

- `assessments` (kind: exam/quiz/assignment/project/...) + `assessment_audiences` (groups/members) + `assessment_questions` (bank-snapshotted).
- `attempts` (one sitting; kind exam/assignment/lab; team-capable) → `responses` (per-question answers) → `grades` (one grade per enrolled member for team attempts, backed by the `team_attempt_members` submission-time snapshot; individual for individual attempts; appeal lifecycle).
- Grading and analytics run on the queue (`jobs`), never in the learner's request path; results confidential until explicit publication; grades immutable-in-effect — changes audited with before/after values.

### 3.6 Attendance Structure

- `training_sessions` (scheduled events) → `attendance_records` (one per enrollment per session; statuses Present/Absent/Excused/Late/Partially Attended; correction + approval state).
- Attendance feeds: certificate conditions (template `conditions_json`), attendance-based evaluation (assessment kind + grade), and reports (derived projections).
- Records finalize at period/program close; finalized records change only through the approved correction process; every change audited.

### 3.7 Notification/Outbox Structure

- Business action writes `notifications` + `notification_outbox` **in the same transaction** (Decision Log #6).
- Dispatcher claims outbox rows (`FOR UPDATE SKIP LOCKED`), applies `notification_preferences` per channel/category, renders `notification_templates` with tenant branding, retries with backoff (5 attempts), dead-letters after max attempts.
- Realtime: SSE endpoints per instance; Phase 1 change signal via PostgreSQL LISTEN/NOTIFY on outbox inserts; event-id resume for correctness; Redis pub/sub is a provider swap later.

### 3.8 Audit Log Structure

- `audit_log`: append-only; no app-role UPDATE/DELETE privileges; sole audit source of truth (logs are for troubleshooting).
- Fields: actor, target tenant (nullable only for platform-level entries), action, entity, reason, request id, timestamp.
- Survives tenant deletion (7y default retention; PII purge); privileged-path operations always produce entries (audit entry without a reason is a defect — Decision Log #2).

### 3.9 File Metadata/Quarantine Structure

- `files` holds metadata + state only: `uploading → quarantined → published / rejected (fail-closed)`; `scan_status` pending/clean/infected/error; magic-byte-derived `content_type`; tenant-prefixed `storage_key`.
- Only `published` files are servable; presigned URLs are tenant-scoped; files never served from the application domain (dedicated storage/CDN domain; attachment + nosniff; CSP).
- Uploads, scan verdicts, and publication decisions are audit-logged (Decision Log #4).

---

## 4. Partitioning Contract

### 4.1 Strategy (one, consistent)

Time-based **RANGE partitioning** on a timestamp column, with the partition key **inside the primary key** and **inside every unique constraint**. Composite keys `(id, <partition key>)` are the chosen form; UUID v7 remains the `id` generator (write locality within partitions) but is **not** used as the partition key itself: v7 ordering is approximate (random bits), which makes retention partition-drops and time-bounded pruning imprecise — and it would still force unique constraints to include the partition key. Timestamp keys are explicit, standard, and align with the query patterns of the model (`(tenant_id, created_at)`, `occurred_at` rollups, retention windows).

### 4.2 Contract rules (apply to every time-partitioned table)

1. **Partition key is explicit** per table (matrix in 4.3).
2. **Primary key includes the partition key**: `(id, <partition key>)`.
3. **Every unique constraint includes the partition key**.
4. **Partition-key inheritance**: children of a partitioned parent copy the parent's partition-key value (e.g., `responses.created_at` = `attempts.created_at`; `notification_outbox.created_at` = `notifications.created_at`). Because the value is immutable per parent row, augmented unique rules remain **logically exact** — the partition key never weakens a business uniqueness rule.
5. Per-partition indexes lead with `tenant_id` (F22); hot tenant queries must include a time bound (UI semantics already imply "this program/term").
6. RLS policies are inherited by partitions — the standard tenant policy applies unchanged (§1.8).
7. Foreign keys may reference a partitioned table **only** through its `(id, <partition key>)` PK (4.6).
8. Partitions are created/dropped **only** by scheduled platform jobs — never by application code (4.7).

### 4.3 Table matrix

| Table | Partition key | PK | Unique constraints (partition-key included) | Status |
|---|---|---|---|---|
| `attempts` | `created_at` (attempt start) | `(id, created_at)` | partial, active only: `(assessment_id, enrollment_id, created_at)`; `(assessment_id, team_id, created_at)` | **Day one** |
| `responses` | `created_at` (inherits attempt) | `(id, created_at)` | `(attempt_id, assessment_question_id, created_at)` | **Day one** |
| `audit_log` | `occurred_at` | `(id, occurred_at)` | none (append-only) | **Day one** |
| `notifications` | `created_at` | `(id, created_at)` | none beyond id | **Day one** |
| `notification_outbox` | `created_at` (inherits notification) | `(id, created_at)` | `(notification_id, channel, created_at)` | **Day one** |
| `metering_events` | `occurred_at` | `(id, occurred_at)` | none (append-only; producer idempotency) | **Day one** |
| `auth_sessions` | `created_at` | `(id, created_at)` | `(token_hash, created_at)` | **Candidate later** |
| `rate_limit_counters` | `window_start` | composite `(scope, bucket_key, window_start)` — already contract-compliant | PK only | **Candidate later** |

### 4.4 Day-one vs later

- **Partitioned from day one**: `attempts`, `responses`, `audit_log`, `notifications`, `notification_outbox`, `metering_events` — high-write/append-heavy from launch (exam waves, notification feeds, audit/metering streams). Shipping partitioned avoids costly later rebuilds on large tables.
- **Candidates for later** (adopt only when measured): `auth_sessions` (Decision Log #1 triggers), `rate_limit_counters` (already contract-compliant by construction; partition when volume demands).
- **Never partition**: `users`, `institutions`, small reference tables.

### 4.5 Migration trigger for introducing partitioning

- Day-one tables ship partitioned; no conversion trigger applies.
- Later candidates adopt partitioning when **measured** (TECHNICAL_GUIDE §21/§22 — never by forecast): sustained write-latency/throughput degradation, or table volume above the operational target (e.g., a time slice exceeding ~500 GB or insert p95 above the target), or delete-based retention purges becoming operationally unacceptable vs partition drop. `auth_sessions` additionally follows the Decision Log #1 thresholds (session queries > 20% of primary queries, auth p95 > 100 ms, session-attributed CPU > 50% — sustained).
- Conversion procedure follows expand-contract (§6): create the partitioned table alongside, backfill in batches with a time bound, cut over; never in-place ALTER of an existing hot table.

### 4.6 Foreign keys referencing partitioned tables

- FKs **from** a partitioned child **to** a non-partitioned parent are unrestricted (e.g., `attempts → assessments`, `attempts → institutions`).
- FKs **to** a partitioned parent must match the parent's `(id, <partition key>)` PK, so the child carries the partition-key column: `responses`, `grades`, `team_attempt_members` → `attempts (attempt_id, created_at)`; `notification_outbox` → `notifications (notification_id, created_at)`. All these children already carry `created_at`.
- No FK may reference a partitioned table by `id` alone.

### 4.7 Retention & partition-drop rules

- Partitions are **advance-created** (default ~2 months ahead) and **dropped** by scheduled platform jobs only — never by application requests (consistent with §1.7 hard-delete discipline).
- Retention-by-dropping partitions (replaces delete-based purge): `audit_log` — 7-year retention; PII-bearing fields purged (nulled) before the partition falls out of the retention window; `metering_events` — per usage/cost retention policy; `notifications` / `notification_outbox` — per retention policy (archive then drop); `auth_sessions` — expiry sweeps become partition drops once adopted.
- Restore drills re-run post-restore retention for restored partitions (Section 5).

### 4.8 Required migration & integration tests

- **Migration tests** (ephemeral DB in CI): partitioned DDL valid; per-table assertions that the PK and every unique constraint include the partition key; FK-to-partitioned constraints include the partition key; advance-create and drop jobs work; isolation test suite covers each new partition (tenant-scoped RLS inherited, fail-closed cross-tenant) per §6 items 6/9.
- **Integration tests**: inserts route to the correct partition; business unique rules hold across partitions (e.g., duplicate `(attempt, question)` response rejected); dispatcher claim (`FOR UPDATE SKIP LOCKED`) works across partitions; retention partition-drop + post-restore drill; tenant-scoped queries remain correct with per-partition `tenant_id`-leading indexes (F22).

---

## 5. Tenant Deletion & Export Implications

- **Export** (Decision Log #5): queued `exports` jobs produce tenant-only packages (members, programs, content metadata, assessments and results, certificates, file manifests) with a 14-day lifetime; available through Grace Period; rate/quota-limited; audit-logged.
- **Deletion is staged and journaled**: `deletion_journal` tracks purge phases in dependency order — queue purge → child rows (responses, attempts, grades, submissions) → content/assessments → enrollments/attendance → memberships/roles → tenant-scope rows (settings, files, exports — purged; subscription rows retained as history) → **final closure conversion** (§5.1). Any failure aborts with alert; partial deletion never silent (fail-closed).
- **Soft vs hard**: reversible decisions soft-delete; hard-delete only in purge jobs (batched, throttled). The tenant root row itself is **never deleted** — it becomes the permanent Tenant Closure record (§5.1).
- **Storage**: tenant-prefixed objects removed via lifecycle/batch jobs; orphaned-object sweep scoped to the deleted tenant only.
- **Search index**: documents keyed by `tenant_id`; archived → excluded by state (retained, cheap reactivation); deleted → batch-removed; failures retry; consistency verified at end.
- **Queue**: no new jobs after leaving Active; pending/retrying jobs drained/cancelled at offboarding; tenant jobs purged **before** DB purge so workers never touch a deleted tenant.
- **Backups**: PITR/dumps may retain purged data until retention expiry — restore drills include post-restore purge re-running the deletion workflow (including the closure conversion, §5.1) for Deleted tenants.
- **Legal hold** (`legal_holds`) freezes retention/deletion for the held scope — the only override; an open hold blocks the final purge phase (§5.1).
- **Survivors**: the **Tenant Closure record** (the `institutions` row in terminal `deleted` state, §5.1) anchors all permanent records: `audit_log` and `deletion_journal` are never deleted with the tenant (audit retention 7y; PII-bearing fields purged); billing records (`invoices`, `payment_events`, `subscriptions` history) and `legal_holds` survive permanently (Decision Log #7; A.12).

### 5.1 Tenant Closure Record & Survivor Strategy

**Tenant Closure record (the retained identity).** The tenant root row is never physically deleted. In the final purge phase the `institutions` row is atomically **converted** into the permanent Tenant Closure record: all business and PII-bearing fields are stripped/nullified (name, branding-derived values, settings references), `status` is set to `deleted`, and `purged_at` + `closure_reason` are recorded. The row and its original `id` are retained forever. This is the "equivalent retained identity" that keeps survivor records permanently valid, and it is the opaque tenant reference required by the audit preservation rule (1.9, Decision Log #5).

**Retained identity contract.** After conversion the row exposes only: `id` (stable, never reused), `status = deleted`, `created_at`, `purged_at`, `closure_reason`. It carries no business data, never appears on tenant-facing paths, and cannot be used to reconstruct the institution.

**Exactly which tables reference the retained identity after deletion (survivors):**

| Table | Tenant FK | Why it survives |
|---|---|---|
| `subscriptions` (history rows) | `tenant_id` → closure record | Permanent billing history (Decision Log #7) |
| `invoices` | `tenant_id` → closure record | Permanent, immutable commercial record |
| `payment_events` | `tenant_id` → closure record | Permanent provider/audit evidence |
| `audit_log` | `tenant_id` (nullable) → closure record | Sole audit source of truth; 7y retention; PII purged |
| `deletion_journal` | `tenant_id` → closure record | Permanent trace of the deletion process |
| `legal_holds` | `tenant_id` → closure record | Permanent per A.12; must stay queryable under holds |

All other tenant-scoped tables are **non-survivors** — purged with the tenant, never referenced after closure (`files`, `exports`, `metering_events`, `usage_quota_meters`, `ai_interactions`, `roles`, `role_permissions`, `user_roles`, `memberships`, `enrollments`, `groups`, `teams`, `team_members`, `team_attempt_members`, `assessments`, `assessment_audiences`, `question_bank_items`, `assessment_questions`, `attempts`, `responses`, `grades`, `training_sessions`, `attendance_records`, `practical_labs`, `content_items`, `certificates`, `certificate_templates`, `notifications`, `notification_outbox`, `notification_preferences`, `notification_templates` (tenant overrides), `institution_settings`, `organization_units`, `invitations`, `api_keys`, `jobs` (drained/cancelled first)).

**FK strategy (referential integrity is never weakened).**

- Survivor FKs keep pointing at the tenant root id. Because the root row is retained as the closure record, every existing constraint remains satisfiable — **no repointing, no NULL-swizzling, no deferred-validation tricks**.
- The tenant root id is immutable and never reused.
- No `ON DELETE CASCADE` exists on the tenant root: deletion is exclusively the explicit, dependency-ordered purge-job work (G.6 journal), and the final phase is a **row conversion**, not a delete.
- After closure, survivor rows are append/read-only under the same platform privileges as before (billing append-only, audit append-only); writes to the closure record itself are platform-only and audit-logged.

**Tenant deletion workflow (final phase).**

1. **Preconditions:** exports completed or expired; queue drained/cancelled; no open legal hold (an open hold freezes the entire lifecycle — §5); grace period lapsed.
2. **Staged purge** per `deletion_journal` phases in dependency order (queue → children → content/assessments → enrollments/attendance → memberships/roles → tenant-scope rows). `subscriptions`/`invoices`/`payment_events` rows are retained as history during this phase; `audit_log` and `deletion_journal` entries are written throughout.
3. **Closure conversion (atomic, last phase):** strip PII/business fields, set `status = deleted`, record `purged_at` + `closure_reason`; the closure transition audit entry (actor, tenant, reason, timestamp, request id) is written in the same transaction (Decision Log #5).
4. **Post-closure:** platform-only reads; billing/audit queries resolve through the closure record; tenant-facing surfaces return "institution not found".

**Export interaction.** Self-service exports are available only through the Grace Period and are impossible after closure (all exportable data is purged). Billing/accounting data is never part of the tenant export scope; post-closure access to billing records is platform-privileged only and audit-logged.

**Legal-hold interaction.** An open legal hold blocks the final purge phase (freezing the lifecycle before conversion). After closure, a newly placed hold can still attach to the closure record and its survivor rows (billing, audit) — the retained identity keeps them queryable under the hold, and `legal_holds` rows referencing the closure record remain FK-valid.

**Restore behaviour.** Backups/PITR may contain pre-closure data. Restore drills must re-run the closure conversion for any tenant whose closure record exists — matching by the stable id, stripping any PII that returned with the backup, and keeping the same closure record (idempotent; a closed tenant is never revived, per Decision Log #5).

---

## 6. Migration Principles

1. **Versioned SQL migrations only**, committed to the repository, run in CI against ephemeral PostgreSQL and via the deploy step (F8 respected — tool choice and RLS-in-migrations remain OPEN items; this model assumes both).
2. **Backward-compatible expand-contract**: additive changes first (new columns/tables), cleanup in a later release — `main` stays deploy-safe at any commit (TECHNICAL_GUIDE §20); no tenant downtime during schema evolution.
3. **RLS policies are part of migrations** — never hand-applied; a CI check asserts staging/prod policy parity once tooling is chosen (F8).
4. **Sequential numbering**; concurrent PRs resolved by merge order; ephemeral-DB migration tests in CI.
5. **Tenant configuration is data, never code** — migrations never create per-tenant rows; tenant-specific state arrives through normal data paths.
6. **Every migration on tenant tables keeps the Tenant-Context Contract in mind**: new tenant-scoped tables must carry `tenant_id` + RLS + leading-`tenant_id` indexes from day one (isolation test suite verifies each new table).
7. **Partitioning and index changes** follow measured triggers (TECHNICAL_GUIDE §21/§22) — no speculative schema complexity.
8. **Audit/evidence tables** (`audit_log`, `grades`, `attempts`, `attendance_records`, `certificates`) are append/soft-change only — migrations never rewrite or delete their history.
9. **Partial unique indexes for mixed-ownership tables** (`roles`, `notification_templates`, `role_permissions` per-grant level): platform rows (`tenant_id` NULL) are protected by partial unique indexes scoped to NULL-tenant rows, while tenant rows keep their composite unique constraints (B.6, F.5). Both are part of migrations from day one and covered by the isolation test suite — no platform-row duplication, no cross-tenant duplicates.

---

## 7. Traceability to Review Findings (OPEN items honored)

- F1, F7, F9, F10, F11, F15, F16, F17 — **resolved**; this model implements their contracts (Tenant-Context Contract, sessions, outbox, billing tables, tenant lifecycle, privileged path, rate-limit counters, file quarantine).
- F2 (audit truth/tamper-evidence) — design follows "DB table as sole source of truth"; hash-chaining remains OPEN.
- F5 (plan flags vs rollout flags) — split as `feature_flag_definitions` (entitlements) vs rollout toggles (deployment, no schema).
- F22 (partitioning) — time partitions with per-partition tenant-leading indexes (Section 4).
- F38 (cursor pagination) — `(tenant_id, created_at, id)` cursor convention (Section 1.4).
- All other findings remain OPEN and out of scope for this document.

---

*Manara — Logical Database Model. Logical design only; SQL, migrations, and code are explicitly out of scope. Companion: PRODUCT_VISION.md, TECHNICAL_GUIDE.md, DOMAIN_MODEL.md, ARCHITECTURE_REVIEW.md.*
