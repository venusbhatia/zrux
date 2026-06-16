# Phase 6 Trade-offs

Running log of the trade-offs, shortcuts, and deliberate scope cuts made while
building Phase 6 (the pixel-faithful UI). Each entry: what was decided, the
alternative not taken, and why. Companion to `trade-offs.md` (whole-system) and
`spec.md` §2 (Phase 6 definition).

---

## Styling: Tailwind v3, not v4
- **Decision:** Add Tailwind CSS v3.4 + PostCSS + Autoprefixer.
- **Alternative:** Tailwind v4 (new Oxide engine, CSS-first config).
- **Why:** v4 changes the config/build story (no `tailwind.config.ts`, `@theme`
  in CSS) and is newer; on a deadline build the mature v3 plugin path is lower
  risk and every example/snippet matches it. Production swap to v4 is mechanical.

## Styling: design tokens in tailwind.config + legacy CSS vars kept
- **Decision:** Encode the mockup tokens in `tailwind.config.ts` `theme.extend`,
  but KEEP the four `:root` CSS vars (`--accent` etc.) in `globals.css`.
- **Alternative:** Delete the CSS vars and migrate everything at once.
- **Why:** The legacy inline-styled `app/ask/page.tsx` references `var(--accent)` /
  `var(--muted)`. Keeping the vars lets that page keep working until it is rebuilt
  in step 6, so typecheck/boot stay green throughout the migration. The vars are
  removed (or left as harmless aliases) once nothing references them.

## Landing scroll-scrub animation: deferred
- **Decision (planned):** Port the landing's CSS-only motion (glow drift, waveform
  pulse, hover, reduced-motion) and the IntersectionObserver `.reveal` fade-in, but
  render the `#assemble` "fragments converge" section in its assembled state with a
  simple reveal instead of the scroll-scrubbed `requestAnimationFrame` animation.
- **Alternative:** Port the full scroll-scrub assembly effect.
- **Why:** The scrub is the most code and the most fragile (manual scroll math),
  and it is polish, not core. The layout, copy, and visual payload are preserved;
  the scrub can be added last only if time remains.

## Landing CSS: global `.lp`-scoped stylesheet, not a CSS module
- **Decision:** Port the landing CSS into a plain `app/(marketing)/landing.css`
  with every rule scoped under a single `.lp` root class, rather than a CSS
  module with hashed names.
- **Alternative:** A CSS module (`landing.module.css`).
- **Why:** The reveal motion island observes elements by the literal `.reveal`
  class via `IntersectionObserver`. Hashed module names would break that selector
  without wrapping every revealed node in a component. The `.lp` prefix keeps the
  semantic class names from leaking into the Tailwind-styled app (the two route
  groups never render together anyway).

## Landing assembly: static, not scroll-scrubbed (as planned)
- **Decision:** The `#assemble` section renders the five source fragments and the
  assembled brief as static reveal-animated cards.
- **Alternative:** The prototype's 260vh sticky scroll-scrub that converges the
  fragments into the brief on scroll.
- **Why:** The scrub is fragile manual scroll math and pure polish. The narrative
  and visual payload are preserved without the risk. Documented as a later add.

## Today badge: sessionStorage handoff, not a count endpoint
- **Decision:** The sidebar Today badge reads `zrux:today-count` from
  sessionStorage, written by the Today page after it loads `/api/today`.
- **Alternative:** A dedicated `/api/today?countOnly=1` the sidebar calls itself.
- **Why:** `/api/today` runs a full retrieval + an LLM call. Having the sidebar
  trigger its own count would double that cost on every navigation. The badge is
  best-effort and updates as soon as the user opens Today.

## Search: matchPercent is normalized, planning runs per settled query
- **Decision:** `matchPercent` is `round(score / topScore * 100)` clamped to
  `[40, 99]` (hybrid RRF scores are not a 0-100 scale). The planner LLM call runs
  once per debounced (350ms) settled query, not per keystroke, with an
  AbortController cancelling in-flight requests.
- **Alternative:** Surface raw scores; or skip planning and embed the raw query.
- **Why:** Normalization makes the leader read high and the tail readable like the
  mock. Reusing `planQuery` keeps keyword/semantic extraction quality; debounce +
  abort keeps the per-keystroke LLM cost bounded.

## Relationships: deterministic radial layout, capped at 24 nodes, no d3-force
- **Decision:** Hand-rolled radial layout (focal = highest-degree node centered,
  neighbors on rings), capped at 24 visible nodes by degree with a "+N more"
  count, rendered as SVG. Detail-panel "recent signals" and "last touch" are
  derived from the edges already returned by `/api/graph` (no per-entity fetch).
- **Alternative:** `d3-force` physics layout; a dedicated signals endpoint.
- **Why:** Real founder graphs are messy; a cap + deterministic layout stays
  readable and stable between renders (no jitter), with zero new dependency.
  Deriving signals from edges avoids an extra round-trip and keeps the panel
  honest to the graph data.

## Onboarding unlock: connection itemCount, not just OAuth status
- **Decision:** `/api/connections` returns a per-source `itemCount` (cheap
  head-count) and `lastSyncedAt`; onboarding unlocks the app when any source has
  `itemCount > 0`. A "Skip for now" escape is always available.
- **Alternative:** Unlock on `status === 'active'` (OAuth finalized) alone.
- **Why:** `active` means the load was enqueued, not that data is queryable.
  Gating on real item counts makes "Ready" honest; the skip escape avoids trapping
  the user behind a slow ingest.

## Ask mic + voice input: visual affordance only
- **Decision:** The Ask composer renders the mic button but it is non-functional
  this phase (tooltip "Voice input coming soon").
- **Alternative:** Wire Deepgram streaming STT now.
- **Why:** Tap-to-talk is an explicit stretch (spec D12 / Phase 7). Keeping the
  affordance preserves the mockup without committing the streaming-STT surface.

## Discovered blocker (NOT Phase 6): `distinct_sources` DB function missing
- **Finding:** During verification, `/api/today` and `/api/answer` return 502 for
  broad intents (daily_briefing / company_summary / cross_source) because the
  retrieval path calls the `distinct_sources(p_user_id)` Postgres function, which
  is defined in `supabase/migrations/0005_distinct_sources.sql` but is NOT applied
  to the live Supabase instance ("Could not find the function public.distinct_sources
  in the schema cache").
- **Scope:** Pre-existing backend/migration-deployment debt, independent of Phase 6.
  It already broke the flagship demo question ("What should I focus on today?") on
  `/api/answer` before this phase. Non-broad questions (e.g. "Which tasks are
  blocked right now?") work end-to-end against real data.
- **Fix (owner action):** apply migration 0005 (e.g. `pnpm supabase db push`, or run
  that one `create or replace function` against the DB). The Today grounding fix and
  all Phase 6 UI are verified correct; once the function exists, Today and the daily
  briefing work. Not applied here: the auto-mode guard correctly blocked a live-DB
  migration as outside this UI task's authorized scope.

## Today grounding: model cites by `[n]`, server maps to the real citation
- **Decision:** The Today `generateObject` schema has the model reference CONTEXT
  items by their bracketed `[n]` number; the route maps `n` -> the real citation
  and backfills item_id/source/url.
- **Why:** The assembled CONTEXT block only exposes `[n]` markers, not item UUIDs,
  so an earlier "match on item_id" guard dropped every ref and produced empty
  briefings. Mapping by `n` is what the model can actually see, while keeping the
  guarantee that a card can never cite a source that was not retrieved.

## Authed-screen verification: via data endpoints, not headless screenshots
- **Decision:** The four app screens were verified by exercising their backing
  endpoints against the real canonical tenant (548 items) plus a build + typecheck;
  only the public landing was screenshotted.
- **Why:** `middleware.ts` gates the app routes behind a real Google session, which
  is not reproducible headless. The endpoints (`/api/connections`, `/api/search`,
  `/api/graph`, `/api/answer`, and the Today grounding path) return correct real
  data, which is the substantive proof the screens render.

## Dev verification: copy gitignored `.env.local` into the worktree
- **Decision:** For local build/dev verification, `.env.local` was copied from the
  main checkout into the worktree (it stays gitignored, never committed).
- **Why:** Several modules instantiate API clients at import time, so `next build`
  and `next dev` require the env to be present even to collect page data. The fresh
  worktree does not inherit gitignored files. Not a code change; verification only.


---

# Rework (post-review) — supersedes the deferral/blocker entries above

## Landing scroll-scrub: RESTORED (supersedes "deferred" / "static" entries)
- **Change:** The `#assemble` section is now the faithful 260vh sticky scroll-scrub
  from the mockup. Five source fragments start scattered (per-fragment
  `data-x/data-y/data-r` vw/vh/deg offsets), and converge, scale to 0.72, rotate to
  0, and fade out into the assembled brief (which fades + scales 0.92 -> 1) as the
  stage scrolls. The `layout()` math is ported verbatim into
  `components/marketing/LandingMotion.tsx` (rAF-throttled, reduced-motion aware).
- **Why:** The earlier static flex grid was the root of the "scattered / animations
  not sitting right" feedback. This restores the signature effect.

## Landing: `overflow-x: clip` instead of `hidden` (sticky-breaking bug fixed)
- **Bug:** `.lp { overflow-x: hidden }` turns `.lp` into a scroll container, which
  silently breaks `position: sticky` on the scroll-scrub stage inside it (the sticky
  element measured `top: -380` instead of pinning at 0 — header vanished, fragments
  sat high).
- **Fix:** `overflow-x: clip` clips the hero glow + fragment vw offsets WITHOUT
  creating a scroll container, so sticky pins correctly. Verified the stage pins at
  `top: 0` and fragments converge into the brief mid-scroll.

## distinct_sources: RESOLVED IN CODE (supersedes the "discovered blocker" entry)
- **Change:** `lib/retrieval/search.ts#userSources()` now wraps the
  `distinct_sources` RPC and falls back to a client-side distinct over
  `context_item` when the function is absent (migration 0005 not applied), logging a
  one-line warning. Broad-intent retrieval (daily_briefing / company_summary /
  cross_source) and therefore `/api/today` and broad `/api/answer` now return 200
  regardless of migration state. Verified: `/api/today` returns grounded cards.
- **Note:** Applying migration 0005 still gives the indexed fast-path; the fallback
  only removes the hard dependency.

## Search abort/loading race: FIXED (Greptile P1)
- **Change:** In `app/(app)/search/page.tsx` the `finally` now guards
  `if (!controller.signal.aborted) setLoading(false)`, so a request superseded by a
  newer keystroke no longer flashes the spinner off while the replacement fetch is
  still running. Added a visible error state (the previous silent empty-on-failure
  was a shortcut).

## Other cleanup this pass
- Re-added `:focus-visible` (landing) and `scroll-behavior: smooth`
  (`app/globals.css`, with a reduced-motion override) that the first pass dropped.
- Waveform now uses the mockup's exact organic delay sequence
  `[0,.1,.2,.3,.15,.25,.05,.35,.2,.1]` instead of a repeating 4-bar pattern.
- Reveal hydration guard: `<noscript>` fallback in `app/(marketing)/layout.tsx`
  forces reveals visible and the brief assembled if JS never runs (content is never
  permanently hidden).
- Ask: added an animated typing indicator + streaming caret beyond the static
  "Thinking..." so a slow first token reads as active.

## Still a documented limitation (acceptable)
- **Today badge** remains a sessionStorage handoff from the Today page to the
  sidebar: it avoids a second (LLM-backed) retrieval just to count cards, but it is
  tab-local and only refreshes after the Today screen loads. Fixing cross-tab
  freshness would need a shared store or a cheap count endpoint; deferred as low
  value versus its cost.
- **Sidebar source dots** poll `/api/connections` and fail quietly (keep last
  state) by design: a transient poll error should not flash an error in the chrome.
