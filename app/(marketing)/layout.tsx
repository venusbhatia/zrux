// Marketing shell: just the landing stylesheet, no app chrome. The root layout
// already provides <html>/<body> + the session provider. The <noscript> fallback
// guarantees content is never permanently hidden: if JS never runs, reveals show
// and the assembled brief replaces the (otherwise JS-driven) scattered fragments.

import './landing.css'

const NO_JS_FALLBACK = `
.lp .reveal { opacity: 1 !important; transform: none !important; }
.lp .frag { opacity: 0 !important; }
.lp .brief-float { opacity: 1 !important; transform: translate(-50%, -50%) scale(1) !important; }
`

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: NO_JS_FALLBACK }} />
      </noscript>
      {children}
    </>
  )
}
