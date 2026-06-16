// Landing (public). Ported from Zrux Landing.html, scoped under .lp. Signed-in
// visitors are redirected to the app. CTAs open /today. Motion is handled by the
// LandingMotion client island; the scroll-scrub assembly is rendered statically.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { LandingMotion } from '@/components/marketing/LandingMotion'

const MailIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.5 6.5L12 13l8.5-6.5" stroke="currentColor" strokeWidth="1.7" />
  </svg>
)
const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const ChatIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M21 11.5a8.5 8.5 0 01-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1121 11.5z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
)
const CalendarIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M4 9h16M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)
const NotionIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M4 4h16v13H7l-3 3V4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
)
const GithubIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M9 18l-5-6 5-6M15 6l5 6-5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const VoiceIcon = (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3v9m0 0a3 3 0 003-3V6a3 3 0 00-6 0v3a3 3 0 003 3zm-7 0a7 7 0 0014 0M12 18v3"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
)
const Chevron = (
  <svg width="9" height="14" viewBox="0 0 9 14" fill="none">
    <path d="M1.5 1l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default async function LandingPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.id) redirect('/today')

  return (
    <div className="lp" id="top">
      <LandingMotion />

      <nav className="nav" id="lp-nav">
        <div className="nav-inner">
          <a className="wordmark" href="#top">
            zrux
          </a>
          <div className="nav-links">
            <a href="#assemble">Overview</a>
            <a href="#connect">How it works</a>
            <a href="#privacy">Privacy</a>
          </div>
          <Link className="nav-cta" href="/today">
            Open the app
          </Link>
        </div>
      </nav>

      <main>
        {/* hero */}
        <header className="hero section">
          <div className="hero-glow" />
          <div className="wrap">
            <p className="eyebrow reveal">Meet zrux</p>
            <h1 className="reveal d1">The brief that reads everything for you.</h1>
            <p className="lead reveal d2">
              Email, calendar, Linear, Slack, docs, and meetings, pulled together overnight. Every
              morning you get one short brief on what actually needs you. Nothing buried. Nothing
              missed.
            </p>
            <div className="link-row reveal d3">
              <a className="clink" href="#assemble">
                See how it works {Chevron}
              </a>
              <a className="clink" href="#ask">
                Ask it anything {Chevron}
              </a>
            </div>
          </div>

          <div className="hero-visual reveal d4">
            <div className="brief-card">
              <div className="brief-top">
                <span className="brief-title">Today</span>
                <span className="brief-date">Monday morning</span>
              </div>
              <p className="brief-kicker">Five things worth your attention.</p>
              <div className="brief-item">
                <span className="dot">{MailIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">
                    Aria Capital sent the term sheet two days ago and asked for your cap table. They
                    are waiting.
                  </div>
                  <span className="tag">Investor</span>
                </div>
              </div>
              <div className="brief-item">
                <span className="dot">{CheckIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">
                    ENG-412 is blocking the launch. Raj flagged it in standup this morning.
                  </div>
                  <span className="tag warn">Blocker</span>
                </div>
              </div>
              <div className="brief-item">
                <span className="dot">{ChatIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">
                    Three customers hit the same export bug this week. It is trending up.
                  </div>
                  <span className="tag">Signal</span>
                </div>
              </div>
              <div className="brief-item">
                <span className="dot">{NotionIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">
                    You told Dana you would send the deck before Thursday. It is still in drafts.
                  </div>
                  <span className="tag calm">Follow-up</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* assemble: 260vh sticky scroll-scrub, driven by LandingMotion */}
        <section className="stage" id="assemble">
          <div className="stage-sticky">
            <div className="stage-head">
              <h2 className="reveal">Scattered context, assembled by morning.</h2>
              <p className="sub reveal d1">
                zrux reads each source as it changes, keeps a living memory of your company, and
                writes it all down to one place you can trust.
              </p>
            </div>
            <div className="stage-canvas">
              {[
                { icon: MailIcon, label: 'Email', text: 'Term sheet from Aria Capital. They asked for the cap table.', x: -32, y: -12, r: -7 },
                { icon: CheckIcon, label: 'Linear', text: 'ENG-412 marked as blocking the launch by Raj.', x: 30, y: -16, r: 6 },
                { icon: ChatIcon, label: 'Slack', text: 'Customer in #support hit the export bug again.', x: -34, y: 18, r: 5 },
                { icon: CalendarIcon, label: 'Calendar', text: 'Board meeting Thursday. Deck not sent yet.', x: 33, y: 16, r: -6 },
                { icon: VoiceIcon, label: 'Voice memo', text: 'Follow up with the design contractor on onboarding.', x: 0, y: -26, r: -3 },
              ].map((f) => (
                <article className="frag" key={f.label} data-x={f.x} data-y={f.y} data-r={f.r}>
                  <div className="fh">
                    {f.icon}
                    <span>{f.label}</span>
                  </div>
                  <p>{f.text}</p>
                </article>
              ))}
              <div className="brief-float" id="briefFloat">
                <div className="brief-card">
              <div className="brief-top">
                <span className="brief-title">Today</span>
                <span className="brief-date">Monday morning</span>
              </div>
              <p className="brief-kicker">Read overnight. Ranked for you.</p>
              <div className="brief-item">
                <span className="dot">{MailIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">Reply to Aria Capital with the cap table.</div>
                  <span className="tag">Investor</span>
                </div>
              </div>
              <div className="brief-item">
                <span className="dot">{CheckIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">Unblock ENG-412 before the launch slips.</div>
                  <span className="tag warn">Blocker</span>
                </div>
              </div>
              <div className="brief-item">
                <span className="dot">{ChatIcon}</span>
                <div className="bi-body">
                  <div className="bi-text">The export bug is now three customers. Worth a look.</div>
                  <span className="tag">Signal</span>
                </div>
              </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* connect */}
        <section className="section center" id="connect">
          <div className="wrap">
            <p className="eyebrow reveal">One memory</p>
            <h2 className="reveal d1">Everything you track, in one place.</h2>
            <p className="sub reveal d2">
              Connect the tools you already use. zrux keeps reading them so you do not have to check
              six tabs to know where things stand.
            </p>
          </div>
          <div className="tile-visual reveal d2">
            <div className="chips">
              <span className="chip">{MailIcon}Mail</span>
              <span className="chip">{CalendarIcon}Calendar</span>
              <span className="chip">{CheckIcon}Linear</span>
              <span className="chip">{ChatIcon}Slack</span>
              <span className="chip">{NotionIcon}Notion</span>
              <span className="chip">{GithubIcon}GitHub</span>
              <span className="chip">{VoiceIcon}Voice</span>
            </div>
          </div>
        </section>

        {/* ask */}
        <section className="section center" id="ask" style={{ background: 'var(--lp-bg-alt)' }}>
          <div className="wrap">
            <p className="eyebrow reveal">Grounded answers</p>
            <h2 className="reveal d1">Ask anything. Get the real answer.</h2>
            <p className="sub reveal d2">
              Every answer comes from your own context and points back to where it came from. If zrux
              is not sure, it says so instead of guessing.
            </p>
          </div>
          <div className="tile-visual reveal d2">
            <div className="panel">
              <div className="ask">What should I focus on before the board meeting?</div>
              <div className="answer">
                Three things stand out. Aria Capital is still waiting on the cap table you promised.
                ENG-412 is blocking the launch you plan to announce. And the export bug now affects
                three customers, so expect it to come up.
                <div className="cites">
                  <span className="cite">Mail, 2 days ago</span>
                  <span className="cite">Linear, ENG-412</span>
                  <span className="cite">Slack, #support</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* two-up: graph + voice */}
        <section className="section" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div className="grid-2">
            <div className="cell reveal">
              <h3>See who connects you to who.</h3>
              <p className="sub">
                zrux maps the people, companies, and projects across your tools, so a name always
                comes with context.
              </p>
              <div className="cell-visual">
                <svg className="graph" viewBox="0 0 340 200">
                  <line className="edge" x1="170" y1="100" x2="78" y2="52" />
                  <line className="edge" x1="170" y1="100" x2="262" y2="56" />
                  <line className="edge" x1="170" y1="100" x2="80" y2="150" />
                  <line className="edge" x1="170" y1="100" x2="258" y2="148" />
                  <text className="edge-label" x="108" y="70">
                    intro
                  </text>
                  <text className="edge-label" x="205" y="74">
                    invested
                  </text>
                  <text className="edge-label" x="106" y="140">
                    works with
                  </text>
                  <g className="node me">
                    <circle cx="170" cy="100" r="30" />
                    <text x="170" y="104" textAnchor="middle">
                      You
                    </text>
                  </g>
                  <g className="node">
                    <circle cx="78" cy="52" r="24" />
                    <text x="78" y="56" textAnchor="middle">
                      Raj
                    </text>
                  </g>
                  <g className="node">
                    <circle cx="262" cy="56" r="26" />
                    <text x="262" y="60" textAnchor="middle">
                      Aria
                    </text>
                  </g>
                  <g className="node">
                    <circle cx="80" cy="150" r="24" />
                    <text x="80" y="154" textAnchor="middle">
                      Dana
                    </text>
                  </g>
                  <g className="node">
                    <circle cx="258" cy="148" r="24" />
                    <text x="258" y="152" textAnchor="middle">
                      ACME
                    </text>
                  </g>
                </svg>
              </div>
            </div>

            <div className="cell reveal d1">
              <h3>Say it, and it is in.</h3>
              <p className="sub">
                Talk through a thought between meetings. zrux captures it, cleans it up, and files it
                with everything else.
              </p>
              <div className="cell-visual">
                <div className="wave" aria-hidden="true">
                  {[
                    [40, 0],
                    [54, 0.1],
                    [30, 0.2],
                    [48, 0.3],
                    [22, 0.15],
                    [46, 0.25],
                    [34, 0.05],
                    [52, 0.35],
                    [26, 0.2],
                    [44, 0.1],
                  ].map(([h, d], i) => (
                    <i key={i} style={{ height: h, animationDelay: `${d}s` }} />
                  ))}
                </div>
                <div className="voice-note">
                  <div className="voice-meta">Voice memo, 0:14</div>
                  Follow up with the design contractor about the onboarding flow before we ship.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* personalization */}
        <section className="section center">
          <div className="wrap">
            <p className="eyebrow reveal">Tuned to you</p>
            <h2 className="reveal d1">It learns what you care about.</h2>
            <p className="sub reveal d2">
              zrux notices what you act on and what you skip, so the brief starts to sound like it
              was written by someone who knows the company as well as you do.
            </p>
          </div>
        </section>

        {/* statement */}
        <section className="section statement">
          <div className="wrap">
            <h2 className="reveal">
              Less noise. <span className="accent">More judgment.</span>
            </h2>
          </div>
        </section>

        {/* privacy */}
        <section className="section center" id="privacy" style={{ background: 'var(--lp-bg-alt)' }}>
          <div className="wrap">
            <p className="eyebrow reveal">Yours alone</p>
            <h2 className="reveal d1">Your data stays your data.</h2>
            <p className="sub reveal d2">
              zrux reads your tools to answer your questions. It does not train on your data and it
              does not share it. Read access stays read access, and nothing acts on your behalf
              without you.
            </p>
          </div>
        </section>

        {/* final cta */}
        <section className="section cta-final" id="start">
          <div className="wrap">
            <p className="eyebrow reveal">Start tomorrow morning</p>
            <h2 className="reveal d1">Wake up already caught up.</h2>
            <div className="cta-actions reveal d2">
              <Link className="btn" href="/today">
                Open the app
              </Link>
              <a className="btn ghost" href="#assemble">
                See how it works
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="foot-wrap">
          <div className="foot-note">
            <p>
              zrux connects to third party tools using read access that you grant and can revoke at
              any time. Source names shown above refer to the tools you choose to connect and are
              used only to describe those integrations.
            </p>
            <p>
              Demonstration content on this page is illustrative. Names, messages, and figures shown
              in the brief are examples, not real customer data.
            </p>
          </div>
          <div className="foot-cols">
            <div>
              <h4>Product</h4>
              <a href="#assemble">Overview</a>
              <a href="#connect">Integrations</a>
              <a href="#ask">Answers</a>
              <a href="#privacy">Privacy</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="#top">About</a>
              <a href="#top">Careers</a>
              <a href="#top">Blog</a>
              <a href="#top">Contact</a>
            </div>
            <div>
              <h4>Developers</h4>
              <a href="#top">Documentation</a>
              <a href="#top">API</a>
              <a href="#top">Status</a>
              <a href="#top">Changelog</a>
            </div>
            <div>
              <h4>Get started</h4>
              <a href="#start">Create account</a>
              <a href="#top">Pricing</a>
              <a href="#top">Security</a>
              <a href="#top">Support</a>
            </div>
          </div>
          <div className="foot-bottom">
            <span>Copyright 2026 zrux. All rights reserved.</span>
            <span>Terms of Use · Privacy Policy · Sales and Refunds</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
