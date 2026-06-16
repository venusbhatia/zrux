'use client'

// Landing motion island: toggles the nav hairline on scroll and reveals .reveal
// elements as they enter the viewport (IntersectionObserver). Honors
// prefers-reduced-motion by revealing everything immediately. Renders nothing.

import { useEffect } from 'react'

export function LandingMotion() {
  useEffect(() => {
    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const nav = document.getElementById('lp-nav')
    const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    const reveals = Array.from(document.querySelectorAll('.lp .reveal'))
    let io: IntersectionObserver | undefined
    if (reduce || !('IntersectionObserver' in window)) {
      reveals.forEach((el) => el.classList.add('in'))
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in')
              io?.unobserve(e.target)
            }
          })
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      )
      reveals.forEach((el) => io!.observe(el))
    }

    return () => {
      window.removeEventListener('scroll', onScroll)
      io?.disconnect()
    }
  }, [])

  return null
}
