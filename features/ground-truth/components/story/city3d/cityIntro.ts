/**
 * Constants for the opening fast-forward of the measured Tehran neighbourhood.
 * Kept free of three.js so UI code (and tests that stub the 3D worlds) can use them.
 */

/** Calendar year at t = 0: the end of the measurement period. */
export const MEASURED_EPOCH = 2026.8

export type WallColourMode = 'rate' | 'tilt'

/** Ground-tilt limits used by the 'tilt' colours (Bjerrum 1963), from least to most severe. */
export const TILT_LIMITS = [
  { r: 500, colour: '#a9d6ff', short: 'past 1 in 500', label: 'Past 1 in 500', meaning: 'reference ground-tilt guide, not a building safety assessment' },
  { r: 300, colour: '#ffbf47', short: 'past 1 in 300', label: 'Past 1 in 300', meaning: 'reference ground-tilt guide, not observed cracks' },
  { r: 150, colour: '#ff6a3d', short: 'past 1 in 150', label: 'Past 1 in 150', meaning: 'reference ground-tilt guide, not a damage prediction' },
] as const

/** Highest tilt limit reached (index into TILT_LIMITS), or -1, and how many projected years ago it was crossed. */
export function tiltLevel(tiltRate: number, t: number): { level: number; since: number } {
  let level = -1
  let since = Infinity
  if (!(tiltRate > 0) || !(t > 0)) return { level, since }
  TILT_LIMITS.forEach((limit, i) => {
    const crossed = 1 / limit.r / tiltRate
    if (t >= crossed) {
      level = i
      since = t - crossed
    }
  })
  return { level, since }
}
