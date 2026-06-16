import type { Config } from 'tailwindcss'

// Design tokens lifted from the handoff mockups (Zrux App.dc.html / Zrux
// Landing.html). Every Phase 6 screen styles against these, so the token names
// are the single source of truth for color, radius, shadow, and layout metrics.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#0071e3', press: '#006edb' },
        ink: '#1d1d1f',
        muted: '#6e6e73',
        faint: '#86868b',
        hint: '#a1a1a6',
        bgalt: '#f5f5f7',
        hairline: { DEFAULT: '#e8e8ed', strong: '#d2d2d7', faint: '#f0f0f2' },
        success: '#34c759',
        // Entity / source accents (people blue, companies purple, projects green).
        person: '#0071e3',
        company: '#6b3fd4',
        project: '#1a7f37',
        warn: '#c2540a',
      },
      borderRadius: {
        card: '18px',
        input: '16px',
        pill: '980px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04), 0 18px 40px -32px rgba(0,0,0,.22)',
        flat: '0 1px 2px rgba(0,0,0,.04)',
        ring: '0 0 0 3px rgba(0,113,227,.10)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      spacing: {
        sidebar: '252px',
        topbar: '68px',
      },
      maxWidth: {
        today: '760px',
        ask: '780px',
        search: '820px',
      },
    },
  },
  plugins: [],
}

export default config
