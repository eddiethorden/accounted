'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styles from './skills.module.css'

/**
 * A segmented control whose white pill slides to the chosen option instead of
 * jumping (300 ms, none with reduced motion). The focus ring shows for the
 * keyboard only, so a click leaves no outline behind.
 */
export function SlidingTabs<T extends string>({ options, value, onChange, label, fill = false, ids }: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (value: T) => void
  label: string
  /** Fill the width with equal segments (the picker) instead of hugging the labels (the list). */
  fill?: boolean
  /** Optional ids for tab/panel wiring: id prefix and the panel it controls. */
  ids?: { prefix: string; controls: string }
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const pillRef = useRef<HTMLSpanElement | null>(null)
  // The pill is placed straight on the element: no re-render, and the first placement does not animate.
  const placed = useRef(false)
  useLayoutEffect(() => {
    const active = wrapRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    const pill = pillRef.current
    if (!active || !pill) return
    if (!placed.current) pill.style.transition = 'none'
    pill.style.transform = `translateX(${active.offsetLeft}px)`
    pill.style.width = `${active.offsetWidth}px`
    pill.style.opacity = '1'
    if (!placed.current) { void pill.offsetWidth; pill.style.transition = ''; placed.current = true }
  }, [value, options.length])
  return (
    <div ref={wrapRef} className={styles.slideTabs} data-fill={fill ? '' : undefined} role="tablist" aria-label={label}>
      <span ref={pillRef} className={styles.slidePill} style={{ opacity: 0 }} aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={ids ? `${ids.prefix}-${o.value}` : undefined}
          aria-controls={ids?.controls}
          aria-selected={value === o.value}
          className={styles.slideTab}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
