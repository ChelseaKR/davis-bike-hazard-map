# Screen-reader walkthrough — script & verification

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §E. Companion to
[`accessibility-2026-05-31.md`](./accessibility-2026-05-31.md): that file covers
the **automated** axe pass (merge-gated); this file is the **screen-reader**
protocol — the reproducible script a human runs with VoiceOver / NVDA, plus the
code-level SR affordances that back each step (and are regression-guarded by
tests).

## How to run it

- **macOS / iOS — VoiceOver:** ⌘F5 to toggle; `VO` = Ctrl+Option. Navigate with
  `VO+→`, interact with `VO+Space`, headings with `VO+⌘+H`, landmarks with
  `VO+U` → rotor.
- **Windows — NVDA:** `Insert` is the NVDA key; `H` next heading, `D` next
  landmark, `F` next form field, `B` next button, `Tab` for focusables.
- Run once on a phone (mobile VoiceOver/TalkBack) too — this is a bike app.

Each step lists the **expected announcement**. A step passes if the announced
role + name match and the task is completable without sighted cues.

## 1. Orientation

| Step | Expected announcement | Backing affordance |
|------|----------------------|--------------------|
| Load app | "Davis Bike Hazard Map, heading level 1" | `<h1>` in `App` |
| Skip link (first Tab) | "Skip to main content, link" → activates to `#main` | skip link in `index.html` |
| Landmark rotor | banner / navigation "Views" / main / contentinfo | `header`/`nav[aria-label]`/`main`/`footer` |
| Tab list | "Map, button" … "Moderate, button"; current tab "current page" | `aria-current="page"` on active tab |

## 2. File a report (primary task)

| Step | Expected announcement | Backing affordance |
|------|----------------------|--------------------|
| Open Report | "Report a hazard, form" | `<form aria-label>` in `ReportForm` |
| Type select | "Type, combo box" | labelled `<select>` |
| Severity | "Severity, radio group" → each option as radio | `role="radiogroup"` + radios |
| Use my location | on success: "Location set …" announced (polite) | `aria-live="polite"` location readout |
| Location error | error announced immediately | `role="alert"` on the geolocation error |
| Submit with no location | "Submit report, button, dimmed" | `disabled` until `locationValid` |
| Submit | "Report saved offline/and syncing ✓, status" announced | `role="status"` success card |
| Submit error | error announced immediately | `role="alert"` on the form error |

## 3. Browse without the map (map/list parity)

| Step | Expected announcement | Backing affordance |
|------|----------------------|--------------------|
| Open List | "Hazard list" reachable; cards as list items | `ListView` (independent of the map) |
| A card | category heading, "moderate severity" (text, not colour), "Community-reported — not verified" | `HazardCard` text + visually-hidden severity |
| Empty state | "No hazards match …" — **not** "you are safe" | coverage-equity framing |
| Filter result count | count change announced (polite) | `role="status" aria-live="polite"` on FilterCounts |

## 4. Moderate (per-moderator account)

| Step | Expected announcement | Backing affordance |
|------|----------------------|--------------------|
| Open Moderate | "Moderator sign-in"; "Username, edit"; "Password, edit, secure" | labelled inputs, `autocomplete` |
| Wrong credentials | "Wrong username or password" announced | `role="alert"` |
| Signed in | "Signed in as <name>"; "Pending review (N)" | live text |
| Approve | item leaves the queue; "queue is clear" when empty | queue re-render |

## 5. Cross-cutting

- **Visible focus** never lost: global `:focus-visible` 3px outline.
- **Reduced motion**: with "reduce motion" on, the map fly-to and transitions
  drop to ~0ms (`@media (prefers-reduced-motion: reduce)` in `styles.css`).
- **Map markers** are keyboard-focusable (`keyboard: true`) with names/alts, but
  SR users are never required to use them — the List view is the equal path.

## Verification status

- **Code-level SR affordances** (every "backing affordance" above): present and
  regression-guarded by `tests/unit/*.a11y.test.tsx` + `ReportForm` live-region
  tests + the full-page axe pass (`tests/e2e/a11y.spec.ts`). ✅
- **Human VoiceOver + NVDA pass** against this script: the final review-gated
  sign-off before public launch. ⏳ Scheduled pre-launch; record the operator,
  date, and AT versions in the sign-off line below.

> Human SR sign-off: _pending_ — operator / date / VoiceOver+NVDA versions: ____

**Last updated: 2026-06-05.**
