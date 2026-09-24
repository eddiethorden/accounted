'use client'

import { useEffect, useRef } from 'react'
import styles from './skills.module.css'

/** How an agent is doing right now: ready, has work waiting, blocked on a connection, or waiting for the user's AI. */
export type Presence = 'ready' | 'busy' | 'blocked' | 'idle'

/**
 * The agent's picture: the onboarding's particle sphere (JourneyOrb), small
 * and in place. Its motion says how the agent is doing: a slow turn when
 * ready, a lively churn when work waits, a held breath when blocked, almost
 * still while it waits for the user's AI. Drawn in the text colour, so it
 * follows the theme.
 *
 * rAF runs only while the sphere is on screen and the tab is visible;
 * reduced motion draws one still frame.
 */
const N = 220

/** A stable number from a string, so every agent's sphere turns its own way every visit. */
export function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) % 10000
}

function buildSphere(seed: number) {
  const pts: { x: number; y: number; z: number; ph: number }[] = []
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const th = i * 2.39996323 + seed
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, ph: ((i * 7919 + seed * 104729) % 628) / 100 })
  }
  return pts
}

function speedOf(p: Presence) {
  return p === 'busy' ? 1.6 : p === 'ready' ? 0.45 : p === 'blocked' ? 0.25 : 0.12
}

export function AgentSphere({ size = 56, presence = 'ready', seed = 0, label }: { size?: number; presence?: Presence; seed?: number; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const presenceRef = useRef(presence)
  useEffect(() => { presenceRef.current = presence }, [presence])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const pts = buildSphere(seed)
    let t = seed
    let last = 0
    let raf = 0
    let visible = true

    function draw() {
      const p = presenceRef.current
      const color = getComputedStyle(canvas!).color
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx!.fillStyle = color
      const R = (size / 2 - 3) * dpr
      const c = (size / 2) * dpr
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      for (let i = 0; i < N; i++) {
        const pt = pts[i]
        let px = pt.x
        let py = pt.y
        let pz = pt.z
        if (p === 'busy') {
          px += Math.sin(t * 2.2 + pt.ph) * 0.16
          py += Math.cos(t * 1.9 + pt.ph * 1.7) * 0.16
          pz += Math.sin(t * 1.6 + pt.ph * 2.3) * 0.14
        } else if (p === 'blocked') {
          const breath = 1 + Math.sin(t * 3) * 0.05
          px *= breath
          py *= breath
        }
        const rx = px * cosT + pz * sinT
        const rz = -px * sinT + pz * cosT
        const depth = (rz + 1) / 2
        ctx!.globalAlpha = (p === 'idle' ? 0.12 : 0.18) + (p === 'idle' ? 0.45 : 0.72) * depth
        ctx!.beginPath()
        ctx!.arc(c + rx * R * 0.92, c + py * R * 0.92, (0.5 + 0.7 * depth) * dpr * (size / 56), 0, 6.2832)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      t += dt * speedOf(presenceRef.current)
      draw()
      if (visible && !document.hidden) raf = requestAnimationFrame(frame)
      else raf = 0
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
  }, [size, seed])

  return (
    <span className={styles.sphere} style={{ width: size, height: size }} data-presence={presence} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <span className={styles.presence} data-presence={presence} aria-hidden />
    </span>
  )
}
