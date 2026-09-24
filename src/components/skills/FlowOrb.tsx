'use client'

import { useEffect, useRef } from 'react'
import { seedOf } from './hues'
import styles from './skills.module.css'

/**
 * The picture of a flow: the onboarding's particle sphere (JourneyOrb), in the
 * flow's colour. A flow is something that runs, so it turns; knowledge and
 * analyses are information and show as a folder instead. `lively` spins it
 * faster, for the flow's own page.
 *
 * rAF runs only while the orb is on screen and the tab is visible; reduced
 * motion draws one still frame.
 */
const N = 220

function buildSphere(seed: number) {
  const pts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const th = i * 2.39996323 + seed
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r })
  }
  return pts
}

export function FlowOrb({ hue, size = 64, seedKey, lively = false }: { hue: number; size?: number; seedKey: string; lively?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seed = seedOf(seedKey)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const pts = buildSphere(seed)
    const speed = lively ? 0.6 : 0.35
    let t = seed
    let last = 0
    let raf = 0
    let visible = true

    function draw() {
      const color = getComputedStyle(canvas!).color
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx!.fillStyle = color
      const R = (size / 2 - 2) * dpr
      const c = (size / 2) * dpr
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      for (const pt of pts) {
        const rx = pt.x * cosT + pt.z * sinT
        const rz = -pt.x * sinT + pt.z * cosT
        const depth = (rz + 1) / 2
        ctx!.globalAlpha = 0.2 + 0.75 * depth
        ctx!.beginPath()
        ctx!.arc(c + rx * R * 0.92, c + pt.y * R * 0.92, (0.55 + 0.75 * depth) * dpr * (size / 56), 0, 6.2832)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }
    function frame(now: number) {
      t += Math.min((now - last) / 1000, 0.05) * speed
      last = now
      draw()
      raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0
    }
    function start() {
      if (reduced) { draw(); return }
      if (raf || !visible || document.hidden) return
      raf = requestAnimationFrame((now) => { last = now; raf = requestAnimationFrame(frame) })
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start() })
    observer.observe(canvas)
    const onVisibility = () => { if (!document.hidden) start() }
    document.addEventListener('visibilitychange', onVisibility)
    draw()
    start()
    return () => {
      cancelAnimationFrame(raf)
      raf = 0
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [size, seed, lively])

  return (
    <span className={styles.orb} style={{ width: size, height: size, color: `hsl(${hue} 62% 46%)` }} aria-hidden>
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
    </span>
  )
}
