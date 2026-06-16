// Marketing shell: just the landing stylesheet, no app chrome. The root layout
// already provides <html>/<body> + the session provider.

import './landing.css'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children
}
