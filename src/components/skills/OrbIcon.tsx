import { forwardRef } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'

// Dots on a sphere seen from the front: rows of latitude, smaller toward the rim, as the flows' orb.
const DOTS: Array<[number, number, number]> = [
  [9, 4.6, 1.2], [15, 4.6, 1.2],
  [5.6, 8.4, 1.25], [12, 7.6, 1.6], [18.4, 8.4, 1.25],
  [3.8, 12.6, 1.1], [8.6, 12.2, 1.6], [15.4, 12.2, 1.6], [20.2, 12.6, 1.1],
  [6.2, 16.8, 1.3], [12, 16.8, 1.6], [17.8, 16.8, 1.3],
  [9, 20.4, 1.15], [15, 20.4, 1.15],
]

/**
 * The flows' orb as a 24px icon, drawn in currentColor so it sits in the
 * sidebar like the lucide icons around it (it takes the same props).
 */
export const OrbIcon = forwardRef<SVGSVGElement, LucideProps>(function OrbIcon({ size = 24, color = 'currentColor', className, ...props }, ref) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={color} className={className} aria-hidden {...props}>
      {DOTS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
    </svg>
  )
}) as unknown as LucideIcon
