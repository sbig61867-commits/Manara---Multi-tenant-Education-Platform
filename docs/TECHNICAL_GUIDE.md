# Manara Technical Guide (Architecture Decision Record)

> **Document status:** Draft — Active review
>
> This document is the official Architecture Decision Record (ADR) for the **Manara** platform.
>
> **How to read this document:**
> - Every technology named in this document is a **recommendation**, not a final decision, unless explicitly recorded in the Decision Log (Section 29).
> - Recommendations marked **[RECOMMENDED]** are proposals that align with the preliminary choices in `docs/PRODUCT_VISION.md`. They become **decisions** only when approved by the team and logged in Section 29.
> - **Scope:** Manara is a multi-tenant Learning & Training SaaS platform (see `docs/PRODUCT_VISION.md`). This document covers platform architecture only.
> - **Scale assumption:** The platform must eventually support **hundreds of thousands of registered users** and tens of thousands of concurrent users during exam waves.
> - No application code is generated from this document. It is a reference for architecture and planning.

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [API Design](#4-api-design)
5. [Database](#5-database)
6. [Authentication](#6-authentication)
7. [Authorization](#7-authorization)
8. [Multi-tenancy](#8-multi-tenancy)
9. [Storage](#9-storage)
10. [Email](#10-email)
11. [Cache](#11-cache)
12. [Queue](#12-queue)
13. [Search](#13-search)
14. [Logging](#14-logging)
15. [Monitoring](#15-monitoring)
16. [Security](#16-security)
17. [Deployment](#17-deployment)
18. [CI/CD](#18-cicd)
19. [Git Strategy](#19-git-strategy)
20. [Branch Strategy](#20-branch-strategy)
21. [Performance Strategy](#21-performance-strategy)
22. [Scaling Strategy](#22-scaling-strategy)
23. [Backup Strategy](#23-backup-strategy)
24. [Disaster Recovery](#24-disaster-recovery)
25. [MCP Integrations](#25-mcp-integrations)
26. [AI Providers](#26-ai-providers)
27. [Cost Estimation](#27-cost-estimation)
28. [Future Migration Strategy](#28-future-migration-strategy)
29. [Decision Log](#29-decision-log)

---

## 1. Technology Stack

**Status:** Recommendation

### Recommendation

A **TypeScript full-stack, modular monolith**:

- **Language:** TypeScript everywhere (frontend, backend, tooling)
- **Frontend:** React + Vite SPA (see Section 2)
- **Backend:** NestJS on Fastify (see Section 3)
- **Database:** PostgreSQL, managed via Supabase, accessed with the standard `pg` driver over `DATABASE_URL` — **not** through the Supabase SDK (per PRODUCT_VISION: no binding of business logic to the Supabase SDK)
- **Architecture pattern:** Modular monolith — one application, clearly separated modules (Identity, Tenancy, Memberships, Programs, Content, Assessments, Certificates, Reports, Billing...), with the option to extract services later

### Why this recommendation

- One language across the stack reduces context switching and allows sharing validation logic and types.
- The modular monolith matches the vision document's structure and is the lowest-complexity architecture that still supports future service extraction.
- The stack is fully open-source, widely supported, and has a large hiring pool.
- It preserves the database decisions already made in PRODUCT_VISION (standard PostgreSQL, RLS, no Supabase SDK coupling).

### Alternatives considered

- **Next.js full-stack:** Ties frontend and backend into one framework; strong for SSR-heavy apps, but the vision defines a separate SPA + API backend (Vite + NestJS).
- **Go / Java / C# backend:** Excellent performance and type safety, but introduces a second language and complicates shared-code reuse with the frontend.
- **Microservices from day one:** Rejected — premature at this stage; the modular monolith provides the same module boundaries with far lower operational cost.
- **Multiple repositories (polyrepo):** Rejected for now; a monorepo matches the single deployable monolith.

### Free/Paid

All core technologies are free and open source. Only managed services (database, hosting) have paid tiers, detailed per section.

### Estimated upgrade point

- Keep the modular monolith through v1 and early growth.
- Revisit when: (a) the team exceeds ~15–20 engineers, (b) a module has independent scaling/regulatory needs, or (c) deploy frequency of one module starts blocking another. Extract modules as services only at that point.

### Risks

- **Monorepo sprawl:** Mitigate with clear module ownership, linting, and build-time boundaries.
- **NestJS abstraction complexity:** Learning curve; mitigated with disciplined structure and internal conventions.
- **TypeScript runtime performance:** Heavy CPU work (grading, analytics, AI) must move to queue workers, never run in the HTTP request path.

### Long-term scalability

- Modular monolith → service extraction without a rewrite (strangler-fig style, see Section 28).
- Stateless application instances scale horizontally; queues/workers scale independently (Section 22).

### Impact on multi-tenant SaaS architecture

- A single codebase means tenant-context logic lives in one place (Section 8), avoiding duplicated or divergent per-tenant logic across services.
- TypeScript + shared validation reduces the risk of cross-tenant data leaks via unvalidated payloads.

---

## 2. Frontend

**Status:** Recommendation

### Recommendation

- **React 19 + TypeScript** — SPA built with **Vite**
- **React Router** for client-side routing
- **TanStack Query** for server state (caching, retries, optimistic updates)
- **React Aria Components** (headless, accessible primitives) for UI building blocks
- **React Hook Form + Zod** for forms and validation (schemas shared with the backend)
- **CSS Variables / design tokens** for theming — required for per-tenant white-labeling
- **PWA** (offline support, installability) — later phase, not v1
- **RTL + Arabic i18n** first-class from day one (Manara is an Arabic-first product)

### Why this recommendation

- Aligns with PRODUCT_VISION's stated frontend stack.
- Headless UI (React Aria) gives full control over styling, essential for per-tenant theming, and ships strong accessibility + RTL support out of the box.
- Vite offers fast builds and simple static deployment.
- TanStack Query is the de-facto standard for server state in React SPAs.

### Alternatives considered

- **Next.js:** SSR/SEO advantages, but conflicts with the vision's SPA approach and adds framework coupling.
- **Angular / Vue / Nuxt:** Viable, but diverge from the vision document.
- **Batteries-included component libraries (MUI, Ant Design, shadcn/ui):** Faster initial UI, but harder to white-label and theme per tenant; React Aria was chosen instead.
- **Tailwind CSS:** Can be adopted later for utility styling; the vision's "CSS Variables" approach does not exclude it — this is an open detail, not a decision.

### Free/Paid

All free, open source. No paid frontend dependencies expected.

### Estimated upgrade point

- Add **SSR or prerendering** (or a separate marketing site) when public SEO pages matter — SPA-only pages rank poorly.
- Add **state splitting / micro-frontends** only if the app grows beyond a single coherent team; unlikely for this product.

### Risks

- **SEO gap for an SPA:** Mitigated with a static marketing site or prerendering later.
- **Headless components mean more custom code:** Slower initial UI velocity; mitigated by building a small internal design system early.
- **Bundle size growth:** Mitigated with code splitting and lazy loading (Section 21).

### Long-term scalability

- Code splitting, route-level lazy loading, and PWA offline caching keep the SPA viable at scale.
- Static assets behind a CDN (Section 9) keep page loads fast worldwide.

### Impact on multi-tenant SaaS architecture

- Per-tenant **theming via runtime CSS variables** (tenant loads its design tokens from the API) — no rebuilds per tenant, no code forks.
- i18n + RTL must be data-driven per tenant (language preference per user and per tenant).
- Feature flags from the tenant's plan (Section 8) gate UI features at runtime.

---

## 3. Backend

**Status:** Recommendation

### Recommendation

- **NestJS** as the application framework, running on the **Fastify** adapter
- TypeScript, decorator-based modules, dependency injection
- **OpenAPI** generated from NestJS decorators (Section 4)
- Modular structure mirroring the vision's core components: Identity, Authentication, Tenancy, Memberships, Invitations, Authorization, Audit, Notifications, Learning Programs, Enrolments, Content, Assessments, Practical Labs, Certificates, Reports, Billing, File Management
- **Zod validation** at the service layer before any database access (defense in depth, per the project rules)

### Why this recommendation

- NestJS enforces module boundaries — exactly what a modular monolith needs to stay clean.
- Fastify is significantly faster than Express and has first-class NestJS adapter support.
- Built-in pipes/guards/interceptors provide centralized request validation and authorization hooks — crucial for consistent multi-tenant enforcement.
- Aligns with PRODUCT_VISION's stated backend stack.

### Alternatives considered

- **Express:** Unstructured at scale; teams must invent their own architecture.
- **Pure Fastify + DIY structure:** Fast, but requires self-imposed discipline with no framework enforcement.
- **Hono / AdonisJS / other Node frameworks:** Viable, but smaller ecosystems than NestJS.
- **.NET / Spring / Django / Laravel:** Excellent frameworks, but split the stack from the TypeScript frontend and contradict the vision document.

### Free/Paid

Free, open source.

### Estimated upgrade point

- Keep the modular monolith. Extract modules (e.g., grading engine, AI service) into separate deployables **as workers**, not separate web apps, initially.
- Revisit service extraction per Section 1's criteria.

### Risks

- NestJS "magic" (decorators, DI, providers) can obscure behavior — mitigated with strong internal conventions and reviews.
- Fastify adapter differences vs the Express ecosystem — check plugin compatibility before adopting any NestJS/Express-ecosystem plugin.
- Framework version churn — pin versions and review upgrade guides.

### Long-term scalability

- Stateless NestJS instances scale horizontally behind a load balancer (Section 22).
- AsyncLocalStorage-based request context keeps tenant tracking clean across asynchronous work within a request.

### Impact on multi-tenant SaaS architecture

- **Per-request tenant context** (tenant_id resolved from the authenticated session, stored in AsyncLocalStorage) — guards and pipes enforce tenant scoping automatically; no developer can forget it.
- Service-layer validation + authorization checks are the **first** defense line; RLS is the second (Section 7).

---

## 4. API Design

**Status:** Recommendation

### Recommendation

- **REST + OpenAPI 3.1**, generated from NestJS decorators, published for internal and (later) partner consumption
- URL prefix `/v1`, JSON bodies, UTF-8 (Arabic-first)
- **Cursor-based pagination** for all list endpoints (no unlimited `SELECT`; project rule)
- **Versioning:** additive changes only within a version; breaking changes require a new major version
- Shared **Zod schemas** between frontend and backend for request/response validation
- No tenant parameter in request bodies — tenant always comes from the authenticated context (never trust the client)

### Why this recommendation

- Contract-first docs keep frontend/backend in sync and give tenants a stable integration surface.
- Cursor pagination scales to huge lists without offset-scan degradation.
- REST is the simplest contract for third-party integrations (universities' IT departments, partner systems).
- OpenAPI is listed in PRODUCT_VISION.

### Alternatives considered

- **GraphQL:** Powerful querying, but authorization/per-tenant isolation must be re-implemented per resolver — a real leak risk at multi-tenant scale. Caching is harder. Rejected for the public API.
- **gRPC:** Efficient and typed, but poor browser tooling and awkward for external integrations; could be adopted **internally** if services are extracted.
- **tRPC:** Great DX within a full-Node project, but weak as an external contract; not suitable as the public API.

### Free/Paid

Free, open source.

### Estimated upgrade point

- Add an **API gateway** (rate limiting, authN at the edge) when public/partner API usage grows.
- Add **webhooks** for tenant integrations when demanded.
- Adopt internal gRPC only if/when services are extracted.

### Risks

- Breaking changes without discipline — mitigated by versioning policy and CI checks on the OpenAPI spec.
- Under-documented endpoints — mitigated by requiring OpenAPI generation in CI.
- Over-fetching / N+1 — mitigated by code review and performance budgets (Section 21).

### Long-term scalability

- Stable REST contracts survive internal refactors; SDKs can be generated from OpenAPI for tenants later.
- Gateway + rate limiting prepare the API for public exposure.

### Impact on multi-tenant SaaS architecture

- Tenant identity is derived from the authenticated session, never from the request body — closes the most common cross-tenant vector.
- Every list endpoint is tenant-scoped by default; pagination limits prevent a tenant from scanning large slices of shared tables.

---

## 5. Database

**Status:** Recommendation

### Recommendation

- **PostgreSQL 16+** hosted on **Supabase** (managed), accessed via the standard **`pg`** driver through `DATABASE_URL`
- **Row Level Security (RLS)** enabled on all tenant-owned tables (second line of defense; per PROJECT rules)
- **Versioned SQL migrations** committed to the repository (run in CI and via deploy step; no ad-hoc schema changes)
- **Composite indexes** on real query patterns, always leading with `tenant_id`/`organization_id`
- **No Supabase SDK** in business logic (per PRODUCT_VISION); plain SQL with prepared statements
- **Connection pooling** via Supabase's pooler — **transaction mode only**, per the [Tenant-Context Contract](#tenant-context-contract-mandatory) below

### Why this recommendation

- PostgreSQL is the best fit for relational educational data (enrollments, grades, assessments, permissions).
- Managed hosting removes ops burden while keeping standard PostgreSQL — full vendor-neutrality (Section 28).
- PRODUCT_VISION explicitly defines this database approach.
- RLS gives a database-level safety net under the application-level checks.

### Alternatives considered

- **MySQL:** Mature, but weaker JSON/advanced features (FTS, partitioning) that Postgres offers.
- **MongoDB:** Flexible schema, but relational integrity is critical for enrollments/grades/audit — rejected.
- **AWS RDS/Aurora:** More manual ops; viable later for vendor-neutrality but not needed now.
- **Neon / PlanetScale (serverless Postgres):** Interesting, but add a provider-switch later if needed; Supabase is already chosen by vision.

### Free/Paid

Supabase has a generous free tier; production scale requires paid plans (per-project pricing). PostgreSQL itself is free.

### Estimated upgrade point

- **Pooler:** When concurrent connections approach provider limits (early growth).
- **Read replicas:** When reporting/analytics queries start contending with OLTP traffic (tens of thousands of concurrent users).
- **Partitioning:** For tables that grow extremely large (attempts, audit logs, notifications) — partition by time and/or tenant.

### Risks

- **RLS misconfiguration** is the #1 multi-tenant leak risk — mitigated by RLS policy tests in CI that attempt cross-tenant access and assert failure (Section 16).
- **Migration mistakes** at scale — mitigated by CI-run migrations against ephemeral databases and backward-compatible expand-contract patterns (Section 20).
- **Noisy-neighbor tenants** — mitigated by per-tenant limits and monitoring (Section 15).

### Long-term scalability

- Shared schema + strong indexes + partitioning scales to hundreds of thousands of users on one primary with replicas.
- Hyperscale tenants could move to a dedicated database later (Section 8 upgrade path).

### Impact on multi-tenant SaaS architecture

- **Every tenant-owned table carries `tenant_id`/`organization_id`** (PROJECT rule) with `(tenant_id, ...)` composite indexes — queries never scan other tenants' rows.
- RLS policy per table: `tenant_id = current_setting('app.tenant_id')` — transaction-local value set per the [Tenant-Context Contract](#tenant-context-contract-mandatory) — simple, join-free, per the project rules ("RLS بدون joins متعددة").

### Tenant-Context Contract (MANDATORY)

This contract is **mandatory** for every process that executes tenant-scoped database queries: API instances, background workers (Section 12), MCP servers (Section 25), and any future service. It is enforced by code review and by the tenant-isolation test suite (Sections 16 and 18). It is not negotiable and has no exceptions for tenant-scoped application traffic.

1. **Transaction-mode pooling only.** All connections to PostgreSQL used by tenant-scoped application traffic must go through the pooler in **transaction mode**.
2. **Session-mode pooling is rejected** for tenant-scoped application traffic. `current_setting()` is **session-scoped**: under session-mode pooling, a physical connection reused from request A (tenant X) by request B (tenant Y) would inherit X's `app.tenant_id`, causing RLS to filter Y's data under X's context — a cross-tenant data exposure. Session-mode pooling is therefore forbidden; any future use requires a documented exception reviewed at platform level.
3. **Tenant context is set transaction-locally**, with:

   ```sql
   SELECT set_config('app.tenant_id', $tenant_id, true);
   ```

   The `true` argument makes the setting **transaction-local**: it lives and dies with the enclosing database transaction.

4. **Same-transaction requirement:** the `set_config` call must be executed **inside the same database transaction** as all tenant-scoped queries of the request, and before the first tenant-scoped query of that transaction.
5. **Autocommit is forbidden** for tenant-scoped queries. Every tenant-scoped operation runs inside an explicit transaction (`BEGIN` … `COMMIT` / `ROLLBACK`). A request whose queries run in autocommit mode is a defect.
6. **RLS policies read the transaction-local value**: `tenant_id = current_setting('app.tenant_id')`. Because the value is transaction-local, RLS always evaluates against the tenant of the current transaction — never a leftover from a previous transaction on the same pooled connection.
7. **Fail-closed behaviour when tenant context is missing.** If `app.tenant_id` is absent, empty, or not set for the current transaction, the application **must abort the operation** — it must never fall back to an unscoped query, never default to a tenant, and never run "as system". RLS fails closed at the database too: with the setting missing, `current_setting('app.tenant_id')` evaluates to NULL, every policy comparison is NULL → false, and **zero rows are returned**. Both layers are required: the application guard (abort + alert) and the database behaviour (empty results). Missing context is always treated as an incident, never as a silent path.
8. **Mandatory integration test (tenant-context leak test).** The tenant-isolation suite (Sections 16, 18) must include a test that proves this contract:
   - Opens a connection through the **pooled** path (the same pooler/connection-reuse mechanism used in production).
   - Executes a tenant-scoped request for tenant X on that connection, then a subsequent request for tenant Y **reusing the same pooled connection**.
   - Asserts that each request observes only its own tenant's rows, and that tenant context never leaks between sequential requests on the reused connection.
   - Asserts fail-closed behaviour: a tenant-scoped query executed without `app.tenant_id` returns no rows and/or the application aborts.
   - The test runs in CI, is a blocking gate on merge, and must fail on any leak.
9. **Scope and exemptions:** the contract applies to every tenant-scoped data path, including background workers (each job opens its own transaction, sets the context first, then executes its queries) and MCP servers. Platform-level operations (super admin tooling, migrations) run on dedicated privileged connections outside this contract, per the Super Admin Access Model (Section 8), and are audited separately (Section 16).

---

## 6. Authentication

**Status:** Recommendation

### Recommendation

- **Self-hosted authentication module inside NestJS** — deliberately **not** Supabase Auth (per PRODUCT_VISION: no reliance on Supabase Auth)
- **Argon2id** for password hashing
- **Opaque server-side sessions for all browser users — FINAL DECISION** (logged in Section 29, Decision Log #1):
  - Session data stored in **PostgreSQL** (session table) initially; session transported via **secure HttpOnly cookies** (Secure, HttpOnly, SameSite, plus CSRF protection)
  - **Exact logout and immediate session revocation** — deleting a session row revokes it instantly; every request re-validates the session against the store
  - **No JWTs for normal browser authentication** — JWTs cannot be revoked without denylist/versioning machinery and are not used as the browser session mechanism
  - **JWTs may be used later only for explicitly designed machine-to-machine or public API access** (Section 4), never as the browser session mechanism
- Password rules — **FINAL DECISION**: minimum 12 characters, maximum 128 characters, no uppercase/lowercase/digit/special-character requirements (passphrases fully supported); login rate limiting (5 attempts / 10 minutes), forgot-password flow with email tokens, account lockout
- **MFA (TOTP)** and **passkeys** as later phases
- Sessions are tenant-aware only through memberships (Section 8) — authentication proves *who* you are, authorization decides *what* you can access

### Session lifecycle policy (FINAL DECISION)

- **Absolute expiry:** sessions have a maximum lifetime — initial default **24 hours**, configurable via platform settings, not code.
- **Idle timeout:** sessions expire after a configurable idle period — initial default **30 minutes**; activity refreshes the last-active timestamp.
- **Rotation after login:** every login creates a fresh session ID and destroys any prior session (no session fixation).
- **Rotation after privilege changes:** when a user's roles, memberships, or entitlements change, the session is rotated (new session ID issued) and authorization is re-evaluated per request (Section 7), so the change applies immediately.
- **Revocation on password reset:** all of the user's sessions are revoked when the password is reset or changed; the user must re-authenticate.
- **Revocation is immediate and exact:** deleting a session row takes effect on the next request — no token TTL to wait out.
- **Provider-neutral design:** the session store sits behind an internal interface. PostgreSQL is the initial implementation; Redis (Section 11) is a provider swap, not a rewrite.
- **Measured trigger for PostgreSQL → Redis (session storage):** move the session store when instrumentation (Section 15) shows session queries dominating the primary — initial thresholds: session-related queries > 20% of total primary queries, or auth-path p95 latency > 100 ms sustained, or primary CPU attributed to session queries above 50% for a sustained period. The move is decided from measurements, never forecasts.

### Why this recommendation

- The multi-tenant membership model (one account, memberships in many tenants) is custom and central to the product — a self-built module keeps it fully under control.
- Vendor-neutrality: no dependency on a third-party auth provider that could change pricing or features.
- PRODUCT_VISION explicitly rejects Supabase Auth.

### Alternatives considered

- **Supabase Auth:** Rejected by vision (vendor lock, less control over multi-tenant membership flows).
- **Auth0 / Clerk / Okta:** Excellent, but costly per-user pricing at hundreds of thousands of users and less control over the custom membership model.
- **Keycloak (self-hosted):** Powerful (SSO/SAML built-in) but heavy to operate; revisit at the enterprise/SSO phase.

### Free/Paid

Self-built module: free. Alternative SaaS providers: freemium → expensive at scale.

### Estimated upgrade point

- **SSO/SAML/SCIM** when enterprise tenants demand it → integrate Keycloak or a SaaS provider as an identity *federation* layer on top of the existing module.
- **MFA enforcement** per tenant plan when security requirements grow.

### Risks

- **Security burden is ours:** Mitigated by Argon2id, session rotation, rate limiting, and regular dependency/security reviews (Section 16).
- **Session store scalability:** DB-backed sessions add load on the primary — mitigated by the provider-neutral session-store interface and the defined measured trigger for moving to Redis (Section 11), per the Session lifecycle policy above.
- **Cookie/CSRF complexities:** Mitigated with SameSite=Strict/Lax + CSRF tokens where needed.

### Long-term scalability

- Auth is a pure, stateless flow — scales with application instances; the session store moves to Redis (Section 11) when the measured trigger fires, via the provider-neutral interface.
- Passkeys/FIDO2 reduce password risks at scale.

### Impact on multi-tenant SaaS architecture

- **One global identity; tenancy lives in memberships.** A user logs in once and can switch between tenant contexts.
- Logout/revocation is global; session data never contains tenant-scoped authorization decisions (those are re-evaluated per request, per Section 7).

---

## 7. Authorization

**Status:** Recommendation

### Recommendation

- **RBAC + ABAC hybrid:** Roles (RBAC) scoped to a context (tenant, unit, program, group) plus attribute checks (feature flags, plan limits, status) — matching PRODUCT_VISION's permission model exactly
- **Central permission module** (e.g., CASL or a custom in-house engine — library choice is an open detail)
- **Service-layer authorization checks first** (the primary defense), **RLS second** (the safety net)
- **Deny by default:** every endpoint requires explicit permission resolution; no "admin bypass" shortcuts
- **Permission caching** with tenant-aware keys when profiling demands

### Why this recommendation

- The vision's model (role + membership + scope + feature flags + plan + status) is a textbook RBAC+ABAC hybrid; building the permission engine centrally avoids scattered, inconsistent checks.
- The project rule mandates service-layer validation before DB access, with RLS as a second line — this design implements that rule.

### Alternatives considered

- **CASL:** Good TS library; supports scope-based rules; strong candidate for the internal engine (open detail).
- **OPA / Rego (policy-as-code):** Powerful but heavy for this stage; revisit if policies explode.
- **Hardcoded per-endpoint checks:** Anti-pattern; rejected (impossible to audit, easy to miss).

### Free/Paid

Free, open source (custom or CASL).

### Estimated upgrade point

- **OPA/Rego** if the permission matrix grows beyond what an in-house engine can maintain.
- **Dynamic per-tenant roles** (tenants define their own roles) — a later premium feature.

### Risks

- **Permission scope bugs** (e.g., a teacher granted access across programs) — mitigated by exhaustive unit tests over the permission matrix.
- **Over-broad defaults** — mitigated by deny-by-default and review checklists.
- **RLS and app-layer drift** — mitigated by the isolation CI suite (Section 16).

### Long-term scalability

- A central permission engine keeps authorization consistent even as services are extracted (shared library).
- Cached permission resolutions scale to high request rates.

### Impact on multi-tenant SaaS architecture

- Roles live in `user_roles` with explicit scope columns (tenant_id, unit_id, program_id, group_id...) per the vision.
- Every check evaluates: role + scope + feature flag + plan + status — preventing both vertical and horizontal privilege escalation.

---

## 8. Multi-tenancy

**Status:** Recommendation

### Recommendation

- **Shared database, shared schema, row-level isolation:** every tenant-owned table carries `tenant_id`/`organization_id`; RLS enforces isolation at the database layer
- **Application-level tenant context** (AsyncLocalStorage) resolved from the session, enforced by NestJS guards on every request
- **Connection pooling** (Supabase pooler) to handle many concurrent tenants' traffic
- **Per-tenant feature flags, usage limits, and quotas** (plan-driven) enforced in the service layer, per the Billing & Subscription Architecture below
- **Audit logging** of tenant-scoped operations (Section 16)

### Why this recommendation

- Cheapest to operate and simplest to migrate/shard — one schema to evolve.
- PostgreSQL RLS is battle-tested at large scale (GitLab, Supabase themselves).
- Matches the vision's strict-isolation requirement with the lowest complexity.
- The project rules explicitly require direct `organization_id` checks and simple RLS without multi-level joins.

### Alternatives considered

- **Schema-per-tenant:** Strong isolation, but migration/ops cost multiplies with every tenant — painful at hundreds of tenants.
- **Database-per-tenant:** Maximum isolation, but expensive and operationally heavy; reserved only for hyperscale tenants later (Section 22).

### Free/Paid

Free (native PostgreSQL feature). Pooler/replicas are paid managed features at scale.

### Estimated upgrade point

- **Composite indexes + partitioning** for hot tables at scale.
- **Read replicas** for reporting.
- **Dedicated database** for a single hyperscale tenant (rare, handled case-by-case).

### Risks

- **Cross-tenant leakage** — the top risk of the whole product; mitigated by three layers (validation → service → RLS) plus a CI isolation test suite that attempts cross-tenant access and must fail (Section 16).
- **Noisy-neighbor tenants** starving others — mitigated by quotas and monitoring.

### Long-term scalability

- Row-level isolation scales to hundreds of thousands of users across all tenants on one primary + replicas.
- Partitioning (by time, with tenant_id as the leading key) keeps the largest tables manageable.

### Impact on multi-tenant SaaS architecture

This *is* the multi-tenant architecture. The core principle, enforced everywhere:

1. Tenant context is never client-supplied (always derived from the session).
2. Every query and mutation carries `tenant_id` from the context.
3. RLS is a safety net, never the only defense.
4. Background jobs carry `tenant_id` explicitly (Section 12).
5. Super Admin (platform-level role) is the only exception to tenant scoping — never a normal tenant role — per the Super Admin Access Model below.
6. Tenant context is applied to the database through the mandatory [Tenant-Context Contract](#tenant-context-contract-mandatory) in Section 5: transaction-mode pooling only, session-mode pooling rejected, transaction-local `set_config('app.tenant_id', ..., true)` in the same transaction as all tenant-scoped queries, autocommit forbidden, fail-closed on missing context.

### Super Admin Access Model (FINAL DECISION)

Super Admin and the other platform-level roles (Support Admin, Billing Admin, Security Auditor — per PRODUCT_VISION) are the only exception to tenant scoping. Their access follows this model, logged as Decision Log #2 (Section 29):

1. **Dedicated privileged path.** All cross-tenant platform operations run through a **dedicated privileged database role** on a **dedicated privileged connection path**, separate from the application's normal tenant-scoped pool.
2. **Normal traffic never uses the privileged path.** Tenant-scoped application traffic (API requests, background workers, MCP servers) always connects through the standard transaction-mode pool with transaction-local tenant context (Tenant-Context Contract, Section 5). Any normal code path using the privileged connection is a defect.
3. **Cross-tenant access is denied by default.** The privileged role confers no implicit access to any tenant's data. A cross-tenant operation is permitted only when explicitly authorized for that operation on that target tenant — there is no "access everything" default.
4. **Every Super Admin action is explicitly authorized.** Every action must pass an explicit authorization check (Section 7) for the operation and the target tenant before execution. Platform roles are enumerated and grant only their scoped capabilities (e.g., Billing Admin cannot access learner data).
5. **Every cross-tenant action is audit-logged.** Each cross-tenant operation writes an Audit Log entry (Section 16) with, at minimum: **actor**, **target tenant**, **action**, **reason**, **timestamp**, and **request identifier**. An audit entry without a reason is a defect.
6. **Privileged access never relies on a missing tenant_id.** Absent tenant context is always fail-closed (Tenant-Context Contract item 7) — it never implicitly means "system level". Privileged operations state their target tenant explicitly; they do not run "without" a tenant.
7. **Isolated connection pool.** The privileged path uses its own dedicated connection pool, fully isolated from the normal application pool — privileged credentials never share a connection with tenant traffic, and no session-state leftover can cross between the two paths.
8. **Mandatory integration test (privileged-path isolation test).** The tenant-isolation suite (Sections 16, 18) must include a test that proves:
   - A request on the normal tenant-scoped path — including attempted elevation — cannot bypass RLS; cross-tenant access attempts with normal roles must fail.
   - Only the dedicated privileged path can perform an authorized cross-tenant operation, and doing so produces the mandatory audit record (actor, target tenant, action, reason, timestamp, request id).
   - The test fails if an authorized cross-tenant operation produces no audit record.
9. **Break-glass access rules.** Emergency platform access (data repair, incident response) follows break-glass rules: a **recorded reason is required** before the operation; the session is time-boxed and rotated after use; the action is audit-logged with its reason (per item 5); and every break-glass usage is reviewed in the next security review (Section 16). Break-glass grants no standing "always on" capability.

### Tenant Data Lifecycle Architecture (FINAL DECISION)

Logged as Decision Log #5 (Section 29). Governs the complete lifecycle of every tenant and its data.

1. **Complete tenant lifecycle:**
   - **Draft:** tenant created, setup in progress — no member access, platform-only.
   - **Active:** fully operational; plan entitlements enforced (Sections 8, 27).
   - **Suspended:** billing failure or platform decision — writes blocked (read-only or full lock per suspension reason); data fully intact; platform action required to resume.
   - **Grace Period:** transitional state after suspension or before archive — initial default **30 days** (configurable per plan); members notified; export available; data fully retained.
   - **Archived:** tenant deactivated after grace — all data retained, inaccessible to members; reactivation possible within the retention window.
   - **Deleted:** irreversible — follows the deletion workflow below; only audit and legal-hold records survive.
2. **Tenant offboarding:** the orchestrated process: notify tenant admins → export window (item 3) → service termination → transition through Grace → Archived → Deleted. Offboarding requires platform authorization (Super Admin Access Model, Section 8) and is audit-logged. Offboarding never deletes data directly — it schedules lifecycle transitions.
3. **Tenant data export:** tenants may request export of their data (members, programs, content metadata, assessments and results, certificates, file manifests) via queued jobs (Section 12). Export produces a structured package (CSV/JSON + manifest) in a tenant-scoped export bucket with bounded lifetime (initial default **14 days**); exports contain only the requesting tenant's data (Tenant-Context Contract, Section 5), are rate/quote-limited, audit-logged, and remain available through Grace Period.
4. **Data retention policy:**
   - Active / Suspended / Grace: full retention (backups per Section 23).
   - Archived: full retention for a defined archive window (initial default **1 year**, configurable); eligible for deletion only after the window elapses.
   - Deleted: purge completes within a bounded window (initial default **90 days** post-deletion, configurable).
   - **Legal hold overrides** retention and deletion timelines (item 10).
5. **Tenant deletion workflow:** explicit, authorized, staged:
   - Triggered only by a platform admin action with a recorded reason (break-glass rules apply for urgency).
   - Requires grace period elapsed (or absence of legal hold) and notification/export done.
   - Scheduled **purge jobs** (Section 12) delete tenant rows feature-by-feature in dependency order (child tables first: responses, attempts, grades, submissions → content, assessments, enrollments → memberships, roles → tenant-scoped resources), every job carrying `tenant_id`.
   - A **deletion journal** tracks progress; any failure aborts with an alert — partial deletion is detected and reported, never silently left inconsistent (fail-closed).
6. **Soft-delete vs hard-delete policy:**
   - **Soft-delete:** used for reversible states (Suspended/Archived tenants, revoked memberships, hidden content) — rows retained with a status/`deleted_at` marker; used for every interactive, reversible decision.
   - **Hard-delete:** used only for irreversible tenant termination (Deleted) and where law or storage policy requires physical removal; executed exclusively by purge jobs — never by application requests; batched and throttled to protect the primary (Section 22).
   - The two never interleave in application code: app code soft-deletes; purge jobs hard-delete.
7. **Storage cleanup:** on deletion, files under the tenant's prefixes/buckets are removed via lifecycle policies or explicit batch delete jobs (Section 12); object versioning retained only briefly (configurable) then purged; an orphaned-object sweep within the deleted tenant's scope removes files with no DB record. A tenant being deleted is the only tenant the sweep ever touches.
8. **Search index cleanup:** documents are indexed with `tenant_id` (Section 13). On Archive, results are excluded by tenant state (documents retained — cheap reactivation). On Delete, documents are batch-removed keyed on `tenant_id` as part of the deletion workflow; failures retry; index consistency is verified at the end of deletion.
9. **Queue cleanup:** no new jobs are enqueued once a tenant leaves Active; pending/retrying jobs are drained or cancelled at offboarding start; on deletion, remaining jobs for the tenant are purged **before** the DB purge so workers never operate on a deleted tenant (Section 12).
10. **Backup implications:** backups (Section 23) may retain hard-deleted tenant data until the backup retention expires (PITR/dumps). Policy: (a) restore drills include a **post-restore purge** re-running the deletion workflow for Deleted tenants on restored data; (b) retained/exported data follows the retention policy; (c) legal-hold data is excluded from purge and preserved in backups. Residual recoverability within backup retention is a documented, accepted risk.
11. **Legal hold:** a tenant (or tenant objects) can be placed under legal hold by a platform admin with a recorded reason. While held: no suspension-to-deletion progression, no hard-delete, retention preserved, exports available to authorized actors, audit records preserved. Hold is revoked only by another authorized platform action; both actions are audit-logged. Legal hold is the only override of retention and deletion timelines.
12. **Audit preservation after deletion:** audit log records (Section 16) and the deletion journal are **never deleted with the tenant**. Audit entries (actor, target tenant, action, reason, timestamp, request id) are retained per the audit retention policy (initial default **7 years**, configurable), with PII-bearing fields purged per policy and the tenant reference kept as an opaque identifier. This preserves compliance and post-deletion investigation.
13. **Mandatory integration tests (blocking CI gates, Sections 16/18):**
    - **Lifecycle transitions:** each transition (Draft → Active → Suspended → Grace → Archived → Deleted) occurs only via authorized actions; the state machine rejects illegal transitions.
    - **Offboarding:** suspension blocks writes and new job enqueues; reads follow policy.
    - **Export:** export contains only the requesting tenant's data — nothing from other tenants.
    - **Deletion residue:** after deletion, no rows, files, search documents, or jobs remain for the tenant (residue checks across DB, storage, search, queue).
    - **Isolation post-deletion:** deleting tenant A never touches tenant B's data.
    - **Legal hold:** a held tenant cannot be hard-deleted; retention is extended.
    - **Audit preservation:** audit records survive tenant deletion.
    - **Backup/restore:** post-restore purge of Deleted tenants works.

### Billing & Subscription Architecture (FINAL DECISION)

Logged as Decision Log #7 (Section 29). Provider-neutral: the payment provider sits behind an abstraction; no platform business logic is bound to a provider.

1. **Subscription plans.** Plans are data, not code: Starter, Professional, Enterprise, Custom (per PRODUCT_VISION). Each plan defines pricing, billing period (monthly/annual), feature entitlements, usage quotas, and limits (students/teachers/admins, organization units, courses, sections, exams, storage, monthly AI requests, API quota). Plans are versioned and effective-dated; changing plans never requires a deployment.
2. **Tenant subscriptions.** Each tenant has exactly one active subscription referencing a plan version, with status, period start/end, and trial marker. Subscriptions are tenant-scoped (`tenant_id`); billing is a platform-level capability operating per tenant under the Super Admin Access Model (Section 8).
3. **Feature entitlements.** Entitlements derive from the plan plus feature flags (AI Question Generator, AI Course Builder, Online Exams, Live Proctoring, Attendance, Certificates, Analytics, API Access, White Label, Custom Domain, Mobile App, SSO — per PRODUCT_VISION). Entitlement evaluation is centralized (an input to Section 7 authorization) and cached with tenant-namespaced keys (Section 11); plan or flag changes re-evaluate entitlements immediately (with session rotation per the Section 6 lifecycle policy).
4. **Usage quotas.** Quota limits per plan (max students/teachers/admins, courses, sections, exams, storage, monthly AI requests, API quota) are enforced at the service layer **before** the operation; exceeding a quota produces a clear error; quota state is tenant-scoped and updated atomically with the business action.
5. **Usage metering.** Metered events (AI requests, API calls, storage, email volume) are recorded per tenant with attribution (Section 14 logs, Section 26 AI attribution, rate-limit counters) through the platform metering pipeline. Metering feeds quota checks and cost attribution (Section 27); metering records carry `tenant_id` and are never written by tenant code directly.
6. **Billing lifecycle.** Active → Past Due → Suspended → Grace → Reactivated / Terminated. Transitions: invoice generation → payment attempt → success / failure → dunning → suspension → grace (Tenant Data Lifecycle, Section 8) → termination. Billing state integrates with the tenant lifecycle; legal hold or an explicit platform decision freezes progression.
7. **Trial period support.** New tenants may start on a trial (duration configurable per plan; initial default **14 days**) granting a defined plan's entitlements with full quota. Trial end converts to a paid plan **only with explicit tenant consent — never a silent auto-charge**; without consent, the tenant downgrades to a defined fallback state (read-only or suspension per the tenant lifecycle). Trial data is retained under normal retention.
8. **Subscription upgrades and downgrades.** Supported at any point in a billing period:
   - **Upgrade:** entitlements and quotas activate immediately (prorated charge); no data loss.
   - **Downgrade:** takes effect at period end by default (or immediately per tenant choice); quotas re-evaluated at effect — over-quota tenants enter defined over-limit handling: new usage above the limit is blocked, admins are warned, and **no data is deleted** (content above the limit is retained per the Tenant Data Lifecycle, never silently removed).
   - All changes are audit-logged with actor, tenant, plan, effective date, and reason.
9. **Invoice lifecycle.** Invoice generated per period end (or on proration for changes): draft → issued → paid / failed. Invoices are stored as data plus a PDF in tenant-scoped storage (Section 9); numbering is per tenant; dunning emails flow through Notifications (Section 10) on an escalation schedule; payment confirmation reconciles open invoices.
10. **Payment provider abstraction.** A narrow internal interface (create payment session, charge, refund, webhook ingestion, status queries) implemented by a payment provider. The provider decision is deferred and logged when adopted; candidates are considered without deciding here. No business logic depends on provider specifics; provider keys are secrets (Section 16).
11. **Webhook processing.** Provider webhooks (payment succeeded/failed/refunded, subscription events) are ingested through a signed, idempotent endpoint: verify provider signature → deduplicate by provider event id → process via the queue (Section 12) → update invoice/subscription state atomically → audit-log. Failures retry per the retry policy (Section 10); unknown or unverifiable webhooks are rejected.
12. **Idempotency.** Every billing mutation (charge, refund, webhook application, plan change) is idempotent, keyed by deterministic ids (provider event id, invoice id, request id); duplicate processing is a no-op. Webhook replays and queue at-least-once semantics are safe by construction.
13. **Audit requirements.** Plan changes, subscription changes, entitlement/flag changes, quota overrides, invoices, payments, refunds, webhook events, suspensions, and trial conversions are audit-logged (Section 16) with actor, tenant, plan, amount, status, timestamp, and request id. Billing audit records survive tenant deletion per the Tenant Data Lifecycle (Section 8).
14. **Tenant suspension for unpaid subscriptions.** Payment failure → dunning → past-due → **suspension**: the tenant moves to Suspended (Section 8 lifecycle) — writes blocked, reads allowed per policy, admins notified; no data deletion; successful payment reactivates the tenant and restores entitlements. Suspension is reversible and audit-logged.
15. **Grace periods.** Defined per plan: payment grace (initial default **7 days** after invoice date, dunning escalations within it) and tenant suspension grace (initial default **30 days**, per the Tenant Data Lifecycle). Grace gives admins time to pay without data loss; after grace, the tenant proceeds to Grace Period → Archived per the tenant lifecycle; legal hold freezes these flows.
16. **Mandatory integration tests (blocking CI gates, Sections 16/18):**
    - **Plan/entitlement evaluation:** entitlement matrix per plan; flag changes take effect immediately; downgrade re-evaluates quotas.
    - **Quota enforcement:** exceeding a quota is rejected atomically; metered events count per tenant only.
    - **Billing lifecycle:** payment success/failure → invoice → dunning → suspension → grace → reactivation, each transition only via authorized/expected events.
    - **Trial:** conversion and expiry paths; no silent auto-charge.
    - **Upgrade/downgrade:** proration, immediate vs period-end timing, over-quota downgrade handling (block new usage, no data loss).
    - **Webhook idempotency:** duplicate webhook delivery is processed exactly once.
    - **Provider abstraction:** a mock provider exercises the full flow — no provider-specific logic in platform code.
    - **Tenant isolation:** billing state of one tenant never affects another; one tenant's failed payment suspends only that tenant.
    - **Suspension:** a suspended tenant blocks writes and new AI/API usage; reactivation restores entitlements.
17. **Provider-neutral design.** Billing business logic is independent of the payment provider; switching providers is a config + adapter change, not a rewrite (consistent with Section 28).

---

## 9. Storage

**Status:** Recommendation

### Recommendation

- **S3-compatible object storage** behind an internal storage interface (abstraction keeps providers swappable)
- Start with **Cloudflare R2** **[RECOMMENDED]** (zero egress fees, generous free tier) — or **Supabase Storage** (convenience, if the Supabase relationship deepens); the exact choice is an open detail to be decided and logged
- **Private buckets by default**; downloads/uploads via **presigned short-lived URLs**; every upload follows the File Upload Security Architecture (Section 16): quarantine → malware scan → publish, served only from a dedicated storage/CDN domain
- Client-side (direct-to-storage) presigned uploads to avoid proxying large files through the API
- Files (course content, media, certificates, lab reports) reference `tenant_id` and belong to their tenant's prefix

### Why this recommendation

- Object storage scales to petabytes without server ops.
- Egress cost is the hidden killer of file-heavy platforms — R2's zero egress is a major long-term win for an education platform with video content.
- Presigned URLs keep secrets out of the application path.

### Alternatives considered

- **AWS S3:** The standard; predictable, but egress costs at scale; a fine fallback.
- **Google Cloud Storage / Azure Blob:** Equivalent; region/ecosystem considerations.
- **DigitalOcean Spaces:** Cheap, S3-compatible, smaller ecosystem.
- **MinIO (self-hosted):** Full control, but ops burden — not recommended now.
- **Local disk storage:** Rejected — does not scale or survive instance restarts (vision: no fake storage in the real system).

### Free/Paid

R2: generous free tier, then usage-based. S3/others: usage-based. MinIO: free (self-hosted).

### Estimated upgrade point

- **CDN** for media distribution when traffic is global.
- **Bucket-per-tenant** (instead of prefix-per-tenant) when billing/quota granularity demands it.
- **Media processing pipeline** (thumbnails, video transcoding) as a queue worker feature (Section 12).

### Risks

- **Cost creep** (storage + requests) — mitigated by lifecycle policies, quotas per plan, and monitoring (Section 15).
- **Key management** — never leak storage keys; use presigned URLs and env-based secrets (Section 16).
- **Data residency** — choose regions that satisfy tenant/regulatory needs (e.g., Middle East region for Gulf customers).

### Long-term scalability

- Object storage is inherently infinitely scalable; CDN + presigned URLs keep the app server out of the data path.
- Certificates (Section of vision: certificates) and media scale without database bloat (DB stores metadata only).

### Impact on multi-tenant SaaS architecture

- **Tenant isolation at the prefix/bucket level** plus per-tenant quotas tied to the plan (Section 5 of the vision).
- Presigned URLs are scoped to the tenant's own prefix; no cross-tenant file access is possible.

---

## 10. Email

**Status:** Recommendation

### Recommendation

- **Transactional email** through a managed provider behind a mailer abstraction — the email channel of the Notifications & Realtime Architecture below
- **Resend** **[RECOMMENDED]** for DX and developer experience at startup; **AWS SES** **[RECOMMENDED]** when volume makes cost matter (SES is far cheaper at high volume)
- Templates versioned in the repository; HTML + plain-text; Arabic RTL-aware templates
- Deliverability basics: SPF, DKIM, DMARC configured on the custom domain
- All sends (invitations, password resets, notifications) queued as background jobs (Section 12), never in the request path

### Why this recommendation

- Deliverability (inbox placement) is a specialist problem; managed providers solve SPF/DKIM/feedback loops for us.
- Provider abstraction keeps a future switch (e.g., SES → Postmark) cheap.
- Queued sends protect request latency during exam waves.

### Alternatives considered

- **SendGrid / Mailgun:** Mature, but pricing and deliverability reputation vary; fine alternatives.
- **Postmark:** Best-in-class deliverability for transactional mail; more expensive.
- **Self-hosted SMTP:** Rejected — deliverability nightmare, maintenance burden.

### Free/Paid

Resend: free tier (~3k emails/mo) then paid. SES: ~$0.10 per 1,000 emails — cheapest at volume.

### Estimated upgrade point

- Move to **SES** at high volume for cost.
- **Dedicated IPs** (SES) when reputation needs shielding from noisy senders.
- **Per-tenant from-addresses** and full white-labeling when enterprise tenants demand it.

### Risks

- **Spam folder placement** — mitigated by SPF/DKIM/DMARC, warm-up, and monitoring bounce rates.
- **Provider rate limits during exam waves** — mitigated by queueing + retries with backoff.
- **PII in emails** (links with tokens) — tokens must be short-lived and scoped.

### Long-term scalability

- Queued sends + provider elasticity handle tens of thousands of emails per wave.
- Broadcasting (newsletters) is a separate later feature — never mixed with transactional mail.

### Impact on multi-tenant SaaS architecture

- Every email job carries `tenant_id`; templates render tenant branding (name, logo, colors).
- Suppression lists and send preferences are per-tenant.

### Notifications & Realtime Architecture (FINAL DECISION)

Logged as Decision Log #6 (Section 29).

1. **Complete notification architecture.** A notification is a tenant-scoped, typed record (category, priority, recipient, payload, template, status) produced by any module (content, assessments, memberships, billing, system) through a single Notifications module. One pipeline: **produce → persist → deliver per preferences → track state → retry / dead-letter**.
2. **Channels:**
   - **In-app notifications:** primary channel — delivered via the realtime channel (item 12) and persisted for history/unread state.
   - **Email notifications:** delivered through the transactional email provider (Section 10) as queued jobs, governed by per-user preferences and tenant branding.
   - **Future push notifications:** mobile/web push as a later channel behind the same channel interface; provider decision deferred (logged when adopted) — never bypasses the pipeline.
   - **Future SMS providers:** the same — a channel behind the interface, for high-priority / low-volume events (e.g., exam start reminders, security alerts) when adopted; provider decision deferred.
3. **Outbox pattern (mandatory).** Notification creation writes a notification row **and** an outbox row **in the same database transaction** as the triggering business action (Tenant-Context Contract, Section 5). A dispatcher (queue worker, Section 12) claims and delivers outbox rows per preferences. Guarantee: no business action commits without its notification being recorded; no notification is delivered without its business action committing (at-least-once).
4. **Tenant isolation.** Every notification and outbox row carries `tenant_id`; delivery, preferences, and history are tenant-scoped per the Tenant-Context Contract; realtime subscriptions are authorized per tenant; one tenant never reads or receives another tenant's notifications.
5. **Per-user notification preferences.** Each user has per-tenant preferences per channel and per category (email: on/off/digest; in-app: on/off; push/SMS: future), with defaults from the tenant's plan and template policy. Preferences are enforced at dispatch time (channel filtering), never at production time. Digest mode (future) is aggregated by scheduled jobs.
6. **Notification templates.** All channels render from versioned templates (Section 10 email templates; in-app templates with localization and RTL). Templates are data, versioned in the repository; tenant branding applied at render time; rendering is tenant-isolated — a template context can never contain another tenant's data.
7. **Notification categories:** Content (new lesson, assignment due), Assessment (exam start, results), Membership (invitations, role changes), Billing (invoices, plan changes), System (maintenance, security alerts). Categories map to preference toggles and rate limits.
8. **Priority levels:** Low (informational), Normal, High, Urgent (exam start, security). Priority controls channel selection (Urgent may bypass digest preferences but respects hard opt-outs), delivery order, retry policy, and rate limits.
9. **Retry policy:** per-channel bounded retries with exponential backoff (initial default: 5 attempts — 1m, 5m, 15m, 1h, 6h; configurable) for transient failures (provider 429/5xx, temporary channel outage). Non-transient failures (invalid template, permanent provider rejection) go to the dead-letter queue without retries. Retry counters and state live in the notification/outbox records.
10. **Dead-letter handling:** after max retries, notifications move to the dead-letter queue with the failure reason. Platform admins (and tenant admins for tenant-scoped failures) can inspect, re-enqueue, or discard via the admin path (Super Admin Access Model, Section 8). DDL depth is monitored and alerted (Section 15).
11. **Idempotency:** outbox rows carry a deterministic notification id (event source + sequence); dispatchers claim outbox rows atomically (e.g., `SELECT ... FOR UPDATE SKIP LOCKED`), so duplicate dispatch is impossible; channel sends use stable message ids where the provider supports it; at-least-once semantics require idempotent handlers that tolerate re-delivery.
12. **Realtime delivery architecture.**
    - **Transport decision (FINAL): SSE (Server-Sent Events), not WebSocket.** SSE over HTTP/2 gives one-way server→client pushes (the dominant direction for notifications), automatic reconnection with event-id resume, no protocol negotiation or middleware complexity, proxy/CDN friendliness, and trivial scaling behind standard load balancers. WebSocket is deferred and reserved for interactive bidirectional features only (future live sessions, live proctoring — a separate decision if adopted); notifications never require client→server push beyond regular API calls.
    - **Delivery path:** authenticated SSE endpoint; the connection is authorized per tenant context (Tenant-Context Contract); the server pushes only notifications addressed to the connected user within their current tenant context; events carry event ids enabling resume after reconnect; cross-tenant push is impossible by construction.
    - **Fan-out and change signal:** notification + outbox are persisted in the DB; instances hold an ephemeral per-instance registry of local connections. Phase 1: instances receive a change signal on outbox inserts via **PostgreSQL LISTEN/NOTIFY** (same infrastructure — no new components), then deliver to their local connections; missed signals are recovered by event-id resume from persisted history. When Redis arrives (Section 11), the signal moves to Redis pub/sub — a provider swap, not a redesign.
13. **Future scaling strategy:** connections are ephemeral per instance; at scale, add a dedicated realtime tier (instances serving SSE only), move the signal to Redis pub/sub when measured, and keep event-id resume as the correctness guarantee across instance churn. Push (FCM/APNs) and SMS become additional channels with their own worker pools.
14. **Audit requirements:** notification production, channel delivery, preference changes, DDL re-enqueue/discard, and template changes are audit-logged (Section 16) with actor, tenant, category, priority, channel, status, timestamp, and request id. Notification content itself is not audit-logged (PII-minimal) — the event record is.
15. **Monitoring metrics:** produced vs delivered per category / priority / channel; delivery latency (p95/p99); outbox backlog depth and age; retry counts; DDL depth; realtime: connected users, connection churn, resume success, missed-signal fallback rate; channel provider errors (email bounce/rate limits); per-tenant preference and enablement rates. Alerts: outbox backlog growth, DDL growth, delivery latency breach, realtime connection anomalies.
16. **Mandatory integration tests (blocking CI gates, Sections 16/18):**
    - **Outbox atomicity:** business action and outbox row commit together; rolling back the action leaves no outbox row.
    - **At-least-once delivery:** a simulated dispatcher crash mid-delivery re-delivers without duplicates (atomic claim / idempotent handlers).
    - **Tenant isolation:** a user receives only their tenant's notifications; cross-tenant push attempts fail; realtime connections cannot subscribe to another tenant's stream.
    - **Preferences:** a user with email disabled for a category receives no email for it; priority/urgency overrides behave per policy.
    - **Realtime resume:** disconnect → reconnect resumes from the last event id without loss or duplicates.
    - **Retry / dead-letter:** provider failure retries with backoff; max retries → dead-letter with reason; re-enqueue works.
    - **Templates:** rendering includes tenant branding and never another tenant's data.

---

## 11. Cache

**Status:** Recommendation

### Recommendation

- **Defer caching.** Start with well-indexed PostgreSQL (Section 5) and zero cache layers (per the project's "postpone Redis/BullMQ until actually needed" philosophy)
- When metrics justify it: **Redis** (or its OSS fork **Valkey**) — managed via **Upstash** or a provider of choice **[RECOMMENDED when needed]**
- Cache candidates in order of priority: hot permission resolutions, session store (if sessions are DB-backed), rate-limit counters, read-heavy configuration

### Why this recommendation

- Premature caching adds invalidation complexity and failure modes without measured benefit.
- PostgreSQL with correct indexes handles tens of thousands of users before a cache is needed.
- When a cache is needed, Redis/Valkey is the standard, well-understood choice.

### Alternatives considered

- **Memcached:** Simpler but less capable than Redis; no reason to choose it first.
- **In-memory (per-instance) caching:** Fine for tiny hot data, but invalidates per instance and can serve stale cross-instance data — use with TTLs only.
- **PostgreSQL for rate limiting:** Phase 1 of the Rate Limiting Architecture (Section 16) — distributed window counters in PostgreSQL; moves to Redis per the measured trigger defined there.

### Free/Paid

Redis/Valkey: free OSS. Managed (Upstash/Redis Cloud): freemium → usage-based.

### Estimated upgrade point

- When p95 latency or primary DB load metrics demand it — decide based on measurements (Section 21), not guesses.
- Revisit at roughly tens of thousands of concurrent users, or when sessions/rate limiting strain the DB.

### Risks

- **Stale data** — mitigated by cache-aside with TTLs and versioned keys.
- **Cache stampede** on hot keys — mitigated by single-flight/request coalescing.
- **Extra infrastructure to operate** — mitigated by using a managed service.

### Long-term scalability

- Distributed cache cluster scales horizontally; keys are tenant-namespaced.
- A cache also enables future read-path features (leaderboards, dashboards) cheaply.

### Impact on multi-tenant SaaS architecture

- **Every cache key is namespaced by `tenant_id`** — eliminates cross-tenant cache poisoning.
- One shared cache cluster is fine for all tenants; isolation is by key design + quotas.

---

## 12. Queue

**Status:** Recommendation

### Recommendation

- **Defer dedicated queue infrastructure.** When background work first appears (email sends, grade computation, analytics, AI requests, certificate generation), start with **pg-boss** (Postgres-backed job queue — zero new infrastructure)
- Move to **BullMQ + Redis** when throughput and scheduling requirements outgrow pg-boss (worker processes scale independently)
- **Hard rule:** every job carries `tenant_id` explicitly (project rule: background jobs must carry and pass `organization_id` explicitly)
- Grading and heavy analytics **never** run inside the student's HTTP request (project rule) — they are always queued

### Why this recommendation

- pg-boss gives job semantics (retries, delays, scheduled jobs) with the database we already have — no new moving parts.
- BullMQ is the standard Node queue and the natural upgrade path.
- The project rules explicitly defer BullMQ/Redis until actually needed.

### Alternatives considered

- **BullMQ + Redis now:** Powerful but adds Redis ops before metrics justify it.
- **AWS SQS:** Cheap and managed, but AWS-coupled; fine later for very high throughput.
- **RabbitMQ / Kafka:** Overkill for this stage; revisit only if fan-out eventing becomes a real need.

### Free/Paid

pg-boss and BullMQ: free OSS. Redis managed: paid when used. SQS: cheap pay-as-you-go.

### Estimated upgrade point

- pg-boss → BullMQ when job volume/throttling needs outgrow it (measure first).
- BullMQ → SQS/Kafka only at extreme scale or when event-streaming features (audit streams, analytics pipelines) demand it.

### Risks

- **At-least-once delivery:** workers must be idempotent (jobs can run twice).
- **Job starvation / long queues during exam waves:** mitigated by priority queues and dedicated workers.
- **Losing `tenant_id` context in async work:** mitigated by the hard rule above + job schema validation.

### Long-term scalability

- Worker processes scale independently from web instances — the clean path to handling exam-wave bursts.
- Dead-letter queues and scheduled jobs give reliable background processing at scale.

### Impact on multi-tenant SaaS architecture

- Jobs are tenant-scoped; workers enforce the same RLS/authorization as the API, including the [Tenant-Context Contract](#tenant-context-contract-mandatory) (Section 5).
- Fair-queueing between tenants (preventing one tenant's bulk jobs from starving others) is a later refinement.

---

## 13. Search

**Status:** Recommendation

### Recommendation

- **Phase 1 — PostgreSQL full-text search** (`tsvector` + GIN indexes) for course/program/content search
- **Phase 2 — Meilisearch** **[RECOMMENDED]** when relevance, typo-tolerance, faceting, or cross-entity global search demands a dedicated engine (OSS, single binary, simple)
- Index sync via queue workers (Section 12); every indexed document carries `tenant_id`

### Why this recommendation

- Phase 1 costs nothing and covers basic search needs.
- Meilisearch gives near-instant typo-tolerant search with minimal ops — the right scale for this product, versus heavyweight Elasticsearch.
- Tenant filtering is trivial (filter on `tenant_id`).

### Alternatives considered

- **Elasticsearch / OpenSearch:** Powerful but operationally heavy; only worth it for log analytics (and we use Loki/Axiom instead, Section 14) or massive scale.
- **Typesense:** Excellent, modern alternative to Meilisearch; the two are interchangeable — open detail.
- **Algolia (managed):** Great DX, but expensive at scale and a SaaS lock-in.

### Free/Paid

PG FTS: free. Meilisearch: free OSS (managed cloud paid). Algolia: paid.

### Estimated upgrade point

- When search queries exceed acceptable latency, or when relevance/faceting requirements arrive — not before.

### Risks

- **Index lag** (document updated but index stale) — mitigated by queue-based sync with retries.
- **Relevance tuning** — Meilisearch's defaults are strong; adjust per tenant only if needed.

### Long-term scalability

- Meilisearch scales horizontally; per-tenant indexes or filters keep isolation.
- Search remains decoupled from the OLTP database, protecting the primary from scan-heavy queries.

### Impact on multi-tenant SaaS architecture

- Every document indexed with `tenant_id`; all queries filter by tenant context — no cross-tenant search results, ever.
- Per-tenant relevance/synonym settings possible later.

---

## 14. Logging

**Status:** Recommendation

### Recommendation

- **Structured JSON logs** with `pino` (NestJS-native, fast) — mandatory fields: `tenant_id`, `request_id`, `user_id`, `timestamp`, `level`, `service`, `event`
- Ship to a managed log service: **Axiom** **[RECOMMENDED]** (generous free tier, fast querying) or Better Stack/Logtail — open detail
- **PII masking** at the source (never log passwords, tokens, emails in bodies, IPs beyond need)
- Log retention tiers: hot (30 days) → cold archive (object storage, Section 9)

### Why this recommendation

- JSON structured logs make centralized search and alerting possible at scale.
- Managed logging = no ELK cluster to operate (matches the project's deferred-ops philosophy).
- `tenant_id` in every log line is the foundation for tenant-level support and audit (vision: audit logs).

### Alternatives considered

- **ELK self-hosted:** Full control, heavy ops — rejected for now.
- **Datadog / New Relic logging:** Excellent, expensive at scale.
- **CloudWatch:** Coarse, awkward querying for tenant-level analysis.
- **Grafana Loki:** Good OSS option; more setup than Axiom — open detail.

### Free/Paid

Axiom/Better Stack: generous free tiers, then usage-based. Self-hosted: free but ops.

### Estimated upgrade point

- Sampling and archive policies when log volume grows.
- OTel-based collection pipeline when services get extracted.

### Risks

- **PII leakage into logs** — mitigated by enforced masking conventions + log review in CI.
- **Log cost at high volume** — mitigated by sampling debug logs, archiving cold logs.

### Long-term scalability

- Centralized logging handles millions of lines/day with tenant-filtered views.
- Logs become the source for audit features (vision's Audit module) — tamper-evident log retention is a later compliance feature.

### Impact on multi-tenant SaaS architecture

- `tenant_id` as a mandatory field enables per-tenant support, cost attribution (Section 27), and abuse investigation.
- Log visibility is restricted to platform admins + per-tenant support scopes.

---

## 15. Monitoring

**Status:** Recommendation

### Recommendation

- **Sentry** for error tracking + basic performance tracing on frontend and backend (per the project's phase plan)
- **Uptime/health checks** (simple external ping) from day one
- **Phase 2 — OpenTelemetry metrics** (request latency, DB query times, queue depths, error rates) exported to **Grafana Cloud** or a self-hosted **Prometheus + Grafana** — deferred until dashboards/alerts are needed (per the project's "no Prometheus now" rule)
- **SLOs** to define once production stabilizes (e.g., 99.9% availability, p95 latency budgets)

### Why this recommendation

- Error tracking first: it catches the bugs that matter most early.
- Sentry was already named in the project's phase plan.
- OTel is the lock-in-free standard for metrics; choosing a managed backend later is cheap.

### Alternatives considered

- **Datadog / New Relic:** All-in-one, expensive at scale.
- **Grafana Cloud:** Free tier exists, standard stack.
- **Prometheus self-hosted:** Free but ops burden — deferred.
- **Only uptime monitors:** Insufficient for a platform with queue workers and heavy DBs.

### Free/Paid

Sentry: free tier → paid. Grafana Cloud: free tier → paid. Self-hosted: free + ops.

### Estimated upgrade point

- Dashboards/alerts when the system has multiple moving parts in production.
- Tracing across queue workers when debugging async pipelines.

### Risks

- **Alert fatigue** — mitigated by carefully curated alerts tied to SLOs.
- **Monitoring cost creep** — mitigated by sampling and retention policies.

### Long-term scalability

- OTel gives one pipeline for metrics regardless of backend; works across extracted services.
- Anomaly detection for exam-wave traffic patterns later.

### Impact on multi-tenant SaaS architecture

- Metrics aggregated globally **and broken down per tenant** — capacity planning and noisy-neighbor detection.
- Tenant-level alerts (e.g., a tenant exceeding quotas) feed the billing/limits modules.

---

## 16. Security

**Status:** Recommendation

### Recommendation

- **OWASP Top 10** as the baseline threat model
- **Defense in depth:** service-layer validation (Zod) → authorization (Section 7) → RLS (Section 8) → audit log
- **Rate limiting** at the application layer, per the Rate Limiting Architecture below (never in-memory, always a shared backend): login (5/10 min), forgot-password (3/hour), registration (per-IP), exam start/submission anti-spam, file upload size/count limits (per project rules)
- **Argon2id** passwords; session rotation; secure cookie flags
- **Secrets** in environment variables / CI secrets only — never in the repository
- **Audit Log module** for sensitive operations (vision: Audit module) — tenant-scoped, immutable
- **Storage:** presigned URLs; private buckets (Section 9); every upload follows the File Upload Security Architecture (Section 16) — quarantine → malware scan → publish
- **CI security gates:** dependency scanning, secret scanning (e.g., gitleaks), RLS/isolation integration tests
- **Penetration testing** before major enterprise sales; optional bug bounty later

### Rate Limiting Architecture (FINAL DECISION)

Logged as Decision Log #3 (Section 29). Applies to the API (Section 4), MCP servers (Section 25), and AI endpoints (Section 26).

1. **Never in-memory.** Rate limiting must never rely on per-instance in-memory counters. With multiple application instances, in-memory counters are bypassable by spreading requests across instances; they are forbidden for all rate limiting.
2. **Shared backend required.** All rate limiting uses a shared backend, so limits are enforced correctly regardless of which instance serves a request.
3. **Phase 1 — PostgreSQL-backed distributed rate limiting.** Window counters stored in PostgreSQL (atomic counter updates against a dedicated counter table with window expiry; stale-window cleanup via scheduled job / queue). Checks run before expensive work (e.g., before password hashing) and before service logic.
4. **Phase 2 — Redis-backed distributed rate limiting.** Same semantics via Redis counters (`INCR` + `EXPIRE`; sorted sets for sliding windows where needed). The limiter sits behind an internal interface — the PG → Redis move is a provider swap, not a rewrite.
5. **Migration trigger (PG → Redis), measured:** move when counter traffic measurably burdens the primary: rate-limit counter queries > 15% of total primary queries, or rate-limit check path p95 > 10 ms sustained, or counter-attributed primary CPU above 50% sustained — measured via Section 15 instrumentation, decided from measurements, never forecasts.
6. **Limits (initial defaults; configurable per plan, enforced per Section 8 entitlements):**
   - **Authentication:** login 5 attempts / 10 min per account+IP; forgot-password 3 / hour per account; registration per-IP (project rules).
   - **Public APIs:** per-tenant API-key limits (requests/minute and /hour per key, per plan); conservative defaults for partner integrations (Section 4).
   - **Tenant APIs:** per-tenant aggregate rate (requests/minute per tenant) protecting shared pools from a single tenant; plus per-user browsing limits.
   - **File uploads:** size and count limits per user and per tenant per window; concurrent upload caps (Section 16 upload rules).
   - **AI endpoints:** per-tenant monthly AI quotas (Section 26) plus per-user burst limits to protect AI cost and latency.
   - **Administrative endpoints:** stricter per-actor mutation limits for institution and platform admin endpoints; the privileged path (Super Admin Access Model, Section 8) is limited too.
   - **Exam endpoints:** start/submission anti-spam per user and attempt (project rules).
7. **Tenant-aware limiting:** limit keys are namespaced by `tenant_id`; per-tenant quotas derive from the tenant's plan; one tenant can never consume another tenant's quota (consistent with cache key namespacing, Section 11).
8. **User-aware limiting:** keys include `user_id` where applicable (per-account auth attempts, per-user API/AI rates); limits follow the user across instances.
9. **IP-based protection:** IP-level limits for unauthenticated flows (login, registration, forgot-password, anonymous public endpoints) to blunt distributed abuse. Because institutions often share egress IPs (NAT), IP limits are sized conservatively and combined with account-level keys — never IP-only for authenticated traffic.
10. **Fail-closed behaviour:** if the shared rate-limit backend is unavailable, the request is **aborted (503)** rather than allowed through — unlimited traffic is never the fallback. This applies to every path; an alert fires immediately (Section 15). Phase 2 may add automatic fallback to the PostgreSQL backend — an optional refinement, never fail-open.
11. **Monitoring metrics:** rejections by scope (auth / public API / tenant API / upload / AI / admin), per tenant, per user, per IP; p95/p99 latency of the rate-limit check; backend availability; counter table size and cleanup progress; tenant quota consumption vs plan limits (feeds cost attribution, Section 27). Alerts: backend failure, rejection-rate anomalies (attack or misconfiguration).
12. **Mandatory integration tests (blocking CI gates, Sections 16/18):**
    - **Multi-instance correctness:** traffic from ≥ 2 concurrent application instances against the shared backend respects the limit in aggregate — proving per-instance bypass is impossible.
    - **Tenant isolation:** tenant A's traffic never consumes tenant B's quota.
    - **Fail-closed:** backend outage (simulated) → requests rejected with 503, not passed.

### File Upload Security Architecture (FINAL DECISION)

Logged as Decision Log #4 (Section 29). Applies to every file uploaded through the platform: course content, media, lab reports, certificates, avatars, imports.

1. **All uploads are untrusted.** Every uploaded file is treated as untrusted input — never trusted based on extension, client-provided MIME type, or source.
2. **Mandatory malware scanning before availability.** Every file passes malware scanning (queued job, Section 12) before it becomes available to anyone. No file is published without a completed scan.
3. **Quarantine-first.** Uploaded files land in a **quarantine** state (private storage prefix, not referenced by any endpoint). Only clean files move to the published state; quarantined files are never servable.
4. **Only clean files are published.** Publication is the explicit transition from quarantine to published (database state + storage move/flag). Any file without a successful scan result stays quarantined.
5. **Magic-byte validation.** File type is validated by inspecting content (magic bytes / file signature), never by extension or client MIME type alone. Client MIME is at most a hint; the authoritative type comes from content inspection.
6. **Allowed types and size limits (initial defaults; configurable per plan):**
   - Allowed categories: documents (PDF, DOCX, XLSX, PPTX, ODF), images (JPEG, PNG, WebP, GIF), video (MP4, WebM), audio (MP3, M4A), archives (ZIP — only for specific features such as bulk imports), plain text / markdown course formats.
   - Maximum sizes: images 10 MB; documents 50 MB; video 500 MB per file (configurable); all enforced by the size/count limits of the Rate Limiting Architecture (Section 16) and plan quotas (Section 8).
7. **Executable and dangerous formats are rejected:** EXE, DLL, SCR, BAT, CMD, PS1, JAR, MSI, APK, scripts, binaries, and active-content office formats with macros (DOCM/XLSM/PPTM) are rejected outright regardless of extension or claimed MIME. Re-encoding content (e.g., images) is preferred where feasible.
8. **Never served from the application domain.** User-uploaded files are never served from the application domain — the application origin serves only HTML/JS/API responses under a strict CSP.
9. **Dedicated storage/CDN domain.** Files are served from a dedicated storage/CDN domain (separate origin, no application cookies, no session access).
10. **Content-Disposition attachment where appropriate.** Responses force `Content-Disposition: attachment` for documents, labs, certificates, and other file types where inline rendering is not required; inline rendering is allowed only for safe, validated media (images/video) — never for HTML/SVG or any active content.
11. **X-Content-Type-Options: nosniff** is set on all file responses.
12. **CSP considerations for uploaded content:** the application CSP never includes the storage domain in `script-src`/`style-src`; uploaded HTML/SVG are not renderable inline (attachment + nosniff, or sanitized); previews, where required, use sandboxed iframes or server-side rendering to images — never direct inline execution.
13. **Ownership and tenant isolation:** every file record carries `tenant_id` and owner (`user_id`); files live under tenant-scoped prefixes/buckets (Section 9); access follows the Tenant-Context Contract (Section 5); presigned URLs are tenant-scoped (Section 9). A file is reachable only through its owning tenant's context.
14. **Scan failure behaviour (fail closed):** an inconclusive or failed scan (scanner error, timeout, scanner unavailable) leaves the file in quarantine — never published. Publication without a positive scan result is a defect. Scanner unavailability is alerted (Section 15) and blocks the publish path (fail closed), consistent with the platform's fail-closed philosophy.
15. **Audit logging:** upload, scan result, publication, and quarantine decisions are audit-logged (Section 16 Audit Log) with actor, tenant, file id, type, size, scan verdict, and timestamp. Access attempts to quarantined files are also logged.
16. **Mandatory security tests (blocking CI gates, Sections 16/18):**
    - **Magic-byte spoofing:** a file claiming to be a PDF but containing an executable is rejected.
    - **Dangerous formats:** EXE/script/macro files are rejected regardless of extension or MIME.
    - **Quarantine enforcement:** quarantined files are not servable by any endpoint; only published files are.
    - **Tenant isolation:** tenant A cannot reference or download tenant B's file, including via presigned URLs.
    - **Headers:** file responses carry the mandated `Content-Disposition` / `nosniff` policy; uploads are never served from the application domain.
    - **Fail-closed:** a simulated scanner outage prevents publication (the file stays quarantined).

### Why this recommendation

- A multi-tenant SaaS is a high-value target — a single leak damages every tenant.
- The project rules mandate exactly this layered approach (service validation first, RLS as second line, all entrances verify tenant ownership).
- These measures are mostly process + open-source tooling, not cost.

### Alternatives considered

- **Cloudflare WAF at the edge:** Add at production deployment (free tier covers core WAF); complements, not replaces, app-layer security.
- **Third-party security platforms:** Evaluate only when compliance requirements (SOC 2, GDPR, ISO) arrive.
- **Bug bounty program:** Later phase.

### Free/Paid

Mostly free (OSS tooling, rate limiting is code). Pentests and compliance audits are paid.

### Estimated upgrade point

- WAF + DDoS protection at production launch.
- Compliance certifications when enterprise/education-ministry deals require them.
- SSO/MFA enforcement per plan tier (Section 6).

### Risks

- **RLS bypass / cross-tenant leak** — the existential risk; mitigated by the CI isolation suite (attempt cross-tenant reads/writes; they must fail) and quarterly security reviews.
- **Session theft / fixation** — mitigated by rotation, secure flags, and short TTLs.
- **Prompt injection in AI features** — mitigated by sandboxing AI inputs and never granting AI tools elevated permissions (Section 26).
- **Data residency** — Middle East region requirements; plan regions (Sections 9, 17).

### Long-term scalability

- Security is process-first: layered checks, automated gates, and drills scale better than point fixes.
- Audit logs at scale feed compliance and incident response.

### Impact on multi-tenant SaaS architecture

- Isolation tests run in CI for **every** change — regression-proof tenant boundaries.
- Audit trails are per-tenant; platform admins can audit any tenant (through the dedicated privileged path only — Super Admin Access Model, Section 8), tenants audit their own scope. Audit records are preserved beyond tenant deletion per the Tenant Data Lifecycle (Section 8).
- Quota/abuse detection (rate limiting per tenant) protects neighbors from abusive tenants.

---

## 17. Deployment

**Status:** Recommendation

### Recommendation

- **Docker** for the backend (one container image for API, one for workers)
- **Frontend:** static build hosted on **Vercel** or **Cloudflare Pages** **[RECOMMENDED — either]**
- **Backend:** container on a managed PaaS — **Render** **[RECOMMENDED]** (simple, auto-deploys, TLS); **Railway / Fly.io** as strong alternatives (open detail)
- **Database:** Supabase managed (Section 5); **Storage:** R2 or Supabase (Section 9)
- Environments: `staging` + `production` (Section 20)
- DNS + TLS handled by the platform/cloudflare; custom domain per product

### Permission catalog deployment runbook

The platform permission catalog is a required deployment gate for every staging and production database. Apply changes in this order:

1. Apply the release's versioned schema migrations.
2. With `DATABASE_URL` already supplied through the environment's secret manager, run the permission catalog seed command from the repository root:

   ```sh
   npm run permissions:seed --workspace @manara/api
   ```

3. Require a successful exit and confirm that the safe summary reports `required=34`. The command verifies that all 34 required keys exist after reconciliation. It is safe and recommended to run the same command again; an already reconciled catalog reports `inserted=0`, `reconciled=0`, and `unchanged=34`.
4. Only after verification succeeds, start or restart the API instances.

`DATABASE_URL` must be configured before the command runs. Supply it through the deployment platform or secret manager; never put a connection string directly in a command, shell history, runbook example, source file, or log.

API startup enforces the same invariant in `staging` and `production`: startup fails closed when `DATABASE_URL` is unavailable or any required permission key is missing. The API does not listen until verification succeeds. Development and test modes intentionally retain their lightweight behavior and do not replace this deployment gate.

The seed operation owns exactly 34 platform permission identities. It is transactional, advisory-lock protected, and idempotent. It preserves existing permission IDs and statuses, reconciles only the code-owned `module` and `description` metadata, and does not delete unknown permission rows. It creates no roles, role grants, role assignments, memberships, or users.

Catalog provisioning does not grant administrative authority. Initial tenant creation, administrative role creation, and controlled role assignment are separate bootstrap procedures. Operators must not grant every permission to arbitrary users as part of catalog seeding.

If the API refuses startup because the catalog is incomplete:

1. Verify that the intended environment's `DATABASE_URL` is configured and accessible without printing it.
2. Confirm that schema migrations for the release completed successfully.
3. Run `npm run permissions:seed --workspace @manara/api`.
4. Run the command again and confirm `required=34`, `inserted=0`, `reconciled=0`, and `unchanged=34`.
5. Restart the API and confirm that startup completes.

Do not recover by manually deleting or recreating permission rows, and never edit an applied migration. Permission keys are stable identities. Automated seeding never deletes catalog rows; any removal or deprecation requires an explicitly approved compatibility change that accounts for existing role grants and deployed clients.

Run the seed command separately for every staging and production database. Test fixtures are not production seeding. Destructive database suites must use isolated databases or run serially; do not point parallel destructive suites at the same shared database.

### Why this recommendation

- Zero Kubernetes ops while the team is small — managed PaaS covers deploys, scaling, TLS, and rollbacks.
- Docker keeps the app portable if we outgrow the PaaS (Section 28).
- Static frontend hosting is free/cheap and CDN-backed.

### Alternatives considered

- **AWS ECS/EKS:** Powerful but operationally heavy; the natural upgrade target later.
- **Heroku:** Simple but expensive and limiting.
- **Hetzner VPS + Docker Compose:** Cheapest, but full ops burden (updates, monitoring, backups) — viable cost-saving option later, not recommended at start.
- **Serverless (AWS Lambda):** Cold starts and stateless constraints complicate the monolith; revisit only for specific hot paths later.

### Free/Paid

Vercel/Cloudflare Pages: free tiers. Render: pay-as-you-go (free tier for staging). Supabase/R2: freemium.

### Estimated upgrade point

- Managed Kubernetes (EKS/DOKS) when the team + scale justify it (typically far into growth).
- Multi-region deployment for latency/DR (Sections 22, 24).

### Risks

- **PaaS vendor lock-in:** Mitigated by Docker + standard interfaces everywhere.
- **Region latency for Gulf/Arab users:** Choose platform regions close to users (e.g., EU/Frankfurt or Middle East regions where available) + CDN for static/media.
- **Cost at scale:** PaaS per-instance pricing grows — budget with Section 27.

### Long-term scalability

- Stateless Docker containers behind a load balancer auto-scale horizontally (Section 22).
- The same image deploys to K8s unchanged when we migrate.

### Impact on multi-tenant SaaS architecture

- Shared infrastructure for all tenants; per-tenant **custom domains (white-label)** later via CNAME + TLS on the platform's domain infrastructure.
- Deployment changes must never require per-tenant configuration — everything tenant-specific is data (Section 19).

---

## 18. CI/CD

**Status:** Recommendation

### Recommendation

- **GitHub Actions** (GitHub is the chosen platform, private repo)
- Pipeline stages: lint → typecheck → unit tests → **database migrations against an ephemeral PostgreSQL** → integration tests (including **tenant-isolation tests**: cross-tenant access attempts must fail) → build → deploy
- **Deploy flow:** push to `main` → auto-deploy to **staging**; production deploy on tag/approval (Section 20)
- **Secrets** via GitHub Environments (staging/prod separated)
- **Dependency + secret scanning** in CI (Section 16)

### Why this recommendation

- GitHub-native, zero extra cost, YAML ecosystem, huge community.
- Ephemeral-DB test runs catch migration errors before they touch production — critical for a shared-schema multi-tenant DB.
- Isolation tests in CI make tenant boundaries regression-proof.

### Alternatives considered

- **GitLab CI / Bitbucket Pipelines:** Fine, but we already use GitHub.
- **CircleCI / Buildkite:** Paid, no advantage here.
- **Jenkins (self-hosted):** Rejected — ops burden.

### Free/Paid

GitHub Actions: free minutes for private repos (limits apply), paid beyond.

### Estimated upgrade point

- Self-hosted runners if tests become heavy/slow.
- Preview environments per PR (deploy a full stack per pull request) when review needs it.

### Risks

- **Flaky E2E tests** — mitigated by focused integration tests over heavy E2E suites.
- **Secret leakage** — mitigated by secret scanning + environments-scoped secrets.
- **CI time creep** — mitigated by caching and test sharding.

### Long-term scalability

- The same pipeline shape survives service extraction (per-service workflows).
- Deploy approvals + canary steps later for safe production releases.

### Impact on multi-tenant SaaS architecture

- **Tenant-isolation integration tests are mandatory CI gates** — no merge may weaken tenant boundaries silently.
- Migration tests run against fresh databases to verify backward-compatible schema changes (Section 20).

---

## 19. Git Strategy

**Status:** Recommendation

### Recommendation

- **Single private GitHub repository** (monorepo — frontend, backend, migrations, docs)
- **Conventional Commits** (`feat:`, `fix:`, `chore:`...) with meaningful messages
- **Protected `main`** — direct pushes blocked; changes via pull requests with required review(s)
- **Semantic versioning tags** for releases (`v1.0.0`, ...) driving changelogs
- All tenant-specific configuration is **data, never code** — the repository stays tenant-agnostic

### Why this recommendation

- One deployable monolith → one repository; matches the modular monolith (Section 1).
- PR review is the quality gate for a small team; protected main prevents accidental direct changes.
- Semantic tags make releases reproducible and auditable.

### Alternatives considered

- **GitLab / Bitbucket:** Equivalent, but GitHub already chosen.
- **Multiple repositories per module:** Overhead without benefit at this stage.
- **Per-tenant branches/forks:** Explicitly rejected — tenancy is data, not code.

### Free/Paid

GitHub private repos: free tier (limits), paid plans for advanced features.

### Estimated upgrade point

- `CODEOWNERS` for module-level ownership as the team grows.
- Release automation (auto-changelog, auto-tagging) when release cadence increases.

### Risks

- **Monorepo history growth:** Cosmetic; GitHub handles it.
- **Merge conflicts:** Mitigated by short-lived branches (Section 20).

### Long-term scalability

- Monorepo stays viable with modular boundaries; a separate repo is needed only for extremely decoupled AI/workers later — an open question, not a plan.

### Impact on multi-tenant SaaS architecture

- Keeping tenant config out of code means deploying a feature never changes tenant behavior implicitly — migrations and feature flags control rollout (Section 20).

---

## 20. Branch Strategy

**Status:** Recommendation

### Recommendation

- **GitHub Flow:**
  - `main` is always deployable (protected, Section 19)
  - Short-lived feature branches (`feat/...`, `fix/...`) → PR → merge to `main`
  - Merge to `main` → auto-deploy to **staging**
  - Production release: create a **release tag** from `main` (or a short `release/*` branch) → deploy to production with approval
- **Database migrations are backward-compatible** (expand-contract: additive changes first, cleanup in a later release) so `main` remains deploy-safe at any commit
- **Feature flags** for risky features (rollout control) — a later refinement

### Why this recommendation

- Minimal ceremony, continuous delivery, and immediate feedback — right for a small team shipping a SaaS.
- Backward-compatible migrations make auto-deploys safe on a shared-schema multi-tenant database.

### Alternatives considered

- **GitFlow:** Heavy ceremony (develop/release/hotfix branches) — overkill for this team size.
- **Pure trunk-based development with feature flags:** Excellent at scale, but requires mature flag infrastructure — adopt elements later.

### Free/Paid

N/A — process decision, no cost.

### Estimated upgrade point

- Long-lived `release/*` + hotfix flow when multiple concurrent release tracks are needed.
- Feature-flag platform when deployments outpace review capacity.

### Risks

- **Main broken on merge:** Mitigated by CI gates (Section 18) + staging auto-deploy.
- **Migration conflicts between concurrent PRs:** Mitigated by sequential migration numbering and CI ephemeral-DB runs.

### Long-term scalability

- The same flow scales to release trains and canary deploys without structural change.
- Schema change discipline (expand-contract) protects zero-downtime deployments forever.

### Impact on multi-tenant SaaS architecture

- Backward-compatible migrations mean **no tenant downtime** during schema evolution — critical for education platforms with fixed exam schedules.
- Feature flags let specific tenants preview features per plan tier (vision: feature flags per tenant).

---

## 21. Performance Strategy

**Status:** Recommendation

### Recommendation

- **Measure first, optimize second:** instrument (Section 15), profile, then change
- **Database-first:** correct composite indexes (leading with `tenant_id`), cursor pagination everywhere, no `SELECT *`, no N+1 (project rules)
- **Connection pooling** from day one
- **Frontend:** code splitting, route-level lazy loading, bundle budgets, TanStack Query caching to avoid redundant fetches
- **Payload hygiene:** return only needed fields; compress JSON; HTTP/2; CDN for static/media
- **Load testing** (k6, OSS) before exam waves — simulate thousands of concurrent submissions
- **Async everything heavy:** grading, analytics, AI, email → queue workers (Section 12)

### Why this recommendation

- Premature caching/architecture is the classic failure; instrumented iteration is sustainable.
- Postgres + correct indexes handles the projected scale for a long time (Section 5).
- Exam waves are the load event that matters; load-test them specifically.

### Alternatives considered

- **Aggressive caching early:** Rejected — invalidation complexity before need (Section 11).
- **Read replicas early:** Rejected — add when metrics show contention.
- **ORM-blind usage:** Rejected — raw SQL (pg) per vision; ORM later only as a query-builder convenience, not a decision.

### Free/Paid

All techniques free; k6 is free OSS.

### Estimated upgrade point

- Cache (Section 11), replicas, and partitioning when measured metrics say so — each has its own section's trigger point.

### Risks

- **Hidden N+1s and scan-heavy queries** — mitigated by query logging and review.
- **Index bloat** — mitigated by regular index usage review.
- **Exam-wave thundering herd** — mitigated by load testing + queue-based submission handling + rate limits.

### Long-term scalability

- Perf budgets and SLOs (Section 15) institutionalize performance as features are added.
- Continuous load testing catches regressions before they reach production.

### Impact on multi-tenant SaaS architecture

- Indexes lead with `tenant_id` so a tenant's queries never scan other tenants' rows.
- Per-tenant pagination and quotas prevent one tenant's misuse from degrading the platform (noisy-neighbor defense).

---

## 22. Scaling Strategy

**Status:** Recommendation

### Recommendation

1. **Scale up first:** right-sized instances, connection pooler, tuned Postgres
2. **Scale out:** stateless app instances behind a load balancer (auto-scaling on CPU/requests); workers as a separate scaled tier (Section 12)
3. **Read replicas** for reporting/analytics traffic
4. **CDN** for static assets and media (Sections 9)
5. **Partitioning** for the largest tables (attempts, audit logs, notifications)
6. **Cache** (Section 11) only when measurements justify
7. **Hyperscale tenants:** dedicated database per giant tenant, case-by-case

### Why this recommendation

- This is the cheapest correct order; each step is triggered by measured need, not speculation.
- Statelessness (sessions in DB/cache, files in object storage) makes horizontal scaling instant.
- Matches the project's phased philosophy (no premature infrastructure).

### Alternatives considered

- **Microservices now:** Premature (Section 1).
- **Serverless everything:** Revisit later for specific paths; unsuitable for the monolith now.
- **Multi-region from day one:** Premature; single region + CDN suffices initially.

### Free/Paid

Scaling is a cost lever: instances, replicas, bandwidth all paid at scale (Section 27).

### Estimated upgrade point

- Auto-scaling when traffic patterns vary (exam waves).
- Read replicas at ~tens of thousands of concurrent users or when DB CPU saturates.
- Multi-region when latency/DR SLAs demand (Section 24).

### Risks

- **Stateful services breaking horizontal scaling** — mitigated by stateless design from day one.
- **Connection limits** — mitigated by the pooler.
- **Uncontrolled costs** — mitigated by auto-scaling caps and quotas.

### Long-term scalability

- Near-linear horizontal scaling: tens of app instances, a few replicas, scaled workers serve hundreds of thousands of users.
- Partitioning keeps the primary's hottest tables bounded.

### Impact on multi-tenant SaaS architecture

- Shared pools scale with **total** load — tenants benefit from each other's idle capacity; no per-tenant provisioning.
- Fair-use quotas + monitoring prevent a single tenant from consuming the shared pool (noisy-neighbor).
- Optional dedicated infra for whale tenants keeps them happy without taxing the pool.

---

## 23. Backup Strategy

**Status:** Recommendation

### Recommendation

- **Primary:** Supabase managed backups — **daily backups + Point-in-Time Recovery (PITR)** (paid feature) for the database
- **Secondary (defense-in-depth):** weekly `pg_dump` to object storage (Section 9) — protects against managed-provider incidents; cross-region copy of that dump
- **Storage (files):** bucket versioning + lifecycle rules (retain N versions, delete old)
- **Restore drills:** quarterly restore tests to a staging database, verifying data integrity **and tenant isolation** after restore
- Backups encrypted; access via service credentials only

### Why this recommendation

- PITR gives the smallest data-loss window (minutes) for operational errors.
- An independent `pg_dump` protects against provider-level failures — never rely on a single system of record.
- The project's phase plan lists backup/recovery as a production-readiness requirement.

### Alternatives considered

- **Only provider-managed backups:** Single point of failure; provider incidents take the data.
- **Manual crons only:** No PITR; daily-loss window; error-prone.
- **Third-party backup SaaS:** Unnecessary now; the two-layer approach suffices.

### Free/Paid

Supabase daily backups: included at low tiers; **PITR is paid** (larger tiers). Object storage dump: pennies.

### Estimated upgrade point

- **Cross-region backup replication** when the product commits to specific SLAs.
- **Immutable backups** (WORM) when compliance (audits, educational ministry requirements) demands it.

### Risks

- **Untested restores** — the #1 backup failure mode; quarterly drills eliminate this.
- **Backup retention cost** — managed by retention policies and tiering.

### Long-term scalability

- Automated restore tests keep backups trustworthy forever.
- Backup + PITR is the foundation of DR (Section 24).

### Impact on multi-tenant SaaS architecture

- One backup covers all tenants; restore drills must verify **tenant isolation is intact** after restore (same isolation test suite as CI, run against the restored data).
- Backup/restore operations are platform-admin only; tenants never touch backup controls.

---

## 24. Disaster Recovery

**Status:** Recommendation

### Recommendation

- **Initial targets:** RPO ≤ 1 hour (via PITR), RTO ≤ 4 hours
- **Runbook (written + tested quarterly):**
  1. Restore PostgreSQL to the nearest PITR point
  2. Rebuild API/worker images from the registry (Section 17/18)
  3. Restore/verify object storage
  4. Verify data integrity + tenant isolation (isolation test suite)
  5. Switch DNS → service restored
- **DR drills quarterly** (restore into staging, practice the runbook)
- **Phase 2:** secondary-region standby (read replica promoted on failover) for reduced RTO
- **Phase 3:** true multi-region active-passive with DNS-based failover, only when SLAs require

### Why this recommendation

- Cost-aware: mature runbooks + tested restores beat expensive standby infrastructure early.
- The project's scale goal (hundreds of thousands of users) demands documented, practiced DR rather than hope.

### Alternatives considered

- **Active-active multi-region from day one:** Expensive and complex — premature.
- **Full standby environment always-on:** Costly; unnecessary at this stage.
- **No DR plan:** Unacceptable for a SaaS platform.

### Free/Paid

Runbook + drills: free (labor). Replicas/standby: paid. Provider DR tiers: paid.

### Estimated upgrade point

- Secondary region when enterprise SLAs or regional risk dictate.
- Automated failover (DNS/probe-based) when RTO must drop below ~30 minutes.

### Risks

- **Untested runbook** — eliminated by quarterly drills.
- **Provider regional outage** — mitigated by cross-region dump copy (Section 23) and, later, multi-region standby.
- **Data loss beyond PITR window** — accepted risk stated in the SLA; reduce by tightening backup cadence later.

### Long-term scalability

- DR scales with the platform: replicas, cross-region dumps, and automation cover growth without redesign.
- DR + backup (Section 23) together satisfy compliance requirements later.

### Impact on multi-tenant SaaS architecture

- DR restores serve **all tenants**; the drill verifies no tenant sees another's data post-restore.
- Per-tenant SLAs (premium tenants) can buy faster recovery tiers later — an open commercial question.

---

## 25. MCP Integrations

**Status:** Recommendation

### Recommendation

- **Expose platform capabilities to AI agents/tools via MCP (Model Context Protocol) servers** — e.g., an admin/ops MCP server (tenant management, support queries, reports, audit search) and later a content-authoring MCP server (draft courses, generate questions)
- **Secure all MCP servers:** API-key/OAuth authN, full authorization checks (Section 7), and mandatory **tenant context** on every tool call
- **Audit every MCP call** (which agent, which tool, which tenant)
- Start with 1–2 internal MCP servers; expand with AI features (Section 26)
- MCP is also the natural integration point for AI-assisted ops tooling used by the team

### Why this recommendation

- This project already operates AI agents (e.g., opencode) — MCP standardizes how tools plug into agents instead of ad-hoc REST tool APIs.
- The vision's future AI features (AI question generation, AI course builder, summarization) are tool/agent-shaped; MCP fits them.
- MCP is the emerging standard (open, free, widely adopted).

### Alternatives considered

- **Plain REST tool APIs + function calling:** Works but no standard tool discovery/auth pattern across agents.
- **Proprietary agent protocols:** Lock-in; rejected.

### Free/Paid

MCP: free, open standard. Tooling: OSS.

### Estimated upgrade point

- When the first agent-driven features ship (AI question generation, admin assistant).
- When external partners want agent integrations (tenant-side MCP access).

### Risks

- **Security:** An MCP server is an API — it must enforce authN/authZ and tenant scoping identically to the REST API, or it becomes a leak vector. Mitigated by shared authorization code (Section 7) and auditing.
- **Prompt injection** via tool inputs — mitigated by sandboxing AI outputs and never auto-executing agent actions without approval flows.

### Long-term scalability

- An MCP catalogue of platform tools scales AI feature development; per-tenant MCP access controls are a premium feature later.
- Agents + MCP reduce ops cost at scale (support triage, content ops).

### Impact on multi-tenant SaaS architecture

- Every MCP tool call resolves a tenant context and goes through the same permission engine — no back door.
- All agent actions are audit-logged per tenant (Section 16).

---

## 26. AI Providers

**Status:** Recommendation

### Recommendation

- **Anthropic Claude API** **[RECOMMENDED]** as the primary AI provider — strong multilingual/Arabic quality, tool use, long context
- **OpenAI (GPT) or Google Gemini** as alternates/fallback — Gemini is a strong Arabic alternative; final choice is an open detail to be decided and logged
- **Route through a gateway (LiteLLM)** **[RECOMMENDED]** to keep provider-agnostic calls and enable cost-based routing later
- **Per-tenant quotas:** plan-based monthly AI request limits (vision: "Monthly AI Requests" usage limit), hard rate limits, cost allocation per tenant
- **No model training on tenant data** — verify provider terms; treat all prompt payloads as PII-class data
- Features (vision): AI question generator, AI course builder, PDF summarization, later AI grading assistance

### Why this recommendation

- Arabic content quality is a core product requirement; Claude and Gemini are currently the strongest for Arabic.
- A gateway avoids lock-in — pricing/quality shifts happen yearly in this market.
- The project already names Claude (Anthropic) in its plans.

### Alternatives considered

- **OpenAI GPT:** Excellent general quality; a fine primary or fallback.
- **Google Gemini:** Strong Arabic + competitive pricing; a leading alternate.
- **Azure OpenAI:** For enterprise compliance/regions — later option.
- **Self-hosted open models:** Full control but heavy GPU ops; revisit only for data-sensitive tenants at scale.

### Free/Paid

Paid usage-based APIs (all providers). Some free trial credits. Gateway: free OSS (LiteLLM).

### Estimated upgrade point

- Provider switching/routing based on measured cost/quality.
- Fine-tuned or distilled models for specific tasks (Arabic question generation) at scale.

### Risks

- **Cost runaway** — the #1 AI risk; mitigated by per-tenant quotas, caching, batch processing via queue (Section 12), and cost dashboards (Section 27).
- **Data privacy** — mitigate: no training on tenant data, PII stripping before prompts, region-compliant providers.
- **Prompt injection** — AI outputs never execute actions without approval; tool calls from AI go through the MCP security model (Section 25).
- **Latency** — heavy AI work is queued, never in the user's request path.

### Long-term scalability

- Multi-provider routing by cost/quality keeps the platform competitive.
- AI features scale via queue workers (Section 12); per-tenant quotas protect both budget and fairness.

### Impact on multi-tenant SaaS architecture

- AI access is a **per-tenant feature flag + quota** (vision's plan model): Starter plans may exclude AI; Enterprise buys more.
- AI calls are tenant-attributed for billing and cost reports; tenant data never mixes in prompts.

---

## 27. Cost Estimation

**Status:** Recommendation — estimates only, not commitments. Review monthly.

### Recommendation — target budget bands (monthly, USD)

| Item | MVP (pilot, ~1k users) | Growth (~10k users) | Scale (~100k+ users) |
|---|---|---|---|
| Database (Supabase) | $25–50 | $100–300 | $500–1,500+ |
| Backend hosting (PaaS instances + workers) | $30–80 | $150–500 | $1,000–4,000 |
| Frontend hosting / CDN | $0–20 | $20–50 | $50–200 |
| Storage + egress (R2/S3) | $0–10 | $20–100 | $100–500 |
| Email | $0–5 | $20–100 | $100–500 |
| AI API usage (variable — biggest risk) | $0–100 | $200–1,500 | $1,500–8,000+ |
| Observability (Sentry/Axiom) | $0–30 | $50–150 | $150–500 |
| **Total (rough)** | **~$100–300** | **~$600–2,700** | **~$3,500–15,000+** |

Notes: AI spend dominates at scale; cost-cutting levers exist (Hetzner VPS vs PaaS, R2 zero egress, SES vs Resend, caching).

### Why this recommendation

- Transparency for planning; bands instead of exact numbers because provider pricing changes.
- The structure matches the chosen stack (Sections 1–17).

### Alternatives considered

- **Self-hosting everything (VPS):** Cuts hosting cost ~2–4x but adds ops labor — a later optimization lever, not a decision.
- **Serverless:** Different cost curve (per-request); reconsider at scale if traffic is spiky.

### Free/Paid

Mix as shown; many free tiers cover MVP.

### Estimated upgrade point

- Monthly cost review from day one; quarterly re-planning as usage data accumulates.

### Risks

- **AI cost spikes** — mitigated by quotas, caching, and alerts (Section 15).
- **Egress surprises** — mitigated by R2/CDN and lifecycle policies.
- **Observability per-GB creep** — mitigated by sampling and retention tiers.

### Long-term scalability

- **Per-tenant cost attribution** prepares usage-based billing (premium plans).
- Unit economics per active user inform pricing (vision: plans with usage limits).

### Impact on multi-tenant SaaS architecture

- Cost allocation per tenant (Section 14 logs + Section 26 AI attribution) supports the subscription model (plan limits vs actual usage).
- Fair-use quotas keep shared pools affordable.

---

## 28. Future Migration Strategy

**Status:** Recommendation

### Recommendation — design for vendor-neutrality from day one

- **Database:** standard SQL via `pg` only (already the vision's rule) → swapping Supabase for RDS/self-managed Postgres is a config change, not a rewrite
- **Storage:** S3-compatible interface (Section 9) → R2 ↔ S3 ↔ MinIO are swappable
- **Email/Cache/Queue/Search/AI:** behind narrow interfaces (Sections 10–13, 26)
- **Auth:** self-contained module (Section 6) — no identity provider lock-in
- **Migrations:** versioned SQL with backward-compatible expand-contract (Section 20)
- **Application:** modular monolith with extraction seams (Section 1) — services emerge via strangler-fig, never a rewrite
- **Data migration:** per-tenant phased migration (dual-run: new infra for a cohort of tenants while others stay) when moving platforms

### Why this recommendation

- Provider pricing/features change; the platform must own its stack.
- The vision explicitly prohibits SDK coupling — this section operationalizes that rule.
- Migration-by-extraction beats big-bang rewrites (the classic SaaS killer).

### Alternatives considered

- **Full rewrite:** Never — always worse cost/risk than incremental migration.
- **Stay locked to current providers:** Simpler today, hostage tomorrow (pricing, features, regions).

### Free/Paid

N/A — a design discipline; costs arise only if/when migrations happen.

### Estimated upgrade point

- Revisit when: provider pricing/terms change materially, compliance demands a region/provider, or a module needs independent scaling.

### Risks

- **Over-abstraction:** interfaces added for hypothetical migrations can complicate today — mitigated by adding interfaces only where a real provider already exists (YAGNI for the rest).
- **Dual-run complexity:** only for genuine migrations; mitigated by the per-tenant phased approach.

### Long-term scalability

- The platform can ride provider cycles (pricing drops, new regions) without rework — a durable competitive advantage.
- Modular monolith → microservices stays an option, never an obligation.

### Impact on multi-tenant SaaS architecture

- Tenant isolation survives migrations: per-tenant phased migration + re-verified RLS/isolation after every move.
- No migration can silently mix tenants' data — the isolation test suite runs as part of every migration.

---

## 29. Decision Log

**Status:** Log of approved decisions. Every entry records the decision, date, and superseded recommendations.

| # | Date | Decision | Supersedes / Notes |
|---|---|---|---|
| 1 | 2026-08-02 | Browser authentication uses **opaque server-side sessions stored in PostgreSQL**, transported via secure HttpOnly cookies. No JWTs for browser authentication; JWTs are reserved for explicitly designed machine-to-machine / public API access only. Session lifecycle defined: absolute expiry (24h default), idle timeout (30m default), rotation after login and after privilege changes, immediate revocation on password reset. PG → Redis move is triggered by the measured thresholds in Section 6. | Supersedes the open "session vs JWT" detail in Section 6. |
| 2 | 2026-08-02 | Super Admin access uses a **dedicated privileged database role / connection path**, isolated from normal tenant-scoped pools. Cross-tenant access denied by default; every action explicitly authorized; every cross-tenant action audit-logged with actor, target tenant, action, reason, timestamp, request identifier. Privileged access never relies on a missing tenant_id (fail-closed). Break-glass access requires a recorded reason. Mandatory privileged-path isolation test in CI. | Supersedes the undefined Super Admin exemption in Section 8. |
| 3 | 2026-08-02 | Rate limiting **never relies on in-memory counters**; all rate limiting uses a **shared backend**. Phase 1: PostgreSQL-backed distributed counters; Phase 2: Redis-backed; migration by the measured trigger defined in Section 16. Limits defined for authentication, public APIs, tenant APIs, file uploads, AI endpoints, administrative endpoints, and exam endpoints; tenant-aware, user-aware, and IP-based protection; fail-closed on backend unavailability; monitoring metrics defined; mandatory multi-instance, tenant-isolation, and fail-closed integration tests in CI. | Supersedes the unspecified per-instance rate limiting in Section 16. |
| 4 | 2026-08-02 | File uploads follow the **File Upload Security Architecture** (Section 16): every upload is untrusted; mandatory malware scan before availability; quarantine-first with publication only for clean files; magic-byte validation (never MIME/extension alone); allowed types and size limits defined; executable/dangerous formats rejected; files never served from the application domain (dedicated storage/CDN domain, `Content-Disposition` attachment where appropriate, `nosniff`, CSP restrictions); tenant-scoped ownership and isolation; fail-closed on scan failure; upload/scan/publication audit-logged; mandatory security tests as blocking CI gates. | Supersedes the unspecified upload handling in Sections 9 and 16. |
| 5 | 2026-08-02 | Tenant lifecycle **Draft → Active → Suspended → Grace Period → Archived → Deleted**; offboarding and tenant data export flows defined; retention policy defined (archive window 1y default, deletion window 90 days default, export 14 days default); staged deletion workflow with purge jobs and deletion journal; soft-delete for reversible states, hard-delete only for irreversible tenant termination via purge jobs; storage, search index, and queue cleanup defined; backup implications documented (post-restore purge for Deleted tenants); legal hold support (only override of retention/deletion timelines); audit preservation after deletion (7y default); mandatory lifecycle, export, residue, isolation, legal-hold, audit-preservation, and post-restore tests as blocking CI gates. | Supersedes the missing tenant data lifecycle in Section 8. |
| 6 | 2026-08-02 | **Notifications & Realtime architecture** (Section 10): single Notifications module with the mandatory outbox pattern (notification + outbox rows written in the same transaction as the triggering action); channels: in-app (primary), email (transactional provider), push and SMS as future channels behind one interface; tenant-isolated end to end; per-user preferences per channel/category; versioned templates with tenant branding; categories and priority levels defined; bounded retry with backoff and dead-letter queue; idempotent dispatch via atomic claim and deterministic event ids; realtime transport FINAL DECISION: SSE over WebSocket, with event-id resume and PostgreSQL LISTEN/NOTIFY change signal in Phase 1 (Redis pub/sub later); future scaling via a dedicated realtime tier; audit and monitoring metrics defined; mandatory integration tests as blocking CI gates. | Supersedes the missing notifications/realtime architecture in Section 10. |
| 7 | 2026-08-02 | **Billing & Subscription architecture** (Section 8): plans as data (versioned, effective-dated) with entitlements and quotas; tenant subscriptions (one per tenant, tenant-scoped); centralized entitlements re-evaluated immediately on change; service-layer quota enforcement; usage metering with tenant attribution; billing lifecycle integrated with the tenant lifecycle (unpaid → Past Due → Suspended → Grace); trial support (14d default, explicit consent to convert — never silent auto-charge); upgrades immediate/prorated, downgrades at period end with over-quota handling (block new usage, no data deletion); invoice lifecycle with tenant-scoped PDFs; payment provider abstraction (provider decision deferred and logged when adopted); signed, idempotent webhook processing via queue; idempotency by deterministic keys; audit requirements; unpaid suspension and grace periods defined; mandatory integration tests as blocking CI gates; provider-neutral design. | Supersedes the missing billing/payments architecture in Section 8. |
| 8 | 2026-08-03 | **UI component primitives:** React Aria Components is the approved headless component primitive library (the themeable, white-label-friendly choice in Section 2); Tailwind CSS is approved as the styling/token utility layer only, aligned to DESIGN_SYSTEM §22 tokens; shadcn/ui and Radix are rejected. No UI library is installed during scaffolding; component primitives are layered on React Aria Components in the UI phase. | Resolves the open Tailwind detail in Section 2; supersedes the shadcn/ui-based component language previously recorded in DESIGN_SYSTEM §12. |

**Next steps before decisions can be logged:**

1. Review PRODUCT_VISION alignment (stack already largely fixed by the vision document).
2. Decide and log: permission library (Section 7), storage provider (Section 9), email provider (Section 10), AI primary provider (Section 26), hosting platform (Section 17).
3. Approve the multi-tenancy model (Section 8) as the architectural cornerstone.

---

*Manara — Architecture Decision Record. Maintained as the single source of truth for architectural choices. Recommendations become decisions only when logged above.*
