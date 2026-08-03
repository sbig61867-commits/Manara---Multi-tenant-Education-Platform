# Manara — Module Specification

> **Document status:** Draft — Active review
>
> **What this document is:** the module boundaries of the Manara platform — what each module owns, what it may call, and what it must never call. It is the contract that keeps the modular monolith (PRODUCT_VISION §23, TECHNICAL_GUIDE §1) clean and the future extraction seams (SYSTEM_ARCHITECTURE §24) explicit.
>
> **What this document is not:** it does not design APIs, write code, or write SQL. "Public services" are capability names, not endpoint contracts.
>
> **Consistency:** this document is fully consistent with `docs/PRODUCT_VISION.md`, `docs/TECHNICAL_GUIDE.md` (ADR + Decision Log #1–#7), `docs/DOMAIN_MODEL.md`, `docs/DATABASE_MODEL.md`, and `docs/SYSTEM_ARCHITECTURE.md`. No features are invented here; every element traces to one of those documents.
>
> **Naming note:** the 20 modules below re-partition the capability list of PRODUCT_VISION §21 and SYSTEM_ARCHITECTURE §4. The mapping is in §2.

---

## 1. How to Read This Document

Every module is specified with the same template:

| Field | Meaning |
|---|---|
| **Purpose** | Why the module exists |
| **Responsibilities** | What the module does at runtime |
| **Owns / May call / Must never call** | The boundary contract in one line each |
| **Public services** | Capabilities this module exposes to other modules (names, not APIs) |
| **Events published** | Domain events this module writes to the transactional outbox (SYSTEM_ARCHITECTURE §10, §17; Decision Log #6) |
| **Events consumed** | Domain events this module reacts to via its workers (consumption is **not** a call dependency) |
| **Dependencies** | Modules this module **may call** (service-layer calls only) |
| **Forbidden dependencies** | Modules and things this module **must never call or touch** |
| **Owned entities** | Domain entities from `docs/DOMAIN_MODEL.md` |
| **Owned database tables** | Tables from `docs/DATABASE_MODEL.md` that only this module may read/write directly |
| **Background jobs** | Job families this module defines, executed on the worker tier (SYSTEM_ARCHITECTURE §9) |
| **Security responsibilities** | The security duties this module must not delegate |
| **Multi-tenant responsibilities** | The tenant-isolation duties this module must not delegate |
| **Future extraction readiness** | How this module maps to future service extraction (SYSTEM_ARCHITECTURE §24) |

### Universal rules (apply to every module)

1. **Table ownership is exclusive.** A module reads/writes only its owned tables, through its own services. Reading another module's table directly is a defect — the owner's public service is the only access path.
2. **Events are written, not called.** Publishing = calling the transactional outbox service (Notifications module) **inside the same database transaction** as the business action (Decision Log #6). Consuming = a worker reacting to a routed event; it creates no code dependency.
3. **No privileged path from tenant traffic.** No tenant-scoped module ever uses the privileged database role/connection path (Super Admin Access Model, Decision Log #2; SYSTEM_ARCHITECTURE §8). Cross-tenant platform operations go through Platform's authorized services only.
4. **Tenant context is never optional.** Every tenant-scoped query follows the Tenant-Context Contract (TECHNICAL_GUIDE §5; SYSTEM_ARCHITECTURE §8): explicit transaction, transaction-local `app.tenant_id` set before the first tenant-scoped query, autocommit forbidden, fail-closed on missing context.
5. **Heavy work is queued.** No module executes grading, AI, email, certificates, analytics, or exports inside an HTTP request (TECHNICAL_GUIDE §12; SYSTEM_ARCHITECTURE §2, §9).
6. **Audit in the same transaction.** Every sensitive operation calls the Audit service in the same transaction as the action (SYSTEM_ARCHITECTURE §16).
7. **The dependency graph is acyclic.** New dependencies are allowed only if they point to a module earlier in the topological order (§3). A cycle is a merge-blocking defect.
8. **Quotas are enforced before the operation.** Any operation bounded by plan quotas checks the Subscription service first, and the quota state updates atomically with the business action (Decision Log #7).

---

## 2. Module List & Traceability

| # | Module | Covers (PRODUCT_VISION §21 / SYSTEM_ARCHITECTURE §4) |
|---|---|---|
| 1 | Platform | Platform-level operations, platform roles, rate-limit policy |
| 2 | Identity | Identity, Authentication, Sessions, Memberships, Invitations |
| 3 | Tenant | Tenancy, tenant lifecycle, legal holds, exports, deletion |
| 4 | Authorization | Authorization, Roles, Permissions |
| 5 | Subscription | Billing, Entitlements, quotas, metering, invoices, payments |
| 6 | Organization | Organization structure (units) |
| 7 | Learning | Learning Programs, Enrolments, Groups, Teams, Training Sessions, Practical Labs |
| 8 | Content | Content tree (content items / resources) |
| 9 | Assessment | Assessments, Question Bank, Attempts, Responses |
| 10 | Attendance | Attendance records |
| 11 | Grading | Grades, grading engine, appeals |
| 12 | Certificates | Certificates and certificate templates |
| 13 | Files | File Management, quarantine/publish, presigned URLs |
| 14 | Notifications | Notifications, outbox (event bus), realtime/SSE, email channel |
| 15 | AI | AI interactions (question generator, course builder, summarization) |
| 16 | Audit | Audit Log |
| 17 | Reporting | Reports and analytics |
| 18 | Search | Search index and sync |
| 19 | Integrations | API keys, MCP servers, outbound webhooks (future), lab level-2 |
| 20 | Background Workers | Queue infrastructure, job runtime, outbox routing |

---

## 3. Dependency Graph & Layering

The graph is a **directed acyclic graph (DAG)**. An edge `A → B` means "module A may call module B's public services". The topological order below guarantees acyclicity: **a module may only depend on modules listed earlier in the order** (module numbers refer to the sections of this document).

**Topological order (position: module):** 1 Audit · 2 Background Workers · 3 Identity · 4 Tenant · 5 Subscription · 6 Organization · 7 Authorization · 8 Files · 9 Notifications · 10 Learning · 11 Content · 12 Assessment · 13 Attendance · 14 Grading · 15 AI · 16 Search · 17 Integrations · 18 Certificates · 19 Reporting · 20 Platform

| Module | Position | May call (dependencies) |
|---|---|---|
| 1 Platform | 20 | Subscription, Tenant, Authorization, Notifications, Audit |
| 2 Identity | 3 | Background Workers, Notifications, Audit |
| 3 Tenant | 4 | Identity, Background Workers, Notifications, Audit |
| 4 Authorization | 7 | Identity, Tenant, Subscription, Audit |
| 5 Subscription | 5 | Tenant, Background Workers, Notifications, Audit |
| 6 Organization | 6 | Tenant, Notifications, Audit |
| 7 Learning | 10 | Tenant, Organization, Identity, Subscription, Files, Notifications, Background Workers, Audit |
| 8 Content | 11 | Learning, Files, Notifications, Audit |
| 9 Assessment | 12 | Learning, Content, Identity, Subscription, Notifications, Audit |
| 10 Attendance | 13 | Learning, Identity, Notifications, Audit |
| 11 Grading | 14 | Assessment, Learning, Notifications, Audit |
| 12 Certificates | 18 | Learning, Grading, Attendance, Content, Files, Notifications, Audit |
| 13 Files | 8 | Subscription, Identity, Tenant, Background Workers, Notifications, Audit |
| 14 Notifications | 9 | Identity, Tenant, Background Workers, Audit |
| 15 AI | 15 | Subscription, Files, Content, Assessment, Notifications, Background Workers, Audit |
| 16 Audit | 1 | (none — leaf sink) |
| 17 Reporting | 19 | Subscription, Tenant, Learning, Content, Assessment, Grading, Attendance, Certificates |
| 18 Search | 16 | Content, Learning, Background Workers |
| 19 Integrations | 17 | Authorization, Subscription, Tenant, Notifications, Background Workers, Audit |
| 20 Background Workers | 2 | (none — infrastructure) |

**Acyclicity verification:** every module's dependencies are modules with an **earlier** position in the topological order (each module's position is greater than the position of every module it may call — verified per row above). A new edge may be added only if the target module has an earlier position; any edge that would create a cycle is forbidden and must be rejected in review and by the CI boundary checks.

**Event flow is not dependency flow:** events travel through the outbox (Notifications) and are consumed by workers; consumption never counts as a call dependency, so it cannot create cycles.

---

## 1. Platform

**Purpose.** The platform-level operator module: platform roles and platform-wide policy, platform-wide operations through the dedicated privileged path, and the rate-limit policy. It is the only module entitled to cross-tenant platform operations (Decision Log #2; SYSTEM_ARCHITECTURE §8).

**Responsibilities.**
- Manage platform-level roles (Platform Owner, Super Admin, Support Admin, Billing Admin, Security Auditor — PRODUCT_VISION §13) and their grants, seeded as platform rows (`tenant_id` NULL) managed through the Authorization service.
- Operate on any tenant through the **dedicated privileged database role/connection path** — every action explicitly authorized for (operation, target tenant) with a recorded reason; every action audit-logged with actor, target tenant, action, reason, timestamp, request id (Super Admin Access Model, Decision Log #2).
- Operate plan catalog and feature-flag catalog through the Subscription service; operate legal holds and tenant lifecycle transitions through the Tenant service.
- Break-glass access: recorded reason, time-boxed, session rotated after use, reviewed at the next security review (Decision Log #2).
- Own the platform-wide rate-limit policy (limits per scope per plan) and the rate-limit counter lifecycle (TECHNICAL_GUIDE §16, Decision Log #3).
- Broadcast platform system announcements (maintenance, security alerts) through Notifications (System category, TECHNICAL_GUIDE §10).
- Seed platform defaults: platform notification templates (via Notifications), plan catalog and feature flag definitions (via Subscription).

**Owns.** Platform-level seed rows (in `roles`, `role_permissions`, `notification_templates`), the rate-limit policy, and the privileged path.
**May call.** Subscription, Tenant, Authorization, Notifications, Audit.
**Must never call.** Any tenant-scoped module's tenant-scoped services as "normal traffic"; the tenant pool; un-authorized cross-tenant access.

**Public services.**
- `authorizePlatformAction(actor, targetTenant, action, reason)` — the gate every cross-tenant operation passes (fail-closed, audit in same transaction).
- `enforceRateLimitPolicy(scope, key, tenantId?, userId?)` — shared-backend rate-limit check (PG counters Phase 1, Redis Phase 2; fail-closed 503).
- `operatePlanCatalog`, `operateFeatureFlags`, `applyLegalHold`, `transitionTenantLifecycle`, `broadcastSystemNotice`, `breakGlass(actor, action, reason)`.

**Events published.** `SystemNoticePublished`.

**Events consumed.** None (platform operations are on-demand, via services).

**Dependencies.** Subscription, Tenant, Authorization, Notifications, Audit.

**Forbidden dependencies.** Every tenant-scoped module (Learning, Content, Assessment, Attendance, Grading, Certificates, Reporting, Search, Files, Organization, AI, Integrations). Platform never runs "as a tenant" and never uses the transaction-mode tenant pool (Decision Log #2).

**Owned entities.** A1 Platform (DOMAIN_MODEL).

**Owned database tables.** No dedicated tables. Platform owns the platform-level rows inside: B.6 `roles`, B.7 `role_permissions`, F.5 `notification_templates` (managed through the owning modules' services), and the rate-limit policy over G.3 `rate_limit_counters` (ownership of the counters' schema follows the shared-backend design, TECHNICAL_GUIDE §16).

**Background jobs.** Rate-limit counter stale-window cleanup (TECHNICAL_GUIDE §16 — scheduled; partition candidate when volume demands, DATABASE_MODEL §4.3).

**Security responsibilities.** The privileged path is the platform's most sensitive surface: deny-by-default, explicit authorization with recorded reason, mandatory audit on every cross-tenant action, break-glass discipline, and the privileged-path isolation CI gate (Decision Log #2). Rate limiting must never be in-memory and must fail closed (Decision Log #3).

**Multi-tenant responsibilities.** Cross-tenant access is denied by default; privileged operations state their target tenant explicitly and never rely on a missing `tenant_id`; normal tenant traffic never touches the privileged path.

**Future extraction readiness.** Platform is the thinnest module by design: it is pure policy + orchestration over the domain modules' services, which makes it the last extraction candidate and a natural admin/ops MCP surface (TECHNICAL_GUIDE §25).

---

## 2. Identity

**Purpose.** One global identity for every user, with authentication, sessions, memberships, and invitations (PRODUCT_VISION §15; TECHNICAL_GUIDE §6; SYSTEM_ARCHITECTURE §6). Tenancy lives in memberships — authentication proves *who* you are.

**Responsibilities.**
- User accounts and identities; **Argon2id** password hashing (TECHNICAL_GUIDE §6).
- **Opaque server-side sessions** in PostgreSQL behind a provider-neutral session-store interface (Decision Log #1): absolute expiry 24h, idle timeout 30m, rotation after login and after privilege changes, immediate exact revocation on logout and password reset. No JWTs for browser authentication.
- Login (5 attempts / 10 min per account+IP), forgot-password (3 / hour, short-lived email token), registration (per-IP limits) — rate limits enforced via the shared backend (Decision Log #3).
- Memberships (B4): a user's memberships across tenants with roles per membership (DOMAIN_MODEL §3.1).
- Invitations: create/accept flows (join methods: direct invite, invite link, join code, public registration, manual add, bulk import — DOMAIN_MODEL §3.5).
- MFA (TOTP), passkeys, and SSO/SAML/SCIM federation: later phases (TECHNICAL_GUIDE §6).
- Session expiry sweeps and auth-token housekeeping as scheduled jobs.

**Owns.** Users, identities, sessions, auth tokens, memberships, invitations.
**May call.** Background Workers, Notifications (invitation/security emails, outbox), Audit.
**Must never call.** Any tenant-scoped module; the privileged path; session decisions stored in tenant data.

**Public services.**
- `registerUser`, `authenticate`, `createSession`, `validateSession`, `rotateSession`, `revokeSession`, `resetPassword`, `requestPasswordReset`, `createMembership`, `listMemberships`, `switchTenantContext`, `createInvitation`, `acceptInvitation`, `updatePreferences`.

**Events published.** `UserRegistered`, `UserPasswordReset`, `SessionRevoked`, `MembershipChanged`, `InvitationAccepted`.

**Events consumed.** None.

**Dependencies.** Background Workers (session sweeps), Notifications (outbox + emails), Audit.

**Forbidden dependencies.** Tenant, Subscription, Learning, Content, Assessment, Attendance, Grading, Certificates, Files, Reporting, Search, Integrations, Platform. Identity never makes authorization decisions (TECHNICAL_GUIDE §6); session data never contains tenant-scoped authorization results (re-evaluated per request).

**Owned entities.** B1 User, B2 Identity, B3 Auth Session, B4 Membership, F1 Invitation (DOMAIN_MODEL).

**Owned database tables.** B.1 `users`, B.2 `identities`, B.3 `auth_sessions`, B.4 `auth_tokens`, B.5 `memberships`, B.9 `invitations` (DATABASE_MODEL).

**Background jobs.** Session expiry/idle sweeps; auth-token cleanup. (Session storage moves to Redis when the measured trigger fires — session queries >20% of primary, auth p95 >100ms, or CPU >50% sustained — Decision Log #1.)

**Security responsibilities.** Password hashing (Argon2id), session cookie flags (HttpOnly, Secure, SameSite) + CSRF protection, exact revocation, rotation on privilege change, no session fixation, no JWT for browsers (Decision Log #1). Auth rate limits enforced before hashing.

**Multi-tenant responsibilities.** Sessions are tenant-agnostic; tenant context is resolved from memberships at request time, never stored in the session (SYSTEM_ARCHITECTURE §8). A membership change applies immediately (session rotation on privilege change).

**Future extraction readiness.** The self-contained auth module (TECHNICAL_GUIDE §28) is the cleanest service candidate after Billing; its session-store interface already supports the PG → Redis swap.

---

## 3. Tenant

**Purpose.** The tenant (institution) and its complete lifecycle: Draft → Active → Suspended → Grace → Archived → Deleted, with export, legal hold, and staged deletion ending in the permanent closure record (Decision Log #5; DATABASE_MODEL §5, §5.1; SYSTEM_ARCHITECTURE §17).

**Responsibilities.**
- Institution root and institution settings (branding, language, terminology — PRODUCT_VISION §16, §17).
- Lifecycle state machine: every transition only via authorized actions; illegal transitions rejected (Decision Log #5).
- Offboarding orchestration: notify admins → export window → service termination → Grace → Archived → Deleted.
- Tenant data export (queued): tenant-only packages, 14-day bounded lifetime, available through Grace Period, rate/quota-limited, audit-logged (Decision Log #5).
- Legal holds (platform-only, recorded reason): freeze retention/deletion; attachable to the closure record after closure (DATABASE_MODEL §5.1).
- Deletion workflow: staged purge jobs with deletion journal, dependency order, fail-closed on partial deletion; **closure conversion** as the atomic final phase (row never deleted; PII stripped; `id` retained forever).
- Post-restore purge for Deleted tenants after backup restores (idempotent re-closure; a closed tenant is never revived — Decision Log #5).
- Storage/search/queue cleanup coordination across Files, Search, and Background Workers during offboarding and deletion (Decision Log #5 items 7–9).

**Owns.** Institutions, settings, legal holds, exports, deletion journal.
**May call.** Identity, Background Workers, Notifications, Audit.
**Must never call.** Subscription's payment internals, Learning, Content, Assessment, Grading, Certificates, Reporting, Search, Files, Integrations, Platform (it must not self-authorize platform actions).

**Public services.**
- `createTenant`, `transitionLifecycle(from, to, reason)`, `getTenantStatus`, `requestExport`, `applyLegalHold`, `removeLegalHold`, `startDeletion`, `runClosureConversion`, `resolveTenantScope`.

**Events published.** `TenantCreated`, `TenantStatusChanged`, `TenantExportRequested`, `TenantExportCompleted`, `TenantClosureCompleted`, `LegalHoldApplied`, `LegalHoldRemoved`.

**Events consumed.** None (billing requests lifecycle transitions through its service call; see Subscription).

**Dependencies.** Identity (tenant admins, memberships), Background Workers (export/purge jobs), Notifications (outbox — offboarding notifications), Audit.

**Forbidden dependencies.** Platform (except via its authorized platform services), Payment provider adapters, and every learning-domain module. Tenant never deletes other modules' tables directly — it orchestrates deletion through owning modules' services (Decision Log #5).

**Owned entities.** A2 Institution (Tenant), A3 Institution Settings (DOMAIN_MODEL).

**Owned database tables.** A.1 `institutions`, A.2 `institution_settings`, A.12 `legal_holds`, G.5 `exports`, G.6 `deletion_journal` (DATABASE_MODEL).

**Background jobs.** Tenant export jobs; staged deletion purge jobs (feature-by-feature, journaled, batched/throttled); post-restore purge job (drills); orphaned-object sweep coordination (executed via Files/Search services).

**Security responsibilities.** Offboarding and deletion require platform authorization with a recorded reason (break-glass rules for urgency — Decision Log #2/#5); export packages contain only the requesting tenant's data; deletion residue checks across DB, storage, search, queue; legal hold is the only retention/deletion override.

**Multi-tenant responsibilities.** The lifecycle *is* multi-tenancy's spine: Suspended blocks writes and new job enqueues; Deleted leaves no residue; audit records and survivor tables (subscriptions history, invoices, payment_events, audit_log, deletion_journal, legal_holds) survive closure with no FK repointing (DATABASE_MODEL §5.1); tenant-facing surfaces return "institution not found" post-closure.

**Future extraction readiness.** Tenant lifecycle is a self-contained state machine with an orchestrated purge workflow — a strong standalone service candidate when billing/tenant ops separate.

---

## 4. Authorization

**Purpose.** The central permission engine: RBAC + ABAC hybrid, deny-by-default, service-layer first with RLS as the safety net (TECHNICAL_GUIDE §7; PRODUCT_VISION §14; SYSTEM_ARCHITECTURE §7).

**Responsibilities.**
- Roles scoped to context (`tenant_id`, unit, program, group — DOMAIN_MODEL §3.1) and permissions/grants; platform roles as NULL-tenant rows protected by partial unique indexes (DATABASE_MODEL §6 item 9).
- Permission evaluation: role + scope + resource + action, plus ABAC attributes (feature flags, entitlements, quotas, tenant/program/user status).
- Deny-by-default on every endpoint and every MCP tool call; no admin-bypass shortcuts.
- Entitlement-aware caching with tenant-namespaced keys (TECHNICAL_GUIDE §7, §11); cache never overrides a deny.
- React to privilege changes: publish role-change events so Identity rotates sessions (Decision Log #1) and re-evaluate on entitlement/tenant-status changes.

**Owns.** Roles, permissions, grants, user-role assignments.
**May call.** Identity, Tenant, Subscription, Audit.
**Must never call.** Learning, Content, Assessment, Grading, Attendance, Certificates, Files, Reporting, Search, Integrations, AI, Background Workers, Platform. Authorization never reads business tables to decide access.

**Public services.**
- `evaluate(userId, tenantId, resource, action, context)`, `getRolesForContext`, `grantRole`, `revokeRole`, `resolveEntitlements`, `assertDenyByDefault`.

**Events published.** `RoleChanged`, `PermissionGrantChanged`, `UserRoleChanged`.

**Events consumed.** `EntitlementChanged`, `TenantStatusChanged` (re-evaluate cached decisions; suspended tenants lose write access immediately).

**Dependencies.** Identity (users, memberships), Tenant (status), Subscription (entitlements), Audit.

**Forbidden dependencies.** Every learning-domain module and the privileged path. No endpoint may embed its own permission checks outside this module (hardcoded per-endpoint checks are an anti-pattern — TECHNICAL_GUIDE §7).

**Owned entities.** B5 Role, B6 Permission (DOMAIN_MODEL).

**Owned database tables.** B.6 `roles`, B.7 `permissions` + `role_permissions`, B.8 `user_roles` (DATABASE_MODEL).

**Background jobs.** None in v1 (permission-cache warming only if profiling demands — TECHNICAL_GUIDE §7).

**Security responsibilities.** Prevent both horizontal (cross-tenant) and vertical (privilege) escalation; scope columns are enforced in every evaluation; permission-matrix unit tests and the tenant-isolation CI suite prove no drift between the engine and RLS (TECHNICAL_GUIDE §7, §16).

**Multi-tenant responsibilities.** Every evaluation is (user, tenant context)-scoped; a role in tenant A never grants anything in tenant B; entitlements are derived from the tenant's plan only.

**Future extraction readiness.** The permission engine is designed as a shared library (TECHNICAL_GUIDE §7) — it travels with every extracted service instead of becoming a call dependency; an OPA/Rego migration path exists if the matrix explodes.

---

## 5. Subscription

**Purpose.** The Billing & Subscription domain (Decision Log #7): plans as data, subscriptions, entitlements, quotas, usage metering, invoices, and payment processing — provider-neutral end to end (SYSTEM_ARCHITECTURE §17; DATABASE_MODEL Part A).

**Responsibilities.**
- **Plans as data** (Starter, Professional, Enterprise, Custom): versioned, effective-dated; entitlements and quotas; changing a plan never requires a deployment.
- **Feature flags** per tenant (AI Question Generator, AI Course Builder, Online Exams, Live Proctoring, Attendance, Certificates, Analytics, API Access, White Label, Custom Domain, Mobile App, SSO — PRODUCT_VISION §21); entitlements re-evaluated immediately on change.
- **Quotas**: service-layer enforcement before operations; quota state updated atomically with the business action; over-quota → clear error, block new usage, never delete data.
- **Usage metering**: metered events (AI requests, API calls, storage, email volume) recorded per tenant with attribution; tenant code never writes metering rows directly (SYSTEM_ARCHITECTURE §17).
- **Billing lifecycle**: Active → Past Due → Suspended → Grace → Reactivated/Terminated; integrated with the Tenant lifecycle (requested via Tenant service); payment grace 7d, suspension grace 30d defaults.
- **Trial**: 14d default; conversion **only with explicit consent — never a silent auto-charge** (Decision Log #7).
- **Upgrades** immediate (prorated), **downgrades** at period end; over-quota downgrade → block new usage, no data deletion.
- **Invoices** (draft → issued → paid/failed) with tenant-scoped PDFs; per-tenant numbering.
- **Payment provider abstraction** (narrow interface; provider decision deferred and logged when adopted) and **webhook ingestion**: signed, idempotent endpoint → verify signature → deduplicate by provider event id → queue → atomic state update → audit (Decision Log #7; SYSTEM_ARCHITECTURE §19).
- Dunning escalation schedule through Notifications.

**Owns.** Plans, flags, subscriptions, entitlements, quotas, metering, invoices, payment events.
**May call.** Tenant, Background Workers, Notifications, Audit.
**Must never call.** Learning, Content, Assessment, Grading, Attendance, Certificates, Files, Reporting, Search, Integrations, AI, Identity, Platform, and the privileged path. Billing business logic is independent of the payment provider (Decision Log #7).

**Public services.**
- `getPlan`, `getEntitlements(tenantId)`, `checkQuota(tenantId, scope)`, `consumeMetered(tenantId, scope, amount)`, `createSubscription`, `changePlan`, `processInvoice`, `ingestWebhook(payload)`, `requestLifecycleTransition(state)`.

**Events published.** `SubscriptionChanged`, `EntitlementChanged`, `QuotaExceeded`, `InvoiceIssued`, `PaymentSucceeded`, `PaymentFailed`, `TrialExpired`, `TrialConverted`, `TenantSuspendedForBilling`, `TenantReactivated`.

**Events consumed.** `TenantStatusChanged` (react to tenant lifecycle transitions: suspension freezes billing progression; closure freezes all writes; legal hold freezes dunning).

**Dependencies.** Tenant (lifecycle integration), Background Workers (invoice/dunning/webhook/metering jobs), Notifications (outbox + dunning emails), Audit.

**Forbidden dependencies.** All learning-domain modules; direct payment-provider coupling in business logic; writing metering rows from tenant-facing code paths.

**Owned entities.** A5 Subscription, A6 Entitlement (DOMAIN_MODEL).

**Owned database tables.** A.4 `subscription_plans`, A.5 `subscriptions`, A.6 `feature_flag_definitions` + `tenant_feature_flags`, A.7 `entitlements`, A.8 `usage_quota_meters`, A.9 `metering_events`, A.10 `invoices` + A.11 `payment_events` (DATABASE_MODEL).

**Background jobs.** Invoice generation (period end/proration), dunning escalations, webhook processing (signed, idempotent), metering rollups, trial expiry checks.

**Security responsibilities.** Webhook signature verification and event-id deduplication (unverifiable webhooks rejected); quota enforcement is atomic (no race to exceed); invoices/PDFs tenant-scoped; payment keys are secrets (TECHNICAL_GUIDE §16); billing audit records survive tenant deletion (survivors — DATABASE_MODEL §5.1).

**Multi-tenant responsibilities.** One subscription per tenant, tenant-scoped; one tenant's failed payment suspends only that tenant; quotas and rate-limit keys are tenant-namespaced — a tenant never consumes another's quota (Decision Log #3/#7).

**Future extraction readiness.** Billing is the #1 service candidate (SYSTEM_ARCHITECTURE §24): provider-neutral interface, webhook pipeline, and plans-as-data make it a clean standalone deployable.

---

## 6. Organization

**Purpose.** The institution's internal structure: organization units (colleges, departments, branches, centers — PRODUCT_VISION §8.2) that scope roles, programs, and delivery (DOMAIN_MODEL A4; DATABASE_MODEL A.3).

**Responsibilities.**
- Organization-unit tree management (create, move, archive) under a tenant.
- Provide unit scope resolution to Authorization and Learning (roles/programs scoped to units).
- Enforce tenant quota on max organization units (plan limits — Decision Log #7).

**Owns.** Organization units.
**May call.** Tenant, Notifications, Audit.
**Must never call.** Subscription, Authorization, Learning, and all downstream modules. Organization is a pure structure module — it never interprets roles or delivery.

**Public services.** `createUnit`, `updateUnit`, `archiveUnit`, `getUnitTree`, `resolveUnitScope`.

**Events published.** `OrgUnitCreated`, `OrgUnitChanged`.

**Events consumed.** None.

**Dependencies.** Tenant, Notifications, Audit.

**Forbidden dependencies.** Everything except Tenant, Notifications, Audit, Background Workers (not required), and Platform (forbidden).

**Owned entities.** A4 Organization Structure (DOMAIN_MODEL).

**Owned database tables.** A.3 `organization_units` (DATABASE_MODEL).

**Background jobs.** None in v1.

**Security responsibilities.** Units never cross tenant boundaries; unit-scoped access is always resolved through the Authorization engine, never by unit-tree traversal alone.

**Multi-tenant responsibilities.** Every unit carries `tenant_id`; a unit belongs to exactly one tenant and is never reachable from another tenant's context.

**Future extraction readiness.** Organization is a leaf domain module; it extracts trivially as a small service if enterprise org structures grow complex.

---

## 7. Learning

**Purpose.** Learning and delivery: learning programs (academic courses, training programs, self-paced, cohort-based — PRODUCT_VISION §10, §11), groups/teams, enrollments and join methods, training sessions, and practical labs (DOMAIN_MODEL Part C; DATABASE_MODEL Part C).

**Responsibilities.**
- Learning programs with archetypes (Academic Course, School Subject, Self-Paced Course, Instructor-Led, Cohort-Based, Corporate, Certification Path, Practical Lab, etc. — PRODUCT_VISION §10).
- Enrollments and all join methods (direct invite, invite link, join code, public registration, approval-based request, manual add, bulk import — DOMAIN_MODEL §3.5).
- Groups, teams (delivery groupings; team membership feeds team assessments — DATABASE_MODEL C.4/C.5) and training sessions (scheduled live events).
- Practical labs at level 1 (external link + instructions + report submission — PRODUCT_VISION §12); level-2 (institution API provisioning) is a future integration through Integrations.
- Delivery state feeds: session completion, lab submissions — events consumed by Certificates.
- Enforce plan quotas (max programs, sections, groups — Decision Log #7).

**Owns.** Programs, groups, teams, enrollments, training sessions, practical labs.
**May call.** Tenant, Organization, Identity, Subscription, Files, Notifications, Background Workers, Audit.
**Must never call.** Content, Assessment, Grading, Attendance, Certificates, Reporting, Search, AI, Integrations, Platform, and the privileged path. Learning never interprets content or grades.

**Public services.**
- `createProgram`, `publishProgram`, `archiveProgram`, `createGroup`, `createTeam`, `enroll`, `join`, `getEnrollments`, `createTrainingSession`, `completeSession`, `createLab`, `submitLabReport`, `getDeliveryContext`.

**Events published.** `ProgramCreated`, `ProgramPublished`, `ProgramArchived`, `EnrollmentChanged`, `GroupMembershipChanged`, `TeamChanged`, `TrainingSessionScheduled`, `TrainingSessionCompleted`, `PracticalLabProvisioned`, `PracticalLabSubmissionReceived`.

**Events consumed.** None in v1 (delivery reacts to status checks through Tenant/Subscription services).

**Dependencies.** Tenant, Organization, Identity, Subscription (quotas), Files (lab attachments/reports), Notifications (outbox), Background Workers, Audit.

**Forbidden dependencies.** Content (below it in the order — Content may call Learning, never the reverse), Assessment, Grading, Attendance, Certificates, Reporting, Search, AI, Integrations, Platform.

**Owned entities.** C1 Learning Program, C2 Academic Course, C3 Training Program, C6 Training Session, C8 Group, C9 Enrollment, C10 Practical Lab, D7 Team (delivery aspect; the team-attempt aspect lives in Assessment — DATABASE_MODEL C.4/C.5 vs D.5).

**Owned database tables.** C.1 `learning_programs`, C.3 `groups`, C.4 `teams` + C.5 `team_members`, C.6 `enrollments`, C.7 `training_sessions`, C.9 `practical_labs` (DATABASE_MODEL).

**Background jobs.** None in v1 (session reminders are notification events; lab provisioning at level 2 will be a queued integration job via Integrations).

**Security responsibilities.** Enrollment and join methods must not allow unauthorized access (approval flows, join-code validation); lab external links are untrusted (SSRF surface — TECHNICAL_GUIDE §16, ARCHITECTURE_REVIEW F21) — validated and restricted; delivery state never overrides authorization.

**Multi-tenant responsibilities.** Programs, groups, teams, enrollments, sessions, and labs all carry `tenant_id`; enrollment audience resolution never crosses tenants; one tenant's delivery never affects another's quotas or state.

**Future extraction readiness.** Learning is the domain heart of the monolith; its event-rich surface (enrollments, sessions, labs) and clean dependencies make it a plausible service candidate after Billing, with Enrollment as its sharpest extraction seam.

---

## 8. Content

**Purpose.** The recursive content tree: units, modules, chapters, lectures, lessons, topics (ContentNode model — PRODUCT_VISION §11; DATABASE_MODEL C.2; SYSTEM_ARCHITECTURE content flows). Activities, assessments, and resources attach to content nodes.

**Responsibilities.**
- Content-item tree management (typed nodes; explicit, stable ordering among siblings; parent/child in the same program and tenant — DATABASE_MODEL C.2).
- Content publication lifecycle (draft → published → archived), gating delivery by program/tenant status.
- Resources: attach Files (via the Files service) to nodes; course-level activities need no node.
- Publish content events to drive search indexing and notifications.

**Owns.** The content tree.
**May call.** Learning, Files, Notifications, Audit.
**Must never call.** Assessment, Grading, Attendance, Certificates, Reporting, Search (it publishes events; Search consumes), AI (AI requests are events, not calls), Subscription, Identity, Tenant, Platform.

**Public services.** `createNode`, `updateNode`, `moveNode`, `reorderNodes`, `publishNode`, `archiveNode`, `attachResource`, `getTree`, `getCompletionState`.

**Events published.** `ContentPublished`, `ContentChanged`.

**Events consumed.** None (search/reporting consumption is one-directional: Content publishes; Search consumes).

**Dependencies.** Learning (program scoping), Files (resources), Notifications (outbox), Audit.

**Forbidden dependencies.** Assessment and everything after it in the topological order; direct file-storage access (always through Files — quarantine/publish rules apply to every content file, Decision Log #4).

**Owned entities.** C4 Module, C5 Lesson (realized as typed content items in the tree — DOMAIN_MODEL; DATABASE_MODEL C.2).

**Owned database tables.** C.2 `content_items` (DATABASE_MODEL).

**Background jobs.** None in v1 (index sync is Search's job, triggered by events).

**Security responsibilities.** Content publication never bypasses plan feature flags (Online Exams/content quotas); resource access goes through Files' quarantine/publish state — unpublished or quarantined resources are never servable; ordering/structure changes are audit-logged.

**Multi-tenant responsibilities.** Every content item carries `tenant_id` and belongs to exactly one program within one tenant; parent/child pairs are always same-tenant, same-program; no node crosses tenant boundaries.

**Future extraction readiness.** Content is the classic first candidate for a headless content service (CMS extraction seam); its event surface (ContentChanged) already decouples it from Search and Notifications.

---

## 9. Assessment

**Purpose.** The unified assessment domain: exams, quizzes, assignments, question bank, attempts, and responses (DOMAIN_MODEL §3.3; DATABASE_MODEL Part D; SYSTEM_ARCHITECTURE §11).

**Responsibilities.**
- Assessment lifecycle: create → publish → start attempt → incremental response saving → submit → results publication (SYSTEM_ARCHITECTURE §11).
- Audiences: sections/groups/users via AssessmentAudience; attachment to content nodes (via Content) or program level.
- Attempts: exactly **one active attempt per (assessment, enrollment)**; for team assessments, per team — with the **team_attempt_members snapshot** frozen immutably at submission (DATABASE_MODEL D.5).
- Responses persisted incrementally; resumable attempts.
- Anti-spam rate limits on exam start/submission (Decision Log #3).
- On submission: publish `AttemptSubmitted` — grading is **never** performed in the student's request (TECHNICAL_GUIDE §12).
- Enforce plan quota (max exams — Decision Log #7).

**Owns.** Assessments, audiences, question bank, questions, attempts, responses.
**May call.** Learning, Content, Identity, Subscription, Notifications, Audit.
**Must never call.** Grading (it consumes `AttemptSubmitted`; grading is a worker reaction), Certificates, Reporting, Search, Files (no direct file access), AI (AI question generation is an event, not a call), Platform, privileged path.

**Public services.** `createAssessment`, `publishAssessment`, `startAttempt`, `saveResponse`, `submitAttempt`, `getAttempt`, `getAudience`, `generateQuestions` (published as AI event).

**Events published.** `AssessmentPublished`, `AttemptStarted`, `AttemptSubmitted`, `AssessmentResultsPublished`, `AIRequested` (question generation).

**Events consumed.** None in v1 (result display reads grades through Grading's service — the result views belong to Grading's surface).

**Dependencies.** Learning (programs/groups/enrollments/teams), Content (node attachment), Identity (users), Subscription (quota), Notifications (outbox), Audit.

**Forbidden dependencies.** Grading (must not read `grades` directly), Files (no direct storage), Reporting, Search, AI, Platform.

**Owned entities.** D1 Assessment, D2 Exam, D3 Question Bank, D4 Attempt, D6 Assignment (DOMAIN_MODEL).

**Owned database tables.** D.1 `assessments`, D.2 `assessment_audiences`, D.3 `question_bank_items`, D.4 `assessment_questions`, D.5 `attempts` + `team_attempt_members`, D.6 `responses` (DATABASE_MODEL). All partitioned day one (DATABASE_MODEL §4.3).

**Background jobs.** None in v1 (grading is Grading's job; attempt expiry handling is request-path logic with rate limits).

**Security responsibilities.** Attempt integrity: guarded state transitions (no double submit, no silent overwrite of published results); anti-spam on start/submit; audience resolution never crosses tenants; attempt data is fail-closed under RLS.

**Multi-tenant responsibilities.** Assessments, questions, attempts, and responses all carry `tenant_id`; audiences are tenant-scoped; a student's attempt context never leaks across tenants (partitioning contract keeps `(tenant_id, ...)`-leading indexes — DATABASE_MODEL §4).

**Future extraction readiness.** Assessment is a strong extraction candidate with its queue boundary at `AttemptSubmitted` (SYSTEM_ARCHITECTURE §24); the partitioning contract (DATABASE_MODEL §4) is already the standalone-DB-ready shape.

---

## 10. Attendance

**Purpose.** Attendance tracking tied to training sessions (DOMAIN_MODEL C7; DATABASE_MODEL C.8) — a gating input for certificates and reports.

**Responsibilities.**
- Attendance records for training sessions (present/absent/late/justified per institution settings).
- Feed `AttendanceRecorded` events consumed by Certificates and Reporting.
- Enforce feature-flag availability (Attendance is a plan feature flag — PRODUCT_VISION §21).

**Owns.** Attendance records.
**May call.** Learning, Identity, Notifications, Audit.
**Must never call.** Assessment, Grading, Certificates, Reporting, Content, Files, Subscription, Tenant, Platform — attendance never interprets grades or certificates.

**Public services.** `recordAttendance`, `bulkRecord`, `getAttendance`, `updateRecord`.

**Events published.** `AttendanceRecorded`.

**Events consumed.** None.

**Dependencies.** Learning (sessions, enrollments), Identity, Notifications (outbox), Audit.

**Forbidden dependencies.** Everything downstream of Grading/Certificates/Reporting; direct writes to certificates or grades.

**Owned entities.** C7 Attendance (DOMAIN_MODEL).

**Owned database tables.** C.8 `attendance_records` (DATABASE_MODEL).

**Background jobs.** None in v1.

**Security responsibilities.** Attendance records are audit-relevant evidence: append/soft-change only, never rewritten in place by migrations (DATABASE_MODEL §6 item 8); recording requires enrollment in the session's tenant scope.

**Multi-tenant responsibilities.** Every record carries `tenant_id`; attendance is only recordable for enrollments in the same tenant; one tenant's attendance never affects another's certificates.

**Future extraction readiness.** Attendance is a leaf module; it extracts as part of a Learning-services group or stays embedded — no special seams needed.

---

## 11. Grading

**Purpose.** The grading engine: auto-grading of objective questions, manual review workflows, grade records, and appeals — **background-only** (never in the student's HTTP request — TECHNICAL_GUIDE §12; SYSTEM_ARCHITECTURE §12).

**Responsibilities.**
- Consume `AttemptSubmitted`; load attempt/responses through Assessment's public services.
- Auto-grading: compute per-question and total scores; write grade rows atomically.
- Manual grading: expose review work to teachers/evaluators; persist grades/feedback; publish result events.
- Team attempts: **one grade per (attempt, enrollment)** — per-member grades that may differ and are individually appealable (DATABASE_MODEL D.7).
- Grade publication and appeals: guarded transitions, audit-trailed.
- Publish `AttemptGraded` for Notifications, Certificates, and Reporting.

**Owns.** Grades.
**May call.** Assessment (attempts, responses, questions), Learning (enrollments/teams via assessment context), Notifications, Audit.
**Must never call.** Certificates, Reporting, Search, Files, Content, Subscription, Tenant, Identity, Platform. Grading never writes attempt state directly — it asks Assessment to transition the attempt.

**Public services.** `gradeAttempt`, `reviewSubmission`, `publishGrade`, `appealGrade`, `resolveAppeal`, `getGrade`, `getResultView`.

**Events published.** `AttemptGraded`, `GradeAppealed`, `GradeAppealResolved`.

**Events consumed.** `AttemptSubmitted` (from Assessment), `AssessmentResultsPublished` (result publication reconciliation).

**Dependencies.** Assessment, Learning, Notifications, Audit.

**Forbidden dependencies.** Certificates and Reporting (they read grades through Grading's services — the dependency points the other way); direct response-table access.

**Owned entities.** D5 Grade (DOMAIN_MODEL).

**Owned database tables.** D.7 `grades` (DATABASE_MODEL).

**Background jobs.** Auto-grading jobs (from `AttemptSubmitted`); manual-review reminder jobs (via Notifications events).

**Security responsibilities.** Grades are evidence: append/soft-change only, never rewritten by migrations (DATABASE_MODEL §6 item 8); a teacher can grade only within their tenant/program scope (Authorization enforced on every review action); publication transitions are guarded; appeals are audited.

**Multi-tenant responsibilities.** Every grade carries `tenant_id`; grade rows reference (attempt, enrollment) within the tenant; team grades are per-member and tenant-scoped; no grade ever surfaces outside its tenant.

**Future extraction readiness.** The grading engine is the #1 worker-tier extraction candidate (SYSTEM_ARCHITECTURE §24): it is already a queue consumer with a pure function shape and can become a standalone worker service with no architectural change.

---

## 12. Certificates

**Purpose.** Certificate templates, condition-based issuance, revocation (PRODUCT_VISION §20; DOMAIN_MODEL E1, §3.4; DATABASE_MODEL E.1/E.2; SYSTEM_ARCHITECTURE §15).

**Responsibilities.**
- Certificate templates (per tenant, branded).
- Condition evaluation (content completion, attendance threshold, exam pass, project/lab completion, supervisor approval — DOMAIN_MODEL §3.4) triggered by domain events.
- Issuance: create the certificate record, render the PDF, store it via Files, notify the recipient (queued — never in a request path).
- Revocation on condition reversal (e.g., appeal overturns a pass) with audit trail; public verification codes are a later feature.

**Owns.** Certificate templates and issued certificates.
**May call.** Learning, Grading, Attendance, Content, Files, Notifications, Audit.
**Must never call.** Assessment (grades come through Grading), Subscription, Tenant, Identity, Reporting, Search, AI, Platform.

**Public services.** `createTemplate`, `evaluateConditions`, `issueCertificate`, `revokeCertificate`, `verifyCertificate`, `getCertificate`.

**Events published.** `CertificateIssued`, `CertificateRevoked`.

**Events consumed.** `AttemptGraded`, `EnrollmentChanged` (completion), `AttendanceRecorded`, `TrainingSessionCompleted`, `PracticalLabSubmissionReceived`.

**Dependencies.** Learning, Grading, Attendance, Content, Files, Notifications, Audit.

**Forbidden dependencies.** Direct grade/attempt reads (always via Grading/Assessment services); direct attendance-table reads (via Attendance); direct file storage (via Files — quarantine rules and `Content-Disposition: attachment` apply, Decision Log #4).

**Owned entities.** E1 Certificate (DOMAIN_MODEL).

**Owned database tables.** E.1 `certificate_templates`, E.2 `certificates` (DATABASE_MODEL).

**Background jobs.** Condition evaluation jobs; PDF generation jobs; issuance notification jobs.

**Security responsibilities.** Issuance is idempotent (no duplicate certificates on re-evaluation); issuance/revocation are audit-logged; certificates are tenant-scoped files never served inline from the app domain; revocation of a condition marks certificates revoked with full audit trail.

**Multi-tenant responsibilities.** Certificates and templates carry `tenant_id`; conditions are evaluated strictly within the tenant's own data (grades, attendance, enrollments); one tenant's certificate never references another tenant's evidence.

**Future extraction readiness.** Certificates (templates + PDF generation) is a compact, event-driven worker module — a natural early extraction along with Grading.

---

## 13. Files

**Purpose.** File management with the mandatory File Upload Security Architecture: quarantine → malware scan → publish; tenant-scoped storage; presigned URLs; dedicated storage/CDN domain (Decision Log #4; TECHNICAL_GUIDE §9, §16; SYSTEM_ARCHITECTURE §13).

**Responsibilities.**
- Upload authorization: quota check (via Subscription), size/count/rate limits (10 MB images, 50 MB documents, 500 MB video defaults; rejected formats: EXE/DLL/SCR/BAT/CMD/PS1/JAR/MSI/APK/scripts/macro office docs — Decision Log #4).
- Issue tenant-scoped presigned upload URLs into the tenant's **quarantine prefix**; files land in state `quarantined` and are never servable.
- Magic-byte validation and malware scanning (queued); **fail-closed**: inconclusive/failed/unavailable scans keep the file quarantined and block publication.
- Publication (clean files only) with audit; downloads via tenant-scoped presigned URLs from the storage/CDN domain with `nosniff` and `Content-Disposition`.
- Storage quotas and lifecycle: deletion support for the Tenant purge workflow (batch delete jobs, orphaned-object sweep scoped to deleted tenants).

**Owns.** File records and their state machine.
**May call.** Subscription, Identity, Tenant, Background Workers, Notifications, Audit.
**Must never call.** Learning, Content, Assessment, Grading, Attendance, Certificates, Reporting, Search, AI, Integrations, Platform. Files never interprets domain payloads — it manages bytes and metadata only.

**Public services.** `requestUploadUrl`, `registerUpload`, `scanFile`, `publishFile`, `requestDownloadUrl`, `deleteFile`, `getQuotaUsage`.

**Events published.** `FileUploaded`, `FileScanSucceeded`, `FileScanFailed`, `FilePublished`, `FileQuarantined`.

**Events consumed.** `TenantStatusChanged` (suspended tenants cannot upload) — read via service; event consumption optional.

**Dependencies.** Subscription (quotas), Identity (owner), Tenant (scope), Background Workers (scan jobs), Notifications (outbox), Audit.

**Forbidden dependencies.** Direct object-storage access from any other module; serving files from the app domain; any module bypassing quarantine.

**Owned entities.** F3 File (DOMAIN_MODEL).

**Owned database tables.** F.1 `files` (DATABASE_MODEL).

**Background jobs.** Malware scan jobs; orphaned-object sweep execution (orchestrated by Tenant's deletion workflow, executed by Files).

**Security responsibilities.** All uploads are untrusted; magic bytes never replaced by MIME/extension; scan failure fails closed; files never served from the app domain; CSP never includes the storage domain in script/style sources; presigned URLs are tenant-scoped; cross-tenant file access (including presigned) is impossible and part of the CI isolation suite (Decision Log #4).

**Multi-tenant responsibilities.** Every file record carries `tenant_id` + owner; files live under tenant-scoped prefixes; downloads are scoped to the owning tenant's prefix.

**Future extraction readiness.** Files is storage-interface-swappable (R2 ↔ S3 ↔ MinIO — TECHNICAL_GUIDE §9, §28) and a clean service candidate; its quarantine/publish contract is the seam every other module already respects.

---

## 14. Notifications

**Purpose.** The notifications & events pipeline: production through the transactional outbox, preference-based delivery, realtime (SSE), email channel, retries and dead-letter (Decision Log #6; TECHNICAL_GUIDE §10; SYSTEM_ARCHITECTURE §10, §17).

**Responsibilities.**
- Own the **outbox / event bus**: any module publishes an event by calling `recordEvent` **in the same transaction** as its business action (at-least-once; no action commits without its event; no event without its action).
- Notification records, per-user preferences (per channel per category; enforced at dispatch time), versioned templates with tenant branding, categories (Content, Assessment, Membership, Billing, System) and priorities (Low, Normal, High, Urgent).
- Dispatcher (worker): atomic claim (`FOR UPDATE SKIP LOCKED`), channel filtering by preferences, template rendering (tenant-isolated), delivery: in-app, email (via mailer interface; Resend → SES at volume); future push/SMS behind the same channel interface.
- Retry policy: bounded exponential backoff — 5 attempts (1m, 5m, 15m, 1h, 6h) for transient failures; non-transient → dead-letter queue with reason; admin re-enqueue/discard via platform (privileged path).
- Realtime: **SSE over HTTP/2** with event-id resume; per-instance connection registry; PostgreSQL LISTEN/NOTIFY change signal (Phase 1) → Redis pub/sub later (provider swap, not redesign — Decision Log #6).
- Route domain events to subscriber workers (search sync, metering, AI, certificates, etc. — SYSTEM_ARCHITECTURE §17).

**Owns.** Notifications, the outbox/event bus, preferences, templates, realtime connections.
**May call.** Identity, Tenant, Background Workers, Audit.
**Must never call.** Learning, Content, Assessment, Grading, Attendance, Certificates, Files, Reporting, Search, AI, Integrations, Subscription, Platform. Notifications never reads domain tables to decide delivery — payloads travel with the event.

**Public services.** `recordEvent(type, tenantId, payload)` (the outbox write, called in-transaction by every producer), `recordNotification(...)`, `setPreferences`, `getPreferences`, `deliver` (dispatcher internal), `reEnqueueDeadLetter`.

**Events published.** `NotificationPreferencesChanged`, `NotificationDeliveryFailed` (ops/DLQ events).

**Events consumed.** None at the domain level (producers call `recordEvent`; the dispatcher consumes outbox rows — internal).

**Dependencies.** Identity (recipients, preferences), Tenant (branding), Background Workers (dispatcher execution), Audit.

**Forbidden dependencies.** Direct table access by producers (producers must call `recordEvent` — the outbox table is owned here); tenant data in template contexts; realtime subscriptions to another tenant's stream.

**Owned entities.** F2 Notification (DOMAIN_MODEL).

**Owned database tables.** F.2 `notifications`, F.3 `notification_outbox`, F.4 `notification_preferences`, F.5 `notification_templates` (platform defaults + tenant overrides — partial unique indexes, DATABASE_MODEL §6 item 9) (DATABASE_MODEL).

**Background jobs.** Dispatcher/outbox-claim jobs; digest aggregation (future); DLQ re-enqueue; outbox backlog monitoring.

**Security responsibilities.** Cross-tenant push impossible by construction (connection authorized per tenant context); template rendering never sees another tenant's data; preference hard opt-outs respected (Urgent may bypass digests, never opt-outs); DLQ depth monitored and alerted (TECHNICAL_GUIDE §10).

**Multi-tenant responsibilities.** Every notification/outbox row carries `tenant_id`; delivery, preferences, and realtime are tenant-scoped end to end; one tenant never reads or receives another tenant's notifications.

**Future extraction readiness.** Notifications & realtime is a designed standalone service (dedicated realtime tier, channel-agnostic pipeline — Decision Log #6); extraction is a packaging change.

---

## 15. AI

**Purpose.** AI features behind the provider gateway: AI question generator, AI course builder, PDF summarization, later AI grading assistance — queued only, quota-gated, provider-neutral (TECHNICAL_GUIDE §26; SYSTEM_ARCHITECTURE §14; DATABASE_MODEL G.2).

**Responsibilities.**
- Entitlement gate: AI features require the tenant's feature flag + monthly AI quota (per-plan limits — Decision Log #7).
- Consume `AIRequested` events (from Content course-building and Assessment question-generation flows); execute via the **LiteLLM gateway** (Anthropic Claude primary; provider swap is a config change).
- PII stripping before prompts; prompts/outputs never shared between tenants; no model training on tenant data (provider terms verified).
- Persist AI interactions (record per tenant with attribution) and publish completion events.
- Metering: each AI call is metered per tenant through Subscription (AI requests consume monthly quota; cost attribution per tenant).

**Owns.** AI interactions and the AI job pipeline.
**May call.** Subscription, Files, Content, Assessment, Notifications, Background Workers, Audit.
**Must never call.** Learning, Grading, Certificates, Reporting, Search, Integrations, Platform, Tenant, Identity — AI never auto-executes domain actions; outputs return to humans for approval.

**Public services.** `requestAIJob`, `getJobResult`, `generateQuestions`, `buildCourse`, `summarizePdf`.

**Events published.** `AIJobCompleted`, `AIJobFailed`.

**Events consumed.** `AIRequested` (from Content/Assessment).

**Dependencies.** Subscription (quota/entitlements), Files (PDF summarization sources via service), Content/Assessment (authoring context via events), Background Workers (execution), Notifications (outbox), Audit.

**Forbidden dependencies.** Direct provider calls outside the gateway; reading other tenants' content; executing AI outputs without human approval (prompt injection containment — TECHNICAL_GUIDE §26).

**Owned entities.** G2 AI Interaction (DOMAIN_MODEL).

**Owned database tables.** G.2 `ai_interactions` (DATABASE_MODEL).

**Background jobs.** AI job execution workers (queued, throttled by quotas); retry with backoff; cost/metering rollup via Subscription.

**Security responsibilities.** Cost runaway defense: per-tenant monthly quotas + per-user burst limits; prompt injection sandboxing (AI never granted elevated permissions, no auto-execution); PII-class treatment of all prompt payloads; every AI call audit-logged and attributed per tenant.

**Multi-tenant responsibilities.** Every AI interaction carries `tenant_id`; quotas are tenant-scoped (one tenant's usage never consumes another's); prompts never mix tenant data.

**Future extraction readiness.** AI is the #2 worker-tier extraction candidate (SYSTEM_ARCHITECTURE §24): event-driven, gateway-based, quota-gated — a standalone AI service with no architectural change.

---

## 16. Audit

**Purpose.** The immutable audit log — the single source of truth for sensitive operations; data, not logs (TECHNICAL_GUIDE §14, §16; DATABASE_MODEL G.1, §1.9, §3.8; SYSTEM_ARCHITECTURE §16).

**Responsibilities.**
- Append-only audit records written **in the same transaction** as the audited action (any module calls the Audit service within its transaction).
- Mandatory fields: actor, target tenant, action, reason (required on privileged actions), timestamp, request id — plus event-specific fields.
- Partitioned day one (DATABASE_MODEL §4.3); retention 7 years default with pre-drop PII purge by scheduled jobs.
- Survivor of tenant deletion: audit rows are never deleted with the tenant; the tenant reference becomes an opaque closure-record id (DATABASE_MODEL §5.1).
- Support platform auditing of any tenant through the privileged path only; tenants audit their own scope.

**Owns.** The audit log and its retention lifecycle.
**May call.** Nothing (leaf sink — no outgoing dependencies).
**Must never call.** Any module, ever. Audit consumes calls; it never initiates work.

**Public services.** `record(event)` — called in-transaction by every module (Identity, Tenant, Subscription, Authorization, Files, Notifications, Learning, Content, Assessment, Attendance, Grading, Certificates, AI, Integrations, Platform).

**Events published.** None (a sink by design).

**Events consumed.** None.

**Dependencies.** None.

**Forbidden dependencies.** Every module. Audit must never block or alter business outcomes beyond its own write.

**Owned entities.** G1 Audit Log (DOMAIN_MODEL).

**Owned database tables.** G.1 `audit_log` (DATABASE_MODEL).

**Background jobs.** Retention partition-drop jobs (7-year retention; PII-bearing fields purged before partitions fall out of the window — DATABASE_MODEL §4.7).

**Security responsibilities.** Immutability (no updates/deletes by application code; corrections are new records); mandatory reason on privileged actions; audit preservation after tenant deletion; tenant-isolation of audit queries.

**Multi-tenant responsibilities.** Every record carries `tenant_id`; records survive tenant closure as the permanent evidence trail; audit retention is platform-wide but queryable per tenant scope.

**Future extraction readiness.** Audit is already a cross-cutting sink; it becomes a shared audit service (or append-only stream) on extraction without changing any consumer's contract.

---

## 17. Reporting

**Purpose.** Reports and analytics: aggregations over learning, assessment, grading, attendance, certificates, and usage — heavy workloads that run on workers/replicas, never in student requests (PRODUCT_VISION §21; SYSTEM_ARCHITECTURE §4, §12).

**Responsibilities.**
- Define report queries over other modules' data **through their public services** (or read replicas when introduced — TECHNICAL_GUIDE §22).
- Scheduled and incremental report generation (queued); report outputs stored tenant-scoped (via Files) or streamed.
- Feed per-tenant analytics surfaces (dashboards); feed cost/usage attribution from Subscription metering.
- No `SELECT *` and no unbounded scans: all aggregation is bounded, paginated, and time-boxed (project rules; TECHNICAL_GUIDE §21).

**Owns.** Report definitions and derived outputs (no source tables).
**May call.** Subscription, Tenant, Learning, Content, Assessment, Grading, Attendance, Certificates.
**Must never call.** Files, Notifications, AI, Search, Integrations, Identity, Organization, Authorization, Platform — reporting reads through services only, never raw tables outside its own derived outputs.

**Public services.** `defineReport`, `runReport`, `scheduleReport`, `getReport`, `getDashboardData`.

**Events published.** None in v1.

**Events consumed.** `AttemptGraded`, `AttendanceRecorded`, `CertificateIssued`, `InvoiceIssued`, `PaymentSucceeded` (incremental aggregate maintenance); plus scheduled runs.

**Dependencies.** Subscription, Tenant, Learning, Content, Assessment, Grading, Attendance, Certificates.

**Forbidden dependencies.** Direct reads of owned tables of other modules; writes to any source table; heavy aggregation inside HTTP requests.

**Owned entities.** None (derived data only).

**Owned database tables.** None (derived outputs are Files/tenant-stored documents or ephemeral aggregates; no source tables owned).

**Background jobs.** Scheduled report jobs; incremental aggregate jobs.

**Security responsibilities.** Report scoping is tenant-strict: a report can only reference data of its own tenant (cross-tenant reporting is a Platform-authorized privileged operation, audit-logged — Decision Log #2).

**Multi-tenant responsibilities.** Every report query is tenant-filtered; per-tenant quotas bound report runs (no noisy-neighbor analytics); read replicas (later) serve reporting traffic without touching the primary's OLTP path (TECHNICAL_GUIDE §22).

**Future extraction readiness.** Reporting is a designed read-side service (replica-backed); its service-only reads make extraction a packaging change.

---

## 18. Search

**Purpose.** Course/program/content search: PostgreSQL FTS (Phase 1) → Meilisearch (Phase 2); tenant-filtered indexing and queries (TECHNICAL_GUIDE §13; SYSTEM_ARCHITECTURE §17).

**Responsibilities.**
- Maintain the search index from domain events (`ContentChanged`, `ContentPublished`, `ProgramPublished/Archived`, `AssessmentPublished`) via queue workers with retries.
- Every indexed document carries `tenant_id`; every query filters by tenant context; cross-tenant results impossible by construction.
- Tenant lifecycle integration: Archived → excluded by state (documents retained); Deleted → batch removal keyed on `tenant_id` (orchestrated by Tenant's deletion workflow, executed here); index consistency verified at end of deletion.
- Phase 1: `tsvector` + GIN indexes in PostgreSQL (no new infrastructure); Phase 2: Meilisearch behind the search interface when relevance/typo-tolerance/faceting demand it.

**Owns.** The search index and sync pipeline (no domain tables).
**May call.** Content, Learning, Background Workers.
**Must never call.** Assessment, Grading, Attendance, Certificates, Files, Reporting, Notifications, AI, Subscription, Tenant, Identity, Platform.

**Public services.** `search(query, tenantId, filters)`, `syncIndex`, `rebuildIndex`, `removeTenantDocuments`.

**Events published.** None (a sink).

**Events consumed.** `ContentPublished`, `ContentChanged`, `ProgramPublished`, `ProgramArchived`, `AssessmentPublished`.

**Dependencies.** Content, Learning, Background Workers.

**Forbidden dependencies.** Direct table reads (documents come from events and service calls); un-scoped queries; index writes from request paths.

**Owned entities.** None (index documents are projections).

**Owned database tables.** None (Phase 1 uses indexed columns on Content/Learning tables via the Content/Learning services' read surfaces; the search engine owns its own index store — currently PG FTS artifacts, later Meilisearch).

**Background jobs.** Index sync jobs; index consistency verification jobs; deletion-time batch removal jobs.

**Security responsibilities.** Index documents are tenant-tagged; queries are tenant-filtered at the engine level, not post-filtered; no tenant can query outside its own documents.

**Multi-tenant responsibilities.** Filter on `tenant_id` for every query; Archived tenants' results excluded by state; Deleted tenants fully removed with retries + consistency verification (Decision Log #5 item 8).

**Future extraction readiness.** Search is behind a narrow interface by design (PG FTS → Meilisearch is a provider swap — TECHNICAL_GUIDE §13, §28); extraction is a packaging change.

---

## 19. Integrations

**Purpose.** The external integration surface: public API access (API keys), MCP servers, future outbound webhooks, and lab level-2 integrations (TECHNICAL_GUIDE §4, §25; PRODUCT_VISION §12; SYSTEM_ARCHITECTURE §19).

**Responsibilities.**
- **API keys** for machine-to-machine/public API access: tenant-scoped, quota-limited (per-plan API quota — Decision Log #7), scoped through the Authorization engine.
- **MCP servers** (admin/ops first, content-authoring later): every tool call carries authentication, full authorization, **tenant context**, and an audit record (which agent, which tool, which tenant — TECHNICAL_GUIDE §25).
- **Outbound webhooks** (future, when tenants demand): signed, idempotent, queued delivery with retries.
- **Lab level-2 integrations** (future): institution API provisioning of training environments; a thin adapter surface (PRODUCT_VISION §12).
- Enforce API rate limits (per-key and per-tenant; fail-closed 503 — Decision Log #3).

**Owns.** API keys, MCP server runtime, outbound webhook registrations, lab integration adapters.
**May call.** Authorization, Subscription, Tenant, Notifications, Background Workers, Audit.
**Must never call.** Learning, Content, Assessment, Grading, Attendance, Certificates, Files, Reporting, Search, AI, Identity, Organization, Platform. Integrations is a shell — it never interprets domain payloads.

**Public services.** `issueApiKey`, `revokeApiKey`, `validateApiKey`, `registerWebhook`, `deliverWebhook`, `callMcpTool`, `provisionLab`.

**Events published.** `ApiKeyCreated`, `ApiKeyRevoked`, `LabIntegrationRequested`.

**Events consumed.** None in v1.

**Dependencies.** Authorization (key scoping), Subscription (API quotas), Tenant, Notifications (outbox), Background Workers (delivery jobs), Audit.

**Forbidden dependencies.** Bypassing the Authorization engine from MCP/webhook paths (an MCP server is an API — same authN/authZ/tenant rules, TECHNICAL_GUIDE §25); exposing privileged operations to agents without approval flows.

**Owned entities.** None (API keys are integration artifacts).

**Owned database tables.** B.10 `api_keys` (DATABASE_MODEL).

**Background jobs.** Outbound webhook delivery jobs (future); MCP call audit flushing (in-transaction).

**Security responsibilities.** API keys are secrets (hashed at rest); MCP tool calls can never become a back door (shared authorization code, tenant context on every call, audit on every call); webhook payloads signed and idempotent; prompt injection contained (agents never auto-execute actions without approval).

**Multi-tenant responsibilities.** API keys are tenant-scoped with per-tenant quotas; MCP tool calls resolve tenant context like any API request; cross-tenant agent access is denied by default.

**Future extraction readiness.** Integrations is the natural gateway/service boundary (API gateway + MCP catalogue at scale — TECHNICAL_GUIDE §4, §25); it extracts cleanly behind the Authorization engine.

---

## 20. Background Workers

**Purpose.** The queue and job runtime: pg-boss on PostgreSQL (Phase 1) → BullMQ + Redis when measured; the job execution harness (tenant context, idempotency, retries, DLQ, priorities) shared by every module's background jobs (TECHNICAL_GUIDE §12; SYSTEM_ARCHITECTURE §3, §9).

**Responsibilities.**
- Own the queue infrastructure (pg-boss now; BullMQ/Redis later per measured triggers) and the `jobs` table.
- Job contract enforcement: **every job carries `tenant_id` explicitly** (schema-validated — project rule, TECHNICAL_GUIDE §12).
- Execution harness: each job opens its own transaction and sets tenant context before queries (Tenant-Context Contract, TECHNICAL_GUIDE §5); at-least-once delivery with idempotent handlers.
- Retry/DLQ handling: bounded retries with backoff (notification default 1m/5m/15m/1h/6h), non-transient failures to dead-letter with reason; DLQ depth monitored.
- Priorities and dedicated worker pools during exam waves (grading/notification bursts — TECHNICAL_GUIDE §12, §22).
- Tenant lifecycle hooks: no new jobs after a tenant leaves Active; pending jobs drained/cancelled at offboarding; tenant jobs purged **before** DB purge so workers never operate on a deleted tenant (Decision Log #5 item 9).
- Route outbox events to subscriber workers (in coordination with Notifications' dispatcher).

**Owns.** The queue, job lifecycle, worker runtime.
**May call.** Nothing domain-level (infrastructure only).
**Must never call.** Any domain module — Background Workers executes jobs *defined* by modules; it contains no domain logic.

**Public services.** `enqueue(jobType, tenantId, payload)`, `schedule(cron)`, `claim`, `retry`, `deadLetter`, `cancelByTenant`.

**Events published.** `JobDeadLettered`, `JobFailed` (ops/alerting).

**Events consumed.** None (job execution is pull-based).

**Dependencies.** None (infrastructure layer).

**Forbidden dependencies.** Domain tables, domain services, the privileged path. Workers enforce the same RLS/authorization as the API through the Tenant-Context Contract — never through privileged connections (TECHNICAL_GUIDE §12).

**Owned entities.** None (jobs are infrastructure records).

**Owned database tables.** G.4 `jobs` (pg-boss queue — DATABASE_MODEL; drained/cancelled during offboarding, purged before tenant DB purge — Decision Log #5).

**Background jobs.** The runtime itself: scheduled job execution, retry timers, DLQ management, fair-queueing between tenants (later refinement — TECHNICAL_GUIDE §12).

**Security responsibilities.** Job payloads are tenant-tagged and schema-validated (no lost `tenant_id` in async work); fail-closed tenant context; idempotent execution tolerates re-delivery; dead-letter inspection/re-enqueue only via authorized (platform/tenant-admin) paths.

**Multi-tenant responsibilities.** Jobs are tenant-scoped end to end; one tenant's bulk jobs never starve others (priority queues; fair-queueing later); workers never execute on deleted tenants.

**Future extraction readiness.** The worker tier is the extraction infrastructure: every module's jobs already run as standalone worker processes, and promoting a job family to a service is a packaging change (SYSTEM_ARCHITECTURE §24).

---

*Manara — Module Specification. Companion to `docs/PRODUCT_VISION.md`, `docs/TECHNICAL_GUIDE.md` (ADR + Decision Log), `docs/DOMAIN_MODEL.md`, `docs/DATABASE_MODEL.md`, and `docs/SYSTEM_ARCHITECTURE.md`. The module dependency graph is acyclic; any new dependency must respect the topological order in §3.*
