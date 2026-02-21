import { useState, useEffect } from 'react';
import type { PixelReadback } from '../pipeline/PixelReadback';

export interface PixelReadoutState {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  valid: boolean;
  screenX: number;
  screenY: number;
}

const INITIAL_STATE: PixelReadoutState = {
  x: 0, y: 0, r: 0, g: 0, b: 0, a: 0,
  valid: false, screenX: 0, screenY: 0,
};

/**
 * Throttled cursor tracking and pixel readback via requestAnimationFrame.
 * Converts screen coordinates to texture pixel coordinates accounting for zoom/pan.
 * Reads at ~30Hz max, with PixelReadback's pending guard preventing overlapping GPU reads.
 */
export function usePixelReadout(
  canvas: HTMLCanvasElement | null,
  readback: PixelReadback | null,
  texture: GPUTexture | null,
  zoom: number,
  panX: number,
  panY: number,
): PixelReadoutState {
  const [readout, setReadout] = useState<PixelReadoutState>(INITIAL_STATE);

  useEffect(() => {
    if (!canvas) return;

    let frameId: number;
    let needsRead = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let isOver = false;

    const onMouseMove = (e: MouseEvent) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      needsRead = true;
    };

    const onMouseLeave = () => {
      isOver = false;
      setReadout((prev) => ({ ...prev, valid: false }));
    };

    const onMouseEnter = () => {
      isOver = true;
    };

    const onFrame = () => {
      if (needsRead && texture && readback && isOver) {
        needsRead = false;

        const rect = canvas.getBoundingClientRect();
        const canvasX = lastMouseX - rect.left;
        const canvasY = lastMouseY - rect.top;

        // Screen coords -> UV coords (accounting for zoom/pan)
        const uvX = (canvasX / rect.width - 0.5) / zoom + panX + 0.5;
        const uvY = (canvasY / rect.height - 0.5) / zoom + panY + 0.5;

        if (uvX >= 0 && uvX <= 1 && uvY >= 0 && uvY <= 1) {
          const texX = Math.min(Math.floor(uvX * texture.width), texture.width - 1);
          const texY = Math.min(Math.floor(uvY * texture.height), texture.height - 1);

          readback.readPixel(texture, texX, texY).then((data) => {
            if (data) {
              setReadout({
                x: texX,
                y: texY,
                r: data[0],
                g: data[1],
                b: data[2],
                a: data[3],
                valid: true,
                screenX: lastMouseX,
                screenY: lastMouseY,
              });
            }
          });
        } else {
          setReadout((prev) => ({ ...prev, valid: false }));
        }
      }
      frameId = requestAnimationFrame(onFrame);
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('mouseenter', onMouseEnter);
    frameId = requestAnimationFrame(onFrame);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('mouseenter', onMouseEnter);
      cancelAnimationFrame(frameId);
    };
  }, [canvas, texture, zoom, panX, panY, readback]);

  return readout;
}
