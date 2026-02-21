import { forwardRef } from 'react';

/**
 * The WebGPU rendering canvas. Always mounted in the DOM (even when not visible)
 * because WebGPU requires an active canvas element for context creation.
 *
 * Initially hidden (1x1 pixel, off-screen). Later phases will resize and
 * display it as the main preview area.
 */
export const WebGPUCanvas = forwardRef<HTMLCanvasElement>(function WebGPUCanvas(_props, ref) {
  return (
    <canvas
      ref={ref}
      width={1}
      height={1}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
});
