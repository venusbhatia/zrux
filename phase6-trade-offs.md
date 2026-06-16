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

<!-- further entries appended as the build proceeds -->
