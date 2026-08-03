# Manara Platform — Business Domain Model

> **وثيقة نموذج المجال التجاري لمنصة منارة**
> This document defines the business domain of the Manara platform: the entities, their purposes, responsibilities, relationships, lifecycles, business rules, ownership, and multi-tenant behavior.
>
> **Scope:** Business concepts only. This is NOT a database schema, API contract, or implementation document. No tables, SQL, or code appear here.
> **Companion documents:** `PRODUCT_VISION.md` (product vision, Arabic), `TECHNICAL_GUIDE.md` (architecture decisions), `ARCHITECTURE_REVIEW.md` (review findings and backlog).

---

## 1. Reading Guide

**Conventions used in this document:**

| Term | Meaning |
|---|---|
| **Institution** | A tenant — an independent, fully isolated space (university, school, training centre, company, ...). |
| **Member / Membership** | A user's association with an institution, carrying one or more scoped roles. |
| **Learning Program** | The generic concept for any educational or training offering (course, training, onboarding, ...). |
| **Archetype** | A specialization of Learning Program (Academic Course, Training Program, ...). |
| **Platform level** | Everything owned and operated by the Manara platform team (platform roles, plans, billing). |
| **Institution level** | Everything owned and operated within a single institution. |

**Cross-cutting rules that apply to every entity:**

1. Every institution-scoped entity belongs to exactly **one institution** — never shared between tenants.
2. Access to any entity is granted by role + context (institution, program, group) + entitlement + entity status. Denial is the default.
3. Institutions may rename *display terms* (Student → Trainee, Course → Training Path) but never change the underlying concepts or rules.
4. Customization may never weaken data isolation or security.
5. Platform operators act across tenants only through platform-level roles, and every such action is audited.

---

## 2. Entity Reference

### Part A — Platform & Tenancy

#### A1. Platform

**Purpose:** The single system that hosts and operates all institutions. The platform is the commercial and technical container of the whole product.

**Responsibilities:**
- Onboarding new institutions (template selection, initial setup).
- Operating the subscription catalogue: plans, pricing, billing, feature flags.
- Defining platform-level roles (Platform Owner, Super Admin, Support Admin, Billing Admin, Security Auditor).
- Setting platform-wide policies: security, usage, support, data retention.
- Monitoring platform health, usage, and compliance across tenants.
- Managing institutions' lifecycles (activate, suspend, archive, delete).

**Relationships:**
- Contains all **Institutions**.
- Publishes **Subscription Plans** and **Feature Flags** consumed by institutions.
- Defines **Roles** and **Permissions** at platform level.
- Owns the master **Audit Log** tier and platform-level support workflows.

**Lifecycle:** The platform is a continuously operated system. Its evolution is governed by phases (foundation → org structure → content → assessments → subscriptions → AI → production readiness) rather than by a start/end lifecycle.

**Business rules:**
- An institution is the smallest unit of isolation; the platform may not weaken isolation to enable any feature.
- Platform roles grant cross-tenant powers; those powers exist only inside platform tooling and always leave an audit trail.
- Feature flags and plan limits are centrally managed; institutions cannot change their own entitlements.
- The platform may not view tenant content without a recorded, legitimate operational reason.

**Ownership:** The platform operator / Manara team.

**Multi-tenant considerations:** The platform is the single container of all tenants. Cross-tenant access is prohibited by default and available only through dedicated platform roles on a dedicated privileged path (see Decision Log #2), never through normal tenant flows.

---

#### A2. Institution (Tenant)

**Purpose:** An independent, isolated space representing one educational or training organization. Everything an organization does inside Manara happens within its institution.

**Responsibilities:**
- Holding its own users, memberships, roles, permissions, and organization structure.
- Owning its programs, content, assessments, labs, certificates, enrollments, and files.
- Managing its settings: branding, language, terminology, enabled features, enrollment policies, evaluation settings, certificate templates, dashboard layout.
- Carrying its commercial state: subscription, plan, entitlements, usage.
- Choosing its own program archetypes and education/training models without platform constraints.

**Relationships:**
- Belongs to the **Platform**; holds one active **Subscription**.
- Contains **Institution Settings**, **Organization Structure**, **Memberships**, **Roles**, **Learning Programs**, **Groups**, **Enrollments**, **Certificates**, **Files**, and its own **Audit Log** records.
- Receives **Users** only through memberships or invitations.

**Lifecycle:** Draft → Trial → Active → Suspended → Grace Period → Archived → Deleted (see Decision Log #5 for the full policy).

**Business rules:**
- Institution *type* (University, School, Training Centre, Corporate, ...) is a starting preset only — it never forbids other models; one institution can run multiple models simultaneously.
- Data of one institution is never visible to another, except through platform roles.
- An institution always has exactly one active subscription state; billing is on the institution, never per user.
- Institution lifecycles: suspension limits access per policy; deletion is irreversible after retention windows.

**Ownership:** Institution Owner / Institution Admin for day-to-day management; Platform operator for lifecycle enforcement (suspension, deletion).

**Multi-tenant considerations:** The institution IS the tenant. All tenant-scoped entities carry its identity, and every tenant-scoped operation must resolve against it. No tenant-scoped entity may reference another tenant.

---

#### A3. Institution Settings

**Purpose:** The configuration space of an institution — every knob that lets an organization shape "its" system.

**Responsibilities:**
- Storing identity and branding: name, logo, colors, language, RTL/LTR presentation.
- Maintaining the institution's terminology dictionary (display labels for roles, programs, units, assessment types).
- Configuring enabled features, usage-affecting preferences, and dashboard layout.
- Defining default templates: certificate templates, program templates, registration defaults, evaluation defaults.
- Holding enrollment and acceptance policies applied by default across programs.

**Relationships:**
- Belongs to one **Institution**.
- Referenced by **Roles** (display names), **Learning Programs** (defaults), **Certificates** (templates), and **Subscriptions** (feature availability).

**Lifecycle:** Created with the institution from a starting template; evolves as the institution configures; archived and deleted with the institution.

**Business rules:**
- Customization is display-and-preference level only; it may never change isolation, authorization rules, or core lifecycle semantics.
- Terminology changes apply to labels across the institution but never change the internal concept.
- Settings may be overridden per program (e.g., a different enrollment method) within the allowed policy.
- Template changes at creation do not force a one-size-fits-all behavior on any institution.

**Ownership:** Institution Admin (permission-gated); template definitions owned by the platform.

**Multi-tenant considerations:** Entirely per-institution; there is no shared setting space. Settings never affect other tenants.

---

#### A4. Organization Structure

**Purpose:** Reflect the institution's internal reality — colleges, departments, branches, divisions, units — to enable administration and grouping.

**Responsibilities:**
- Maintaining a hierarchy of organizational units of arbitrary depth.
- Providing a scoping context for roles (e.g., Department Admin) and for assigning programs and groups to units.
- Supporting reports and oversight filtered by unit.

**Relationships:**
- Belongs to one **Institution**.
- Units may own or administer **Learning Programs**, **Groups**, and member assignments.
- Members may be linked to one or more units.

**Lifecycle:** Created and restructured over time; units may be renamed, moved, merged, or deactivated (soft removal with history preserved for audit).

**Business rules:**
- A unit belongs to exactly one parent or is a root unit of its institution.
- Unit admins have authority only within their unit's subtree.
- Restructuring must not orphan programs or break audit trails.

**Ownership:** Institution Admin.

**Multi-tenant considerations:** Fully contained within one institution; there is no cross-institution organizational hierarchy.

---

#### A5. Subscription

**Purpose:** The commercial relationship between an institution and the platform: chosen plan, billing state, and entitlements derived from it.

**Responsibilities:**
- Holding the institution's plan (Starter, Professional, Enterprise, Custom) and billing terms.
- Driving the billing lifecycle: trial, invoicing, payment, renewal, upgrade/downgrade, suspension, cancellation.
- Feeding **Entitlements** (features + usage limits) and metering consumption (storage, AI requests, API quota, seat counts).

**Relationships:**
- Belongs to one **Institution**.
- Derives **Entitlements** from the plan and feature flags.
- Recorded in the **Audit Log** and reflected in institution lifecycle transitions.

**Lifecycle:** Trial → Active → Past Due → Grace Period → Suspended → Cancelled (see Decision Log #7).

**Business rules:**
- Billing is on the institution, never per individual user.
- Trial (14 days default) requires explicit consent; there is no silent auto-charge.
- On payment failure: grace period (7 days) then suspension; after suspension (30 days) the institution enters lifecycle handling per policy.
- Upgrade/downgrade applies immediately to entitlements with clear rules about over-limit resources.
- Invoices and payment events are immutable commercial records.

**Ownership:** Platform Billing Admin; institution admins manage their own subscription through allowed flows.

**Multi-tenant considerations:** One subscription per institution, strictly; no sharing of plans, discounts, or quotas across institutions. Entitlements are computed per institution only.

---

#### A6. Entitlement

**Purpose:** The concrete, current set of rights an institution actually has: which features are enabled and what usage limits apply.

**Responsibilities:**
- Mapping enabled feature flags (AI Question Generator, AI Course Builder, Online Exams, Live Proctoring, Attendance, Certificates, Analytics, API Access, White Label, Custom Domain, Mobile App, SSO) to institution reality.
- Enforcing usage limits (max students/teachers/admins, org units, courses, sections, exams, storage, monthly AI requests, API quota).
- Tracking consumed quota vs allowed quota.

**Relationships:**
- Derived from **Subscription** + plan + flags.
- Referenced by permission checks (a permission is effective only if the entitlement allows the feature).
- Consumed by institution activity (creation of programs, exams, AI usage, uploads).

**Lifecycle:** Recalculated on plan change, payment events, and flag changes; no independent lifecycle.

**Business rules:**
- No feature can be used without an active entitlement (fail closed).
- Usage beyond limits is blocked or requires upgrade, never silently exceeded.
- AI usage is metered monthly per institution.

**Ownership:** Platform defines the catalogue; entitlements are computed per institution.

**Multi-tenant considerations:** Entitlements are per-institution state; one institution's limits never affect another's.

---

### Part B — Identity & Access

#### B1. User

**Purpose:** One account per person (or, in the future, service account) usable across institutions — the single, global identity in the platform.

**Responsibilities:**
- Holding profile data, preferences, and the user's own settings.
- Owning credentials via **Identity** and managing **Auth Sessions**.
- Being the actor in **Audit Log** records and the recipient of **Notifications**.
- Carrying zero or more **Memberships** that grant tenant access.

**Relationships:**
- Has one or more **Identities** (login methods) and **Auth Sessions**.
- Has zero or more **Memberships** across institutions.
- May hold platform-level **Roles** in addition to institution memberships.
- Is enrolled in programs through **Enrollments** within memberships.

**Lifecycle:** Created (self-registration or invitation) → Verified → Active → Suspended (temporarily) → Closed (deactivated).

**Business rules:**
- One account per person; no duplicate accounts to join multiple institutions.
- A user may hold different roles in different institutions simultaneously (student in one, trainer in another, admin in a third) without separate accounts.
- Suspension can be per-membership (institution-level) or global (platform-level for abuse); global suspension overrides all memberships.
- Closing an account keeps required audit records per retention policy.

**Ownership:** The user controls their own profile; platform support handles identity disputes and global suspension.

**Multi-tenant considerations:** The user record is tenant-agnostic; all access to tenant data flows exclusively through memberships scoped to one institution. A user is invisible to an institution until a membership exists there.

---

#### B2. Identity

**Purpose:** The credentials and verification evidence that let a user prove who they are.

**Responsibilities:**
- Managing login credentials (email + password today; social and SSO future options behind the SSO flag).
- Managing verification status, password recovery, and re-authentication for sensitive actions.
- Supporting account security events (new device, password reset, login failure lockout).

**Relationships:**
- Belongs to exactly one **User**.
- Interacts with **Auth Sessions** (auth session creation on successful authentication).
- Observed by security monitoring and **Audit Log** (login/verification events).

**Lifecycle:** Created at signup → Verified → Reset/Restored (on recovery) → Closed with the account.

**Business rules:**
- Verification is required before sensitive operations (e.g., billing changes, certificate issuance).
- Repeated failed logins trigger a temporary lockout; recovery flows are rate-limited per policy.
- Password changes invalidate existing **Auth Sessions**.
- Institution-level SSO configuration is per-institution and gated by entitlement.

**Ownership:** The user + platform security policy.

**Multi-tenant considerations:** Identity is tenant-agnostic. Institutions never hold a user's credentials; they only see membership-level information.

---

#### B3. Auth Session

**Purpose:** A logged-in period for a user, establishing who the user is across requests and carrying the user's active context.

**Responsibilities:**
- Representing the user's authenticated state on a device.
- Tracking activity, expiry, and revocation; re-authentication for sensitive actions.
- Resolving the user's chosen institution context when the user has multiple memberships.

**Relationships:**
- Belongs to one **User**.
- Created by authentication via **Identity**; destroyed on logout/expiry/revocation.
- Referenced by authorization checks and **Audit Log** entries.

**Lifecycle:** Created at login → Active → Expired (idle or absolute timeout) → Revoked (logout, password change, security event).

**Business rules:**
- Auth sessions are server-side, opaque, and revocable; the browser never holds long-lived tokens (see Decision Log #1).
- A user may have multiple concurrent auth sessions (multiple devices).
- Auth sessions have absolute and idle timeouts; sensitive actions require recent re-authentication.
- Revocation on password change/reset and on privilege changes is mandatory.

**Ownership:** The user manages their auth sessions (view/revoke devices); platform security policy governs lifetimes.

**Multi-tenant considerations:** The auth session itself is global to the account; tenant access inside an auth session is still resolved only through memberships — an auth session never bypasses tenant scoping.

---

#### B4. Membership

**Purpose:** The bridge between a **User** and an **Institution**: a membership is the only way a user gains access to a tenant and holds roles inside it.

**Responsibilities:**
- Holding the user's roles and their scopes within the institution (institution-wide, department, program, group).
- Carrying membership status and effective dates (start, end).
- Determining which programs, groups, and actions are available to the user in that institution.

**Relationships:**
- Belongs to one **User** and one **Institution**.
- Carries one or more **Roles** (each scoped).
- Enables **Enrollments** in programs/groups.
- Created via **Invitation**, self-registration, manual addition, or bulk import.

**Lifecycle:** Invited/Requested → Pending Approval → Active → Inactive/Suspended → Ended.

**Business rules:**
- A user can hold many memberships; each membership belongs to exactly one institution.
- A membership can carry several roles simultaneously (e.g., Teacher in one course and Student in another course of the same institution).
- Ending a membership revokes all tenant access derived from it; enrollments and records remain per retention policy.
- Invitation-driven memberships expire if not accepted in time.

**Ownership:** Institution admins manage memberships; users accept/reject invitations and may leave.

**Multi-tenant considerations:** Membership is the sole tenant-access mechanism. The same user in two institutions has two fully independent memberships with no data flow between them.

---

#### B5. Role

**Purpose:** A named set of permissions that gives a member a defined range of action within an institution (or within the platform).

**Responsibilities:**
- Grouping **Permissions** into reusable, named roles.
- Carrying a scope: institution-wide, unit, program, or group level.
- Providing default role sets per institution template; institutions may define custom roles and rename labels.

**Relationships:**
- Assigned to **Memberships** (one membership may hold several roles).
- Composed of **Permissions**.
- Scoped by **Organization Structure**, **Learning Programs**, and **Groups**.

**Lifecycle:** Platform-defined roles are maintained centrally; institution-defined roles are created, updated, and retired by institution admins.

**Business rules:**
- Access is never granted by role name alone; the effective scope (institution, program, group) and the entitlement (feature enabled, plan allows) and entity status all participate.
- Example: a Trainer may create exams only within their own institution, within programs they manage, for groups assigned to them, when the Online Exams feature is enabled, and while the program is not archived.
- Display labels are customizable; semantics are not.

**Ownership:** Platform roles by platform; institution roles by institution admins.

**Multi-tenant considerations:** Institution roles and their assignments are per-tenant; platform roles are a separate tier that only operates through the privileged platform path.

---

#### B6. Permission

**Purpose:** The smallest unit of capability (e.g., create exam, publish content, view grades, issue certificate) that the system can check.

**Responsibilities:**
- Defining the complete catalogue of actions across modules.
- Being combined into **Roles**; being restricted by **Entitlement** (feature flags, plan) and entity status.
- Being checked at every sensitive operation, as the first line of defense.

**Relationships:**
- Composed into **Roles**.
- Effective only when the **Entitlement** allows the underlying feature.
- Verified against context (institution, program, group, resource owner).

**Lifecycle:** The catalogue grows with features; no independent lifecycle.

**Business rules:**
- Denied by default: an unlisted permission equals no permission.
- Permissions are always checked with tenant context; a permission without a valid context grants nothing.
- Sensitive permissions (billing, user administration, certificate issuance) require additional safeguards (audit, re-authentication).

**Ownership:** Platform defines the catalogue; institutions configure assignments via roles.

**Multi-tenant considerations:** The catalogue is shared, but every check is resolved against the requesting institution's context and entitlements — a permission from one tenant never applies in another.

---

### Part C — Learning & Delivery

#### C1. Learning Program

**Purpose:** The generic concept covering every educational or training offering an institution delivers: academic courses, school subjects, training courses, onboarding programs, labs, certification paths, mandatory training, and more.

**Responsibilities:**
- Carrying one education/training model (Academic Course, School Subject, Self-Paced, Instructor-Led, Live Training, Cohort-Based, Corporate Training, Onboarding, Compliance, Certification Path, Practical Lab, Internship, Project-Based, Blended, External, Custom).
- Organizing content: **Modules**, **Lessons**, **Training Sessions** (live sessions), files, activities, labs, assessments.
- Defining enrollment method (invitation, link, code, public registration, approval request, manual, bulk import, future integration) and acceptance policy.
- Defining schedule, grading policy, completion rules, and certificate conditions.
- Hosting **Groups** and **Enrollments**.

**Relationships:**
- Belongs to one **Institution** (and optionally to an organizational unit).
- Contains **Modules** → **Lessons**; **Assessments**, **Assignments**, **Practical Labs**.
- Has **Groups** and **Enrollments**; issues **Certificates** under defined conditions.
- Is managed through **Roles** scoped to the program.

**Lifecycle:** Draft → Published → Running → Completed → Archived.

**Business rules:**
- A program belongs to exactly one institution and never crosses tenant boundaries.
- Each program follows one model, but the institution may run many models concurrently.
- The enrollment method may differ from program to program within the same institution.
- Program-level activities (assessments, files) may exist without belonging to a module.
- Archived programs are read-only; grading and certificate issuance follow archive rules.

**Ownership:** Program Manager / Academic Supervisor / department admins.

**Multi-tenant considerations:** Programs are the core tenant-scoped unit; every nested item (modules, lessons, assessments, groups, enrollments) inherits the program's institution and never escapes it.

---

#### C2. Academic Course

**Purpose:** The archetype for universities, colleges, and schools: term-based courses with sections, credit hours, exams, and formal grades.

**Responsibilities:**
- Modeling the academic calendar rhythm (term/semester), **Sections** (شعب), credit hours, and **Attendance**.
- Supporting formal examinations, gradebooks, and final grades.
- Serving academic supervision and accreditation-related oversight.

**Relationships:**
- Is a **Learning Program** archetype (same lifecycle and container).
- Uses **Groups** as sections/شعب; **Enrollments** as registrations.
- Carries **Exams**, **Assignments**, and final **Grades**.

**Lifecycle:** Same as Learning Program; typical academic terms add term-start/term-end constraints.

**Business rules:**
- Credit-hour policies and section capacity rules are configurable per institution.
- Final grades follow the institution's grading policy (numeric, percentage, pass/fail, descriptive).
- Only enrolled members of the course's section participate in its assessments.

**Ownership:** Academic Supervisor / Teacher / department admins.

**Multi-tenant considerations:** All course data is within one institution; different universities can run fully different academic models without conflict.

---

#### C3. Training Program

**Purpose:** The archetype for training centres, companies, and institutes: duration-based training with cohorts, **Attendance**, practical work, and completion certificates.

**Responsibilities:**
- Modeling **Cohorts/Batches** (دفعات), **Training Session** schedules, and **Attendance** tracking.
- Supporting practical projects, **Practical Labs**, trainer evaluation, and supervisor approval.
- Issuing completion/attendance certificates upon defined conditions.

**Relationships:**
- Is a **Learning Program** archetype.
- Uses **Groups** as cohorts/batches; tracks **Attendance** per **Training Session**.
- Carries **Practical Labs**, **Assignments** (projects/reports), and **Certificates**.

**Lifecycle:** Same as Learning Program; cohort start/end dates drive activity.

**Business rules:**
- **Attendance** thresholds may be conditions for **Certificates**.
- Practical work can require external systems (institution-provided) with temporary access credentials.
- Trainer and supervisor evaluations combine into the final outcome.

**Ownership:** Trainer / Program Manager / institution admins.

**Multi-tenant considerations:** Within one institution; corporate and academic tenants can run training programs side by side.

---

#### C4. Module

**Purpose:** An organizational level inside a program (unit, week, chapter, track) that groups lessons and activities.

**Responsibilities:**
- Ordering content into a stable structure within the program.
- Grouping **Lessons**, activities, and attached **Assessments**/labs.
- Supporting completion tracking at the module level.

**Relationships:**
- Belongs to one **Learning Program** (or to a parent module in deeper hierarchies).
- Contains **Lessons** and may carry activities directly.

**Lifecycle:** Created in draft → Published with the program → Updated → Archived with the program.

**Business rules:**
- A module belongs to exactly one program; ordering is explicit and stable.
- Nested structure depth is flexible but always within the same program and institution.

**Ownership:** Teacher / Content Editor / Program Manager.

**Multi-tenant considerations:** Inherits the program's institution; never cross-tenant.

---

#### C5. Lesson

**Purpose:** A deliverable content unit that teaches a specific topic.

**Responsibilities:**
- Presenting learning material: text, video, files, live sessions (delivered via **Training Session**), activities.
- Tracking learner completion of the lesson (viewed, completed, skipped).
- Hosting attached resources and activities.

**Relationships:**
- Belongs to one **Module** (or directly to a program at the top level).
- References **Files** (videos, documents) and may attach **Assessments**/labs.

**Lifecycle:** Draft → Published → Updated (versioned) → Archived.

**Business rules:**
- Published lessons are visible to enrolled learners; drafts are visible to editors only.
- Completion conditions are configurable (e.g., watched/read/completed activity).
- Content changes after publication follow versioning so completion and audit records remain meaningful.

**Ownership:** Teacher / Content Editor.

**Multi-tenant considerations:** Within one program of one institution.

---

#### C6. Training Session

**Purpose:** A scheduled learning event — a live or instructor-led session, lecture, or class meeting where teaching or training happens at a specific time within a program.

**Responsibilities:**
- Carrying the schedule: start/end time, mode (live, in-person, recorded), and the environment or link where the session happens.
- Connecting the session's instructors (via teaching **Roles**) with the attending learners (via **Enrollments** and **Groups**) at the scheduled time.
- Supporting per-member **Attendance** collection for the event.
- Hosting session materials and recordings after the event.

**Relationships:**
- Belongs to one **Learning Program** (and optionally a **Module**); may serve a **Group** (section/cohort).
- Delivered by members holding teaching **Roles** scoped to the program or group.
- Collects **Attendance** per enrolled member of its program/group (see C7).
- May reference **Files** (materials, recordings).

**Lifecycle:** Scheduled → Live → Completed → Cancelled.

**Business rules:**
- A training session belongs to exactly one program; it never crosses institutions.
- Sessions are time-bound; **Attendance** applies only to members of the session's program/group.
- A session may be cancelled only before or during its live window; exceptional cancellations after completion require audit.
- Cancelled sessions may be rescheduled; completed sessions keep their **Attendance** records and recordings per retention policy.

**Ownership:** Teacher / Trainer / Program Manager (scheduling); institution admins set session policy.

**Multi-tenant considerations:** Sessions inherit their program's institution; schedule, **Attendance**, and recordings are institution-scoped and never exposed across tenants.

---

#### C7. Attendance

**Purpose:** Records a learner's participation in a scheduled learning event — a **Training Session** or equivalent event — as the source of truth for attendance tracking, evaluation, and certification conditions.

**Responsibilities:**
- Recording one participation status per learner per scheduled event: **Present**, **Absent**, **Excused**, **Late**, **Partially Attended**.
- Supporting capture during or after the event (instructor marking; future self-check-in where allowed).
- Providing the basis for attendance-based evaluation (grades), certificate conditions, and reports.
- Maintaining an audited history of all changes and approvals.

**Relationships:**
- Belongs to one **Enrollment** (the learner) and one **Training Session** (the scheduled event).
- Inherits the **Learning Program** and institution of its session.
- Feeds **Certificate** conditions (e.g., minimum attendance ratio) and **Grade** calculations where attendance contributes to evaluation.
- Serves **Reports** and analytics.
- Is recorded by members holding teaching **Roles** (instructor/trainer).

**Lifecycle:** Expected (event scheduled, attendance not yet taken) → Recorded (status set) → Corrected (approved changes) → Closed (finalized and retained).

**Business rules:**
- One attendance record exists per learner per scheduled event, with statuses: Present, Absent, Excused, Late, Partially Attended.
- A learner qualifies for attendance only if enrolled in the session's program/group.
- Attendance may be recorded only within the event's recording window (during or shortly after the event, per policy).
- Corrections require justification and approval: routine corrections by the session instructor; disputes and late corrections escalate to the trainer/supervisor.
- Attendance records are finalized after a defined period or at program close; finalized records are locked and changed only through the approved correction process.
- Every attendance change is audited.
- Attendance contributes to evaluation only where the program's assessment/grade policy includes it (attendance-based evaluation), and can be a certificate condition (e.g., minimum ratio).

**Ownership:** Instructor/Trainer records attendance; supervisor/institution admin approves disputes and defines attendance policy.

**Multi-tenant considerations:** Attendance is institution-scoped through its session's program; records never cross tenants.

---

#### C8. Group

**Purpose:** Organizes learners for delivery within a program — sections (شعب) in academic courses, cohorts/batches (دفعات) in training programs, and study groups.

**Responsibilities:**
- Grouping **Enrollments** for delivery, communication, and assessment targeting.
- Scoping roles (e.g., a teacher assigned to one section).
- Providing the audience for **Assessments** and activities.

**Relationships:**
- Belongs to one **Learning Program**.
- Contains **Enrollments** (learners); targeted by **Assessments** and notifications.
- Scopes teaching **Roles**.

**Lifecycle:** Created → Active → Closed (with program end).

**Business rules:**
- A group belongs to exactly one program.
- A learner typically belongs to one group per program, but flexible policies per program may allow multiple.
- Group capacity and assignment rules are per-institution settings.
- A group is a delivery structure only; collaboration on submissions is handled by **Teams** (see D7), whose membership is independent of group membership.

**Ownership:** Teacher / Program Manager.

**Multi-tenant considerations:** Within one institution; group identity never conflicts across tenants.

---

#### C9. Enrollment

**Purpose:** A member's registration and participation in a program (and its group).

**Responsibilities:**
- Granting participation rights in the program: content access, assessments, labs, communications.
- Tracking participation state: pending, active, completed, withdrawn.
- Recording effective dates and completion data.

**Relationships:**
- Links a **Membership** (user within institution) to a **Learning Program** and optionally a **Group**.
- Produces participation history: attempts, grades, **Attendance**, certificate issuance.

**Lifecycle:** Invited/Applied → Pending Approval → Enrolled/Active → Completed → Withdrawn/Dropped.

**Business rules:**
- Enrollment method is defined per program: direct invitation, invite link, join code, public registration, approval request, manual addition, bulk import, future system integration.
- Prerequisites and seat/plan limits may block enrollment.
- Withdrawal policy and records of completion are institution-configurable but audited.
- Enrollment state feeds plan usage limits (active learners per plan).

**Ownership:** Program Manager / Institution Admin (and self-service flows per program policy).

**Multi-tenant considerations:** Enrollment is scoped to one institution's program; no cross-tenant enrollment exists.

---

#### C10. Practical Lab

**Purpose:** Hands-on, practical training: a defined task with instructions, an environment (external link today; managed environments in the future), and an evaluated outcome.

**Responsibilities:**
- Describing the task: instructions, steps, prerequisites, expected result, duration, start/end dates.
- Providing access to the environment: external system link, temporary credentials, or (future) platform-managed environments.
- Collecting the learner's final report and proof of completion.
- Supporting evaluation: manual assessment now, automated verification in the future.

**Relationships:**
- Belongs to a **Learning Program** (and optionally a **Module**).
- References **Files** (instructions, attachments) and temporary access data.
- Produces submissions (reports/proofs) that are **evaluated** and may feed **Grades** and **Certificates**.

**Lifecycle:** Created → Published → Open (access window) → Submitted → Evaluated → Closed.

**Business rules:**
- Three integration levels exist: Level 1 — external link + uploaded report; Level 2 — API integration with the institution's system creating a temporary environment and receiving results; Level 3 — platform-managed environments (containers, VMs, in-browser terminals) — **not part of the first release**.
- Access is time-bound; temporary credentials expire.
- A lab is passed only when the submission is evaluated as satisfactory (manually today, automatically in the future).
- Lab work may be completed individually or by **Teams** (see D7), per lab policy.

**Ownership:** Lab Supervisor / Teacher / Trainer.

**Multi-tenant considerations:** Labs belong to one institution; external environments are institution-provided and institution-specific.

---

### Part D — Assessment & Evaluation

#### D1. Assessment

**Purpose:** The general evaluation concept covering exams, quizzes, assignments, projects, reports, presentations, practical evaluations, and attendance-based evaluation (see **Attendance**).

**Responsibilities:**
- Defining what is evaluated, for which audience (**Group**, section, or specific members), and when.
- Holding evaluation settings: numeric grade, percentage, pass/fail, descriptive, or multi-stage.
- Orchestrating the flow: publish → attempts/submissions → grading → results publication → review.
- Recording evaluation metadata (who graded, when, appeal status).

**Relationships:**
- Belongs to a **Learning Program** (and optionally a **Module**); may target specific **Groups** or members.
- Is the parent of **Exams**, **Assignments**, and practical evaluations.
- Produces **Attempts** (and submissions) and **Grades**.

**Lifecycle:** Created → Published → Running → Grading → Results Published → Archived.

**Business rules:**
- Results are confidential until published; publication is explicit.
- Grading may be automatic (system), manual (evaluator), or multi-stage (trainer + supervisor).
- Grading and heavy analytics are processed out of band — never inside the learner's request path (Decision Log, assessment pipeline).
- An assessment applies to one institution's program; audience membership is enforced.

**Ownership:** Teacher / Trainer / Evaluator; supervision by Academic Supervisor.

**Multi-tenant considerations:** Fully institution-scoped; question reuse never crosses tenants.

---

#### D2. Exam

**Purpose:** A timed, controlled assessment of knowledge (quiz, midterm, final) with questions and answers.

**Responsibilities:**
- Defining the question set (from the **Question Bank** or ad hoc), timing, scheduling window, and retake policy.
- Running attempts: start, progressive answer saving, submission, and time enforcement.
- Producing automatic grades where possible; handing written answers to graders.

**Relationships:**
- Is an **Assessment**; targets **Groups** or members.
- Draws questions from the **Question Bank**; each sitting produces an **Attempt**.
- May carry proctoring settings when the Live Proctoring feature is enabled.

**Lifecycle:** Draft → Scheduled/Published → Attempt Window → Grading → Results Published → Review → Archived.

**Business rules:**
- Exams have a defined start/end window and duration; rapid repeated starts are prevented.
- Submission is final; progressive saving protects against loss.
- Retake policy is per-institution/per-program (allowed, limited, forbidden).
- Proctoring is entitlement-gated (Online Exams, Live Proctoring flags).

**Ownership:** Teacher / Trainer; schedule oversight by supervisors.

**Multi-tenant considerations:** Exam waves happen per institution; scheduling and load handling are isolated per tenant.

---

#### D3. Question Bank

**Purpose:** The institution's repository of reusable questions for assessments.

**Responsibilities:**
- Storing questions with types (multiple choice, true/false, written, ...), options, points, and metadata (topic, difficulty).
- Enabling authoring, reuse across assessments, and versioning.
- Supporting (with the AI Question Generator entitlement) AI-assisted question generation — always reviewed by a human before use.

**Relationships:**
- Belongs to one institution; used by **Exams** and quizzes.
- Questions are authored by teachers/content editors.

**Lifecycle:** Created → Used → Deprecated → Archived.

**Business rules:**
- Questions belong to one institution; sharing across tenants is prohibited.
- AI-generated questions are drafts until a human accepts them.
- Question versioning preserves the exact text used in past exams.

**Ownership:** Teacher / Content Editor.

**Multi-tenant considerations:** Strictly per-institution; no cross-tenant bank access.

---

#### D4. Attempt

**Purpose:** One learner's single sitting of an assessment (or one submission cycle of an assignment/lab).

**Responsibilities:**
- Capturing responses/answers and time data during the sitting.
- Supporting progressive saving during the attempt and a final, irreversible submission.
- Feeding **Grading** and appearing in review/appeal processes.

**Relationships:**
- Belongs to one **Assessment** and one **Enrollment** (member).
- Produces one **Grade** (when graded).
- For assignments/labs, carries the **submission** (file/report/proof).

**Lifecycle:** Started → In Progress → Submitted → Graded → Reviewed/Appealed.

**Business rules:**
- One active attempt per assessment per learner unless retake policy allows more.
- Submission is final; after submission, answers cannot be changed.
- Attempts are attributed to the learner's enrollment within the institution.
- Attempt data is preserved for audit and dispute resolution.

**Ownership:** The learner; the assessment owner grades it.

**Multi-tenant considerations:** Attempts are institution-scoped; grading pipelines process per-institution workloads.

---

#### D5. Grade

**Purpose:** The recorded outcome of an assessment or attempt — the currency of academic and training results.

**Responsibilities:**
- Representing outcomes in the configured scale (numeric, percentage, pass/fail, descriptive).
- Feeding the gradebook, program completion, certificate eligibility, and reports.
- Supporting the review/appeal lifecycle.

**Relationships:**
- Produced from an **Attempt** (or practical evaluation/submission).
- Aggregates into program-level completion; conditions for **Certificates** reference it.
- Recorded in **Audit Log** when changed.

**Lifecycle:** Pending → Provisional → Final → Adjusted → Appealed/Resolved.

**Business rules:**
- Grading follows the assessment's evaluation settings and the program's grading policy.
- Grades are confidential until results are published.
- Changes to final grades require justification and are audited; appeals follow a defined process.
- Gradebook aggregation is per-program within one institution.

**Ownership:** Teacher/Trainer/Evaluator (issue); supervisors (oversight and appeal decisions).

**Multi-tenant considerations:** Grades never leave the institution; cross-tenant comparisons are impossible by design.

---

#### D6. Assignment

**Purpose:** A task that requires the learner to produce and submit work — project, report, presentation, or written work — for evaluation.

**Responsibilities:**
- Defining the task, deliverables, submission format, deadline, and evaluation criteria.
- Collecting submissions (files, reports, presentations) and enforcing the deadline and late policy.
- Routing submissions to the assigned evaluator and supporting feedback and results publication.

**Relationships:**
- Is an **Assessment**; belongs to a **Learning Program** (and optionally a **Module**).
- Targets **Groups** or individual members; collects submissions (which reference **Files**) individually or via **Teams** (see D7).
- Produces **Grades** and may feed certificate conditions (e.g., finished project).

**Lifecycle:** Created → Published → Submission Window → Grading → Results Published → Archived.

**Business rules:**
- Deadline and late-submission policy are configurable per assignment.
- Submission becomes final after the deadline (or per the late policy).
- Individual or team submissions are allowed per assignment policy.
- Grading may be by one evaluator or multi-stage (trainer + supervisor), following the assignment's evaluation settings.

**Ownership:** Teacher / Trainer / Evaluator.

**Multi-tenant considerations:** Fully institution-scoped; submissions and evaluations never cross tenants.

---

#### D7. Team

**Purpose:** A set of learners collaborating on a common deliverable — an assignment, project, or practical lab — whose work is submitted and evaluated jointly.

**Responsibilities:**
- Grouping learners who produce one joint deliverable (assignment, project, or lab work).
- Carrying team membership independently of any **Group** (section/cohort) membership.
- Supporting the joint submission flow and the application of the resulting grade to members per policy.

**Relationships:**
- Belongs to exactly one **Assignment** (covering projects and reports) or **Practical Lab**.
- Composed of **Enrollments** (members) — team membership is independent of **Group** membership.
- Produces a joint submission that is evaluated and yields **Grades** for its members.

**Lifecycle:** Formed (team creation) → Active (collaborating) → Submitted → Evaluated → Closed.

**Business rules:**
- A team belongs to one assignment/project/lab; a learner belongs to at most one team per deliverable (per policy).
- Team membership is independent from group membership — teammates may come from different groups where policy allows.
- Team size limits and formation rules (self-selected or instructor-assigned) are per-deliverable policy.
- Joint submissions receive a grade applied to all members per the deliverable's team-grading policy (shared or per-member).

**Ownership:** Learners form teams (self-service) or teachers/trainers assign them; evaluators grade the joint submission.

**Multi-tenant considerations:** Teams are scoped to one institution's program and deliverable; team data never crosses tenants.

---

### Part E — Outcomes & Evidence

#### E1. Certificate

**Purpose:** The formal credential an institution issues to prove a learner's achievement (**Attendance**, completion, success, skill pass, practical training, professional program, internal training).

**Responsibilities:**
- Issuing certificates only when defined conditions are met.
- Presenting institutional branding/template and a unique verification identity.
- Enabling third-party verification (by code) without exposing learner data.
- Supporting revocation when conditions were violated.

**Relationships:**
- Belongs to one **Institution** (template + issuance).
- Tied to an **Enrollment** and program completion records.
- Conditioned on: content completion, **Attendance** ratio, passing assessments, completing projects, passing labs, supervisor approval.

**Lifecycle:** Template Defined → Issued → Delivered → Verified → Revoked.

**Business rules:**
- Issuance is automatic only when all conditions are verified; manual issuance requires explicit approval.
- Each certificate has a unique verification code; verification is public and data-minimal.
- Revocation is allowed for policy violations and is recorded in the audit trail.
- Certificate issuance is entitlement-gated (Certificates feature flag).

**Ownership:** Institution Admin defines templates and policy; supervisors/issuers issue.

**Multi-tenant considerations:** Certificates are institution-scoped; verification exposes no cross-tenant data.

---

### Part F — Engagement & Lifecycle

#### F1. Invitation

**Purpose:** The mechanism through which people enter an institution (and its programs): the controlled front door.

**Responsibilities:**
- Carrying one of the supported join methods: direct invitation, invite link, join code, public registration, join request requiring approval, manual addition, bulk import, future system integration.
- Delivering role/membership intent and program context with the invitation.
- Handling acceptance, expiry, and revocation.

**Relationships:**
- Targets a prospective member; belongs to one **Institution** (and optionally a **Program**).
- Produces a **Membership** (and optional **Enrollment**) upon acceptance.

**Lifecycle:** Created → Sent → Accepted → Expired/Revoked.

**Business rules:**
- Each method may be configured per program within the same institution.
- Invitations expire after a defined period; codes are single-use by default.
- Approval-required methods hold the pending state until an admin accepts.
- Invitations never cross institutions.

**Ownership:** Institution Admin / Program Manager (create); invitees (accept).

**Multi-tenant considerations:** An invitation belongs to exactly one institution; no invitation can grant access to another tenant.

---

#### F2. Notification

**Purpose:** Timely communication with users about events that matter to them (invitations, new content, exam schedules, results, submissions, certificate issuance).

**Responsibilities:**
- Delivering events through channels: in-app now; email; push/SMS in the future.
- Respecting per-user channel preferences and digest options.
- Targeting only authorized recipients (members of the relevant institution/program/group).

**Relationships:**
- Belongs to a recipient **User** (within a **Membership** context).
- Originates from domain events (programs, assessments, grades, certificates, billing, security).

**Lifecycle:** Generated → Delivered → Read/Dismissed → Archived (retention policy).

**Business rules:**
- Recipients are computed with tenant context; a notification never leaks cross-tenant information.
- Sensitive notifications (results, security events) are not suppressible below a safety threshold.
- Delivery is guaranteed by an outbox pattern; failures retry, and nothing is silently lost (Decision Log #6).

**Ownership:** Users control preferences; system generates from domain events.

**Multi-tenant considerations:** Content and recipient lists are always resolved within one institution's scope.

---

#### F3. File

**Purpose:** The managed content object behind uploads and deliveries: lesson materials, assignment submissions, lab attachments, branding assets, certificate media.

**Responsibilities:**
- Storing user and system content with controlled access and expiry.
- Enforcing upload rules: allowed types, size limits, malware scanning before availability.
- Serving content safely (download-attachment behavior for executables, no-sniff, tenant-scoped access).

**Relationships:**
- Belongs to one **Institution**; referenced by **Lessons**, **Labs**, **Assignments** (submissions), **Certificates**, and branding.
- May carry temporary access (e.g., lab credentials document).

**Lifecycle:** Uploaded → Scanned/Quarantined → Available → Replaced/Expired → Deleted (per retention).

**Business rules:**
- Uploads are treated as untrusted until scanning passes; scanning failure quarantines the file (fail closed).
- Dangerous formats are rejected; images, documents, and videos have per-type size limits.
- Access is tenant-scoped and time-limited where required; no public bucket patterns.
- Deletion follows the tenant retention policy (Decision Log #5).

**Ownership:** Uploading user / institution; platform enforces scan and retention.

**Multi-tenant considerations:** Files are stored and served strictly per institution; content from one tenant is unreachable from another.

---

### Part G — Trust & Operations

#### G1. Audit Log

**Purpose:** The durable, immutable record of who did what, when, and in which institution — the backbone of accountability, security, and dispute resolution.

**Responsibilities:**
- Recording sensitive and significant actions: authentication events, permission changes, grading changes, billing events, certificate issuance, tenant lifecycle transitions, platform-level actions.
- Preserving records beyond tenant deletion per retention policy.
- Serving institution-level reviews (own logs) and platform-level investigations.

**Relationships:**
- Each record references an actor (**User**), an **Institution**, an action, and the affected entity.

**Lifecycle:** Append-only record; retention periods apply; never edited or deleted early.

**Business rules:**
- Sensitive actions are always logged; logs cannot be altered or erased by institution users.
- Logs survive tenant deletion (retention per policy — see Decision Log #5).
- Platform auditors may review across tenants through the privileged path only.

**Ownership:** Platform (integrity and retention); institution admins (viewing own logs).

**Multi-tenant considerations:** Every record is attributed to one institution; cross-tenant search is a platform-privileged capability only.

---

#### G2. AI Interaction

**Purpose:** The recorded usage of AI-assisted features (AI Question Generator, AI Course Builder, future PDF summarization), ensuring gated, metered, auditable use.

**Responsibilities:**
- Recording each AI request: feature, requester, institution, context (program/assessment), outcome.
- Feeding monthly quota metering (AI usage limits per plan).
- Keeping an audit trail for AI outputs.

**Relationships:**
- Belongs to one **Institution**; initiated by a **User** within a membership.
- Contextualized by the target **Learning Program** or **Assessment**.
- Consumes **Entitlement** quota.

**Lifecycle:** Requested → Processing → Completed/Failed → Metered/Retained.

**Business rules:**
- AI features are usable only when the entitlement (flag + plan quota) allows; over-quota requests are blocked.
- AI output is a draft until a human reviews and accepts it (question generation, content building).
- Usage is metered monthly per institution; quota is per plan.

**Ownership:** Platform monitors usage and quota; institution admins review their own usage.

**Multi-tenant considerations:** Requests and outputs are attributed to exactly one institution; no cross-tenant data is ever sent as context.

---

## 3. Cross-Cutting Notes

### 3.1 The Role Scoping Model
Access is the intersection of: role (what the user can do) × scope (institution / unit / program / group) × entitlement (feature enabled, plan allows) × status (user, membership, program, entity active). None of these alone grants access.

### 3.2 Program Archetypes at a Glance
| Archetype | Typical institution | Distinctive elements |
|---|---|---|
| Academic Course | University, school | Sections (شعب), credit hours, exams, formal grades |
| Training Program | Training centre, company | Cohorts (دفعات), attendance, practical work, certificates |
| Self-Paced Course | Any | No fixed schedule, progress-based completion |
| Practical Lab | Any | Task + environment + report/evaluation |
| (Other models: School Subject, Instructor-Led, Live, Cohort-Based, Corporate, Onboarding, Compliance, Certification Path, Internship, Project-Based, Blended, External, Custom) | | |

### 3.3 Assessment Family
Assessment is the umbrella; Exam, Quiz, Assignment, Project, Report, Presentation, Practical Evaluation are specializations. Evaluation scales: numeric, percentage, pass/fail, descriptive, multi-stage (trainer + supervisor).

### 3.4 Certificate Conditions
Issuance conditions (any combination): content completion, **Attendance** ratio, passing assessment, finishing project, passing practical lab, supervisor approval — all verified before issue.

### 3.5 Enrollment & Join Methods
Direct invitation · invite link · join code · public registration · approval request · manual addition · bulk import · future system integration. Method is per-program, and different programs in the same institution may differ.

### 3.6 Alignment with Resolved Architecture Decisions
This domain model is consistent with the resolved findings (Decision Log #1–#7): auth sessions are server-side and revocable; tenant lifecycle and data retention follow the defined policy; notifications are outbox-guaranteed; billing follows the institution-level lifecycle with explicit consent and grace periods; uploads are scan-gated; and all cross-tenant capabilities flow through the privileged platform path.

---

*Document: Business Domain Model — Manara (منارة)*
*Companion: PRODUCT_VISION.md, TECHNICAL_GUIDE.md, ARCHITECTURE_REVIEW.md*
