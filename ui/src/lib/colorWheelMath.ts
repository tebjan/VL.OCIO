import type { Vector3 } from '../types/settings'

const DEG_120 = (2 * Math.PI) / 3   // 2.0944 rad
const DEG_240 = (4 * Math.PI) / 3   // 4.1888 rad
const SQRT_2_3 = Math.sqrt(2 / 3)   // ≈ 0.8165
const HALF_SQRT3 = Math.sqrt(3) / 2 // ≈ 0.8660

/**
 * Forward transform: wheel position → chromatic RGB delta.
 * Projects normalized (x,y) onto three axes at 0°, 120°, 240°.
 * Output always satisfies r + g + b = 0 (pure chromatic).
 */
export function wheelPosToChroma(
  pos: { x: number; y: number },
  sensitivity: number
): { r: number; g: number; b: number } {
  let { x: px, y: py } = pos
  let dist = Math.sqrt(px * px + py * py)
  if (dist > 1) {
    px /= dist
    py /= dist
    dist = 1
  }

  const angle = Math.atan2(-py, px)
  const mag = dist * sensitivity

  return {
    r: mag * Math.cos(angle),
    g: mag * Math.cos(angle - DEG_120),
    b: mag * Math.cos(angle - DEG_240),
  }
}

/**
 * Inverse transform: chromatic RGB delta → wheel position.
 * Input should be zero-mean (use decomposeRgb first to strip achromatic).
 * Corrects for the sqrt(3/2) magnitude factor inherent in the 3-axis projection.
 */
export function chromaToWheelPos(
  r: number,
  g: number,
  b: number,
  sensitivity: number
): { x: number; y: number } {
  const chromaMag = Math.sqrt(r * r + g * g + b * b)
  if (chromaMag < 1e-10) return { x: 0, y: 0 }

  const angle = Math.atan2(HALF_SQRT3 * (g - b), r - 0.5 * g - 0.5 * b)
  const normalizedMag = Math.min(
    (chromaMag * SQRT_2_3) / Math.max(sensitivity, 0.01),
    1
  )

  return {
    x: normalizedMag * Math.cos(angle),
    y: -normalizedMag * Math.sin(angle),
  }
}

/**
 * Decompose an RGB value into chromatic (zero-mean) and achromatic (uniform) parts.
 * The wheel controls only the chromatic part; the master slider controls the achromatic part.
 */
export function decomposeRgb(
  value: Vector3,
  defaultValue: Vector3
): { chroma: { r: number; g: number; b: number }; achromatic: number } {
  const dr = value.x - defaultValue.x
  const dg = value.y - defaultValue.y
  const db = value.z - defaultValue.z
  const achromatic = (dr + dg + db) / 3

  return {
    chroma: {
      r: dr - achromatic,
      g: dg - achromatic,
      b: db - achromatic,
    },
    achromatic,
  }
}
