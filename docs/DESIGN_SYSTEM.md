# Manara Design System

> **المرجع البصري الرسمي لمنصة منارة** — The approved visual-system contract for Manara.
>
> - **Version:** 2.0 (UX-0C)
> - **Status:** Visual direction approved; implementation proceeds through separately approved checkpoints
> - **Scope:** Public, student, teacher, institution-admin, and Super Admin surfaces
> - **Logo status:** No final logo or brand mark is approved

## 1. Direction

Manara is a bilingual institutional learning platform. Its visual language is scholarly, precise, civic, warm, composed, bilingual, and enduring. It must not feel childish, generic SaaS, ornamental, visually noisy, or dependent on lighthouse/minaret imagery.

The approved direction is **Disciplined Hybrid**:

- Deep institutional green is the product foundation.
- Plum is a secondary editorial-memory accent.
- Copper is a rare achievement and consequence accent.
- Warm ivory and restrained neutral surfaces carry most interface area.
- Light and dark themes are designed independently through semantic tokens.

## 2. Color Hierarchy

### 2.1 Foundation Green

`foundation-50` through `foundation-950` own product structure, primary actions, active navigation, progress, links, and the Manara operating environment. Foundation green is dominant but must not flood content surfaces.

| Core token | Value | Role |
|---|---:|---|
| `foundation-50` | `#EEF6F3` | Quiet selected/active surface |
| `foundation-600` | `#17675B` | Primary action |
| `foundation-700` | `#105047` | Hover/link |
| `foundation-800` | `#103F3A` | Institutional navigation |
| `foundation-950` | `#062420` | Deepest foundation surface |

### 2.2 Memory Plum

`memory-50` through `memory-950` identify reflection, retained knowledge, editorial passages, selected narrative moments, and distinctive brand memory.

Plum is prohibited for routine controls, generic navigation backgrounds, tables, ordinary success states, and large product surfaces. Its reference value is `memory-600: #694C70`.

### 2.3 Consequence Copper

`consequence-50` through `consequence-950` identify certification, meaningful milestones, deadlines, decisions requiring attention, and consequential progress.

Copper is prohibited for general calls to action, ordinary hover states, routine progress, and decorative fields. Its reference value is `consequence-600: #A05534`; `#A8673D` remains the conceptual identity reference rather than a required UI text color.

### 2.4 Semantic States

Success, warning, danger, and information are independent state concepts. Color is always paired with text, an icon, shape, pattern, or explicit value.

| State | Light foreground | Light background | Dark foreground | Dark background |
|---|---:|---:|---:|---:|
| Success | `#2F7150` | `#E8F3EC` | `#72C295` | `#173326` |
| Warning | `#815311` | `#FBF0E0` | `#E0B462` | `#382B17` |
| Danger | `#A33D3D` | `#FBE9E7` | `#EF8585` | `#3B2020` |
| Information | `#365F8D` | `#EAF1F8` | `#83AEDD` | `#1D2F43` |

## 3. Surfaces And Dark Mode

| Semantic token | Light | Dark |
|---|---:|---:|
| `canvas` | `#F8F7F3` | `#101715` |
| `surface` | `#FFFDFA` | `#162522` |
| `surface-muted` | `#F1F3EF` | `#1D302C` |
| `surface-strong` | `#E8ECE7` | `#253A35` |
| `border-subtle` | `#D5DDD8` | `#39504A` |
| `border-strong` | `#AEBCB6` | `#587069` |
| `text-strong` | `#1B2825` | `#EDF2EF` |
| `text` | `#34443F` | `#D3DED9` |
| `text-muted` | `#63716D` | `#A5B7B1` |
| `text-disabled` | `#89948F` | `#7D918A` |
| `action` | `#17675B` | `#70B5A4` |
| `on-action` | `#FFFFFF` | `#09231F` |

Dark mode is not an inversion. Borders replace most shadow separation, text retains measured contrast, and semantic colors are independently tuned. Pure black, decorative glows, and broad gradients are excluded.

## 4. Typography

The token contract references fonts without loading them in UX-1. Font files and subsetting require a separate approved checkpoint.

| Role | Latin | Arabic |
|---|---|---|
| Product UI/body | IBM Plex Sans | IBM Plex Sans Arabic |
| Editorial display | Source Serif 4 | Noto Naskh Arabic |
| Data/identifiers | IBM Plex Mono | IBM Plex Sans Arabic fallback |

Product interfaces use the UI family for density and endurance. Display faces are reserved for public storytelling, certificates, reflective material, and selected editorial headings. Arabic body copy uses at least 1.7 line-height. Letter spacing is always `0`; do not track Arabic text. Mixed identifiers use directional isolation.

Type tokens are `display`, `h1`, `h2`, `h3`, `body-lg`, `body`, and `caption`. Product tables use body/caption sizes with tabular numerals and visible labels.

## 5. Density And Geometry

- Base spacing follows a 4px rhythm: 4, 8, 12, 16, 24, 32, 48, 64, and 96px.
- Minimum control height and comfortable table row height are 44px.
- Compact table rows are 36px and are restricted to dense operational contexts.
- Product content width is capped at 90rem; reading measure is 68ch (60ch Arabic).
- Radii are 4, 6, 8, and 12px. Full pills are limited to statuses, toggles, and circular controls.
- Page sections are unframed. Cards frame repeated items, dialogs, and genuine tools only.
- Shadows are restrained and never substitute for clear borders or hierarchy.

## 6. Manara Beacon System

Beacon primitives are a semantic visual language, not a logo:

- **Arcs** express reach or relationship.
- **Nodes** express checkpoints or resolved states.
- **Signal lines** express continuity through a process.
- **Registration marks** identify bounded institutional records or coordinates.
- **Indexed rails** locate a user within hierarchy or progress.

Green expresses normal structure/progress, plum expresses memory, and copper expresses consequence. A Beacon element without informational meaning is prohibited. Beacon primitives must never be exported as a final brand mark or required on every screen.

## 7. Charts

Charts use `chart-1` through `chart-5` plus `chart-grid`. Values and labels remain visible without hover; patterns, symbols, or direct labels supplement color. Data tables are the accessibility fallback. Recharts is added only when a real chart requirement exists and is lazy-loaded where appropriate.

| Series | Light | Dark |
|---|---:|---:|
| 1 | `#17675B` | `#70B5A4` |
| 2 | `#694C70` | `#C1A8C5` |
| 3 | `#A05534` | `#D4956E` |
| 4 | `#365F8D` | `#83AEDD` |
| 5 | `#8A6431` | `#D8BB78` |

## 8. Focus And Accessibility

WCAG 2.1 AA is the floor. Normal text targets 4.5:1 and UI boundaries/large text target 3:1. Focus uses a visible 2px outline with 3px offset; focus is never removed. Error and status meaning never relies on color alone.

Interactive targets are at least 44x44px on touch surfaces. Page structure uses landmarks and sequential headings. Inputs have visible labels. Tables use captions, headers, and `aria-sort` when sortable. Every icon-only action has an accessible name.

## 9. RTL And LTR

Layouts use logical properties and are authored for both directions. Arabic hierarchy may recompose rather than mechanically mirror English. Directional icons follow meaning; neutral icons do not flip. Dates, codes, emails, and identifiers receive explicit bidi isolation. Tables retain the reading order appropriate to their locale and task.

## 10. Motion

Motion communicates state and spatial continuity:

| Token | Duration | Use |
|---|---:|---|
| `motion-instant` | 100ms | Immediate pressed feedback |
| `motion-fast` | 150ms | Hover/focus state |
| `motion-base` | 200ms | Small UI transition |
| `motion-slow` | 300ms | Drawer/navigation transition |
| `motion-reveal` | 400ms | Restrained public content reveal |

Entering motion uses `ease-enter`; exit uses the faster `ease-exit`; ordinary state changes use `ease-standard`. CSS and IntersectionObserver are sufficient. No motion library is approved. Reduced motion removes spatial movement and reduces transitions to effectively immediate state changes.

## 11. Responsive Principles

Large screens prioritize scanning and comparison. Tablets collapse navigation without hiding context. Mobile prioritizes the role's next action and preserves 44px targets. Dense tables may scroll horizontally or deliberately recompose according to known column priority; columns are never silently discarded.

Every implemented surface is reviewed at 390, 768, 1024, and 1440px in RTL and LTR. Text must not overlap or resize containers unexpectedly.

## 12. Dependency Policy

- CSS variables are the source of truth; Tailwind remains installed as an approved utility layer.
- Do not migrate away from Tailwind during visual implementation or deepen unnecessary coupling.
- React Aria Components are preferred when an appropriate mature accessible primitive is needed.
- TanStack Table is the behavior engine only for real stateful tables. Static tables remain semantic HTML.
- React Hook Form with Zod is used only for real forms.
- Recharts is used only for real charts and lazy-loaded where appropriate.
- Do not add any dependency before a checkpoint proves it is needed.
- Do not introduce Framer Motion, another animation library, or a heavy UI framework.

## 13. Role Density

- **Student:** lower simultaneous control density; next actions and progress dominate.
- **Teacher:** workflow density; schedules, feedback, and interventions remain quickly scannable.
- **Institution Admin:** comparison and governance density; tables and bulk operations are explicit.
- **Super Admin:** highest operational density; compact mode is permitted with durable contrast and stable geometry.
- **Public:** editorial composition and longer rhythm without giant empty space or floating dashboard mockups.

## 14. Implementation Rules

Tokens are consumed by semantic purpose. New components must not choose raw palette values. Compatibility aliases (`brand`, `gold`, and `ink`) remain temporarily for the existing placeholder and are prohibited in new UI.

The final logo is a separate decision. No Beacon primitive, conceptual mark, lighthouse, or minaret may be promoted to a production logo through this document.
