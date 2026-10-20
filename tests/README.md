# CRM browser regression tests

`mobile-workspace.cjs` loads the actual CRM HTML, styles and scripts in Chromium,
using the real Supabase browser SDK. It intercepts **every network request**.
The 33,000-owner dataset and all changes exist only in the test process. It does
not connect to the production database or send WhatsApp messages.

## Run

Requirements: Node.js, Playwright, a Chromium executable and a local copy of the
Supabase UMD bundle used by the site. Install testing dependencies outside the
repository if preferred; no runtime/build dependencies are added to this CRM.

```bash
npm install --prefix /tmp/crm-test-deps playwright
curl -L https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js -o /tmp/crm-supabase.js
npx --prefix /tmp/crm-test-deps playwright install chromium
NODE_PATH=/tmp/crm-test-deps/node_modules \
CRM_TEST_SUPABASE_SDK=/tmp/crm-supabase.js \
CRM_TEST_CHROMIUM=/path/to/chromium \
node tests/mobile-workspace.cjs
```

`CRM_TEST_CHROMIUM` can point to an existing compatible Chromium binary. The
original run used Chromium 153. Set `CRM_TEST_WIDTHS=390,1440` for a focused run.
Screenshots and `results.json` go to `CRM_TEST_OUTPUT` (default:
`/tmp/crm-test-results`).

## Assertions

- 320, 375, 390 and 430 px touch-enabled mobile viewports, plus 1280 and 1440 px desktop.
- Menu taps and direct Owners ↔ Leads taps change the displayed view.
- WhatsApp links open an intercepted external tab; switching back preserves
  exact scroll, filters, page and the original owner-card DOM node.
- Repeated round trips at villas 5, 20, 30 and 40, plus villa 33 under combined
  community, cluster, source, status and search filters.
- Actual document reload restores the filtered workspace and scroll; page 2
  around villa 80 also restores.
- Natural ordering through 9 → 10 → 11, with `unit_natural` in the server request.
- Every Owners listing request has a server-side limit of 50.
- A delayed obsolete search response cannot overwrite newer results.
- Theme changes and persists through reload, navigation and standalone Cluster
  Guide navigation. Header theme/notification controls remain visible.
- Bell opens actual notification content; a notification opens its event editor.
- Calendar save reaches the mocked API with the entered title.
- Profiles and lead detail open, retain eight stages, fit the viewport and have
  scrollable containers; the removed occupancy log is absent.
- Dashboard, Calendar, Users and profile settings open; rotation/resizing does
  not hide global mobile controls.
- Known status foreground/background pairs exceed 4.5:1 in both themes.
- Desktop Leads table width fits its container; mobile content has no horizontal
  page overflow; browser JavaScript errors fail the run.

## Limits

These are browser workflow tests with isolated API fixtures, not a live Supabase
integration test. The suite does not prove production RLS, deployed functions,
Safari behavior, iOS/Android memory eviction or the native WhatsApp app handoff.
The branch preview should be checked with an authorized account and a physical
phone before merge. No production data changes are needed for the UI rollout.

## Mobile polish round (2026-10-20)

Set `CRM_TEST_FONT_DIR` to a directory containing actual Poppins 400/500/600
TrueType files named `poppins-400.ttf`, `poppins-500.ttf`, `poppins-600.ttf`.
The harness serves these locally through intercepted Google Fonts requests and
waits for `document.fonts.ready`. Without this option it deliberately tests the
system fallback. Download the currently published font URLs from the Google
Fonts Poppins stylesheet before running; production fonts are not bundled here.

The expanded checks cover full Owner/Lead status text measured with the loaded
font, stage controls without horizontal overflow, missing-phone placeholders and
disabled WhatsApp buttons, hydrated related-unit actions, real SVG navigation
icons, wrapped left-aligned long notes and bounded card height. They also cover
light/dark event fields, entered values, placeholders, minimum 4.5:1 text contrast,
date/time boundaries, footer buttons, owner/lead activity fields and Edit Lead
form accessibility above the profile. Dashboard labels and semantic bar colors
are checked after the asynchronous dashboard render completes.

Each mobile width also positions Unit 30 at approximately 70px, reloads the tab,
and checks its restored screen coordinate and retained community/cluster.
`results.json` includes measured coordinates, widths, text requirements and field
colors. All screenshots contain generated fixture records. This is Chromium
browser simulation, not a physical phone/Safari/native WhatsApp test.
