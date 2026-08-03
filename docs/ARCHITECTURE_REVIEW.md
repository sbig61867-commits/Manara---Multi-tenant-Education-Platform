# Manara — Architecture Review Report & Backlog

> **Purpose:** Official record of the Principal Architect review of `docs/TECHNICAL_GUIDE.md`.
>
> **Structure:**
> 1. **Part 1 — Review Report:** Verbatim copy of the architecture review (anchor tags added to finding headings/rows solely to enable backlog linking; the report text itself is unchanged).
> 2. **Part 2 — Finding Backlog:** Every finding (F1–F41) converted into a checklist item. Status `OPEN` for all. **Nothing is fixed. No decisions are made.**
>
> **Status:** Backlog only — items remain OPEN until explicitly resolved and moved to a closed section.

---

# Part 1 — Architecture Review Report

# Architecture Review — Manara Technical Guide (docs/TECHNICAL_GUIDE.md)

**Reviewer role:** Principal Software Architect
**Scope:** Full ADR review against the scale target (hundreds of thousands of users, exam-wave concurrency) and the multi-tenant isolation mandate.
**Method:** Cross-section consistency audit; adversarial testing of the tenant-isolation, DR, scaling, and security claims.

---

## Executive Summary

The document is structurally strong (28 sections × 8 required fields, consistent ADR discipline, recommendations clearly separated from decisions). The architecture is fundamentally sound for MVP. However, it contains **1 Critical**, **6 High**, **12 Medium**, and **9 Low** findings. The most serious are:

1. **(Critical)** The RLS implementation pattern (`current_setting`) combined with connection pooling is the classic multi-tenant cross-contamination bug — the document combines the two ingredients without addressing the interaction.
2. **(High)** Three vision-mandated subsystems have no architecture at all: Notifications/Realtime, Billing, and tenant data lifecycle.
3. **(High)** Several security controls (upload scanning, shared-store rate limiting, session revocation semantics) are asserted but not designed.

Findings are grouped by category. No document changes were made.

---

## A. Contradictions

### <a id="F1"></a>F1 — RLS `current_setting` + connection pooling → cross-tenant leak vector
**Severity: Critical**

**Explanation:** Section 5 recommends RLS via `current_setting('app.tenant_id')` *and* "connection pooling via Supabase's pooler". `current_setting` is **session-scoped**. With the pooler in session mode, a pooled connection serving request A (tenant X) is reused for request B (tenant Y) — if the setting was set outside a transaction, B inherits X's tenant context and RLS filters on the wrong tenant. Supabase's pooler defaults to transaction mode, but the document never states this requirement, and `set_config(..., true)` (transaction-local) must be called inside the same transaction as the queries. NestJS + `pg` with autocommit does not do this by default. This is the single highest-risk design detail in the entire guide and it is silently undefined.

**Recommended fix:** Mandate (a) transaction-mode pooler only, (b) `set_config('app.tenant_id', $1, true)` — transaction-local — inside every request transaction, (c) an explicit rejection of session-mode pooling in the ADR, and (d) a CI integration test that: opens a fresh pooled connection, runs two requests for different tenants in sequence, and asserts tenant context does not leak between them.

---

### <a id="F2"></a>F2 — Audit truth ambiguity: database audit table vs logs-as-audit
**Severity: Medium**

**Explanation:** Section 16 requires an "Audit Log module — tenant-scoped, **immutable**" (a database table), while Section 14 says "logs become the source for audit features (vision's Audit module)". Two competing sources of truth for the same mandated module; an operator cannot tell which record is authoritative. Also, an app-level DB table is **not** immutable — any privileged DB role can update it.

**Recommended fix:** Designate the DB audit table as the sole source of truth for audit; logs are for troubleshooting only. Replace "immutable" with a concrete mechanism: append-only table + revoked update privileges for app roles + hash-chaining (or outbox to object storage) when compliance demands tamper-evidence.

---

### <a id="F3"></a>F3 — "Defer queue" vs email queued from day one
**Severity: Medium**

**Explanation:** Section 12 says "defer dedicated queue infrastructure … when background work first appears", but Section 10 mandates "all sends … queued as background jobs" from day one, and Section 21 mandates "async everything heavy". The queue exists from day one (pg-boss); the "defer" framing contradicts the rest of the guide.

**Recommended fix:** Reword Section 12: queue is **required at launch** via pg-boss (zero new infra); what is deferred is *dedicated* queue infrastructure (Redis/BullMQ). This also closes the F7 wording gap.

---

### <a id="F4"></a>F4 — RPO ≤ 1h vs free-tier backups vs MVP budget
**Severity: Medium**

**Explanation:** Section 24 commits to RPO ≤ 1h via PITR; Section 23 notes PITR is a paid tier feature. Section 27 budgets the MVP database at $25–50/month — likely below the PITR-enabled tier, where RPO degrades to ~24h (daily backups). The DR commitment and the cost plan are mutually inconsistent.

**Recommended fix:** State RPO/RTO as **tier-dependent targets** (free tier: RPO ≤ 24h; PITR tier: ≤ 1h) and include PITR explicitly in the MVP cost line so the budget matches the claim.

---

### <a id="F5"></a>F5 — Feature-flag conflation: plan flags vs rollout flags
**Severity: Medium**

**Explanation:** Section 8 ("per-tenant feature flags … enforced in the service layer") and Section 2 ("feature flags from the tenant's plan gate UI") treat tenant **plan** flags as day-one, while Section 20 calls feature flags "a later refinement" — that's rollout (deployment) flags, a different mechanism. The guide uses one term for two unrelated systems, which will cause implementation confusion.

**Recommended fix:** Split terminology: "Entitlements" (plan/tenant feature flags — day one) vs "Rollout flags" (deployment toggles — later). Note the difference in Sections 2, 8, 20.

---

### <a id="F6"></a>F6 — Supabase Storage option contradicts the "S3-swappable" claim
**Severity: Medium**

**Explanation:** Section 9 offers "Supabase Storage" as a peer option to R2 under an "S3-compatible interface… providers swappable" claim. Supabase Storage's API is **not** S3-compatible — choosing it breaks the abstraction promised in Section 28.

**Recommended fix:** Remove Supabase Storage from the options, or explicitly document it as an adapter with its own interface (accepting that it weakens the migration story). Recommend S3-compatible providers only.

---

## B. Missing Decisions

### <a id="F7"></a>F7 — Session vs JWT open, but revocation semantics are asserted
**Severity: High**

**Explanation:** Section 6 leaves session-vs-JWT open yet asserts "logout/revocation is global" (Section 6, multi-tenant impact). With JWTs, global revocation requires a token-version/denylist mechanism; with DB sessions it's a delete. The claimed security property does not follow from the open decision. Additionally, "session store moves to Redis" is listed as an upgrade but no trigger metric is given, and a DB-backed session table means every request costs one extra primary-DB round trip from day one.

**Recommended fix:** Decide this before implementation (recommendation: DB-backed opaque sessions for an exam platform — revocation is exact and cheap; JWT only for public API tokens). If sessions are DB-backed, commit to the measured trigger for moving to Redis (e.g., session reads > X% of DB queries).

---

### <a id="F8"></a>F8 — No migration tooling decision
**Severity: Low**

**Explanation:** "Versioned SQL migrations" is specified, but no tool (node-pg-migrate, Drizzle, Flyway…) is named, and RLS policies are not stated to be migration-managed. RLS policy drift between environments is a known failure mode.

**Recommended fix:** Add the migration runner to the decision list in Section 29, and explicitly require **RLS policies to be versioned as part of migrations** with a CI check that staging/prod policy sets are identical.

---

## C. Missing Sections / Documentation

### <a id="F9"></a>F9 — No Notifications / Realtime architecture
**Severity: High**

**Explanation:** The vision mandates a Notifications module plus live features (Live Training, Live Proctoring, Live Training sessions). The guide has Email (Section 10) but no in-app notification, WebSocket/SSE, eventing, or fan-out design. Notification fan-out to 100k users is a classic bottleneck; live proctoring has latency and security requirements (anti-cheat, reconnect semantics) that cannot be retrofitted cleanly.

**Recommended fix:** Add a Realtime & Notifications section: event/outbox model (writes to an outbox table in the request transaction → worker fans out), batching inserts for fan-out, SSE/WebSocket transport decision logged in Section 29, and per-tenant notification preferences.

---

### <a id="F10"></a>F10 — No Billing / Payments architecture
**Severity: High**

**Explanation:** Subscription plans, feature flags, and usage limits are core (vision: SubscriptionPlan, Billing module), and Section 27 promises "usage-based billing readiness" — but there is no architecture for metering, payment providers, invoices, dunning, or plan changes. Plan changes interact with authorization (Section 7) and quotas (Section 8) and are the hardest part to retrofit.

**Recommended fix:** Add a Billing section: meter usage via the audit/log streams (per-tenant attribution already designed), payment provider decision (logged, later), invoice storage in object storage, and a documented plan-change lifecycle that re-evaluates entitlements.

---

### <a id="F11"></a>F11 — No tenant data lifecycle (offboarding, deletion, export)
**Severity: High**

**Explanation:** Nowhere does the guide address: tenant offboarding, GDPR/PDPL-style data deletion, data export, or purge jobs. For universities in Gulf markets this is legally mandatory, and retrofitting deletion into a shared-schema design is expensive and risky (soft-delete vs hard-delete, cascade across RLS tables, storage prefix cleanup, search index purge, queue job cleanup).

**Recommended fix:** Add a Data Lifecycle subsection under Multi-tenancy or Security: per-tenant export (via queue workers), staged offboarding (disable → grace → purge), purge jobs carrying `tenant_id`, and CI tests that deletion leaves no residue in DB/storage/search/queues.

---

### <a id="F12"></a>F12 — Practical Labs architecture missing (vision levels 2–3)
**Severity: Medium**

**Explanation:** The vision defines three lab integration levels, including "create temp environment via tenant API" and future in-browser environments. The guide mentions labs only in storage context. Level 2 (outbound API integrations, credentials handling, time-bounded access) has security and SSRF implications that need a home.

**Recommended fix:** Add a short Practical Labs section (or fold into a Future Capabilities section): level 1 (link + report) first; document credential vaulting and outbound-call isolation when level 2 is built.

---

### <a id="F13"></a>F13 — No measurement instrumentation plan
**Severity: Medium**

**Explanation:** Section 21's strategy is "measure first", but the guide never specifies what instrumentation is enabled from day one (query statistics, DB load, per-route latency). "Measure first" without measurement infrastructure is unfalsifiable.

**Recommended fix:** Mandate day-one observability: `pg_stat_statements` for query-level analysis, Sentry tracing on API routes, and queue-depth metrics (Section 15) — before any caching decision can be made.

---

### <a id="F14"></a>F14 — No local development environment / seed strategy
**Severity: Low**

**Explanation:** Nothing covers developer onboarding: docker-compose, seed data, or how RLS behaves in dev. Multi-tenant RLS in dev environments is a frequent source of "works on my machine" bugs.

**Recommended fix:** Add one paragraph: docker-compose (Postgres + app + workers), fixture-based multi-tenant seed data (≥2 tenants), and the isolation test suite runnable locally.

---

## D. Multi-Tenant Design & Security

### <a id="F15"></a>F15 — Super Admin access path vs RLS undefined
**Severity: Medium**

**Explanation:** Section 8 makes "Super Admin the only exception to tenant scoping" but never defines *how* a super admin operates under RLS: a session without `app.tenant_id` is blocked by policies; a bypass role must be created and its every action audited. Undefined bypass paths are where leaks and compliance gaps are born.

**Recommended fix:** Define explicitly: super admin runs on a dedicated role/connection that bypasses RLS, every super-admin request is audit-logged (who, what, which tenant), and cross-tenant super-admin access is denied by default outside the defined tooling.

---

### <a id="F16"></a>F16 — Rate limiting is per-instance and silently bypassable at horizontal scale
**Severity: High**

**Explanation:** Section 16 places rate limiting "at the application layer", but Section 22 scales out to multiple instances. In-memory or per-instance limiters are trivially bypassed by spreading requests across instances. The guide never states that limiters must use a shared store (PG counters initially, Redis later per Section 11).

**Recommended fix:** State the shared-store requirement for all limiters in Section 16, with PG window counters as the day-one implementation and Redis as the measured upgrade (consistent with Section 11).

---

### <a id="F17"></a>F17 — Upload security: no malware scanning, no MIME/sniffing defense
**Severity: High**

**Explanation:** Section 16 limits upload size/count but never addresses: virus/malware scanning (a university platform distributing files between students is a distribution vector), content-type validation by magic bytes, or stored-XSS via uploaded HTML/SVG (served from the same origin/domain as the app, files can hijack sessions). Certificate/lab files are exactly the kind of content that gets weaponized.

**Recommended fix:** Add to Section 16/9: queued malware scan on every upload (decision logged; provider-agnostic), magic-byte validation at the API, serving user files from a separate domain/CDN with `Content-Disposition: attachment` + no-sniff headers + CSP, and immediate quarantine of unscanned files.

---

### <a id="F18"></a>F18 — Session security on tenant custom domains unaddressed
**Severity: Medium**

**Explanation:** Section 17 promises per-tenant custom domains (white-label) later. Auth cookies scoped to custom domains, CORS between tenant domains and the API, and CSRF across those domains are not designed. Retrofitting multi-domain cookies is painful and error-prone.

**Recommended fix:** Note in Section 17 that custom-domain support requires a cookie/domain design decision (e.g., root-domain cookie strategy or per-tenant cookie scoping + CSRF tokens) to be made **before** white-labeling ships, and log it.

---

### <a id="F19"></a>F19 — Presigned URL revocation is coarse
**Severity: Medium**

**Explanation:** Presigned URLs (Section 9) are valid until expiry — a student who is removed mid-exam, or a certificate PDF, remains downloadable for the URL's lifetime. For exam content and private materials this is a real leak window that signed URLs alone cannot close.

**Recommended fix:** Add a per-file ACL check on download for sensitive content (proxy check or short-TTL + re-check endpoint), and document the trade-off; reserve very short TTLs for exam assets.

---

### <a id="F20"></a>F20 — Helmet/CSP/clickjacking controls absent (exam context)
**Severity: Medium**

**Explanation:** The security section covers passwords, sessions, and rate limiting but not headers: CSP, frame-ancestors (clickjacking of exam pages), and X-Frame-Options. Exam sessions are the classic clickjacking target.

**Recommended fix:** Add to Section 16: Helmet defaults, strict CSP (including `frame-ancestors 'none'` on exam routes), and no-sniff on all responses.

---

### <a id="F21"></a>F21 — SSRF via AI tools and lab links
**Severity: Low**

**Explanation:** AI features (PDF summarization via URL, lab external links, MCP tools) fetch URLs server-side; the guide doesn't mention outbound-request restrictions. SSRF from AI tooling is a current, real attack class.

**Recommended fix:** Add one line in Section 26/25: outbound fetches are egress-restricted (allowlist, no cloud metadata endpoints), and AI tools never receive privileged credentials.

---

## E. Scalability & Performance

### <a id="F22"></a>F22 — Partition-by-time conflicts with tenant_id-led query patterns
**Severity: Medium**

**Explanation:** Section 8 says "partitioning (by time, with tenant_id as the leading key)". Declarative partitioning by time means tenant-only queries (no time bound) cannot prune partitions and will scan every partition — the exact query pattern this platform has (a tenant browsing its attempts/history). The two goals are in tension.

**Recommended fix:** Clarify: partition by time **and** keep per-partition indexes on `(tenant_id, …)`; hot queries must include a time bound (UI already implies "this semester/this program"); state which tables (attempts, audit, notifications) partition and on which key.

---

### <a id="F23"></a>F23 — Single Supabase project limits vs hundreds of thousands of users
**Severity: Medium**

**Explanation:** A single Supabase project has hard caps (connections, DB size tiers, memory/CPU) that will bind well before "hundreds of thousands of users". The guide says "shared schema scales to hundreds of thousands … on one primary + replicas", but Supabase replicas/PITR are paid add-ons and the migration path to RDS is only sketched in Section 28.

**Recommended fix:** Add sizing guidance to Section 5: project tiers vs expected DB size/connections, when the RDS/migration trigger fires (size, connections, or cost), and keep the `pg`-driver neutrality requirement (already there) as the migration enabler.

---

### <a id="F24"></a>F24 — pg-boss on the primary DB during exam waves
**Severity: Medium**

**Explanation:** pg-boss stores jobs in the same primary that handles exam submissions — the busiest resource gets the queue's writes *and* polling reads exactly when load peaks. The document's own risk framing (Section 12) acknowledges this only as "priority queues".

**Recommended fix:** State the measured trigger for BullMQ/Redis explicitly (e.g., primary DB load % during waves, job backlog lag) and note that worker polling should use a dedicated (small) connection pool, not the request pool.

---

## F. Vendor Lock-In

### <a id="F25"></a>F25 — Supabase Storage contradiction (see F6)
**Severity: Medium** — covered above.

### <a id="F26"></a>F26 — Backups chain tied to Supabase internals
**Severity: Low**

**Explanation:** The weekly `pg_dump` is the only provider-neutral copy, and it yields at best 7-day RPO if Supabase is lost. The migration story (Section 28) implies "config change", but the backup story's RPO during any migration is bounded by the dump cadence.

**Recommended fix:** State the intent: raise dump cadence (e.g., daily `pg_dump` + WAL archiving if feasible) before any provider migration, so the 1h RPO survives a provider switch.

---

## G. Operational Risks

### <a id="F27"></a>F27 — Staging environment data privacy undefined
**Severity: Medium**

**Explanation:** Staging will be populated (or not) with real tenant data — no policy exists. RLS makes data real, and GDPR/PDPL applies to staging copies; also, staging is used for restore drills (Section 23), which implies real data there by design.

**Recommended fix:** Add a policy: staging uses synthetic multi-tenant fixtures only (F14); restore drills run against an isolated staging instance and are purged after verification.

---

### <a id="F28"></a>F28 — No incident response / on-call process
**Severity: Low**

**Explanation:** DR runbooks (Section 24) exist, but day-to-day incident response — alert ownership, escalation, severity definitions, postmortems — is absent. Exam waves are high-stakes incidents waiting to happen.

**Recommended fix:** Add one paragraph in Section 15/24: on-call rotation once in production, severity taxonomy, and a postmortem template. No new technology needed.

---

### <a id="F29"></a>F29 — Secrets management is env-only; no rotation plan
**Severity: Low**

**Explanation:** "Secrets in env variables / CI secrets" is fine for MVP but rotation of provider keys (storage, email, AI) has no mechanism, and a leaked key has no containment story.

**Recommended fix:** Add to Section 16: key rotation cadence and a documented "key compromised" procedure; defer a vault (e.g., a secrets manager) to the decision log rather than promising it later.

---

## H. Cost Risks

### <a id="F30"></a>F30 — Cost table omits infra that Sections 13–24 themselves introduce
**Severity: Medium**

**Explanation:** The "Scale" column omits: Redis/Upstash (Sections 11/12), Meilisearch (managed or its own instance), Supabase read replicas + PITR add-ons (Sections 5/23), worker instances at wave scale (Section 22), multi-region/DR standby (Section 24), virus scanning, and cross-provider **egress** between Render (or Vercel functions) and Supabase DB/storage. For an education platform with video content, storage+transcoding at scale is also likely underestimated ($100–500/mo).

**Recommended fix:** Add the missing line items to the scale column (or a "deferred infra" note with trigger points), and call out DB egress between PaaS and Supabase explicitly — this cost surprises teams most.

---

## I. Disaster Recovery Gaps

### <a id="F31"></a>F31 — Queue state and search index not in DR scope
**Severity: Medium**

**Explanation:** DR runbook (Section 24) covers DB, images, storage. Missing: queue state (pg-boss jobs live in the restored DB — OK for phase 1 — but BullMQ/Redis jobs would be **lost** on failover with no recovery step), and the search index (Meilisearch rebuild from DB is required — its rebuild time is unbounded and unstated).

**Recommended fix:** Extend the runbook: queue recovery policy (re-enqueue from outbox; accept at-least-once redelivery), and a search index rebuild step with an RTO budget recorded at Section 13.

---

### <a id="F32"></a>F32 — Alerting before DR is never connected
**Severity: Low**

**Explanation:** Section 24 assumes an operator notices the outage; monitoring (Section 15) defers dashboards/alerts to "phase 2". With RTO ≤ 4h, detection cannot be deferred.

**Recommended fix:** State explicitly: uptime/health checks must generate notifications (email/Slack) from day one — alerting is a launch requirement, not a phase-2 feature.

---

## J. CI/CD Gaps

### <a id="F33"></a>F33 — No E2E browser testing strategy
**Severity: Medium**

**Explanation:** Pipeline stages end at integration tests. The multi-tenant theming, RTL, and entitlement-gated UI (Sections 2/8) are exactly where frontend regressions hide, and no browser-level test exists.

**Recommended fix:** Add a browser E2E stage (tool choice logged in Section 29) covering: login → tenant switch, entitlement-gated UI, RTL rendering; run on merge-to-main, not per-PR initially.

---

### <a id="F34"></a>F34 — No container image scanning
**Severity: Medium**

**Explanation:** Dependency scanning is CI-specified, but the built Docker images (Section 17) are never scanned for OS-level CVEs. Image scanning is cheap and catches the supply-chain layer dependency scanning misses.

**Recommended fix:** Add image scanning to the build stage in Section 18 (open-source scanner; name logged in the decision list).

---

### <a id="F35"></a>F35 — OpenAPI breaking-change gate is vague; no dependency update automation
**Severity: Low**

**Explanation:** Section 4 says "CI checks on the OpenAPI spec" without defining the check; Section 18 doesn't automate dependency updates, so vulnerability fixes depend on human diligence.

**Recommended fix:** Define the gate (diff detection of breaking changes between tagged specs — e.g., semantic diff tooling) and add dependency-update automation (Renovate/Dependabot) to Section 18.

---

### <a id="F36"></a>F36 — No performance gate in CI
**Severity: Low**

**Explanation:** Section 21 mandates load testing "before exam waves" (periodic), but nothing prevents per-PR performance regressions (new N+1, missing index) from reaching production between load tests.

**Recommended fix:** Add a lightweight query-log review (slow-query report from the ephemeral test DB) to the pipeline; full k6 load runs stay periodic per Section 21.

---

## K. Low-Severity Notes

| # | Finding | Severity | Fix |
|---|---|---|---|
| <a id="F37"></a>F37 | "Sections 9" typo (Section 22); "Section of vision" (Section 9) — cross-ref hygiene | Low | Fix references |
| <a id="F38"></a>F38 | Cursor pagination needs unique sort keys — unstated | Low | One line in Section 4: cursor over unique, stable ordering columns |
| <a id="F39"></a>F39 | Certificate tamper-proofing (verification links/hash) unaddressed though certificates are a core feature | Low | Add to future capabilities; note tamper-evident storage of issued certificates |
| <a id="F40"></a>F40 | Argon2id cost during login floods is a CPU-DoS surface; limiter must preempt hashing | Low | Note: rate-limit *before* password hashing in Section 16 |
| <a id="F41"></a>F41 | "Immutable audit log" (see F2) | Low | Covered in F2 |

---

## Priority Recommendation (top 5 actions)

1. **F1 (Critical):** Lock down the RLS + pooler contract (transaction-mode pooler, transaction-local `set_config`, connection-reuse isolation test) before any implementation starts.
2. **F11 (High):** Design the tenant data lifecycle (offboarding/deletion/export) before the shared-schema schema reaches production.
3. **F9/F10 (High):** Add the missing Notifications/Realtime and Billing sections — both are core vision modules with retrofitting costs.
4. **F17 (High):** Add upload malware scanning + file-serving hardening to the security baseline.
5. **F7/F16 (High):** Close the two "asserted but undefined" security properties: session revocation semantics and shared-store rate limiting.

The document is a strong foundation. Its main systemic risk is the pattern of **asserting security properties without specifying the mechanisms** (F1, F2, F7, F15, F16) — each of which becomes exponentially more expensive to fix after implementation begins.

---

# Part 2 — Finding Backlog

> Checklist of all findings. Status is `OPEN` for every item. Nothing has been fixed; no decisions have been made.
> Links point to the original finding text in Part 1.

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 6 |
| Medium | 12 |
| Low | 9 |
| **Total** | **28 unique findings (F1–F41; F25 duplicates F6, F41 duplicates F2)** |

**Resolved:** F1, F7, F9, F10, F11, F15, F16, F17 — see [Resolved Findings](#resolved-findings) below. All other findings remain OPEN.

## Backlog

| ID | Severity | Status | Title | Link to finding |
|---|---|---|---|---|
| F1 | Critical | RESOLVED | RLS `current_setting` + connection pooling → cross-tenant leak vector | [F1](#F1) |
| F2 | Medium | OPEN | Audit truth ambiguity: DB audit table vs logs-as-audit | [F2](#F2) |
| F3 | Medium | OPEN | "Defer queue" vs email queued from day one | [F3](#F3) |
| F4 | Medium | OPEN | RPO ≤ 1h vs free-tier backups vs MVP budget | [F4](#F4) |
| F5 | Medium | OPEN | Feature-flag conflation: plan flags vs rollout flags | [F5](#F5) |
| F6 | Medium | OPEN | Supabase Storage option contradicts "S3-swappable" claim | [F6](#F6) |
| F7 | High | RESOLVED | Session vs JWT open, revocation semantics asserted | [F7](#F7) |
| F8 | Low | OPEN | No migration tooling decision | [F8](#F8) |
| F9 | High | RESOLVED | No Notifications / Realtime architecture | [F9](#F9) |
| F10 | High | RESOLVED | No Billing / Payments architecture | [F10](#F10) |
| F11 | High | RESOLVED | No tenant data lifecycle (offboarding, deletion, export) | [F11](#F11) |
| F12 | Medium | OPEN | Practical Labs architecture missing (vision levels 2–3) | [F12](#F12) |
| F13 | Medium | OPEN | No measurement instrumentation plan | [F13](#F13) |
| F14 | Low | OPEN | No local development environment / seed strategy | [F14](#F14) |
| F15 | Medium | RESOLVED | Super Admin access path vs RLS undefined | [F15](#F15) |
| F16 | High | RESOLVED | Rate limiting per-instance, bypassable at horizontal scale | [F16](#F16) |
| F17 | High | RESOLVED | Upload security: no malware scanning, no MIME/sniffing defense | [F17](#F17) |
| F18 | Medium | OPEN | Session security on tenant custom domains unaddressed | [F18](#F18) |
| F19 | Medium | OPEN | Presigned URL revocation is coarse | [F19](#F19) |
| F20 | Medium | OPEN | Helmet/CSP/clickjacking controls absent (exam context) | [F20](#F20) |
| F21 | Low | OPEN | SSRF via AI tools and lab links | [F21](#F21) |
| F22 | Medium | OPEN | Partition-by-time conflicts with tenant_id-led query patterns | [F22](#F22) |
| F23 | Medium | OPEN | Single Supabase project limits vs hundreds of thousands of users | [F23](#F23) |
| F24 | Medium | OPEN | pg-boss on the primary DB during exam waves | [F24](#F24) |
| F25 | Medium | OPEN | Supabase Storage contradiction — duplicate of F6 | [F25](#F25) |
| F26 | Low | OPEN | Backups chain tied to Supabase internals | [F26](#F26) |
| F27 | Medium | OPEN | Staging environment data privacy undefined | [F27](#F27) |
| F28 | Low | OPEN | No incident response / on-call process | [F28](#F28) |
| F29 | Low | OPEN | Secrets management env-only; no rotation plan | [F29](#F29) |
| F30 | Medium | OPEN | Cost table omits infra introduced by Sections 13–24 | [F30](#F30) |
| F31 | Medium | OPEN | Queue state and search index not in DR scope | [F31](#F31) |
| F32 | Low | OPEN | Alerting before DR never connected | [F32](#F32) |
| F33 | Medium | OPEN | No E2E browser testing strategy | [F33](#F33) |
| F34 | Medium | OPEN | No container image scanning | [F34](#F34) |
| F35 | Low | OPEN | OpenAPI breaking-change gate vague; no dependency update automation | [F35](#F35) |
| F36 | Low | OPEN | No performance gate in CI | [F36](#F36) |
| F37 | Low | OPEN | Cross-reference typos ("Sections 9", "Section of vision") | [F37](#F37) |
| F38 | Low | OPEN | Cursor pagination unique sort keys unstated | [F38](#F38) |
| F39 | Low | OPEN | Certificate tamper-proofing / verification unaddressed | [F39](#F39) |
| F40 | Low | OPEN | Argon2id login-flood CPU-DoS surface | [F40](#F40) |
| F41 | Low | OPEN | "Immutable audit log" claim — duplicate of F2 | [F41](#F41) |

## Resolved Findings

| ID | Severity | Status | Title | Resolution |
|---|---|---|---|---|
| F1 | Critical | RESOLVED | RLS `current_setting` + connection pooling → cross-tenant leak vector | Resolved in `docs/TECHNICAL_GUIDE.md` Section 5 — new mandatory [Tenant-Context Contract](TECHNICAL_GUIDE.md#tenant-context-contract-mandatory): transaction-mode pooling only; session-mode pooling rejected; transaction-local `set_config('app.tenant_id', $tenant_id, true)` set inside the same transaction as all tenant-scoped queries; autocommit forbidden; fail-closed on missing context; mandatory pooled-connection tenant-context leak test in CI. Cross-referenced from Sections 8 and 12. |
| F7 | High | RESOLVED | Session vs JWT open, revocation semantics asserted | Resolved in `docs/TECHNICAL_GUIDE.md` Section 6 — [Session lifecycle policy (FINAL DECISION)](TECHNICAL_GUIDE.md#session-lifecycle-policy-final-decision), logged as Decision Log #1: opaque server-side sessions stored in PostgreSQL, secure HttpOnly cookies, exact logout and immediate session revocation, no JWTs for browser authentication (JWTs reserved for explicitly designed machine-to-machine / public API access only). Session expiry (24h default), idle timeout (30m default), rotation after login and privilege changes, revocation on password reset, measured PG → Redis trigger, and provider-neutral session-store interface all defined. |
| F15 | Medium | RESOLVED | Super Admin access path vs RLS undefined | Resolved in `docs/TECHNICAL_GUIDE.md` Section 8 — [Super Admin Access Model (FINAL DECISION)](TECHNICAL_GUIDE.md#super-admin-access-model-final-decision), logged as Decision Log #2: dedicated privileged database role/connection path isolated from normal tenant-scoped pools; normal traffic never uses the privileged path; cross-tenant access denied by default; every action explicitly authorized; every cross-tenant action audit-logged (actor, target tenant, action, reason, timestamp, request identifier); privileged access never relies on a missing tenant_id (fail-closed); mandatory privileged-path isolation test in CI; break-glass access with recorded reason and review. Cross-referenced from the Tenant-Context Contract (Section 5) and Section 16. |
| F16 | High | RESOLVED | Rate limiting per-instance, bypassable at horizontal scale | Resolved in `docs/TECHNICAL_GUIDE.md` Section 16 — [Rate Limiting Architecture (FINAL DECISION)](TECHNICAL_GUIDE.md#rate-limiting-architecture-final-decision), logged as Decision Log #3: never in-memory; shared backend required; Phase 1 PostgreSQL-backed distributed counters, Phase 2 Redis-backed, with measured migration trigger; defined limits for authentication, public APIs, tenant APIs, file uploads, AI endpoints, admin endpoints, and exam endpoints; tenant-aware, user-aware, and IP-based protection (NAT-aware); fail-closed (503) on backend unavailability; monitoring metrics defined; mandatory multi-instance, tenant-isolation, and fail-closed integration tests as blocking CI gates. Cross-referenced from Section 11 (cache). |
| F17 | High | RESOLVED | Upload security: no malware scanning, no MIME/sniffing defense | Resolved in `docs/TECHNICAL_GUIDE.md` Section 16 — [File Upload Security Architecture (FINAL DECISION)](TECHNICAL_GUIDE.md#file-upload-security-architecture-final-decision), logged as Decision Log #4: all uploads treated as untrusted; mandatory malware scanning before availability; quarantine-first with publication only for clean files; magic-byte validation (never MIME/extension alone); allowed types and size limits defined; executable/dangerous formats rejected; files never served from the application domain (dedicated storage/CDN domain, `Content-Disposition: attachment` where appropriate, `X-Content-Type-Options: nosniff`, CSP restrictions); tenant-scoped ownership and isolation; fail-closed on scan failure; upload/scan/publication audit-logged; mandatory security tests (magic-byte spoofing, dangerous formats, quarantine enforcement, tenant isolation, headers, fail-closed) as blocking CI gates. Cross-referenced from Sections 9 and 16. |
| F11 | High | RESOLVED | No tenant data lifecycle (offboarding, deletion, export) | Resolved in `docs/TECHNICAL_GUIDE.md` Section 8 — [Tenant Data Lifecycle Architecture (FINAL DECISION)](TECHNICAL_GUIDE.md#tenant-data-lifecycle-architecture-final-decision), logged as Decision Log #5: complete lifecycle (Draft → Active → Suspended → Grace Period → Archived → Deleted); offboarding and tenant data export flows (14-day export window default); retention policy (1y archive window, 90-day deletion window defaults); staged deletion workflow with purge jobs and deletion journal (fail-closed on partial deletion); soft-delete for reversible states vs hard-delete only for irreversible termination via purge jobs; storage, search index, and queue cleanup defined; backup implications with post-restore purge for Deleted tenants; legal hold as the only override of retention/deletion timelines; audit preservation after deletion (7y default); mandatory lifecycle, export, residue, isolation, legal-hold, audit-preservation, and post-restore tests as blocking CI gates. Cross-referenced from Section 16 (audit). |
| F9 | High | RESOLVED | No Notifications / Realtime architecture | Resolved in `docs/TECHNICAL_GUIDE.md` Section 10 — [Notifications & Realtime Architecture (FINAL DECISION)](TECHNICAL_GUIDE.md#notifications--realtime-architecture-final-decision), logged as Decision Log #6: single Notifications module; mandatory outbox pattern (notification + outbox rows in the same transaction as the triggering action, at-least-once); channels: in-app (primary), email, future push and SMS behind one interface; tenant-isolated end to end; per-user preferences per channel/category; versioned templates with tenant branding; categories and priority levels; bounded retry with backoff and dead-letter handling; idempotency via atomic outbox claim and deterministic event ids; realtime FINAL DECISION: SSE over WebSocket (event-id resume, PostgreSQL LISTEN/NOTIFY change signal in Phase 1, Redis pub/sub later); future scaling via dedicated realtime tier; audit and monitoring metrics defined; mandatory integration tests (outbox atomicity, at-least-once, tenant isolation, preferences, resume, retry/DDL, templates) as blocking CI gates. |
| F10 | High | RESOLVED | No Billing / Payments architecture | Resolved in `docs/TECHNICAL_GUIDE.md` Section 8 — [Billing & Subscription Architecture (FINAL DECISION)](TECHNICAL_GUIDE.md#billing--subscription-architecture-final-decision), logged as Decision Log #7: plans as data (versioned, effective-dated) with entitlements and quotas; one tenant subscription per tenant; centralized entitlements re-evaluated immediately on plan/flag change; service-layer quota enforcement; usage metering with tenant attribution; billing lifecycle integrated with the tenant lifecycle (unpaid → Past Due → Suspended → Grace); trial support (14d default, explicit consent to convert, never silent auto-charge); upgrades immediate/prorated, downgrades at period end with over-quota handling (block new usage, no data deletion); invoice lifecycle with tenant-scoped PDFs; payment provider abstraction (provider decision deferred and logged when adopted); signed, idempotent webhook processing via the queue; idempotency by deterministic keys; audit requirements; unpaid suspension and grace periods defined; mandatory integration tests (entitlements, quota, billing lifecycle, trial, upgrade/downgrade, webhook idempotency, provider mock, tenant isolation, suspension) as blocking CI gates; provider-neutral design. |

---

*Manara — Architecture review backlog. Items move from OPEN to a resolved state only through an explicit decision; this file records no decisions.*
