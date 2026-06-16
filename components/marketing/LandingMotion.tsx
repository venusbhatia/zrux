'use client'

// Landing motion island. Three jobs, all matching the original mockup:
//  1. toggle the nav hairline on scroll,
//  2. reveal .reveal elements as they enter the viewport,
//  3. drive the #assemble scroll-scrub: five scattered fragments converge,
//     shrink, rotate, and fade into the assembled brief as the 260vh stage
//     scrolls past (the layout() math is ported from Zrux Landing.html).
// Honors prefers-reduced-motion. Renders nothing.

import { useEffect } from 'react'

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function LandingMotion() {
  useEffect(() => {
    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // 1. nav hairline
    const nav = document.getElementById('lp-nav')
    const navState = () => nav?.classList.toggle('scrolled', window.scrollY > 8)
    navState()
    window.addEventListener('scroll', navState, { passive: true })

    // 2. reveal on enter
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

    // 3. signature assembly scroll-scrub
    const stage = document.getElementById('assemble')
    const frags = Array.from(document.querySelectorAll<HTMLElement>('.lp .frag'))
    const brief = document.getElementById('briefFloat')

    function layout() {
      if (!stage || !brief) return
      if (reduce) {
        frags.forEach((f) => {
          f.style.opacity = '0'
        })
        brief.style.opacity = '1'
        brief.style.transform = 'translate(-50%,-50%) scale(1)'
        return
      }
      const rect = stage.getBoundingClientRect()
      const total = rect.height - window.innerHeight
      const p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0

      const conv = easeOut(clamp(p / 0.68, 0, 1))
      frags.forEach((f) => {
        const sx = parseFloat(f.dataset.x ?? '0')
        const sy = parseFloat(f.dataset.y ?? '0')
        const sr = parseFloat(f.dataset.r ?? '0')
        const x = sx * (1 - conv)
        const y = sy * (1 - conv)
        const s = 1 - 0.28 * conv
        const rot = sr * (1 - conv)
        const fade = 1 - clamp((p - 0.42) / 0.26, 0, 1)
        f.style.transform = `translate(calc(-50% + ${x}vw), calc(-50% + ${y}vh)) scale(${s}) rotate(${rot}deg)`
        f.style.opacity = String(fade)
      })

      const bp = clamp((p - 0.36) / 0.4, 0, 1)
      brief.style.opacity = String(bp)
      brief.style.transform = `translate(-50%,-50%) scale(${0.92 + 0.08 * easeOut(bp)})`
    }

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        layout()
        ticking = false
      })
    }
    layout()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', layout)

    return () => {
      window.removeEventListener('scroll', navState)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', layout)
      io?.disconnect()
    }
  }, [])

  return null
}
