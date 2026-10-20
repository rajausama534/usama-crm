# Mobile polish review — 20 October 2026

Branch: `chatgpt-mobile-polish`. Base: latest `main`, `5c4ffed42b39c5d8ce28022c5522afcbe71b4612`.
Review only: do not merge or promote without Usama/Claude's review.

## Causes fixed

- A global `input,select,textarea` rule forced a dark background with `!important` in every theme. It now uses existing surface/text/border tokens at the source. Modal fields retain those tokens, placeholders use readable muted text, the shared dark indigo accent provides 5.03:1 contrast for white button text, intrinsic date/time widths cannot expand the grid, and the event footer wraps within the screen. Edit Lead previously opened beneath its profile because both overlays had the same stacking level; the editor now sits above the profile.
- Mobile stage controls were explicitly a horizontally scrolling strip with fixed 115px cards. They now use a compact two-column wrapping grid. The eight existing stages are unchanged.
- Native status dropdowns lacked room for both text and arrows. Lead status columns now reserve 224px; Owner fit minimums reserve 200px for status and distribute the remaining flexible width using Claude's existing proportional algorithm. No sideways-table scrolling was added. Mobile Owner headings wrap when necessary, and dashboard labels wrap without ellipses.
- Finder navigation was injected as plain text, triggering a generic square icon placeholder. The injectors now supply actual inline SVGs, Logout has an SVG, the placeholder rule is removed, and Broadcast reuses the existing recognizable WhatsApp SVG.
- Missing phone actions returned a literal dash or empty markup. Owner cards/tables now show a disabled same-size WhatsApp action and explicit “No phone number”. Empty More menus are hidden. Related-unit hydration slots remain mounted so asynchronously available actions are preserved.
- Dashboard status colors were applied only to a label; its bar is a sibling. The centralized status decorator now shares the same tone variables with the row, so bars use the existing semantic palette. There is no second status mapping.
- Poppins was loaded but overridden by Inter. The shared design system and separate Cluster Guide now use Poppins with system fallbacks. Headings, mobile card spacing, notes and metadata are restrained; long notes remain left-aligned and wrap to a three-line preview, with the full note available in the existing record detail.

## Files changed and why

| File | Purpose |
| --- | --- |
| `index.html` | Theme-token field source rule, status width minimum and flexible fit budgets, asset cache versions. |
| `crm-premium.css` | Poppins/type scale, remove square placeholders, wrapping dashboard labels, readable placeholders, Lead editor stacking. Existing 90vh profile scrolling retained. |
| `crm-leads-fit.css` | Wider status column; balance flexible Name/Requirement columns while retaining every column and zero horizontal scroll. |
| `crm-workspace-refinement.css` | Compact mobile cards/stages, readable aligned notes, full badges, bounded date/time fields and wrapping footer buttons, disabled/missing-phone and empty-menu styling. |
| `crm-workspace.js` | Missing-phone markup, mounted related-unit slots, Logout SVG and shared WhatsApp navigation icon. |
| `crm-enhancements-core.js` | Inline Unit Finder, Owner Finder and Cluster Guide SVGs at their injection source. |
| `crm-status-system.js` | Dashboard row inherits the existing central status tone. |
| `crm-enhancements.js` | Version changed JS assets to prevent stale cached code. |
| `cluster-guide.html` | Match Poppins and readable font fallbacks on the separate guide page. |
| `tests/mobile-workspace.cjs` | Expanded real-browser fixtures, font-aware bounds/contrast checks, form stacking, notes, missing phones, related actions, Unit 30 reload and dashboard assertions. |
| `tests/README.md` | Reproduction instructions including actual local Poppins files and test limitations. |
| `docs/MOBILE_POLISH_2026-10-20.md` | This file-by-file review and measured verification report. |
| `docs/mobile-polish/results.json` | Raw fixture-browser measurements and pass results. |
| `docs/mobile-polish/follow-up-320-light.png` | Fixture screenshot: follow up 320 light. |
| `docs/mobile-polish/follow-up-320-dark.png` | Fixture screenshot: follow up 320 dark. |
| `docs/mobile-polish/dashboard-390-light.png` | Fixture screenshot: dashboard 390 light. |
| `docs/mobile-polish/missing-phone-320.png` | Fixture screenshot: missing phone 320. |
| `docs/mobile-polish/lead-records-390-dark.png` | Fixture screenshot: lead records 390 dark. |
| `docs/mobile-polish/desktop-leads-light.png` | Fixture screenshot: desktop leads light. |

## Preserved behavior and data safeguards

The stages remain exactly **New · No Response · Interested · Viewing Scheduled · Visit Done · Negotiation · Won · Lost**. No database/schema, permission, migration, record or historical-data changes were made. No keys were added. Server-side Owner list queries remain bounded to 50 records and ordered using `unit_natural`; filtering and paging are unchanged. The WhatsApp state architecture in `crm-state.js` is untouched. Claude's proportional table fit, profile scrolling and removed Occupancy UI remain in place.

## Verification scope

Chromium 153, touch-enabled mobile browser contexts at 320/375/390/430px and desktop at 1280/1440px. Both light/dark modes. Actual application HTML/CSS/JS and the real Supabase browser SDK run against intercepted fixture APIs, using actual Poppins 400/500/600 font files. Every external request is intercepted; the fixture dataset contains 33,000 Owners, but list responses remain paginated. No production login, records or WhatsApp messages were used.

Checks include complete labels and arrow space, stage wrapping, no page overflow, missing phones and disabled actions, all requested SVGs, a 500+ character note, form values and placeholder contrast >=4.5:1, date/time and footer bounds, profile/activity and Lead editor fields, calendar save reaching the fixture API, notification open, theme persistence, Owners ↔ Leads taps, profile internal scrolling, Occupancy absence, natural unit sequence, stale-search rejection, repeated WhatsApp tab round trips and reload restoration at Unit 30.

**Limits:** Browser-tab switching/reload simulates leaving and returning from WhatsApp. Physical iPhone/Safari lifecycle, native WhatsApp deep-link handoff, real notification delivery and live database permissions were not tested. A reviewer should complete those device checks on the branch preview before merging. No production merge or deployment is authorized in this round.

## Measured pass results

| Viewport | Page width | Stage strip client/scroll | Unit 30 screen Y before/after reload | Long-note Lead card height |
| --- | --- | --- | --- | --- |
| 320px | 320px | 266/266px | 70.46875/70.46875px | 339.375px |
| 375px | 375px | 321/321px | 69.765625/69.765625px | 339.375px |
| 390px | 390px | 336/336px | 69.765625/69.765625px | 339.375px |
| 430px | 430px | 376/376px | 69.765625/69.765625px | 339.375px |

Desktop table client/scroll widths: **Owners 917/917px and Leads 917/917px at 1280px; Owners 1077/1077px and Leads 1077/1077px at 1440px.** Status text checks reserve arrow/padding space: Lead dropdown 202px usable, largest measured requirement 197px; Owner dropdown 174px usable, Invalid Number requirement 166px, Not Interested 162px. Related-unit Actions stayed within its 236px column.

All 20 recorded WhatsApp round trips returned to exactly the same document scroll coordinate. An additional second-page Unit 80 round trip/reload passed at 390px. Community, cluster, search, source, status and page restoration passed. Natural unit sequence 1–12 and bounded 50-row server requests passed. Browser JavaScript errors: **0**.

Syntax checks passed for each modified JavaScript file and the browser harness; `git diff --check` passed. Screenshots were visually reviewed for card hierarchy, complete chart labels and readable event fields/footer.
