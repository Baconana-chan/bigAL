# bigAL

A small, no-backend browser extension and userscript that fills in the gaps of
[AniList](https://anilist.co): richer studio pages, a site-wide profile accent, OP/ED
themes, quick list actions, friends' progress comparison and home rails for upcoming
premieres and backlog picks.

bigAL is built as one TypeScript core and ships three ways: Manifest V2, Manifest V3 and
a userscript. There is no account, server or analytics component.

> Status: `0.1.0`, early but usable. Not affiliated with AniList or AnimeThemes.

## Features

### Enhanced studio pages

AniList's studio page stops at the newest 25 titles. bigAL replaces it with the full
filmography from the GraphQL API:

- pagination across every work, not just the first page;
- filters for format, airing status, role and free-text search;
- main vs supporting credits, with a badge on each cover and a role filter with counts;
- a colour-coded list marker on works you already track (watching, planning, completed,
  rewatching, paused, dropped), matching AniList's status colours;
- summary stats: favourites, works loaded, year range, average score, top-rated title;
- a toggle back to AniList's native view.

### Studio DNA

Between the summary and the grid, the enhanced studio page shows the people who keep
coming back across the studio's most popular works:

- recurring series/film directors with the credits they hold on the sample, plus the
  composers whose music carries the filmography;
- recurring Japanese lead voice actors, read from the main characters of the sample;
- every person links to their staff page, with an avatar and an `8×` count of how many
  sampled works they worked on; hovering shows the full credit list;
- the sample is the studio's 25 most popular own works (adult titles and titles where the
  studio is only a supporting credit are skipped), fetched as one batched staff request
  plus one cast request per title;
- cast is only requested for a signed-in visitor: AniList returns `voiceActors` as null to
  anonymous calls, so a signed-out visitor pays nothing for it and simply sees directors
  and composers;
- nothing recurring hides the panel instead of showing an empty one, and the whole block
  has its own settings toggle;
- cached for 30 minutes per studio.

### Global profile accent

AniList lets you pick a profile color, but only paints your profile with it. bigAL
applies the same palette across the site, follows light/dark theme changes and can detect
the color from your username automatically (or from a color you choose manually).

### Openings & Endings

Title pages get an OP/ED block powered by [AnimeThemes](https://animethemes.moe), placed
under the trailer in the main column:

- OP/ED tags, song titles and the episodes each theme covers;
- an inline video player, plus a direct link to the source video;
- spoiler themes are revealed on click; NSFW themes stay behind an explicit reveal.

### Studios on title pages

Under the OP/ED block, a title page lists its animation studios from the API, main studio
first:

- main and supporting credits are marked, and each studio name links to the enhanced
  studio page ("All works" opens the same page);
- up to five of the studio's most popular own works are shown as covers with score and
  year, excluding the title you are reading;
- licensors and TV stations that own no works are left out, so only real production
  credits get a row;
- results are cached per title and per studio for ten minutes.

### Friends' progress

Under the studio credits, a title page compares episode progress with the AniList
profiles you list in settings (up to six):

- one batched request covers you and every friend, so six people still cost a single
  round trip; results are cached for two minutes per title and friend set;
- each row shows avatar, list status in AniList's status colour, a progress bar and
  `watched / total`, plus how far ahead or behind you are;
- your own row is marked and comes first; friends who have not added the title are
  listed as `No entry` instead of being dropped;
- only episode counts, status and the last update time are shown, never episode titles;
- private profiles, typos and rate-limit hiccups degrade per row instead of blanking the
  block.

### Quick actions on studio cards

Hovering a work on an enhanced studio page shows the same kind of actions AniList's own
cards have:

- play the trailer (YouTube/Dailymotion);
- add to the list or change status (Watching, Planning, Completed, Rewatching, Paused,
  Dropped) and remove entries;
- edit status, score and episode progress in a compact popover;
- see the next episode's countdown.

These actions use your existing AniList site session. bigAL does not register an OAuth
client and never stores a token.

The popovers work from the keyboard: Tab stays inside an open popover, arrow keys and
Home/End move through the status menu, Escape closes and returns focus to the card
action, and results are announced through a polite live region. Motion respects
`prefers-reduced-motion`.

### Anime in Plans

A fourth block on the signed-in home page lists planning entries whose **first** episode
has not aired yet, sorted by premiere time with a live countdown. Titles that already
started airing (episode 2+) are intentionally left out. The block refreshes its counters
and removes cards once the premiere passes.

### Continue watching

A second home rail answers "what do I actually watch next": one card per current or
rewatching title, with the next **unwatched** episode rather than the next airing one.

- progress is compared with what has already aired, so a title with 80 episodes waiting
  says `80 behind` instead of presenting the upcoming episode as if it were next;
- caught-up titles show a live countdown (`5d 18h left`) to the next airing;
- finished and fully watched titles are left out, and the rail is ordered by how far
  behind you are, then by the nearest airing;
- when an episode airs while the page is open, the tick turns that card into `1 behind`
  without a reload;
- cached for two minutes per viewer and dropped by any list mutation.

### Next from your plans

A fifth home block answers "what should I finally start from that pile": planning
entries that AniList's community recommendations connect to titles you rated highly.

- seeds are the completed, watching and rewatching entries you scored well, sampled
  evenly across the whole set instead of taking the eight highest scores, so a mixed
  taste profile (a 10/10 slice-of-life next to a 10/10 action show) still gets a voice;
- every pick keeps its reason visible — `Like Shingeki no Kyojin` — and picks recommended
  by several of your favourites rise to the top (recommendation rating × your score);
- recommendation ratings are normalised inside each favourite, so a blockbuster does not
  outvote everything else, and each reason vouches for at most two cards — without that
  cap a single favourite filled five of six slots with shows it recommends;
- only titles already in your planning list are shown, so the block is a shortcut, not a
  second discovery feed;
- covers show the score and format, and nothing is injected when no planning entry is
  linked to your library;
- one list request plus at most two recommendation requests per load, with the list cached
  for five minutes and each seed's recommendations for thirty.

### Premiere calendar

The calendar is its own view, not another home block: `#alx/calendar` opens a full-screen
month grid over whatever page you are on, so it is deep-linkable, survives a reload and
closes with Escape or the browser's back button. The home page only gains a small
"Open calendar" link.

- one day cell per date, in your local time, with every scheduled episode of the titles
  you watch or rewatch plus planned premieres, marked in orange;
- counts per day make pile-ups obvious, and empty days stay visible so gaps are real;
- prev / Today / next month navigation, with the month kept in the URL
  (`#alx/calendar/2026-10`);
- **Export .ics** writes the visible month as a calendar file with a ten-minute reminder
  per episode, so premieres can live in your phone's calendar;
- data comes from one list request plus `airingSchedules` ranges (50 ids per request), and
  is cached for five minutes; list changes drop it.

Planned titles without a scheduled date have no episode to place and stay out of the
grid.

### Backlog triage

`#alx/triage` is a review view for the planning list — the same kind of overlay as the
calendar, opened from the settings dialog or by URL. One request reads every list status
plus two timestamps per entry, and one batched relations request supplies the links, so
nothing is guessed from title strings:

- **After a season you dropped** — a plan whose prequel (`PREQUEL` / `PARENT` relation) is
  in your dropped list; continuing a series you already abandoned is rarely intended;
- **Several seasons of one franchise** — planning entries joined by `PREQUEL`, `SEQUEL`,
  `PARENT`, `SIDE_STORY`, `SPIN_OFF` or `ALTERNATIVE` edges, collapsed with union-find and
  grouped by size, so three seasons of one show stop looking like three separate plans;
- **Untouched for 2+ years** — no status, score or progress change in all that time; the
  plan has become a bookmark.

Every entry appears in exactly one section, so the counts add up: the strongest signal
claims it, and the row still shows its other signals as chips (`2 from one franchise`,
`First season dropped`) next to `in plans since 2016 · idle 6 yrs`. Each section has a
select-all toggle; nothing is written until **Pause selected** or **Move to dropped**, which
reuse the same session mutation as the quick actions and report the outcome
(`Moved 4 titles to Dropped · 1 failed`).

After a bulk action the view re-reads the list instead of trusting its own snapshot,
because moving one title changes what the others mean: dropping a first season promotes
its sequels into the dropped-parent section without a reload. The list is cached for ten
minutes and dropped by any list mutation. Titles link to their page (which closes the
overlay), and Escape, the close button or the back button close it; keyboard focus stays
inside the dialog while it is open.

### Franchise tracker

Every title page of a franchise gains a small **Franchise** block: the next episode to
watch in release order and a link into `#alx/franchise/<id>`, a full tracker view. Both
are switched off with one setting, and a standalone title gets no block at all.

- the graph is walked from the open title through `PREQUEL`, `SEQUEL`, `PARENT`, `CHILD`,
  `SIDE_STORY`, `SPIN_OFF` and `ALTERNATIVE` relations (recaps are skipped), one batched
  aliased request per hop, at most 40 titles and 8 hops;
- **Main story** is the component reachable through `PREQUEL`/`SEQUEL` only, sorted by
  release date — so the seasons read in watch order instead of whatever order the graph
  was walked in;
- **Side stories & spin-offs** lists everything else with its link spelled out
  (`side story of …`, `alternative version of …`, `spin-off of …`);
- each row carries the list status chip (`Watching`, `Planning`, `Completed`, `Paused`,
  `Dropped`), progress (`10 / 24`), a thin progress bar, and the next unwatched row is
  highlighted in the list and repeated as a card (`Next unwatched`, or `Caught up` with a
  countdown when the next episode is still ahead);
- the next pick prefers something that is already out over a future airing, walks the main
  line before the side stories, and skips completed and dropped entries;
- one broken relation id used to blank a whole request (AniList nulls every alias when any
  id is missing), so a failed batch is bisected until the dead id is isolated; rate limits
  are not retried in a loop;
- cached for five minutes per title and viewer, dropped by any list mutation; signed-out
  visitors still get the watch order, without progress or a next-episode guess.

### Settings

The gear button in the bottom-left corner opens a small dialog where every injected block
can be switched off independently: enhanced studio pages, Studio DNA on studio pages,
quick list actions on studio covers, OP/ED on title pages (including automatic spoiler
reveal), the studio summary,
friends' progress and the franchise block on title pages, the home "Anime in Plans",
"Continue watching" and "Next from your plans" blocks and the global profile accent. The
same dialog holds the comma-separated list of
friends to compare with. Changes apply immediately, without a reload, and are stored
locally. The same dialog opens the premiere calendar and the backlog triage view.

## Install

There are no store releases yet, so build the extension locally first:

```bash
npm install
npm run build
```

The build writes everything to `dist/` (gitignored).

### Manifest V3 — Chrome, Edge, Brave, Vivaldi

1. Open `chrome://extensions` (or the equivalent page in your browser).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `dist/manifestv3` folder.
4. Open <https://anilist.co> and reload the tab.

Firefox 109+ can load the MV3 build through `about:debugging` as well; the MV2 build is
kept for older forks and engines that never adopted MV3.

### Manifest V2 — older Chromium forks and Firefox

Use `dist/manifestv2`.

- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on** and select `dist/manifestv2/manifest.json`. Temporary add-ons disappear after
  a restart; permanent installation requires signing through AMO.
- **Chromium-based browser that still supports MV2:** load `dist/manifestv2` as an
  unpacked extension the same way as above. Recent Chrome releases no longer load MV2
  extensions at all, which is why both builds exist.

### Userscript — Tampermonkey / Violentmonkey

1. Install a userscript manager.
2. Open `dist/bigAL.user.js` in the browser, or create a new script in the manager and
   paste the file contents.

The metadata matches `https://anilist.co/*` and requests no extra host permissions beyond
the APIs the extension already talks to.

After rebuilding, reload the extension in the browser (or refresh the tab for the
userscript) to pick up the new bundle.

## Development

Requirements: Node.js with npm. There are no runtime dependencies.

```bash
npm install        # esbuild + TypeScript
npm run watch      # rebuild dist/ on every change
npm run typecheck  # tsc --noEmit
npm run build      # one-off build of all three targets
npm run check      # typecheck + build
```

### Local harness

`builder/_serve.mjs` serves a small AniList-shaped page and mocks the signed-in endpoints,
so features can be exercised without touching a real account:

```bash
node builder/_serve.mjs 4173
```

Then open:

- `http://127.0.0.1:4173/studio/196` and `/studio/2` — enhanced studio page with Studio
  DNA (directors and composers come from the real API, the recurring cast from the mock
  `/graphql` so it works offline; `/__signout` drops the cast section entirely);
- `http://127.0.0.1:4173/anime/120377` — OP/ED block;
- `http://127.0.0.1:4173/anime/16498` — studio credits and friends' progress (set the
  friends list in the settings dialog first; `Viewer` and the list entries are mocked);
- `http://127.0.0.1:4173/home` — Anime in Plans, Continue watching and Next from your plans;
- `http://127.0.0.1:4173/home#alx/calendar` — premiere calendar (the month grid, range
  queries and .ics export run against the mock);
- `http://127.0.0.1:4173/home#alx/triage` — backlog triage (the mocked planning list has
  stale entries, two franchises and a sequel behind a dropped season; bulk actions write to
  the mock and the list is re-read afterwards);
- `http://127.0.0.1:4173/anime/16498` and `#alx/franchise/16498` — franchise block and
  tracker (mock: four Attack on Titan seasons with different list states plus two OVAs, so
  ordering, badges and the next unwatched episode are all exercised; other ids fall back to
  the real public API when signed out).

Studio, theme and recommendation data come from the real APIs; list mutations, the
viewer, the studio cast sample and the library used by backlog picks are served by the mock. `/__signout` and
`/__signin` switch the mocked auth state, `/__state` shows the mocked list entries, and
`/__viewer?name=Kiyon` makes the session claim a real profile (needed to exercise the
friends' deltas, which come from public data).

## Project structure

| Path | Purpose |
| --- | --- |
| `shared/` | Core logic: settings, router, DOM helpers, API clients, features, styles |
| `shared/api/` | AniList GraphQL, site-session requests and AnimeThemes |
| `shared/features/` | Studio pages (with Studio DNA), profile accent, OP/ED, studio credits, friends' progress, quick actions, home plans, continue watching, backlog picks, calendar, backlog triage, franchise tracker |
| `manifestv2/` | MV2 entry point and manifest |
| `manifestv3/` | MV3 entry point and manifest |
| `tempermonkey/` | Userscript entry point and metadata header |
| `builder/` | esbuild build script, local harness and mock server |
| `dist/` | Generated builds (gitignored) |
| `TODO.md` | Roadmap and feature research |

## How it works

- **One core, three bundles.** esbuild bundles `shared/` into an IIFE for each target and
  injects the userscript metadata header. Platform-specific storage and style injection
  live behind a small interface.
- **SPA-aware mounting.** AniList is a Vue app, so a lightweight router watches the
  pathname, mounts the matching feature and tears it down on navigation. Blocks re-attach
  themselves if Vue replaces their host node. The calendar uses a hash route instead:
  no free pathname exists, and a hash keeps the view deep-linkable without fighting the
  site's router.
- **Calendar files are generated locally.** The .ics export is built in the page from the
  schedule already on screen; nothing is uploaded anywhere.
- **Scoped styling.** Every injected rule uses the `alx-` prefix and AniList's CSS
  variables, so the extension follows light/dark themes and leaves native styles alone.
- **Session, not OAuth.** Public metadata comes from `graphql.anilist.co`. Signed-in
  actions use the site's own cookies plus the CSRF token rendered into AniList pages;
  the token is cached in memory and refreshed on `403`. bigAL never asks for your
  password, never registers an OAuth app and never sends your session anywhere.
- **Short-lived in-memory caches.** Planning lists (2 min), continue watching (2 min),
  per-title state (1 min), backlog picks and the calendar (5 min) and each seed's
  recommendations (30 min) live only for the page, so returning to a page is instant;
  concurrent callers share one request, and any list mutation drops the affected entries,
  so edits show up immediately.
- **No background worker, no server.** Everything runs in the page. Settings live in the
  extension's storage or the userscript manager's storage.

## Privacy

- Settings are stored locally.
- Network requests go only to `anilist.co` / `graphql.anilist.co` (AniList data and lists),
  `graphql.animethemes.moe` (OP/ED data), `v.animethemes.moe` (theme videos you choose
  to play) and AniList's image CDN.
- List mutations are sent only when you click a bigAL action. No telemetry or analytics.
- Adult content follows your AniList account settings; bigAL does not bypass them.
- The source in this repository is the complete extension; there is no remote code.

## Known limitations

- AniList's DOM is not a public API. Selectors can break when the site is redesigned; the
  code degrades quietly (an injection point missing means the block simply does not
  appear).
- Adult entries may be hidden by AniList itself depending on your account settings.
- AnimeThemes coverage is not universal; titles without themes get an empty state.
- Backlog picks depend on AniList's community recommendations; obscure favourites may
  link to nothing, and the block then stays off the page.
- List actions and your own friends' progress row require being signed in on anilist.co
  in the same browser; other people's rows need public lists.
- The MV2 build targets older engines; new Chrome releases will not load it.
- No mobile apps are supported.

## Roadmap and contributing

Feature plans, priorities and prior art are collected in [TODO.md](TODO.md). Before
sending a change:

1. run `npm run typecheck` and `npm run build`;
2. exercise the affected block in the harness, including navigation away and back;
3. keep injected CSS prefixed with `alx-` and gate injected UI behind a setting in the
   settings dialog;
4. avoid new host permissions unless they are strictly required, and document why.

## License

[MIT](LICENSE)
