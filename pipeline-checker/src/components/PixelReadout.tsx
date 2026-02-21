import type { PixelReadoutState } from '../hooks/usePixelReadout';

export interface PixelReadoutProps {
  readout: PixelReadoutState;
  containerRect: DOMRect | null;
}

/**
 * Floating tooltip showing RGBA float values at the cursor position.
 * Positioned 16px offset from cursor; flips to opposite side near edges.
 */
export function PixelReadout({ readout, containerRect }: PixelReadoutProps) {
  if (!readout.valid || !containerRect) return null;

  const tooltipW = 160;
  const tooltipH = 100;
  const offset = 16;

  // Position relative to container
  let left = readout.screenX - containerRect.left + offset;
  let top = readout.screenY - containerRect.top + offset;

  // Flip if tooltip would overflow container edges
  if (left + tooltipW > containerRect.width) {
    left = readout.screenX - containerRect.left - tooltipW - offset;
  }
  if (top + tooltipH > containerRect.height) {
    top = readout.screenY - containerRect.top - tooltipH - offset;
  }

  // Clamp to container bounds
  left = Math.max(0, left);
  top = Math.max(0, top);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: '4px',
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        lineHeight: 1.5,
        zIndex: 10,
      }}
    >
      <div style={{ color: '#999999', marginBottom: '2px' }}>
        ({readout.x}, {readout.y})
      </div>
      <div>R: {readout.r.toFixed(5)}</div>
      <div>G: {readout.g.toFixed(5)}</div>
      <div>B: {readout.b.toFixed(5)}</div>
      <div>A: {readout.a.toFixed(5)}</div>
    </div>
  );
}
