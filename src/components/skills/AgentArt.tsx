'use client'

import { useEffect, useRef, type ComponentType } from 'react'
import { BookOpen, CalendarCheck, CalendarRange, FileText, Percent, ReceiptText, Scale, ScrollText, TrendingUp, Undo2, Users, type LucideProps } from 'lucide-react'
import type { RegistrySkillId } from '@/lib/agent-skills/registry'
import styles from './skills.module.css'

/** What each agent works with, drawn out of the dot field. Own agents get a scroll. */
const MOTIFS: Record<RegistrySkillId, ComponentType<LucideProps>> = {
  bookkeep: BookOpen,
  kvittojakten: ReceiptText,
  'reconcile-month': Scale,
  'month-end-close': CalendarCheck,
  'quarterly-vat-review': Percent,
  'payroll-monthly': Users,
  'invoicing-rules': FileText,
  'kreditfaktura-process': Undo2,
  'year-end-close': CalendarRange,
  'tax-planning': TrendingUp,
}

/** A stable number from a string, so every agent draws the same field every visit. */
export function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) % 10000
}

function hash(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}
/** Smooth value noise in [0, 1]. */
function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, seed)
  const b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed)
  const d = hash(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * The stage behind an agent: a halftone drawing in the app's own ink, in the
 * language of the marketing site's illustrations. A quiet dot field with the
 * agent's motif rising out of it in denser dots. It draws itself in once, a
 * soft sweep, then holds still.
 */
export function AgentArt({ agentKey, motif }: { agentKey: string; motif?: RegistrySkillId }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const iconRef = useRef<HTMLSpanElement | null>(null)
  const Icon = motif ? MOTIFS[motif] : ScrollText

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const svg = iconRef.current?.querySelector('svg')
    if (!wrap || !canvas || !ctx || !svg) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const seed = seedOf(agentKey)
    let raf = 0
    let cancelled = false

    // The motif as a soft mask: the icon drawn thick and blurred on an offscreen canvas.
    const mask = document.createElement('canvas')
    const mctx = mask.getContext('2d', { willReadFrequently: true })
    const clone = svg.cloneNode(true) as SVGElement
    clone.setAttribute('stroke', '#000')
    clone.setAttribute('width', '240')
    clone.setAttribute('height', '240')
    const image = new Image()
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))

    function render(maskData: Uint8ClampedArray | null, mw: number, mh: number, animate = true) {
      const W = wrap!.clientWidth
      const H = wrap!.clientHeight
      canvas!.width = W * dpr
      canvas!.height = H * dpr
      canvas!.style.width = `${W}px`
      canvas!.style.height = `${H}px`
      const g = 9
      const cols = Math.ceil(W / g) + 1
      const rows = Math.ceil(H / g) + 1
      // the motif sits right of centre, large, so the agent's card on the left leaves it visible
      const box = Math.min(W * 0.5, H * 0.66)
      const ox = W * 0.62 - box / 2
      const oy = H * 0.5 - box / 2
      const dots: { x: number; y: number; r: number; a: number; at: number }[] = []
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * g + (j % 2 ? g / 2 : 0)
          const y = j * g
          const field = noise(x / 90, y / 90, seed) * 0.55 + noise(x / 28, y / 28, seed + 1) * 0.25
          let m = 0
          if (maskData) {
            const mx = Math.floor(((x - ox) / box) * mw)
            const my = Math.floor(((y - oy) / box) * mh)
            if (mx >= 0 && my >= 0 && mx < mw && my < mh) m = maskData[(my * mw + mx) * 4 + 3] / 255
          }
          const v = Math.min(1, field * 0.26 + m * 0.8)
          if (v < 0.06) continue
          dots.push({ x, y, r: (g / 2) * Math.sqrt(v) * 0.8, a: 0.1 + 0.42 * m + 0.1 * field, at: (x + y * 0.55) / (W + H * 0.55) })
        }
      }
      const color = getComputedStyle(canvas!).color
      const drawAt = (progress: number) => {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
        ctx!.fillStyle = color
        for (const d of dots) {
          const k = Math.max(0, Math.min(1, (progress * 1.35 - d.at) / 0.35))
          if (k <= 0) continue
          ctx!.globalAlpha = d.a * k
          ctx!.beginPath()
          ctx!.arc(d.x * dpr, d.y * dpr, d.r * dpr * (0.4 + 0.6 * k), 0, 6.2832)
          ctx!.fill()
        }
        ctx!.globalAlpha = 1
      }
      if (reduced || !animate) { drawAt(1); return }
      const start = performance.now()
      const step = (now: number) => {
        if (cancelled) return
        const p = Math.min(1, (now - start) / 1200)
        drawAt(1 - (1 - p) * (1 - p))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }

    let maskData: Uint8ClampedArray | null = null
    image.onload = () => {
      if (cancelled || !mctx) return
      mask.width = 120
      mask.height = 120
      mctx.filter = 'blur(2px)'
      mctx.lineWidth = 3
      mctx.drawImage(image, 0, 0, 120, 120)
      maskData = mctx.getImageData(0, 0, 120, 120).data
      URL.revokeObjectURL(url)
      render(maskData, 120, 120)
    }
    image.onerror = () => { URL.revokeObjectURL(url); render(null, 0, 0) }
    image.src = url

    let resizeTimer = 0
    let lastSize = ''
    const observer = new ResizeObserver(() => {
      const size = `${wrap.clientWidth}x${wrap.clientHeight}`
      if (size === lastSize) return
      const first = lastSize === ''
      lastSize = size
      if (first) return
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => { cancelAnimationFrame(raf); if (maskData) render(maskData, 120, 120, false) }, 150)
    })
    observer.observe(wrap)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      observer.disconnect()
    }
  }, [agentKey])

  return (
    <div ref={wrapRef} className={styles.art} aria-hidden>
      <canvas ref={canvasRef} />
      <span ref={iconRef} hidden><Icon size={24} strokeWidth={2.25} /></span>
    </div>
  )
}
