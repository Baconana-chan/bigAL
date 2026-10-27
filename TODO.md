# bigAL roadmap

A living plan for bigAL. Priorities are intent, not promises: **P0** = next release,
**P1** = worth doing soon, **P2** = interesting / needs research, **parked** = deliberately
not planned.

Guiding constraints:

- Everything runs client-side; there is no bigAL backend.
- Signed-in actions use the AniList site session (cookies + CSRF token), never a
  registered OAuth client or a stored third-party token.
- One TypeScript core builds three targets: MV2, MV3 and a userscript.
- AniList's own UI stays intact; additions are prefixed `alx-` and degrade to nothing
  when an anchor element is missing.
- Features must work with keyboard, respect the current theme, and avoid hiding data
  the user already has in their library without an explicit choice.

## Shipped

- [x] **Enhanced studio pages** — full filmography instead of the first 25 titles,
      pagination, search, format/status/role filters, summary stats, main vs supporting
      credits, colour-coded list-status markers, native view toggle.
- [x] **Global profile accent** — the profile color applies to the whole site, survives
      theme switches, supports auto-detection from the username.
- [x] **Openings & Endings on title pages** — AnimeThemes data, OP/ED tags, episodes,
      NSFW/spoiler reveal, inline player; placed under the trailer in the main column.
- [x] **Quick actions on studio cards** — trailer, list status menu, edit entry
      (status/score/progress), next-episode countdown, remove from list.
- [x] **Home “Anime in Plans”** — planning-list premieres whose first episode is still
      ahead, countdown badges, live tick, inserted as the fourth home block.
- [x] **Shared build pipeline** — esbuild + TypeScript, MV2/MV3 manifests and a
      userscript from the same source.
- [x] **bigAL rename** — manifests, userscript metadata, settings dialog, package name.
- [x] **Per-block settings** — independent toggles for studio pages, quick actions,
      OP/ED, home plans and the global accent, applied without a reload.
- [x] **Request cache** — planning lists (2 min) and per-title list/trailer state
      (1 min) in memory, deduplicated while in flight, invalidated on mutations.
- [x] **Popover accessibility** — dialog/menu roles, focus trap, focus return to the
      trigger, arrow-key menu navigation, live announcements, reduced motion.
- [x] **Studio summary on title pages** — animation studios with main/supporting
      credits, a strip of each studio's key works and a link to the enhanced studio
      page; licensors without works are skipped.
- [x] **Friends' progress on title pages** — episode progress and list status for the
      viewer and up to six public AniList profiles in one batched request, with deltas,
      progress bars and a two-minute cache; counts only, no episode titles.
- [x] **Next from your plans** — home block of planning entries that AniList's community
      recommendations link to titles the user scored well, sampled evenly across the
      whole library, each pick showing the title that suggests it; 5-minute list cache
      and 30-minute recommendation cache, dropped on list mutations.
- [x] **Premiere calendar** — month grid on its own `#alx/calendar` view: airing episodes
      from watching/rewatching lists plus planned premieres in local time, day counts,
      month navigation in the URL, and a local `.ics` export with reminders. Lives outside
      the home page so the dashboard does not keep growing.
- [x] **Continue watching** — home rail of the next unwatched episode per current title:
      counts what has already aired (`80 behind`), counts down to the next airing when
      caught up, flips to "1 behind" live when an episode airs, and skips finished titles.
- [x] **Backlog triage** — `#alx/triage` review view: plans untouched for 2+ years,
      franchise duplicates found through relation edges (union-find, not title matching) and
      sequels whose prequel you dropped; each entry in one section only, select-all per
      section, bulk pause/drop through the session mutation, and the list is re-read after
      an action so a new drop re-flags its sequels.
- [x] **Studio DNA** — recurring directors, composers and Japanese lead voice actors across
      a studio's 25 most popular works, each linked to their staff page with a count; the
      cast sample is fetched through the site session because AniList nulls `voiceActors`
      for anonymous calls, so guests get directors and composers only. 30-minute cache,
      own settings toggle, panel hidden when nothing recurs.
- [x] **Franchise tracker** — relations walked from the open title (dead ids isolated by
      bisecting a failed batch), main story split from side stories, release-order list with
      status chips and progress bars, next unwatched episode highlighted, plus a compact
      block on the title page; `#alx/franchise/<id>` view and its own setting.

## Next release (P0)

- [x] Settings toggles for every injected block (home plans, quick actions, OP/ED,
      studio pages) so a user can keep only what they want.
- [x] Cache planning/list queries with a short TTL and invalidate them after mutations;
      deduplicate concurrent requests.
- [ ] Revalidate the viewer after sign-in/sign-out instead of waiting for a reload.
- [x] Popover accessibility: focus trap, return focus, `aria-live` status, arrow-key
      navigation, `prefers-reduced-motion`.
- [x] README with install paths (MV2, MV3, Firefox/Tampermonkey), privacy note and
      build instructions.
- [ ] Store screenshots and listing copy.
- [ ] Release packaging: extension icons, Chrome/Firefox zips, changelog, version bumps.

## Borrowed from similar extensions

Feature candidates seen in the AniList extension ecosystem. Each needs a fit check —
bigAL should add a distinct angle rather than clone a feature one-to-one.

| Candidate | Prior art | Plan |
| --- | --- | --- |
| MAL character/staff data as a fallback when AniList's cast list is thin | AniList-Extras | P2 — needs Jikan API and a CORS review |
| MAL scores / external ratings next to AniList scores | AniList-Extras, AniList:RE | P1 — one cached Jikan lookup per title, clearly labelled source |
| MAL OP/ED data when AnimeThemes has no entry | AniList-Extras | P1 — keep AnimeThemes first, fall back per title |
| Grid/list toggle for characters and staff | AniList-Extras | P2 |
| Reddit discussion links per episode/title | AniList-Extras | P2 |
| Search popup and right-click actions | AL Search | P2 |
| Activity feed filtering and post templates | Activity-Feed Filter, Activity Templates | P2 |
| Auto progress sync with streaming sites | MAL-Sync | parked — needs host integrations and is a different product |
| Hide global activity feed, default player volume | AniList-Extras | P2 — small quality-of-life toggles |

## Original ideas (what should make bigAL different)

### Library intelligence

- [ ] **Franchise-first triage action** — for a franchise group, keep the earliest season
      and drop or pause the rest in one click instead of selecting rows by hand. (P2)
- [ ] **Watch-time budget** — hours needed for the planning list, “finish in a weekend”
      picks, average episode length per franchise. (P2)
- [ ] **Progress from the tracker** — a `+1 episode` / `completed` button on each tracker
      row, so catching up on a franchise does not need a trip to every title page. (P1)
- [ ] **List health report** — score histogram, genre bias, drop rate, longest series,
      favourite decades; exportable as an image. (P2)

### Studio and staff intelligence

- [ ] **Recurring cast fallback** — AniList nulls `voiceActors` without a session, so a
      signed-out visitor sees directors and composers only; a public source (Jikan's MAL
      cast) could fill the cast column at the cost of one extra request per title. (P2)
- [ ] **Co-studio graph** — which studios repeatedly co-produce, main vs supporting
      credits visualised. (P2)
- [ ] **Studio timeline** — releases per year and upcoming works from the studio page. (P1)
- [ ] **Staff overlap with favourites** — “you liked 6 titles scored by this composer”. (P2)

### Themes (OP/ED)

- [ ] **Theme playlists** — queue all OPs/EDs of a studio, season or franchise; continue
      playback across titles. (P1)
- [ ] **Theme timeline** — OP1/OP2/ED1… order with the episodes they cover; collapse
      spoiler entries behind an explicit reveal. (P1)
- [ ] **Community favourites** — best-voted themes per season/studio if AnimeThemes
      exposes usable votes; otherwise rank by local play count only. (P2 — verify API)
- [ ] **NSFW-aware presentation** — blur thumbnails instead of hiding rows, with a
      session-only “show anyway” toggle. (P1)

### Social and shared watching

- [ ] **Friend compatibility** — score overlap, shared favourites and “watch next”
      suggestions from public lists. (P1)
- [ ] **Following picker** — choose comparison friends from your AniList follows
      instead of typing usernames, with avatars in the settings dialog. (P1)
- [ ] **Share cards** — compact list/studio/theme summaries rendered locally as images. (P2)

### UX and navigation

- [ ] **Command palette** (`Ctrl/Cmd+K`) — jump to a title, studio, profile, bigAL
      setting or the calendar; run quick actions. (P1)
- [ ] **Week view for the calendar** — the month grid is dense on narrow screens; a
      one-week list with times would read better on phones. (P2)
- [ ] **Configurable home dashboard** — reorder/hide bigAL blocks and native sections
      without touching AniList's own layout. (P2)
- [ ] **Density modes** for our grids (compact / comfortable / large). (P2)
- [ ] **Accent presets beyond profile colors** — custom accent hue with AA contrast
      checks, separate light/dark values. (P2)
- [ ] **Keyboard shortcuts** for the most-used quick actions. (P2)
- [ ] **Locale support** (at least `en` and `ru`) with a language switch in settings. (P2)

### Data and notifications

- [ ] **Premiere notifications** — browser notifications for planned premieres and next
      episodes; extension-only, opt-in, no background server. (P2)
- [ ] **Cross-source ratings panel** — AniList + MAL (+ optional TMDB/IMDb when a key is
      supplied) with source labels and cache. (P2)
- [ ] **Title metadata enrichment** — native/English/romaji switching, broadcast time in
      the viewer's timezone, streaming availability. (P2)

## Technical debt and quality

- [ ] Unit tests for countdown formatting, list filtering, score conversion and route
      parsing (no DOM required).
- [ ] Harness scenarios for every injected block: mount, re-mount after Vue re-render,
      route cleanup, signed-out state, error state.
- [ ] Central request layer: timeout, retry with backoff for 429/5xx, request dedupe and
      cache invalidation hooks for mutations.
- [ ] Session robustness: refresh the CSRF token proactively, detect 401 and clear the
      viewer cache, never cache another account's entries.
- [ ] DOM resilience: avoid depending on scoped Vue hashes; keep selector fallbacks and
      never throw when an anchor disappears.
- [ ] Performance: avoid full grid re-renders on quick-action changes, lazy-load covers,
      cap large lists and measure first-paint cost on studio/home pages.
- [ ] Accessibility audit across all blocks (contrast, focus order, screen-reader labels).
- [ ] Settings export/import and migration when keys change (keep `alx:` prefixes stable).
- [ ] Privacy doc: what is requested from AniList/AnimeThemes/MAL, what stays local,
      why no analytics.
- [ ] CI: typecheck, build all targets, run harness smoke tests, enforce a bundle budget.
- [ ] Browser matrix: old Chromium/Firefox forks for MV2, current Chrome for MV3,
      Tampermonkey/Violentmonkey for the userscript.

## Research questions

- Does AniList's site session ever filter adult entries for `/graphql` requests, or is it
  purely a client-side setting? Our queries do not filter `isAdult`.
- How stable are AnimeThemes video URLs and does the API expose community votes?
- Jikan/MAL rate limits and CORS behavior from an `anilist.co` content script.
- Can `.ics` exports and notifications be done without extra permissions on all targets?
- What is a safe cache TTL for list mutations so the native UI does not show stale data?

## Parked / not planned

- Backend service, accounts, telemetry or analytics.
- Bypassing AniList's adult-content settings or private-list visibility.
- Streaming-site integrations, automatic playback tracking (MAL-Sync territory).
- Reading or modifying data outside the signed-in user's own session.

## Prior art links

- AniList-Extras — <https://github.com/pilar6195/AniList-Extras>
- Anilist+ for Anilist — <https://chromewebstore.google.com/detail/anilist+-for-anilist/elpfbellmnhbenkcdofdbdkneppoekhl>
- AL Search — <https://anilist.co/forum/thread/11987>
- AniList:RE — <https://greasyfork.org/en/scripts/by-site/anilist.co>
- AniList Activity-Feed Filter — <https://greasyfork.org/en/scripts/475234-anilist-activity-feed-filter>
- AniTogether — <https://anilist.co/forum/thread/9179>

## Definition of done for a feature

1. Works on anilist.co in MV2, MV3 and the userscript build.
2. Has a settings toggle when it injects UI or changes the page meaningfully.
3. Handles signed-out, empty, error and route-change states.
4. Keyboard accessible, themed for light/dark, no console errors.
5. Covered by a harness scenario; typecheck and all builds pass.
6. Documented in README/changelog; no new host permissions without a privacy note.
