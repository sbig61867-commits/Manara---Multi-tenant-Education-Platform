# Manara Design System (DESIGN_SYSTEM.md)

> **المرجع البصري الرسمي لمنصة منارة** — The official visual identity of Manara.
>
> - **Version:** 1.0 (draft for review)
> - **Status:** Approved for implementation by the frontend team
> - **Scope:** Marketing site, product (dashboard) UI, and all user-facing surfaces
> - **Applies to:** Frontend per TECHNICAL_GUIDE §2 (React 19 + Vite + TypeScript + Tailwind CSS + TanStack Query, shadcn/ui component base)
> - **Related docs:** PRODUCT_VISION.md · TECHNICAL_GUIDE.md · DOMAIN_MODEL.md · DATABASE_MODEL.md · SYSTEM_ARCHITECTURE.md · MODULE_SPECIFICATION.md
> - **Tooling note:** Design direction researched and validated with the UI/UX Pro Max skill (`uipro`); recommendations that contradict the product brief (e.g. Claymorphism) were consciously rejected and recorded in §23 Decision Log.

---

## 1. Introduction & Scope

Manara (منارة — *lighthouse*) is a multi-tenant education SaaS platform serving universities, training centers, schools, and academies across the Middle East and globally. It is an enterprise product that must feel **premium, calm, modern, and minimal** while remaining **Arabic-first and native to RTL and LTR** — a world-class experience that never looks like a copy of any existing product.

This document defines:

1. Brand personality and design philosophy.
2. The complete token system (color, type, spacing, radius, shadow, motion) aligned to Tailwind CSS.
3. Component, pattern, and page-level guidance (forms, tables, navigation, dashboards, charts, empty states).
4. Accessibility, responsive, and dark-mode rules that are **mandatory**, not optional.
5. The Decision Log recording why each direction was chosen.

No UI code lives here. Implementation consumes these tokens and patterns through the Tailwind theme and shadcn/ui primitives.

---

## 2. Brand Personality

| Dimension | Manara is | Manara is not |
|---|---|---|
| Tone | Calm authority, scholarly, confident | Loud, gamified, childish |
| Character | A trustworthy lighthouse — clarity in every screen | Chaotic, dense, "startup-y" |
| Feel | Premium, unhurried, warm-neutral | Cold corporate, clinical |
| Language | Clear, direct Arabic and English copy; no marketing puff | Vague, clever, untranslatable |
| Posture | The infrastructure institutions rely on (SaaS, multi-tenant, 100k+ users/org) | A toy LMS |

Four personality keywords — **Calm · Clear · Scholarly · Global** — govern every design decision:

- **Calm:** low-contrast neutrals, generous whitespace, restrained motion (200–300ms), no flashing, no visual noise, even under exam-time load.
- **Clear:** one primary action per screen, explicit states, labels over placeholders, predictable navigation.
- **Scholarly:** deep blue + heritage gold (academic tradition), paper-like warmth, typography with a measured, editorial cadence.
- **Global:** Arabic-first, full RTL/LTR parity, locale-aware numerals, dates, and fonts — not an afterthought.

---

## 3. Design Philosophy

Guiding principles (each maps to how a reviewer verifies it):

1. **The lighthouse rule.** Every screen must make the user's current position and next step obvious. If a screen requires thought to find the primary action, it fails. *Evidence:* visible active states, breadcrumbs, one emphasized CTA.
2. **Calm over clever.** Depth comes from subtle elevation and spacing, not from gradients, glows, or ornament. *Evidence:* surfaces separated by 1px borders + low-opacity shadows; no gradient buttons.
3. **Arabic-first, RTL-native.** The layout is authored in logical properties; `dir="rtl"` is a first-class render target, not a mirroring trick. *Evidence:* every pattern in this doc specifies its RTL behavior.
4. **Real data over decoration.** Dashboards show decisions, not chart-junk. Empty states guide, never punish. *Evidence:* §18 chart rules, §17 empty-state structure.
5. **Accessibility is a feature.** WCAG 2.1 AA is the floor for every color, interaction, and motion choice. *Evidence:* §19 checklist is non-negotiable.
6. **Progress, not surprise.** Every async action shows loading → success/error. No silent failures. *Evidence:* §13 submit feedback, §17 loading patterns.
7. **Restraint in the enterprise.** Enterprise software earns trust through predictability and density control — so Manara ships a comfortable default density with an opt-in compact mode, never the reverse.

---

## 4. Color System

### 4.1 Core principle

Neutrals carry the interface (90%+ of screen area). Brand color is used sparingly: primary actions, active states, key links, and the logo. Gold is the **achievement accent only** — awards, certificates, badges, and celebratory moments. This keeps the product calm while preserving prestige.

### 4.2 Brand palette — "Minaret Blue" (deep, slightly desaturated sea blue)

| Token | Hex | Usage |
|---|---|---|
| brand-50 | `#F0F6F9` | Tinted surfaces, selected row backgrounds |
| brand-100 | `#DCECF3` | Hover tints, info banners |
| brand-200 | `#B9D9E7` | Chart series light, borders on tinted surfaces |
| brand-300 | `#8DC0D6` | Disabled brand elements |
| brand-400 | `#55A1C0` | Secondary brand elements, chart series |
| brand-500 | `#3386AA` | Hover state of primary buttons |
| brand-600 | `#1F6E93` | **Primary actions, active navigation, focus-adjacent accents** |
| brand-700 | `#1B5A79` | Pressed state, dark-mode primary |
| brand-800 | `#1A4A63` | Headings on light backgrounds (optional) |
| brand-900 | `#183E52` | Deep brand surfaces, marketing hero backgrounds |
| brand-950 | `#0C2331` | Marketing dark footer, deepest brand surface |

### 4.3 Accent — "Heritage Gold" (achievement only)

| Token | Hex | Usage |
|---|---|---|
| gold-400 | `#D4B45C` | Icons/lines on dark surfaces |
| gold-500 | `#C29B3A` | Award icons, certificate seals, badges |
| gold-600 | `#A9812B` | Main gold on light surfaces (AA-compliant for 3:1 large text/UI) |
| gold-700 | `#8A6820` | Gold text on light backgrounds (AA 4.5:1) |

**Constraint:** Gold must never be used for primary buttons, links, or generic UI. If gold appears on screen, it signifies recognition.

### 4.4 Neutral scale — "Parchment" (warm, paper-like)

| Token | Hex | Usage |
|---|---|---|
| canvas | `#FAF9F6` | **App background** (warm paper — distinctive, calm, reduces the cold SaaS feel) |
| surface | `#FFFFFF` | Cards, panels, modals |
| surface-muted | `#F3F1EC` | Secondary surfaces, table zebra, wells |
| ink-50 | `#F0F2F5` | Row hover, subtle fills |
| ink-100 | `#E4E7EC` | Dividers, table row borders |
| ink-200 | `#C6CCD6` | Input borders (resting), strong dividers |
| ink-300 | `#9AA4B2` | Disabled text, placeholders |
| ink-400 | `#7A8595` | Secondary text, captions |
| ink-500 | `#5A6676` | Body text (secondary) |
| ink-600 | `#3A4553` | Body text (primary) |
| ink-700 | `#1C2430` | **Headings, high-emphasis text** |
| ink-800 | `#141A23` | Marketing hero text |

### 4.5 Semantic colors

| Token | Hex | Usage |
|---|---|---|
| success | `#2F7D4F` | Success text, success icons, progress completion (deep — calm, not neon) |
| success-bg | `#E8F3EC` | Success banners, badges |
| warning | `#B45309` | Warnings (e.g. exam time low) |
| warning-bg | `#FBF0E0` | Warning banners |
| danger | `#C2392B` | Errors, destructive actions, failed attempts |
| danger-bg | `#FBE9E7` | Error banners, invalid field tint |
| info | `brand-600` | Information (no separate token) |
| info-bg | `brand-50` | Information banners |

**Semantic usage rules:**

- Error states: colored border **plus** icon **plus** message (never color alone — §19).
- Destructive actions are always the same deep red; never a custom red.
- Progress/completion uses success green; in-progress uses brand-600.

### 4.6 Chart palette (colorblind-safe categorical)

Five series colors selected for colorblind legibility (Deuteranopia/Protanopia-safe separation) — **chart colors are a separate set from the UI palette** so charts never collide with interface colors:

| Token | Hex |
|---|---|
| chart-1 | `#1F6E93` (brand) |
| chart-2 | `#C29B3A` (gold) |
| chart-3 | `#4E7C6B` (muted green) |
| chart-4 | `#8A6BBE` (muted violet) |
| chart-5 | `#C2665B` (terracotta) |

Plus **pattern overlays** (diagonal lines, dots, cross-hatch) that can be layered per series so charts remain legible even in grayscale (see §18).

### 4.7 Contrast guarantees

- Text on `canvas`/`surface`: `ink-600`/`ink-700` ≥ 4.5:1 against both. ✓ (verified against WCAG 2.1)
- `brand-600` as text on white: 4.5:1 ✓ (used for links); `gold-600` reserved for large text/icons (3:1).
- Dark mode: see §21 — every semantic color has a dark-mode variant that restores AA.

---

## 5. Typography

### 5.1 Typefaces (self-hosted, woff2, `font-display: swap`)

| Role | Latin | Arabic | Rationale |
|---|---|---|---|
| Display / Headings | **Lexend** (500/600/700) | **Noto Kufi Arabic** (500/600/700) | Shared geometric, scholarly personality; Kufi style reads modern-premium in Arabic, distinct from the generic Naskh everywhere else |
| Body / UI | **IBM Plex Sans** (400/500/600) | **IBM Plex Sans Arabic** (400/500/600) | IBM Plex has a first-class Arabic sibling — same family system, excellent small-size legibility, enterprise-grade neutrality |
| Mono (IDs, timestamps, code, logs) | **IBM Plex Mono** (400/500) | IBM Plex Sans Arabic (fallback for Arabic text in mono contexts) | Stable numerals and identifiers |

Fallback stacks: `Lexend, "Noto Kufi Arabic", system-ui, sans-serif` and `"IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif`.

### 5.2 Type scale (Tailwind-aligned)

| Step | Size / Line-height | Usage |
|---|---|---|
| display | 40–56 / 1.15 | Marketing hero, certificate titles |
| h1 | 32 / 1.2 | Page titles (dashboard) |
| h2 | 24 / 1.3 | Section titles |
| h3 | 18 / 1.4 | Card titles, panel headers |
| body-lg | 16 / 1.6 | Body, form fields, table cells (default UI) |
| body | 14 / 1.6 | Secondary body, table rows (dense) |
| caption | 12 / 1.5 | Labels, helper text, timestamps, axis labels |
| overline | 12 / 1.5, uppercase | Section overlines (Latin only — see Arabic rules) |

### 5.3 Arabic-specific rules (non-negotiable)

1. **Never apply `letter-spacing` to Arabic text** — it breaks cursive joining. Keep all tracking in Latin-only classes.
2. **Minimum weight 400** for Arabic body — Arabic renders poorly below that weight.
3. **Line-height 1.7** for Arabic body text (ascenders/descenders need more room) vs 1.5 for Latin; use the `dir`-based CSS override.
4. **Numbers:** Latin digits are the default in data UI (exams, tables, analytics) for cross-locale clarity; Arabic-Indic numerals are a locale setting, never mixed in the same view.
5. Text selection color, underlines, and focus rings must respect the baseline shift of Arabic; test both scripts at every type step.

### 5.4 Composition

- Max measure ~68ch for paragraphs (Arabic 45–60ch).
- Headings use `letter-spacing: -0.02em` in Latin only; never in Arabic.
- No justified text in Arabic body copy (creates uneven word spacing); left/right aligned per `dir`.

---

## 6. Spacing Scale

4px base unit, doubled progressively. All components use these values only.

| Token | Value | Typical use |
|---|---|---|
| space-0.5 | 2px | Icon-to-text gap in tight buttons |
| space-1 | 4px | Inline icon gaps, focus-ring offset |
| space-2 | 8px | Badge padding, compact lists |
| space-3 | 12px | Form control padding, card header padding |
| space-4 | 16px | **Base gutters, button padding, form gaps** |
| space-6 | 24px | Section spacing, card padding |
| space-8 | 32px | Panel margins, modal padding |
| space-12 | 48px | Page-level section gaps |
| space-16 | 64px | Large section breaks (marketing) |
| space-24 | 96px | Marketing hero rhythm |

Density: comfortable is the default (row height 44px, table cell padding 12px 16px). An opt-in **compact mode** (row 32px, padding 8px) exists for power users in data-heavy modules — it never affects marketing or exam surfaces.

---

## 7. Border Radius

| Token | Value | Usage |
|---|---|---|
| radius-sm | 6px | Small controls: inputs, selects, small buttons |
| radius-md | 8px | **Default**: buttons, badges, table rows, cards |
| radius-lg | 12px | Large cards, dialogs, sheets, charts tooltips |
| radius-xl | 16px | Hero images, media thumbnails, certificate cards |
| radius-full | 999px | Pills, avatars, status chips, icon buttons (circular) |

Rule: **never mix more than two radius values on one surface.** Soft-UI direction: rounded-but-honest 8–12px — not bubbly, not sharp-corporate.

---

## 8. Shadows

Low-opacity, layered, warm-neutral (never pure black at full strength):

| Token | Value | Usage |
|---|---|---|
| shadow-sm | `0 1px 2px rgba(20, 26, 35, 0.05)` | Resting cards on canvas |
| shadow-md | `0 4px 12px rgba(20, 26, 35, 0.06)` | Dialogs, popovers, dropdowns, tooltips |
| shadow-lg | `0 12px 32px rgba(20, 26, 35, 0.10)` | Modals, command palettes, marketing hero media |
| ring-focus | `0 0 0 3px rgba(31, 110, 147, 0.35)` | Visible focus ring (brand-600 @35%) |
| ring-focus-danger | `0 0 0 3px rgba(194, 57, 43, 0.35)` | Focus on destructive actions |

Hover elevation: a resting card lifts from `shadow-sm` to `shadow-md` at 150ms ease-out. In dark mode, shadows are replaced by stronger borders + elevated surfaces (§21).

---

## 9. Icon Style

| Property | Spec |
|---|---|
| Set | Lucide-compatible, outline stroke icons (consistent 24px grid) |
| Stroke | 1.5px (UI 20px), 2px at 16px sizes for legibility |
| Corners | Rounded caps/joins — calm, matches Lexend/IBM Plex geometry |
| Sizes | 16 / 20 / 24 px in UI; 32/48 px in empty states and marketing |
| Fill | Outline by default; **filled only for active nav items and selected states** |
| **Emoji** | **Forbidden in all UI.** Icons only. |

RTL rules:

- Directional icons (arrows, chevrons, pagination, back) flip via `scaleX(-1)` when `dir="rtl"`, or use logical-property-aware icons.
- Non-directional icons (settings, search, bell) never flip.
- All icon-only buttons must carry an `aria-label` (§19).

Iconography tone: geometric, precise, quiet. No gradient icons, no multi-color icons, no hand-drawn style.

---

## 10. Illustration Style

Used **sparingly** — empty states, onboarding, marketing hero, certificates.

| Property | Spec |
|---|---|
| Language | Minimal line + flat geometric shapes; 1.5–2px strokes matching the icon system |
| Palette | brand-900/600/300 + gold-500 accent + neutral ink grays on `canvas` — **never rainbow** |
| Composition | One focal element, generous negative space, max 2 colors + 2 neutrals per illustration |
| Scale | Flat, small footprint; no heavy 3D, no gradients, no photorealism |
| Role | Explains or celebrates — never decorative clutter on functional screens |

Certificate visuals (for the Certificates module): a restrained seal/medallion in brand + gold, echoing the Kufi geometry — designed once, reused consistently.

---

## 11. Motion Principles

| Token | Duration | Usage |
|---|---|---|
| motion-fast | 150ms | Hover, active/pressed, icon feedback |
| motion-base | 200ms | Standard: collapse, expand, popovers, toasts |
| motion-slow | 300ms | Panel transitions, modal entrances, page transitions |
| motion-xslow | 400ms max | Marketing reveals, certificate animations |

Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out, calm deceleration) everywhere. Spring physics are forbidden.

Rules:

1. **`prefers-reduced-motion: reduce`** → all motion collapses to 0–150ms opacity-only fades; skeletons stop pulsing.
2. Press feedback: `active: scale(0.98)` on buttons/cards (from UX guidelines: active states required).
3. Loading: skeleton screens (`animate-pulse` 1.5s) for lists/content; spinners only for blocking actions (< 3s).
4. **No auto-playing video anywhere** (click-to-play, `preload="none"`; pause off-screen). Sustainability + attention.
5. Exam UI: the countdown timer ticks with a subtle color change at < 5 min (gold → warning) — no blinking, no alarms.
6. Motion never blocks interaction; entrance animations under 300ms on interactive surfaces.

---

## 12. Component Language

Base: **shadcn/ui components** (built on Radix primitives) re-skinned with these tokens.

### 12.1 Buttons

| Variant | Style | RTL note |
|---|---|---|
| primary | `brand-600` bg, white text, radius-md, hover `brand-500`, pressed `brand-700`, focus ring | — |
| secondary | Surface bg, 1px `ink-200` border, `ink-700` text | — |
| ghost | Transparent, `ink-700` text, `ink-50` hover | — |
| destructive | `danger` bg or text variant | — |
| link | `brand-600` text, underline on hover only | — |

Sizes: sm (32px), md (40px), lg (48px); icon buttons circular `radius-full` 40px with aria-label.

Rules: one primary button per view (the lighthouse rule); disabled = `opacity-40` + `cursor-not-allowed`; hover on every interactive element (150ms, subtle); `cursor-pointer` on all clickable elements.

### 12.2 Cards & surfaces

- Surface on canvas separated by 1px `ink-100` borders; elevation is the exception, not the default.
- Card = surface, radius-lg, padding space-6, optional `shadow-sm`, hover lift only when interactive.
- Status chips (Exam: Draft/Published/In Progress/Graded) = pill, 12px, tinted bg + ink-700 text, semantic colors only for state.

### 12.3 Toasts, banners, popovers

- Toasts: surface, radius-lg, `shadow-md`, success/info/warning/danger icon + message, auto-dismiss 5s (errors persist), `role="status"`/`aria-live`.
- Banners: tinted bg + border-inline-start 3px semantic color (works identically in RTL).
- Popovers/dropdowns: surface, radius-lg, `shadow-md`, 200ms fade+8px slide.

### 12.4 Tabs & steppers

- Underline tabs: brand-600 indicator bar on active; used for ContentNode-level switching.
- Steppers (exam/setup flows): numbered circles, completed = brand-600 with check, current = outlined brand, upcoming = ink-300; labels never wrap in Arabic (test).

---

## 13. Forms

Mandatory patterns (from UX guidelines — all are requirements):

1. **Visible labels always.** Placeholder is never the label. `label[for]` or wrapped input. *High severity.*
2. **Validation on blur** for most fields (not submit-only); also validate on submit. Errors render **below the field** (not one banner at top), tinted border + danger icon + message, `role="alert"` so screen readers announce. *High.*
3. **Correct input types** (`email`, `tel`, `number`, `url`), `autocomplete` attributes (autofill must work), and `inputmode` for mobile keyboards (`numeric` for national IDs, phone numbers).
4. **Required indicators:** explicit `*` + legend "الحقول المطلوبة / Required fields" or `(required)` text. Never guess.
5. **Password fields:** show/hide toggle always present.
6. **Submit feedback:** button shows loading state → success confirmation or inline error. **No silent submits.**
7. **Affordance:** inputs have border (`ink-200`) + surface bg + focus ring (brand); never look like plain text.
8. **Disabled fields:** `opacity-50` + `cursor-not-allowed`, with helper text why (e.g. "Locked — exam published").
9. **Formatting hints** under fields (e.g. phone format, date format) in caption 12px `ink-400`.
10. **RTL:** all fields flow logically in both directions; mixed Arabic/English content uses proper `dir="auto"` per field.

Exam-specific: answer selection is a large-tap radio group (≥44px), sticky "Next" + progress; saving shows a quiet "محفوظ / Saved" check (the system saves progressively — the UI must reassure without interrupting).

---

## 14. Tables

Data tables are the heart of the admin experience (students, attempts, submissions, invoices). Pattern:

1. **Header:** sticky within scroll container; sortable columns with explicit chevron on active sort.
2. **Rows:** 44px comfortable (32px compact), `ink-100` row dividers, `ink-50` hover, no heavy zebra (optional zebra in `surface-muted` only for > 20 rows).
3. **Selection:** checkbox column + bulk action bar (from UX guidelines — bulk edit is a requirement), disabled bulk actions when nothing selected.
4. **Pagination:** server-side always (DATABASE_MODEL mandates pagination; never load-all). Page size selector 10/25/50, total count shown, logical prev/next (flips in RTL).
5. **Mobile:** `overflow-x-auto` wrapper **or** collapse to card layout per column priority (1–2 key columns + expand).
6. **Status cells:** pill chips (§12.2) with semantic colors.
7. **Numerals/dates:** locale-aware (Gregorian + Hijri calendar option in settings); numbers align consistently per locale (right in Arabic).
8. **Loading:** skeleton rows (not a spinner) matching column widths.
9. **Empty:** never blank — §17 pattern.

---

## 15. Navigation

### 15.1 Marketing (Enterprise Gateway pattern)

- Sticky header (with `padding-top` compensation so it never covers content); mega-menu for "Solutions / Institutions / Features", plus top-level links.
- **Primary CTA:** "اطلب عرضاً تجريبياً / Contact Sales" (brand-600); **secondary:** "تسجيل الدخول / Login".
- Trust signals under hero: institution logos, certifications (ISO 27001 / SOC 2), customer quotes from real institutions.
- Mobile: hamburger → full-screen sheet; keep Contact Sales always visible.

### 15.2 Product (app shell)

- **Sidebar:** fixed, collapsible (icons-only state), groups by domain (My Courses, Exams, Students, Analytics, Settings per role). Active item = brand-tinted `brand-50` bg + 3px brand-600 inline-start indicator (logical property — sits on the correct side in RTL). Max 2 nesting levels via disclosure; deeper hierarchy goes to breadcrumbs.
- **Topbar:** breadcrumbs + page context, search, notifications, avatar menu. Breadcrumbs are **required at 3+ levels** — the ContentNode tree (Course → Unit → Lesson → Topic) is exactly this case.
- **Keyboard navigation** is mandatory in every menu (roving tabindex); tab order matches visual order; **skip link** to main content on every page.
- **Back button/history:** never broken — all stateful views push real URLs (deep-linking for course nodes, exam attempts, student profiles). URL reflects state (from UX guidelines: deep linking required).
- **Active state** must be visible on all nav items (color + indicator), including keyboard focus.

### 15.3 Footer (both)

Institutional completeness: product links, legal, compliance (GDPR/PDPL), languages (AR/EN toggle persisting in cookie), and trust badges.

---

## 16. Dashboard Philosophy

Per-role calm overview (Education Analytics direction, expressed in Manara's calm language):

1. **KPI row:** 4 cards max — each with value (Lexend 24px), label, and a small sparkline (chart-1/gold only). Example (Institution Admin): Active Students, Exams in Progress, Completion Rate, Attendance Today.
2. **Charts below:** max 2–3 meaningful visualizations per screen, each answering one question. Progressive disclosure: Course → Section → Student drill-down.
3. **Exam-time readiness:** dashboards must stay calm at 100k+ users — skeletons, server-side pagination, no eager-loading everything (from performance guidelines: lazy-load below-fold).
4. **Decision-first:** a chart that doesn't change a decision is removed. Tooltips carry detail; the canvas stays quiet.
5. First-run: role-based onboarding cards (create your first course / invite teachers / schedule an exam) instead of empty charts.
6. Every widget has an explicit loading state and a graceful error state with retry (§17).

---

## 17. Empty States & Error States

**Empty states** (never a blank screen):

1. Minimal line illustration (§10) in the top area.
2. Title: what this place is ("No exams yet").
3. Description: one sentence on value ("Exams run fully online — with auto-grading and proctoring.").
4. Primary action button ("Create your first exam").
5. Optional secondary link; for data lists, an "Import" alternative when applicable.
6. Empty states are also the onboarding entry — first-run pages share this anatomy.

**Error states** (all mandatory):

1. Error message near the failing element, `role="alert"`, with recovery path: "Try again" + support/help link (from UX guidelines: recovery is required).
2. Page-level errors: calm panel (danger icon + message + retry) — never a raw stack trace; technical details behind "Details" disclosure for support.
3. Toast errors persist until dismissed (never auto-dismiss errors).
4. Offline/network detection for exam surfaces: explicit banner + "resume saved answers" reassurance (the system persists progressively — the UI must say so).

---

## 18. Charts & Data Visualization

Library: **Recharts** (React-native, fits Tailwind/shadcn; documented in TECHNICAL_GUIDE's frontend stack).

| Pattern | Chart | Spec |
|---|---|---|
| Trend over time (enrollments, attempts, load) | Line / area | 2px line, **20% opacity fill** under line, no gradient fills |
| Comparison (per-course, per-unit) | Bar (horizontal for RTL-friendliness) | brand-600 primary, chart-3 secondary, gold for the highlighted series |
| Distribution / single highlight | Donut (one only) | Gold or brand for the focus slice; tooltips carry the rest |
| Rank / top lists | Horizontal bars | Max 8 bars, sorted descending |

Rules:

1. **Max 5 series** per chart; beyond that → aggregate or split.
2. **Colorblind safety:** chart palette (§4.6) + optional pattern overlays per series; color is never the only differentiator.
3. **No chart-junk:** no 3D, no glows, no decorative gridlines (max 2 guide lines), gridlines `ink-100`.
4. Axes: caption 12px `ink-400`; values formatted per locale (Latin/Arabic-Indic digits, Gregorian/Hijri).
5. Direct labels only when 3 points or fewer; otherwise tooltips (surface, radius-lg, shadow-md).
6. Loading: skeleton block matching chart aspect ratio. Empty: §17 pattern inside the chart card.
7. RTL: time axis flows right→left in RTL (logical axis); horizontal bars grow from the inline-start.
8. Accessibility: charts ship with a data table fallback (visually hidden) + `aria-label` summary; interaction via keyboard (focusable series points).

---

## 19. Accessibility (Mandatory)

Target: **WCAG 2.1 AA** (minimum), with AAA attempted for contrast on marketing text.

| Area | Requirement |
|---|---|
| Contrast | Text ≥ 4.5:1; large text/UI components ≥ 3:1; verified in both light and dark themes; semantic colors never sole indicator |
| Focus | Visible ring (`ring-focus`, 2–3px offset) on every focusable element; never `outline: none` without replacement |
| Keyboard | Full functionality by keyboard; tab order = visual order; no traps; roving tabindex in menus; skip link to main content |
| Semantics | Sequential heading levels (h1→h2→h3, never skips); one h1 per page; landmarks (header/nav/main/footer) |
| Labels | Every input labeled; every icon-only control has `aria-label` |
| Live regions | Errors `role="alert"`; loading announcements `aria-live="polite"`; toasts `role="status"` |
| Touch | Targets ≥ 44px (mobile), ≥ 24px spacing between targets; `active` feedback on all pressable |
| Motion | `prefers-reduced-motion` honored globally (§11) |
| Media | No autoplay; captions/transcripts for marketing video |
| Language | Correct `lang`/`dir` attributes; mixed content uses `dir="auto"` per element |
| Forms | Error messages tied to fields (`aria-describedby`); validation announced, not just painted |
| Tables | Real `<th>`/`<caption>`; sortable headers expose state via `aria-sort` |
| RTL/a11y overlap | Focus order, breadcrumb direction, and chart axis direction tested in both `dir` values |

An accessibility pass is part of the definition of done for every module in MODULE_SPECIFICATION (each module lists its security + multi-tenant constraints; a11y is the frontend counterpart).

---

## 20. Responsive Behavior

Breakpoints (Tailwind defaults): sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536.

| Surface | ≤ sm | ≤ md | lg+ |
|---|---|---|---|
| Marketing nav | Hamburger → sheet (Contact Sales pinned) | Collapsed mega-menu | Full mega-menu, sticky |
| Sidebar | Hidden → overlay drawer (with backdrop) | Collapsed icons | Full |
| Tables | Card layout or horizontal scroll | Horizontal scroll | Full table |
| Forms | Single column, full-width controls | Single column | Grid where logical (label inline) |
| KPI row | 2×2 grid | 2×2 → 4-across | 4-across |
| Dialogs | Full-width sheet (bottom) | Centered | Centered, max-width |

Rules: sticky elements compensate their own height; touch targets ≥ 44px on all breakpoints; exam surfaces are responsive but the timer + answers never scroll out of a single reachable view; test every breakpoint in RTL.

---

## 21. Dark Mode

Full token-level dark theme (not inversion). Default follows `prefers-color-scheme`, with a manual toggle persisted (cookie — per TECHNICAL_GUIDE's session/cookie decisions).

| Token | Light | Dark |
|---|---|---|
| canvas | `#FAF9F6` | `#0E141B` |
| surface | `#FFFFFF` | `#161D26` |
| surface-muted | `#F3F1EC` | `#1D2732` |
| ink-100 | `#E4E7EC` | `#2A3542` (borders) |
| ink-200 | `#C6CCD6` | `#37424F` (input borders) |
| ink-300 | `#9AA4B2` | `#5C6876` (disabled/placeholders) |
| ink-400 | `#7A8595` | `#8B96A4` |
| ink-600 | `#3A4553` | `#C7CFD8` |
| ink-700 | `#1C2430` | `#EDF1F5` |
| brand-600 (actions) | `#1F6E93` | `#3E93BC` (brightened for AA) |
| brand-50 (tints) | `#F0F6F9` | `#12242E` |
| success / warning / danger | as §4.5 | brightened variants (e.g. `#4CAF7E`, `#E09A3E`, `#E57368`) maintaining 4.5:1 on dark surfaces |
| gold-500 | `#C29B3A` | `#D4B45C` |
| Shadows | §8 | **Replaced by borders + surface elevation** (no glow) |

Rules: charts use the dark chart variants of the same hue set; hero/marketing may go full `brand-950` with gold; no pure `#000` backgrounds; motion and radius unchanged; exam mode honors the user's theme choice (no forced theme).

---

## 22. Design Tokens (Tailwind Alignment)

All tokens above map 1:1 to Tailwind `theme.extend` (colors as shown in §4; fonts §5; spacing §6 as `space-*`; radius §7 as `radius-*`; shadows §8; type scale §5.2; transitions §11; breakpoints §20). Components consume tokens only — **no hard-coded hex/sizes in components**.

Summary token inventory:

```
colors:     brand-50..950, gold-400..700, canvas, surface, surface-muted,
            ink-50..800, success(+bg), warning(+bg), danger(+bg), info(+bg),
            chart-1..5, (dark variants as `dark:` mappings)
fontFamily: display (Lexend + Noto Kufi Arabic), sans (IBM Plex Sans + Arabic), mono
fontSize:   display/h1/h2/h3/body-lg/body/caption/overline (+ Arabic line-height overrides)
spacing:    2,4,8,12,16,24,32,48,64,96
radius:     6,8,12,16,999
shadow:     sm, md, lg, ring-focus, ring-focus-danger
motion:     150,200,300,400 (ease-out cubic-bezier(0.16,1,0.3,1))
zIndex:     10 dropdown · 20 sticky · 30 header · 40 overlay · 50 modal · 60 toast
breakpoints: sm 640, md 768, lg 1024, xl 1280, 2xl 1536
```

---

## 23. Decision Log

| # | Decision | Rejected alternative(s) | Reason |
|---|---|---|---|
| D1 | Soft UI Evolution style (subtle depth, 8–12px radius, 200–300ms motion) | Claymorphism (generator's primary suggestion); Glassmorphism | Clay = playful/kid-oriented, contradicts enterprise calm; Glass hurts legibility |
| D2 | Custom "Minaret Blue + Heritage Gold + Parchment" palette | Copying generator palettes (#4F46E5 indigo, #2563EB SaaS blue, #0369A1 micro-credential, #1E3A8A legal navy); AI-purple | Must not copy existing products; deep desaturated blue + warm paper + gold achieves premium, scholarly, regionally resonant identity |
| D3 | Product style = education product, but executed as enterprise SaaS | "Playful colors + clear hierarchy" (product DB default for e-learning) | Multi-tenant enterprise brief (100k+ users/org, institutions as buyers) overrides consumer-playful defaults |
| D4 | Lexend + IBM Plex Sans/IBM Plex Sans Arabic + Noto Kufi Arabic | Inter-only, Baloo 2 + Comic Neue (generator suggestion), Poppins/Open Sans | Arabic-first requirement: Inter/Poppins lack full Arabic coverage; IBM Plex Arabic is the same-family premium pairing; Kufi display differentiates headings |
| D5 | Marketing pattern: Enterprise Gateway (Contact Sales primary + Login secondary, mega menu, trust signals) | Storytelling/Feature-showcase patterns | B2B education buyers (institutions) need trust + direct sales path |
| D6 | Recharts for all visualization | Chart.js | React-native, fits React 19 + Tailwind + shadcn stack in TECHNICAL_GUIDE §2 |
| D7 | RTL via logical properties + direction-aware icons, tested as first-class | CSS `scaleX(-1)` page mirroring | Mirroring breaks icons, text flow, and chart axes; logical properties are the correct native approach |
| D8 | Dark mode = token-level dark theme, default `prefers-color-scheme` + persisted toggle | Dark-by-default | The design-system generator flagged dark as anti-pattern for education products, but enterprise adoption and user expectation require it; token-level approach keeps AA contrast |

---

*Manara Design System v1.0 — consistent with PRODUCT_VISION, TECHNICAL_GUIDE, DOMAIN_MODEL, DATABASE_MODEL, SYSTEM_ARCHITECTURE, and MODULE_SPECIFICATION. Design direction validated with the UI/UX Pro Max skill; every divergence is recorded in §23.*
