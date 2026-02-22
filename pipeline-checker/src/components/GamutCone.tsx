import type { StageVolume } from '../lib/colorSpaceVolume';

export interface GamutConeProps {
  leftVolume: StageVolume;
  rightVolume: StageVolume;
  height?: number;
  width?: number;
}

/**
 * SVG indicator showing the theoretical color volume transition between
 * two adjacent pipeline stages.
 *
 * Top half: muted rainbow gradient — represents chromatic gamut.
 * Bottom half: black-to-white gradient — represents luminance range.
 *
 * The left/right edge heights are proportional to each stage's volume,
 * creating a tapering "cone" effect through the pipeline.
 */
export function GamutCone({
  leftVolume,
  rightVolume,
  height = 90,
  width = 24,
}: GamutConeProps) {
  const cy = height / 2;       // vertical center
  const halfH = cy - 1;        // max half-height (1px margin)
  const minH = 3;              // minimum visible height per half

  // Compute edge heights for top (gamut) and bottom (range) halves
  const leftGamutH  = Math.max(minH, leftVolume.gamut  * halfH);
  const rightGamutH = Math.max(minH, rightVolume.gamut * halfH);
  const leftRangeH  = Math.max(minH, leftVolume.range  * halfH);
  const rightRangeH = Math.max(minH, rightVolume.range * halfH);

  // Top trapezoid (gamut): color gradient
  const topPoints = [
    `0,${cy - leftGamutH}`,     // top-left
    `${width},${cy - rightGamutH}`, // top-right
    `${width},${cy}`,           // bottom-right
    `0,${cy}`,                  // bottom-left
  ].join(' ');

  // Bottom trapezoid (range): B/W gradient
  const bottomPoints = [
    `0,${cy}`,                  // top-left
    `${width},${cy}`,           // top-right
    `${width},${cy + rightRangeH}`, // bottom-right
    `0,${cy + leftRangeH}`,     // bottom-left
  ].join(' ');

  // Unique ID prefix for gradient defs (avoid collisions with multiple instances)
  const id = `gc-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        {/* Rainbow gradient (vertical: top edge → center) */}
        <linearGradient id={`${id}-hue`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="hsl(320, 70%, 50%)" />
          <stop offset="20%"  stopColor="hsl(240, 65%, 55%)" />
          <stop offset="40%"  stopColor="hsl(180, 65%, 45%)" />
          <stop offset="60%"  stopColor="hsl(120, 60%, 45%)" />
          <stop offset="80%"  stopColor="hsl(50, 70%, 50%)" />
          <stop offset="100%" stopColor="hsl(10, 70%, 50%)" />
        </linearGradient>

        {/* B/W gradient (vertical: center → bottom edge) */}
        <linearGradient id={`${id}-bw`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#b0b0b0" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>

      {/* Top half: gamut (color) */}
      <polygon
        points={topPoints}
        fill={`url(#${id}-hue)`}
        opacity={0.85}
      />

      {/* Bottom half: range (luminance) */}
      <polygon
        points={bottomPoints}
        fill={`url(#${id}-bw)`}
        opacity={0.85}
      />

      {/* Thin outline for shape definition against dark background */}
      <polygon
        points={topPoints}
        fill="none"
        stroke="var(--surface-600, #525252)"
        strokeWidth={0.5}
        opacity={0.4}
      />
      <polygon
        points={bottomPoints}
        fill="none"
        stroke="var(--surface-600, #525252)"
        strokeWidth={0.5}
        opacity={0.4}
      />
    </svg>
  );
}
