import { useState, useRef, useCallback, type DragEvent } from 'react';

interface DropZoneProps {
  /**
   * Called when an EXR image is loaded (from file drop or sample button).
   * @param imageData - Raw RGBA Float32Array pixel data
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   */
  onImageLoaded: (imageData: Float32Array, width: number, height: number) => void;
}

/**
 * Full-screen EXR file drop zone with a "Try with sample image" button.
 *
 * Accepts .exr files via drag-and-drop. When a file is dropped, the raw bytes
 * are passed to the Three.js EXRLoader. The sample button generates a procedural
 * HDR gradient (256x256, brightness 0-10+) for quick testing without a file.
 */
export function DropZone({ onImageLoaded }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragCountRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const processExrBytes = useCallback(
    async (buffer: ArrayBuffer, fileName: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
        const loader = new EXRLoader();

        const result = loader.parse(buffer);

        if (!result || !result.data) {
          throw new Error(`Failed to parse EXR file "${fileName}": no image data returned.`);
        }

        const { data, width, height } = result;

        // EXRLoader returns Float32Array for FLOAT type, or Uint16Array for HALF.
        // We need Float32Array for the pipeline.
        let float32Data: Float32Array;
        if (data instanceof Float32Array) {
          float32Data = data;
        } else {
          // Convert Uint16Array (half-float) to Float32Array
          float32Data = new Float32Array(data.length);
          for (let i = 0; i < data.length; i++) {
            float32Data[i] = halfToFloat(data[i] as number);
          }
        }

        console.log(`[DropZone] Loaded EXR: ${fileName} (${width}x${height}, ${float32Data.length / 4} pixels)`);
        onImageLoaded(float32Data, width, height);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DropZone] EXR load error:`, err);
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [onImageLoaded]
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCountRef.current = 0;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file.name.toLowerCase().endsWith('.exr')) {
        setError('Please drop an .exr file.');
        return;
      }

      const buffer = await file.arrayBuffer();
      await processExrBytes(buffer, file.name);
    },
    [processExrBytes]
  );

  const handleSampleClick = useCallback(() => {
    setIsLoading(true);
    setError(null);

    try {
      // Generate a procedural 256x256 HDR gradient:
      // X = brightness 0.0 to 10.0+, Y = hue sweep (HSL)
      const width = 256;
      const height = 256;
      const data = new Float32Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        const hue = y / height; // 0..1 hue sweep
        for (let x = 0; x < width; x++) {
          const brightness = (x / (width - 1)) * 10.0; // 0..10 HDR range
          const [r, g, b] = hslToLinear(hue, 0.8, 0.5);
          const idx = (y * width + x) * 4;
          data[idx + 0] = r * brightness;
          data[idx + 1] = g * brightness;
          data[idx + 2] = b * brightness;
          data[idx + 3] = 1.0;
        }
      }

      console.log(`[DropZone] Generated sample: ${width}x${height} HDR gradient`);
      onImageLoaded(data, width, height);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to generate sample image: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [onImageLoaded]);

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-8"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className="w-full max-w-2xl p-16 rounded-xl flex flex-col items-center justify-center gap-6 transition-colors duration-150"
        style={{
          border: `2px dashed ${isDragging ? 'var(--color-text)' : 'var(--color-border)'}`,
          background: isDragging ? 'var(--color-surface)' : 'transparent',
        }}
      >
        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading EXR...</p>
        ) : (
          <>
            <div className="text-center">
              <p className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>
                Drop EXR file here
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Drag and drop an OpenEXR file to inspect the color pipeline
              </p>
            </div>

            <div
              className="flex items-center gap-4 w-full max-w-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
              <span className="text-xs uppercase tracking-wide">or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            </div>

            <button
              onClick={handleSampleClick}
              className="px-4 py-2 rounded text-sm transition-colors duration-150 cursor-pointer"
              style={{
                border: '1px solid var(--color-accent)',
                color: 'var(--color-text-muted)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent-hover)';
                e.currentTarget.style.color = 'var(--color-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }}
            >
              Try with sample image
            </button>
          </>
        )}

        {error && (
          <p className="text-sm mt-4" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Convert a 16-bit IEEE 754 half-precision float to a 32-bit float.
 * Used when EXRLoader returns Uint16Array data (HALF channel format).
 */
function halfToFloat(h: number): number {
  const sign = (h >>> 15) & 0x1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
  }

  if (exponent === 31) {
    return mantissa === 0
      ? (sign ? -Infinity : Infinity)
      : NaN;
  }

  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}

/**
 * Convert HSL (h in 0..1, s in 0..1, l in 0..1) to linear RGB.
 * Used for generating the procedural sample gradient.
 */
function hslToLinear(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  const sector = Math.floor(h * 6) % 6;
  if (sector === 0)      { r = c; g = x; b = 0; }
  else if (sector === 1) { r = x; g = c; b = 0; }
  else if (sector === 2) { r = 0; g = c; b = x; }
  else if (sector === 3) { r = 0; g = x; b = c; }
  else if (sector === 4) { r = x; g = 0; b = c; }
  else                   { r = c; g = 0; b = x; }

  // Convert sRGB to linear (approximate gamma 2.2)
  const toLinear = (v: number) => Math.pow(Math.max(v + m, 0), 2.2);
  return [toLinear(r), toLinear(g), toLinear(b)];
}
