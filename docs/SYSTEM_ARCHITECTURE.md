# Manara — System Architecture (Runtime)

> **Document status:** Draft — Active review
>
> **What this document is:** the **runtime** architecture of the Manara platform — the components that run in production, how requests, jobs, events, and files move through the system at runtime, and the failure, scaling, and security behaviour of those flows.
>
> **What this document is not:** it does not restate the product vision, the domain model, the database schema, or the decision rationale in full. It references them and describes their runtime behaviour.
>
> **Position in the documentation set:**
>
> | Document | Answers |
> |---|---|
> | `docs/PRODUCT_VISION.md` | What we build, and why |
> | `docs/TECHNICAL_GUIDE.md` | Which technologies and which decisions (ADR + Decision Log #1–#7) |
> | `docs/DOMAIN_MODEL.md` | The business domain and entities (Parts A–G) |
> | `docs/DATABASE_MODEL.md` | The logical schema, contracts, partitioning, and tenant lifecycle (Sections 1–7) |
> | **`docs/SYSTEM_ARCHITECTURE.md` (this document)** | **How the system behaves at runtime** |
>
> **Scope and scale assumption.** Manara is a multi-tenant Learning & Training SaaS platform (see `docs/PRODUCT_VISION.md`). The runtime architecture must support **hundreds of thousands of registered users** and **tens of thousands of concurrent users during exam waves**, with strict tenant isolation. No application code is generated from this document; it is a reference for architecture and planning.

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Architectural Principles](#2-architectural-principles)
3. [Runtime Components](#3-runtime-components)
4. [Module Boundaries & Runtime Responsibilities](#4-module-boundaries--runtime-responsibilities)
5. [Request Lifecycle](#5-request-lifecycle)
6. [Authentication & Session Flow](#6-authentication--session-flow)
7. [Authorization & Entitlement Flow](#7-authorization--entitlement-flow)
8. [Tenant Context Flow](#8-tenant-context-flow)
9. [Background Jobs & Workers](#9-background-jobs--workers)
10. [Notifications & Realtime Flow](#10-notifications--realtime-flow)
11. [Assessment Flow](#11-assessment-flow)
12. [Grading Flow](#12-grading-flow)
13. [File Upload & Storage Flow](#13-file-upload--storage-flow)
14. [AI Features Flow](#14-ai-features-flow)
15. [Certificate Generation Flow](#15-certificate-generation-flow)
16. [Audit Flow](#16-audit-flow)
17. [Event Flow: Outbox, Search Sync & Metering](#17-event-flow-outbox-search-sync--metering)
18. [Error Handling & Failure Semantics](#18-error-handling--failure-semantics)
19. [External Integrations](#19-external-integrations)
20. [Deployment Topology](#20-deployment-topology)
21. [Scaling & Performance Behaviour](#21-scaling--performance-behaviour)
22. [Security Boundaries & Trust Model](#22-security-boundaries--trust-model)
23. [Failure Recovery & DR Runtime](#23-failure-recovery--dr-runtime)
24. [Future Service Extraction](#24-future-service-extraction)

---

## 1. Overview & Purpose

Manara runs as a **TypeScript modular monolith** (TECHNICAL_GUIDE §1): one application containing clearly separated modules (Identity, Tenancy, Memberships, Programs, Content, Assessments, Certificates, Billing, ...), deployed as **stateless API instances** and a **separate worker tier**, sharing one **PostgreSQL** database (Supabase managed) and **S3-compatible object storage**.

At runtime the system is a set of concurrent flows:

- **Synchronous flows** — HTTP requests served by API instances: authentication, authorization, tenant-scoped CRUD, exam interaction, uploads.
- **Asynchronous flows** — background jobs executed by workers: grading, notifications, email, AI calls, certificates, exports, invoices, purge jobs, search index sync.
- **Realtime flows** — SSE connections pushing notifications to logged-in users.
- **Integration flows** — inbound webhooks (payments), provider calls (email, AI), and future MCP tool calls.

The single most important runtime property is **tenant isolation at every layer**, enforced by the mandatory Tenant-Context Contract (TECHNICAL_GUIDE §5) and the fail-closed philosophy described in §8 of this document.

All decisions this document depends on are logged in TECHNICAL_GUIDE §29 (Decision Log #1–#7); where a section references a decision, it assumes the reader knows it is a logged, non-negotiable decision.

---

## 2. Architectural Principles

These principles govern every runtime flow in this document:

1. **Modular monolith first.** One deployable application with hard module boundaries; extraction into services is possible through documented seams (§24), never a rewrite.
2. **Shared-schema, row-level multi-tenancy.** All tenants share one schema; isolation comes from `tenant_id` on every tenant-owned row, RLS as the database safety net, and application-layer context enforcement (DATABASE_MODEL §1.1, DOMAIN_MODEL Part A).
3. **Tenant context is never client-supplied.** The tenant is always derived from the authenticated session at runtime (§5, §8). No request body, header, or query parameter ever carries the tenant.
4. **Service layer first, RLS second.** Zod validation and authorization checks run in the service layer before any database access; RLS is the second line of defence, never the only one (TECHNICAL_GUIDE §7).
5. **Fail-closed, everywhere.** Missing tenant context aborts the operation. Rate-limit backend unavailability rejects with 503. Failed malware scans leave files quarantined. A partial tenant deletion alerts and stops. There is no silent fallback that widens access (TECHNICAL_GUIDE §5, §16).
6. **Heavy work never runs in the student's request path.** Grading, analytics, AI, email, and certificate generation are always queued (§9). The HTTP request only persists state and returns a confirmation.
7. **At-least-once everywhere → idempotent consumers.** Queues deliver at-least-once; every worker and webhook handler is idempotent by construction (deterministic ids, atomic claims, deduplication).
8. **Stateless instances.** Sessions live in PostgreSQL (later Redis, behind an interface), files in object storage, jobs in the queue — any API instance can serve any request.
9. **Provider-neutral interfaces.** Storage, email, queue, cache, search, AI, and payments sit behind narrow internal interfaces (TECHNICAL_GUIDE §28). A provider swap is a configuration + adapter change, never a rewrite.
10. **Measure first, then scale.** Cache, Redis, replicas, and partitioning are introduced only when the measured triggers defined in TECHNICAL_GUIDE (§6, §11, §16, §22) fire.
11. **Audit is data, not logs.** Sensitive operations write immutable Audit Log records in the same transaction as the action (§16). Structured logs (pino) are a separate, support-oriented stream.
12. **Defence in depth.** Rate limiting → authentication → authorization → service validation → RLS → audit, in that order, on every tenant-scoped path.

---

## 3. Runtime Components

```
                          ┌──────────────────────────────────────────────┐
                          │                  Clients                     │
                          │   Browser SPA (React/Vite) · APIs · MCP      │
                          └───────────────┬──────────────────────────────┘
                                          │ HTTPS
                          ┌───────────────▼──────────────────────────────┐
                          │  Edge / CDN                                  │
                          │  Static SPA · media (storage domain) · WAF*  │
                          └───────────────┬──────────────────────────────┘
                                          │ HTTPS
                          ┌───────────────▼──────────────────────────────┐
                          │  Application tier (stateless)                │
                          │  API instances  (NestJS/Fastify)             │
                          │   · REST /v1 · SSE endpoint · MCP servers    │
                          │  Worker instances (pg-boss workers)          │
                          │   · grading · notifications · email · AI     │
                          │   · certificates · exports · purge · scan    │
                          └───────┬──────────────────┬───────────────────┘
                                  │ tenant pool      │ privileged pool (isolated)
                       ┌──────────▼──────────┐ ┌─────▼─────────────────────┐
                       │ PostgreSQL (primary)│ │ (same PostgreSQL,          │
                       │ Supabase managed    │ │  dedicated privileged role)│
                       │ pooler: transaction │ └───────────────────────────┘
                       │ mode only           │
                       └───────┬──────────────┘
                               │              ┌────────────────────────────┐
                               │              │ Object storage (S3-compat) │
                               │              │ quarantine · published     │
                               │              │ exports · backups          │
                               │              └────────────────────────────┘
                               │  External providers (behind interfaces):
                               │  Email (Resend→SES) · AI (LiteLLM→Claude)
                               │  Payment provider · Search (PG FTS→Meili)
                               └── Observability: pino→Axiom · Sentry ·
                                   OTel (Phase 2) · rate-limit counters (PG→Redis)
```

| Component | Runtime role | Notes |
|---|---|---|
| **Frontend SPA** | React 19 + Vite static build served from CDN/static host; TanStack Query for server state; per-tenant theming via runtime CSS variables (TECHNICAL_GUIDE §2) | Never renders uploaded files inline from the app domain (§22) |
| **API instances** | Serve REST `/v1`, the authenticated SSE endpoint, webhook ingestion, and MCP servers; stateless; one container image | NestJS on Fastify; OpenAPI 3.1 generated (TECHNICAL_GUIDE §3–4) |
| **Worker instances** | Execute pg-boss jobs (Phase 1): notifications dispatch, email, grading, AI, certificates, exports, invoices, purge, malware scans, search sync, metering | Second container image; scales independently (§9, §21) |
| **PostgreSQL** | Single source of truth; sessions, outbox, audit, jobs (pg-boss), partitioned hot tables (DATABASE_MODEL §4) | Tenant traffic only via transaction-mode pooler; privileged pool separate (§8) |
| **Object storage** | Quarantine + published prefixes per tenant, exports, invoices, backups; presigned URLs; dedicated storage/CDN domain (TECHNICAL_GUIDE §9, §16) | S3-compatible (R2 recommended); never served from the app domain |
| **Queue** | pg-boss inside PostgreSQL now; BullMQ + Redis when measured (TECHNICAL_GUIDE §12) | Every job carries `tenant_id`; at-least-once delivery |
| **Realtime** | SSE over HTTP/2 on API instances; per-instance connection registry; PostgreSQL LISTEN/NOTIFY change signal (Phase 1) → Redis pub/sub later (TECHNICAL_GUIDE §10, Decision Log #6) | Event-id resume is the correctness guarantee |
| **Rate limiter** | Shared backend: PostgreSQL window counters (Phase 1) → Redis (Phase 2); never in-memory (TECHNICAL_GUIDE §16, Decision Log #3) | Fail-closed → 503 on backend outage |
| **Search** | PostgreSQL FTS (Phase 1) → Meilisearch (Phase 2); documents carry `tenant_id` (TECHNICAL_GUIDE §13) | Sync via queue workers |
| **Logging / monitoring** | pino structured JSON → Axiom; Sentry error tracking; uptime checks; OTel → Grafana/Prometheus in Phase 2 (TECHNICAL_GUIDE §14–15) | Mandatory fields: `tenant_id`, `request_id`, `user_id`, `timestamp` |
| **MCP servers** | Admin/ops MCP server exposing platform tools (tenant management, support, audit search); future content-authoring server (TECHNICAL_GUIDE §25) | Every tool call carries tenant context and is audit-logged |

---

## 4. Module Boundaries & Runtime Responsibilities

Modules mirror PRODUCT_VISION §21 and DOMAIN_MODEL Parts A–G. At runtime each module is a NestJS module with its own services, validation, and database access; modules communicate only through their public services or via the outbox/queue (§9, §17) — never through shared mutable state.

| Module | Runtime responsibilities | Persistence (DATABASE_MODEL part) |
|---|---|---|
| **Identity** | User accounts, profile, one global identity; never tenant-scoped decisions | Part B |
| **Authentication / Sessions** | Argon2id verification, session create/validate/rotate/revoke, cookies, MFA later (§6) | Part B (§3.1) |
| **Tenancy** | Tenant lifecycle state machine, closure record, export, entitlements source | Part A |
| **Memberships** | Memberships, role assignments (`user_roles`), tenant context resolution (§8) | Part A/B |
| **Invitations** | Invite creation, email via notifications, accept/join flows (DOMAIN_MODEL §3.5) | Part B |
| **Authorization** | Central permission engine: RBAC + ABAC, deny-by-default, entitlement input (§7) | Part B (§3.2) |
| **Entitlements** | Plan + feature flags + quotas evaluation; cached tenant-namespaced; immediate re-evaluation on change | Part A (§3.3) |
| **Audit** | Append-only Audit Log; every sensitive operation writes in the same transaction (§16) | Part G (§3.8) |
| **Notifications** | Outbox producer, preferences, templates, dispatcher, retry/DLQ, SSE delivery (§10) | Part F (§3.7) |
| **Learning Programs** | Programs, org units, sections/groups, enrolment, delivery metadata | Part C |
| **Enrolments** | Enrollment lifecycle, join methods, section/group membership | Part C |
| **Content** | ContentNode tree (recursive), resources, file references, ordering (DOMAIN_MODEL Part C) | Part C |
| **Assessments** | Assessment lifecycle, questions, attempts, responses, anti-spam (§11) | Part D (§3.5) |
| **Practical Labs** | Lab definitions, level-1 (external link + report) now; level-2 API integration later (PRODUCT_VISION §12) | Part C |
| **Certificates** | Condition evaluation, PDF generation, issuance records (§15) | Part E |
| **Reports** | Aggregations and analytics; heavy queries on workers or replicas, never in the student request | Part E |
| **Billing** | Plans-as-data, subscriptions, quotas, metering, invoices, payment abstraction, webhooks (Decision Log #7) | Part A |
| **File Management** | Upload authorization, quarantine state, scan coordination, presigned URLs, publication (§13) | Part F (§3.9) |

Cross-module rules at runtime:

- A module never reads another module's tables directly; it calls its public service or subscribes to its outbox events (§17).
- Background jobs belong to the module that owns the domain but execute on the shared worker tier (§9).
- Every module's tenant-scoped queries go through the Tenant-Context Contract (§8).

---

## 5. Request Lifecycle

A tenant-scoped HTTP request passes through the following stages in order:

1. **Edge.** CDN/static assets; API requests pass through to instances (WAF/DDoS at edge is added at production launch, TECHNICAL_GUIDE §16). The app domain serves only HTML/JS/API; files are never served here (§13).
2. **Rate limiting (before expensive work).** The shared rate-limit backend is checked per scope (auth / tenant API / upload / AI / admin / exam endpoints) — always before password hashing and before service logic (TECHNICAL_GUIDE §16, Decision Log #3). If the backend is unavailable the request fails closed with **503**.
3. **Session resolution.** The HttpOnly cookie is read; the opaque session id is looked up in the session store and re-validated (absolute 24h / idle 30m defaults, §6). Failure → 401. Success → `user_id` bound to the request.
4. **Tenant context resolution.** The active membership for (user, requested tenant scope) is resolved from `memberships`/`user_roles`; the tenant id is stored in the request context (AsyncLocalStorage) (§8). The client never supplies the tenant.
5. **Authorization.** Guards evaluate the permission for (role, scope, resource, action) plus ABAC attributes — feature flags, plan entitlements, quotas, tenant/program/user status (§7). Deny-by-default; failure → 403.
6. **Validation.** NestJS pipes + shared Zod schemas validate the body/query against the OpenAPI contract; malformed → 400. The tenant id is never accepted in payloads (TECHNICAL_GUIDE §4).
7. **Service layer.** Business rules, quota checks (entitlements module, atomic with the action), and idempotency handling run here — before any database access.
8. **Database transaction (Tenant-Context Contract).** The service opens an explicit transaction, sets `app.tenant_id` transaction-locally **before the first tenant-scoped query**, executes the queries (RLS filters at the database), writes outbox/audit rows in the same transaction when required, and commits. Autocommit is forbidden for tenant-scoped operations (§8).
9. **Response.** Serialized DTO (only needed fields), cursor pagination for lists, UTF-8 JSON. Errors follow the taxonomy in §18.

Request context propagation: `request_id`, `user_id`, `tenant_id`, and `session_id` are propagated via AsyncLocalStorage and attached to every log line, audit entry, outbox row, and queued job (TECHNICAL_GUIDE §14).

---

## 6. Authentication & Session Flow

Authentication proves *who* you are; authorization decides *what* you may access (TECHNICAL_GUIDE §6). Sessions are tenant-agnostic — tenancy lives in memberships.

**Login flow:**

1. Rate limit: 5 attempts / 10 min per (account + IP); checked before hashing.
2. Verify credentials with **Argon2id**; failed attempts are counted per account+IP; account lockout on sustained failure.
3. On success, create a fresh opaque session row in the session store (PostgreSQL, behind a provider-neutral interface — Redis later, per the measured trigger in TECHNICAL_GUIDE §6).
4. **Rotate:** any prior session for the user is destroyed (no session fixation); a new session id is issued.
5. Set the transport cookie: `HttpOnly`, `Secure`, `SameSite`, plus CSRF protection where required (TECHNICAL_GUIDE §6).
6. Audit the login (actor, timestamp, request id).

**Session lifecycle (Decision Log #1, non-negotiable):**

- **Absolute expiry:** 24h default (configurable, platform setting — not code).
- **Idle timeout:** 30m default; activity refreshes `last_active`.
- **Rotation on privilege change:** roles/memberships/entitlements change → new session id issued; authorization is re-evaluated per request, so the change applies immediately.
- **Revocation on password reset:** all sessions for the user are deleted; the user must re-authenticate.
- **Revocation is exact:** deleting a session row takes effect on the next request. No JWTs for browser authentication, ever; JWTs are reserved for explicitly designed machine-to-machine access (TECHNICAL_GUIDE §4, §6).

**Other flows:**

- **Logout:** delete the session row (exact, immediate).
- **Forgot password:** rate limit 3 / hour per account; short-lived email token via queued email; password reset revokes all sessions and rotates.
- **Registration:** per-IP rate limits; invites/join codes per DOMAIN_MODEL §3.5.
- **MFA (TOTP) and passkeys:** later phases (TECHNICAL_GUIDE §6).
- **SSO/SAML/SCIM:** later identity-federation layer for enterprise tenants; never replaces the internal membership model.

Runtime guarantee: session validation happens on every request against the store; there is no cached trust beyond the store row.

---

## 7. Authorization & Entitlement Flow

Authorization is **RBAC + ABAC hybrid**, evaluated by a central permission engine (TECHNICAL_GUIDE §7), deny-by-default, on every endpoint and every MCP tool call.

**Evaluation inputs (all resolved from request context, never from the client):**

1. **Roles** from `user_roles` for the current tenant scope, with explicit scope columns (tenant, org unit, program, group) — DOMAIN_MODEL §3.1.
2. **Resource + action** — the endpoint and object being accessed.
3. **ABAC attributes:**
   - Feature flags from the tenant's plan (AI Question Generator, Online Exams, Certificates, ... — PRODUCT_VISION §21, DATABASE_MODEL §3.3).
   - Entitlements and quota state (plan limits; over-quota states block new usage).
   - Status: tenant state (Active/Suspended/Archived — §17), program/assessment state, user status.

**Flow per request:**

1. Permission query for (user, tenant, resource, action) against the central engine.
2. Entitlement lookup (cached with tenant-namespaced keys, invalidated on plan/flag change; session rotated on privilege change).
3. Attribute checks (flags, quotas, statuses).
4. Decision: **allow** → proceed to service layer; **deny** → 403. No admin bypass shortcuts; even Super Admin passes explicit checks on the privileged path (§8).

**Runtime guarantees:**

- Horizontal (privilege) and vertical (cross-tenant) escalation are both blocked by scope columns and deny-by-default.
- Service-layer checks are the primary defence; RLS is the safety net; the CI isolation suite proves they do not drift apart (TECHNICAL_GUIDE §7, §16).
- Permission resolutions may be cached with tenant-aware keys when profiling demands; a cache never overrides a deny.

---

## 8. Tenant Context Flow

This is the runtime heart of multi-tenancy. The **Tenant-Context Contract** (TECHNICAL_GUIDE §5) is mandatory for every process that executes tenant-scoped queries: API instances, workers, MCP servers, future services.

**Resolution (per request/job):**

1. Tenant is derived from the authenticated session + membership, stored in AsyncLocalStorage for the duration of the request.
2. A NestJS guard enforces that a tenant context exists before any tenant-scoped service runs; missing context → abort + alert (fail-closed).

**Database application (mandatory mechanics):**

- **Transaction-mode pooling only** for all tenant-scoped traffic. Session-mode pooling is rejected — a reused physical connection could leak a previous tenant's `app.tenant_id` into the next request.
- Every tenant-scoped operation runs inside an explicit transaction: `BEGIN` → `SELECT set_config('app.tenant_id', $tenant, true)` **before the first tenant-scoped query of that transaction** → queries → `COMMIT`/`ROLLBACK`. Autocommit for tenant-scoped queries is a defect.
- RLS policies read `current_setting('app.tenant_id')`; with the setting missing the comparison is NULL → false → **zero rows** (database fails closed). Both layers are required: the application guard and the database behaviour.
- Missing tenant context is always treated as an incident, never a silent path.

**Workers and MCP:** each background job opens its own transaction and sets its own tenant context before executing (§9); every MCP tool call resolves and applies tenant context identically (TECHNICAL_GUIDE §25).

**The privileged path (Super Admin Access Model, Decision Log #2):** platform-level operations (Super Admin, Support Admin, Billing Admin, Security Auditor) run on a **dedicated privileged database role and connection pool**, fully isolated from the tenant pool. Rules at runtime:

- Normal traffic never uses the privileged path; a normal code path touching it is a defect.
- Cross-tenant access is denied by default; each operation is explicitly authorized for (operation, target tenant) — no "access everything" default.
- Every cross-tenant action writes an audit entry with actor, target tenant, action, **reason**, timestamp, and request id. An audit entry without a reason is a defect.
- Privileged access never relies on a missing `tenant_id` (fail-closed); privileged operations state their target tenant explicitly.
- Break-glass (emergency) access requires a recorded reason, is time-boxed, session-rotated after use, audit-logged, and reviewed at the next security review.

---

## 9. Background Jobs & Workers

**Queue runtime:** pg-boss on PostgreSQL (Phase 1) — zero new infrastructure, job semantics (retry, delay, schedule) with the existing database. BullMQ + Redis replaces it when measured throughput demands (TECHNICAL_GUIDE §12). Until then no Redis is deployed for the queue.

**Non-negotiable rules:**

- Every job carries `tenant_id` explicitly (schema-validated); workers enforce the same authorization and Tenant-Context Contract as the API.
- Grading, analytics, AI, email, certificates, exports, and purges **never** run inside an HTTP request — they are always queued.
- At-least-once delivery: every handler is idempotent (deterministic job ids; state transitions are guarded so double execution is a no-op).

**Job catalog (initial):**

| Job family | Trigger | Notes |
|---|---|---|
| Notification/email dispatch | Outbox rows (§10, §17) | Atomic claim (`FOR UPDATE SKIP LOCKED`); per-channel retries |
| Grading | Assessment submission (§12) | Auto-grading + manual review workflow |
| AI requests | AI features (§14) | Quota + metering, PII stripping, provider-neutral |
| Certificate generation | Condition evaluation events (§15) | PDF render, storage write, notification |
| File malware scan | Upload (§13) | Fail-closed: no publication without positive verdict |
| Search index sync | Domain events (§17) | PG FTS now; Meilisearch later; retries on failure |
| Tenant export | Tenant request | Tenant-scoped export package, 14d bounded lifetime (Decision Log #5) |
| Tenant purge | Deletion workflow (§17, §23) | Staged, feature-by-feature, deletion journal, batched/throttled |
| Invoice / dunning | Billing lifecycle (Decision Log #7) | Payment grace 7d; suspension grace 30d |
| Webhook processing | Payment provider (§19) | Signature verify → dedup → process |
| Metering rollup | Scheduled | Quota consumption, cost attribution (§17) |

**Runtime behaviour:**

- Priorities: urgent/assessment-critical jobs (grading, exam notifications) take precedence; dedicated worker pools during exam waves (TECHNICAL_GUIDE §12, §22).
- Bounded retries with exponential backoff; non-transient failures → dead-letter queue with reason; admins inspect/re-enqueue/discard via the privileged path (§16, §18).
- No new jobs are enqueued for a tenant once it leaves Active; on deletion, remaining jobs are purged **before** the DB purge so workers never touch a deleted tenant (Decision Log #5).
- Workers scale independently from API instances — the primary lever for exam-wave bursts (§21).

---

## 10. Notifications & Realtime Flow

Notifications follow the architecture logged as Decision Log #6 (TECHNICAL_GUIDE §10). Runtime pipeline: **produce → persist → deliver per preferences → track state → retry / dead-letter**.

**Production (synchronous, atomic):**

1. Any module produces a notification (category, priority, recipient, payload, template).
2. A **notification row and an outbox row are written in the same database transaction** as the triggering business action.
3. Guarantee: no business action commits without its notification being recorded; no notification is delivered without its business action committing (at-least-once).

**Dispatch (async, worker):**

1. The dispatcher claims outbox rows atomically (`SELECT ... FOR UPDATE SKIP LOCKED`); duplicate dispatch is impossible.
2. Preferences are applied **at dispatch time** (channel filtering per user preferences, per channel and category; Urgent may bypass digest but never hard opt-outs).
3. Templates render with tenant branding; rendering is tenant-isolated — a template context can never contain another tenant's data.
4. Channel delivery: in-app (persisted history + realtime push), email (queued via the mailer), future push/SMS behind the same channel interface.
5. Retries: bounded, exponential backoff — initial default 5 attempts (1m, 5m, 15m, 1h, 6h) for transient failures; non-transient failures go straight to the DLQ. Retry state lives in the notification/outbox records.

**Realtime delivery (SSE, final decision):**

- Transport: **SSE over HTTP/2**, one-way server→client (the dominant direction for notifications), automatic reconnection with **event-id resume**, proxy/CDN-friendly. WebSocket is deferred and reserved only for future interactive features (live sessions, proctoring) — a separate decision.
- The SSE endpoint is authenticated; the connection is authorized for a single tenant context; only the connected user's notifications in that context are pushed; cross-tenant push is impossible by construction.
- Change signal: notification+outbox are persisted in the DB; instances keep a per-instance registry of local connections; Phase 1 signals outbox inserts via **PostgreSQL LISTEN/NOTIFY** (no new infrastructure), then deliver to local connections. Missed signals are recovered by event-id resume from persisted history. When Redis arrives, the signal moves to Redis pub/sub — a provider swap, not a redesign.
- Future scaling: dedicated realtime tier instances serving SSE only; resume stays the correctness guarantee across instance churn.

**Monitoring:** produced vs delivered per category/priority/channel; delivery latency p95/p99; outbox backlog depth and age; DLQ depth; connection churn and resume success; alerts on backlog growth and latency breaches (TECHNICAL_GUIDE §10).

---

## 11. Assessment Flow

Assessments unify Exam / Quiz / Assignment (DOMAIN_MODEL §3.3, DATABASE_MODEL Part D). Runtime lifecycle:

1. **Create & publish.** Authoring (with optional AI question generation, §14) → publish → assessment becomes available to its audience (sections/groups/users).
2. **Start attempt.** The student requests an attempt; anti-spam rate limits apply (exam start/submission per user+attempt); exactly **one active attempt per (assessment, enrollment)** — for team assessments, per team (DATABASE_MODEL §3.5).
3. **Incremental saving.** Responses are persisted as the student progresses; the attempt is resumable; responses carry `tenant_id` and are stored in partitioned tables (DATABASE_MODEL §4).
4. **Submit.** Final submission closes the attempt; submissions for assignments create a Submission record; team submissions record the submitter enrollment and freeze the **team_attempt_members snapshot** (who was in the team at submission) — immutable at submission (DATABASE_MODEL D.5).
5. **Post-submit:** a **queued grading job** is created (§12). The student's request returns immediately; nothing heavy runs in it.
6. **Results publication.** Grades are published per policy; notifications and audit entries are produced through the outbox (§10, §16).
7. **Analytics.** Aggregations run as queued/report workloads, never on the student path.

**Team assessments (runtime specifics):** one shared attempt per team; grades are stored **per member** — one grade per (attempt, enrollment) — and members' scores may differ and are individually appealable (DATABASE_MODEL D.5, D.7).

**Integrity at runtime:** attempt state transitions are guarded (an attempt cannot be submitted twice; a published result cannot be silently overwritten); all transitions are audit-logged.

---

## 12. Grading Flow

Grading is a **background-only** workload (project rule; TECHNICAL_GUIDE §12). It never executes inside the student's HTTP request.

**Auto-grading (objective questions):**

1. Submission event → queue job with `tenant_id`, attempt id, response references.
2. Worker opens a transaction, sets tenant context, loads responses + key, computes per-question and total scores.
3. Grades are written atomically; one grade row per (attempt, enrollment) for team attempts; the attempt transitions to graded.
4. Idempotency: re-execution of the job is a no-op (guarded transitions, deterministic results).

**Manual grading (essays, assignments, labs, supervisor reviews):**

1. Submission creates pending-review work visible to the teacher/evaluator within the tenant.
2. Teacher review writes grades/feedback through the API; the same transaction writes outbox rows for result notifications and audit.
3. Where the platform later adds AI-assisted grading (§14), it will be an additional queued step producing suggestions for the teacher — never an autonomous grade.

**Grade publication & appeals:**

- Publishing a result fires notifications (per preferences) and audit records; an appeal (individual, per grade row) follows a guarded review flow with its own audit trail.

**Wave behaviour:** during exam waves the grading queue is the bottleneck risk; dedicated worker pools + priority queues absorb the burst (§9, §21). Load testing simulates thousands of concurrent submissions before every wave (TECHNICAL_GUIDE §21).

---

## 13. File Upload & Storage Flow

Every upload follows the File Upload Security Architecture (Decision Log #4; TECHNICAL_GUIDE §16). All uploads are untrusted.

**Upload path (client → storage, API stays out of the data path):**

1. **Authorization & quota:** the API validates the upload (tenant, user, plan quotas — size/count limits, rate limits) and issues a **tenant-scoped presigned upload URL** into the tenant's **quarantine prefix**.
2. **Upload:** the client uploads directly to object storage; the file record is created with state `quarantined` (DATABASE_MODEL §3.9). Quarantined files are **not referenced by any endpoint and never servable**.
3. **Validation & scan (queued):** a worker validates **magic bytes** (content inspection, never extension/client MIME alone) and runs **malware scanning**. Inconclusive, failed, or unavailable scans leave the file quarantined — **fail-closed** (scanner outage blocks publication and alerts).
4. **Publish:** only a clean file transitions to `published` (database state + storage flag/move to the published prefix). Publication is audit-logged (uploader, tenant, file id, type, size, verdict, timestamp).
5. **Access:** downloads via **tenant-scoped presigned URLs** from the **dedicated storage/CDN domain** — never the app domain. File responses carry `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` where inline rendering is not required; inline rendering only for safe, validated media (images/video), never HTML/SVG or active content. The app's CSP never includes the storage domain in `script-src`/`style-src`.

**Limits (initial defaults):** images 10 MB; documents 50 MB; video 500 MB; rejected outright: EXE, DLL, SCR, BAT, CMD, PS1, JAR, MSI, APK, scripts, binaries, and macro-enabled office formats (DOCM/XLSM/PPTM) — regardless of extension or claimed MIME.

**Isolation at runtime:** every file record carries `tenant_id` and owner; files live under tenant-scoped prefixes; presigned URLs are scoped to the owning tenant's prefix; tenant A cannot reference or download tenant B's file by any path, including presigned URLs. Cross-tenant file access attempts are part of the CI isolation suite.

**Lifecycle:** files are deleted by the tenant purge workflow (lifecycle policies or batch delete jobs); an orphaned-object sweep touches only deleted tenants (Decision Log #5).

---

## 14. AI Features Flow

AI features (AI question generator, AI course builder, PDF summarization, later AI grading assistance) run as **queued jobs only** — never in the request path (TECHNICAL_GUIDE §26).

**Runtime flow:**

1. **Entitlement check:** the feature is gated by the tenant's feature flag + monthly AI quota (plan-based). A request without entitlement is rejected before any provider call.
2. **Quota reservation + metering:** the monthly quota is checked and the call is metered per tenant (metered events carry `tenant_id`; written by the platform metering pipeline, never by tenant code).
3. **Job creation:** the AI job is queued with `tenant_id`, prompt payload (PII stripped), and attribution context.
4. **Worker execution:** the worker calls the provider through the **LiteLLM gateway** (provider-agnostic; Anthropic Claude primary). Output is persisted tenant-scoped; prompts and outputs are never shared between tenants; no model training on tenant data (provider terms verified; all prompt payloads treated as PII-class).
5. **Result delivery:** a notification (outbox) informs the user; results are surfaced in-app per module (e.g., draft questions into the assessment authoring flow for teacher approval).
6. **Audit + cost attribution:** every AI call is audit-logged and attributed per tenant for cost reports and quota consumption (TECHNICAL_GUIDE §27).

**Runtime protections:**

- **Cost runaway:** per-tenant monthly quotas + per-user burst rate limits + queued batching (TECHNICAL_GUIDE §16, §26). Quota exhaustion → clear error, no silent fallback.
- **Prompt injection:** AI outputs never execute actions; tool calls from AI go through the MCP security model with tenant context and audit (§19).
- **Latency:** the requesting user never waits on the provider; heavy work is queued.
- **Provider switch:** the gateway makes a provider swap a configuration change; routing by cost/quality comes later.

---

## 15. Certificate Generation Flow

Certificates (attendance, completion, success, skill pass, practical training, professional program — PRODUCT_VISION §20) are condition-driven (DOMAIN_MODEL §3.4).

**Runtime flow:**

1. **Condition evaluation (queued):** when relevant state changes (content completion, attendance threshold, exam pass, project/lab completion, supervisor approval), a worker evaluates the certificate conditions for the enrollment.
2. **Issuance:** when all conditions hold, the certificate record is created (tenant-scoped, unique per definition/enrolment), the PDF is rendered and stored in tenant-scoped storage, and a notification is queued.
3. **Access:** certificates are tenant-scoped files; retrieval uses the file access path (§13); `Content-Disposition: attachment` applies (PDFs are not inline-rendered on the app domain).
4. **Revocation/verification:** revocation of a condition (e.g., grade appeal overturns a pass) marks the certificate revoked with an audit trail; public verification codes are a later feature (DOMAIN_MODEL Part E).

**Guarantees:** issuance is idempotent (a re-run of the evaluation does not duplicate certificates); every issuance/revocation is audit-logged; certificates survive tenant archive but are purged with the tenant under the deletion workflow unless under legal hold.

---

## 16. Audit Flow

Audit records are **data, not logs** — append-only rows written **in the same transaction** as the audited action (DATABASE_MODEL §1.9, §3.8). Structured logs (pino) are a separate stream for support and debugging; they are not the audit of record.

**What is audited (minimum):** authentication events, role/membership/entitlement changes, content & assessment lifecycle transitions, grade publications and appeals, file upload/scan/publication decisions, notifications production and delivery, billing events (plan changes, invoices, payments, refunds, webhooks, suspensions, trial conversions), tenant lifecycle transitions, every privileged/cross-tenant action, every break-glass usage, every MCP call.

**Record anatomy:** actor, target tenant, action, reason (required on the privileged path), timestamp, request id — plus event-specific fields. Missing reason on a privileged action is a defect.

**Runtime properties:**

- **Immutable:** rows are never updated or deleted by application code; corrections are new records (supersede semantics).
- **Partitioned:** audit log is a day-one partitioned table (DATABASE_MODEL §4); retention 7 years default; pre-drop PII purge per policy before partitions are dropped.
- **Survivor of tenant deletion:** audit records and the deletion journal are **never deleted with the tenant**; after closure, the tenant reference remains an opaque identifier with PII-bearing fields purged per policy (DATABASE_MODEL §5.1, Decision Log #5).
- **Queries:** tenant admins audit their own scope; platform admins audit any tenant **through the privileged path only** (Decision Log #2).
- **Feeders:** audit entries feed security reviews, break-glass review, and compliance (7-year retention).

---

## 17. Event Flow: Outbox, Search Sync & Metering

**The outbox is the platform's event bus.** Any business action that must trigger follow-up work (notifications, search re-index, metering, billing, exports) writes an outbox row in the same transaction as the action. Consumers run as workers with atomic claims, deterministic event ids, and idempotent handlers (Decision Log #6; TECHNICAL_GUIDE §10, §12).

**Consumers at runtime:**

| Event | Consumer |
|---|---|
| Notification/outbox rows | Notification dispatcher (§10) |
| Content/assessment changes | Search index sync (§17 below) |
| AI requests, API calls, storage, email volume | Metering pipeline (below) |
| Grade published | Notifications, reports |
| Certificate conditions met | Certificate worker (§15) |
| Tenant lifecycle transitions | Purge scheduler, offboarding workflow, billing (Decision Log #7) |

**Search sync:**

- Phase 1: PostgreSQL FTS (`tsvector` + GIN) — the runtime index for course/program/content search.
- Phase 2: Meilisearch when relevance/typo-tolerance/faceting demand it (TECHNICAL_GUIDE §13).
- Every indexed document carries `tenant_id`; every query filters by tenant context; cross-tenant results are impossible by construction.
- Index lag is handled by queue retries; on Archive, results are excluded by tenant state (documents retained — cheap reactivation); on Delete, documents are batch-removed keyed on `tenant_id` as part of the deletion workflow.

**Metering pipeline:**

- Metered events (AI requests, API calls, storage, email volume) are recorded per tenant with attribution, through the platform pipeline only — tenant code never writes metering rows directly.
- Metering feeds quota enforcement (checked before operations, updated atomically with the business action) and cost attribution (per-tenant cost reports, TECHNICAL_GUIDE §27).
- Metering events live in a day-one partitioned table (DATABASE_MODEL §4) with scheduled rollups and retention.

**Billing events at runtime:** invoice generation, payment success/failure, dunning escalations, trial expiry/conversion (explicit consent — never a silent auto-charge), upgrade (immediate, prorated) / downgrade (period end, over-quota = block new usage, no data deletion) all flow through the outbox + workers and are audit-logged (Decision Log #7).

**Tenant lifecycle events at runtime:** Draft → Active → Suspended → Grace → Archived → Deleted. Transitions are guarded state changes; export (14d bounded window) and purge (90d deletion window; archive window 1y) run as queued workflows; legal hold freezes retention/deletion timelines; post-restore purge re-runs the deletion workflow for Deleted tenants on restored data (§23).

---

## 18. Error Handling & Failure Semantics

**Error taxonomy (API):**

| Error class | HTTP | Runtime meaning |
|---|---|---|
| Validation | 400 | Zod/DTO rejection before service logic |
| Unauthenticated | 401 | Missing/invalid/expired session |
| Unauthorized | 403 | Permission engine deny (deny-by-default) |
| Not found | 404 | Resource absent or not in the tenant scope (indistinguishable by design) |
| Quota exceeded / rate limited | 429 | Plan quota or rate-limit rejection (tenant/user scoped) |
| Fail-closed | 503 | Rate-limit backend, scanner, or required provider unavailable |
| Idempotency | 200/409 | Duplicate request detected and handled (no-op or state conflict) |

**Transaction semantics:**

- Every tenant-scoped operation is one explicit transaction; any failure rolls back completely — including outbox and audit rows (§8, §10, §16).
- A business action commits only with its notifications (outbox) and audit records committed.

**Asynchronous failure handling:**

- Transient failures → bounded retries with exponential backoff (notification default: 1m, 5m, 15m, 1h, 6h); non-transient → dead-letter with reason; DLQ depth is monitored and alerted.
- Poison jobs are isolated; one tenant's failing jobs never block other tenants (tenant-scoped jobs, per-job isolation).
- Idempotent handlers tolerate re-delivery (at-least-once queue semantics).

**Fail-closed rules (non-negotiable):**

- Missing `app.tenant_id` → abort + alert (application) and zero rows (RLS) — §8.
- Rate-limit backend down → 503, never allow-through.
- Scanner down/inconclusive → file stays quarantined; publication is a defect.
- Partial tenant deletion → abort with alert; never left silently inconsistent (deletion journal, Decision Log #5).
- Webhook unverifiable → rejected (never processed).

**Observability of failures:** every error carries `request_id` and `tenant_id` in logs; Sentry tracks exceptions; alerts fire on rate-limit backend failure, rejection anomalies, outbox/DLQ growth, and scanner unavailability (TECHNICAL_GUIDE §15).

---

## 19. External Integrations

All providers sit behind narrow internal interfaces (TECHNICAL_GUIDE §9–13, §26, §28); runtime behaviour is governed by the provider-neutrality principle.

| Integration | Runtime contract |
|---|---|
| **Payment provider** | Narrow interface (create session, charge, refund, webhook ingestion, status). Webhooks: signed endpoint → **verify signature → deduplicate by provider event id → queue processing → atomic state update → audit**. Unverifiable/unknown webhooks rejected. Provider decision is deferred and logged when adopted (Decision Log #7). |
| **Email provider** | Mailer abstraction (Resend at startup; SES at volume). All sends queued, tenant-branded, SPF/DKIM/DMARC on the custom domain; suppression lists per tenant; never in the request path (TECHNICAL_GUIDE §10). |
| **AI provider** | LiteLLM gateway → Anthropic Claude (primary). Per-tenant quotas, metering, PII stripping, queued execution (§14). |
| **Object storage** | S3-compatible interface (R2 recommended); presigned URLs; quarantine/published prefixes; dedicated storage domain (§13). |
| **Search** | PG FTS now; Meilisearch later — behind an internal search interface (TECHNICAL_GUIDE §13). |
| **MCP servers** | Internal admin/ops MCP server: tenant management, support queries, audit search. Every tool call: authN, full authorization, **tenant context**, and audit (which agent, which tool, which tenant). Prompt injection mitigation: AI outputs never auto-execute actions (TECHNICAL_GUIDE §25, §26). Future: content-authoring MCP server, tenant-side agent access as premium feature. |
| **Lab integrations** | Level 1 (external link + report upload) at launch; Level 2 (institution API provisioning) later behind an integration interface (PRODUCT_VISION §12). |
| **Outbound webhooks** | Future tenant-facing webhooks (API Access plan feature) — signed, idempotent, queued (TECHNICAL_GUIDE §4). |

Runtime rules for all integrations: timeouts and circuit breaking on provider calls; providers never receive tenant-scoped secrets; every integration failure is observable (Sentry + metrics) and retried per policy; no platform business logic depends on a provider's specifics.

---

## 20. Deployment Topology

**Environments:** development, **staging** (auto-deployed from `main`, ephemeral DB for CI; staging data privacy defined per ARCHITECTURE_REVIEW F27), **production** (release tag + approval) (TECHNICAL_GUIDE §17–20).

**Artifacts:** two container images (API, workers) from one monorepo; static SPA build deployed to Vercel or Cloudflare Pages; backend on a managed PaaS (Render recommended; Railway/Fly alternatives); Docker keeps portability to K8s later (TECHNICAL_GUIDE §17).

**Domain topology:**

- **App domain:** HTML/JS/API only, strict CSP, no uploaded files, no session cookies for the storage domain (decision: uploads never served from the app domain).
- **Storage/CDN domain:** user files only — `nosniff`, `Content-Disposition`, no application cookies (Decision Log #4).
- **Email domain:** SPF/DKIM/DMARC configured (TECHNICAL_GUIDE §10).
- Per-tenant custom domains (white-label) later via CNAME + TLS on the platform's domain infrastructure; cookie security on custom domains is a known open item (ARCHITECTURE_REVIEW F18).

**Database & storage:** Supabase managed PostgreSQL (pooler transaction mode for tenant traffic; dedicated privileged pool; PITR + daily backups + weekly cross-region `pg_dump` — TECHNICAL_GUIDE §23); object storage R2/S3-compatible.

**Secrets:** environment variables and CI secrets only — never in the repository; secret scanning in CI (TECHNICAL_GUIDE §16, §18); key rotation is a known open item (F29).

**Migrations:** versioned SQL, backward-compatible expand-contract, run against ephemeral databases in CI and via deploy steps; never ad-hoc (TECHNICAL_GUIDE §5, §20).

**CI/CD:** GitHub Actions pipeline — lint → typecheck → unit → migrations on ephemeral PG → integration (including tenant-isolation suite) → build → deploy; staging auto-deploy; production on tag/approval (TECHNICAL_GUIDE §18).

---

## 21. Scaling & Performance Behaviour

Scaling follows the ordered ladder of TECHNICAL_GUIDE §22: **scale up → scale out → replicas → CDN → partitioning → cache → hyperscale dedicated**, each step triggered by measurements, never forecasts.

**Runtime scaling levers:**

| Lever | When (measured triggers) |
|---|---|
| Scale up API/worker instances | Right-sizing first; then stateless horizontal scaling behind a load balancer; auto-scaling on CPU/requests for exam waves |
| Worker tier scale-out | Grading/notification bursts; dedicated worker pools during waves |
| Read replicas | Reporting/analytics contention or DB CPU saturation at tens of thousands of concurrent users |
| CDN | Static assets and media from day one; app instances never serve files |
| Partitioning | **Day-one** for: attempts, responses, audit_log, notifications, notification_outbox, metering_events. **Later candidates:** auth_sessions, rate_limit_counters. RANGE partitioning; composite PK `(id, partition key)`; all unique constraints include the partition key; partition-key inheritance keeps logical uniqueness; FKs reference partitioned tables via `(id, key)` only; advance-create ~2 months; drops only by scheduled jobs; audit retention 7y with pre-drop PII purge (DATABASE_MODEL §4) |
| Cache (Redis/Valkey) | Session store: session queries >20% of primary queries, or auth p95 >100ms, or session-attributed CPU >50% sustained. Rate limiting: counter queries >15%, or check p95 >10ms, or counter-attributed CPU >50%. Cache keys are tenant-namespaced (TECHNICAL_GUIDE §6, §11, §16) |
| Dedicated DB per hyperscale tenant | Case-by-case; never the default |

**Exam-wave behaviour (the load event that matters):** load testing (k6) before every wave; submissions persisted quickly and **grading deferred to workers** (the wave never blocks on heavy work); anti-spam rate limits on start/submission; queue priorities protect grading latency; per-tenant quotas and rate limits prevent a single tenant from degrading the pool (noisy-neighbour defence).

**Performance invariants:** composite indexes lead with `tenant_id`; cursor pagination everywhere; no `SELECT *`; no N+1; pooler handles connection fan-out; JSON payload hygiene; heavy work always async (TECHNICAL_GUIDE §21).

---

## 22. Security Boundaries & Trust Model

**Trust zones at runtime:**

1. **Client (untrusted).** Browser, API clients. Never trusted for tenant, roles, or file safety.
2. **Edge/CDN.** WAF + DDoS mitigation at production launch; Challenge Mode; IP blocking (TECHNICAL_GUIDE §16).
3. **App tier.** Rate limiter → session authN → permission engine → Zod validation → service layer → RLS — every layer runs before data access (§5–§8).
4. **Data tier.** PostgreSQL with RLS as the final gate; storage with quarantine-first publication; every file and row carries `tenant_id`.

**Enforcement points (in order on every tenant-scoped path):**

- Rate limiting (shared backend; fail-closed 503) — auth scopes: login 5/10min per account+IP, forgot-password 3/hour, registration per-IP (Decision Log #3).
- Session authentication (HttpOnly/Secure/SameSite cookie, CSRF protection, rotation, exact revocation — §6).
- Authorization (deny-by-default RBAC+ABAC, scope columns, entitlements — §7).
- Service-layer validation (Zod, before DB access).
- RLS (direct `tenant_id = current_setting('app.tenant_id')` comparison, no multi-level joins — DATABASE_MODEL §1.8).
- Audit (immutable records for sensitive operations — §16).

**File security boundaries:** uploads quarantined; magic-byte validation; malware scan mandatory; publication only for clean files; files never served from the app domain; dedicated storage domain with `nosniff`/`Content-Disposition`; CSP excludes the storage domain from script/style sources (Decision Log #4, §13).

**Session and cookie security:** opaque server-side sessions (no JWT for browsers); secure cookie flags; rotation after login and privilege changes; revocation on password reset; custom-domain cookie behaviour is a known open item (F18); helmet/CSP/clickjacking controls (frame-ancestors) required for the exam context (F20).

**Privileged access:** the dedicated Super Admin path is a separate trust zone — isolated pool, explicit per-action authorization with recorded reason, mandatory audit, break-glass rules, and a CI gate proving normal traffic cannot reach it (Decision Log #2, §8).

**Verification at runtime:** the tenant-isolation test suite is a blocking CI gate on every merge (cross-tenant access must fail; privileged-path isolation must hold; fail-closed behaviours must hold — §8, Decision Log #2/#5/#6); quarterly security reviews; penetration testing before major enterprise sales; data residency planned (Middle East region options for Gulf customers).

---

## 23. Failure Recovery & DR Runtime

**DR targets:** RPO ≤ 1 hour (PITR), RTO ≤ 4 hours — initial; runbook tested quarterly (TECHNICAL_GUIDE §23–24).

**Backup runtime:** Supabase managed backups (daily + PITR) as primary; weekly `pg_dump` to object storage with cross-region copy as defence-in-depth; storage bucket versioning + lifecycle; backups encrypted, service credentials only; restore drills verify data integrity **and tenant isolation** after restore.

**Restore runbook (drilled quarterly):**

1. Restore PostgreSQL to the nearest PITR point.
2. Rebuild API/worker images from the registry (deploy stack).
3. Restore/verify object storage.
4. Verify data integrity + tenant isolation (isolation suite against restored data).
5. **Post-restore purge:** re-run the deletion workflow for Deleted tenants on restored data (Decision Log #5).
6. Switch DNS → service restored.

**Async-state recovery after restore:**

- **Queue:** pg-boss jobs live in PostgreSQL — recovered with the DB; at-least-once semantics make re-delivery safe. (When BullMQ/Redis arrives, queue state is rebuilt/re-queued per policy — a documented DR step.)
- **Realtime:** SSE connections reconnect with event-id resume from persisted history — no loss, no duplicates (§10).
- **Outbox:** consumers re-claim unprocessed rows after restore; idempotent handlers make this safe.
- **Search index:** rebuilt/re-synced from domain events with retries; index consistency verified.
- **Storage:** versioning + lifecycle protect file objects; orphans swept within deleted tenants only.
- **Billing:** webhooks re-delivered by the provider are deduplicated by event id; no double charging (Decision Log #7).

**Deletion/closure recovery:** the tenant **closure record** (never a physical delete of the institution root) survives and is idempotently re-applied on restore — restored data never revives a closed tenant (DATABASE_MODEL §5.1). Survivor tables (subscriptions history, invoices, payment_events, audit_log, deletion_journal, legal_holds) are preserved; no ON DELETE CASCADE chains exist to repoint.

**Incident response:** uptime/health checks from day one; alerting before DR is a known gap being closed (F32); incident response / on-call process is a known open item (F28); every incident involving tenant data is audit-logged and post-reviewed (break-glass review).

**Residual risk (accepted, documented):** data loss beyond the PITR window (SLA-stated); hard-deleted tenant data recoverable from backups until backup retention expires.

---

## 24. Future Service Extraction

The modular monolith has explicit **extraction seams** (TECHNICAL_GUIDE §1, §28); services emerge by strangler-fig, never by rewrite.

**Extraction order (when triggers fire — team > ~15–20 engineers, module needing independent scaling/regulatory treatment, or deploy frequency conflicts):**

1. **Workers as separate deployables first** — the grading engine, AI service, and notification dispatcher already run as workers (§9); promoting a worker to a standalone service is a packaging change, not an architecture change.
2. **Billing & payments** — provider-neutral interface and webhook pipeline (§19) make it the cleanest service candidate.
3. **Notifications & realtime** — outbox-driven, channel-agnostic, dedicated realtime tier already designed (§10).
4. **Search** — already decoupled behind an interface with queue-based sync (§17).

**Extraction invariants:**

- The Tenant-Context Contract, authorization engine (shared library), audit, and outbox semantics are preserved across service boundaries — no service may weaken tenant isolation (isolation suite runs per service).
- Cross-service communication stays event-driven via the outbox (and later a real event bus); no synchronous service-to-service querying without tenant context.
- Internal gRPC is acceptable between extracted services; the public API stays REST (TECHNICAL_GUIDE §4).
- Vendor-neutral interfaces (storage, email, AI, search, payments, sessions) mean provider swaps remain config changes after extraction.
- MCP servers become the integration surface for agent-driven ops and content authoring (§19).
- Per-tenant phased migration (dual-run: new infra for a cohort of tenants while others stay) is the only acceptable data-migration path between platforms; tenant isolation is re-verified after every move (TECHNICAL_GUIDE §28).

**Guardrail:** extraction is an option, never an obligation. The monolith remains the cheapest correct architecture until the measured triggers above fire.

---

*Manara — System Architecture (Runtime). Companion to `docs/PRODUCT_VISION.md`, `docs/TECHNICAL_GUIDE.md` (ADR + Decision Log), `docs/DOMAIN_MODEL.md`, and `docs/DATABASE_MODEL.md`. Decisions referenced here are governed by TECHNICAL_GUIDE §29 and the contracts in DATABASE_MODEL §1–§7.*
