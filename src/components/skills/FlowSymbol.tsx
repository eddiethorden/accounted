'use client'

import { useEffect, useState } from 'react'

/**
 * The picture of a flow: three steps joined by a path, the last one ticked,
 * with a dot travelling from the first step to the last. It says "this runs
 * step by step and ends done", which the orb did not. Drawn in the flow's
 * colour; `lively` makes the dot travel faster, for the flow's own page.
 * Reduced motion shows the steps without the travelling dot.
 */
const PATH = 'M18 14 C 46 14, 46 14, 46 32 C 46 50, 46 50, 18 50'

export function FlowSymbol({ hue, size = 64, lively = false }: { hue: number; size?: number; lively?: boolean }) {
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMoving(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const ink = `hsl(${hue} 58% 42%)`
  const soft = `hsl(${hue} 60% 90%)`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d={PATH} stroke={`hsl(${hue} 45% 75%)`} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="1 5" />
      <circle cx={18} cy={14} r={7.5} fill={soft} stroke={ink} strokeWidth={2.5} />
      <circle cx={46} cy={32} r={7.5} fill={soft} stroke={ink} strokeWidth={2.5} />
      <circle cx={18} cy={50} r={8.5} fill={ink} />
      <path d="M14.2 50.2 l2.6 2.6 l5.2 -5.4" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {moving && (
        <circle r={3.4} fill={ink}>
          <animateMotion dur={lively ? '2.2s' : '3.2s'} repeatCount="indefinite" path={PATH} keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="linear" />
        </circle>
      )}
    </svg>
  )
}
