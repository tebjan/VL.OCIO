import { useState, useRef, useCallback, useEffect } from 'react';

/** File types the pipeline can load. */
export type LoadedFileType = 'exr' | 'dds' | 'sample';

interface DropZoneProps {
  /**
   * Called when an EXR image is loaded from file drop.
   * imageData is Float32Array RGBA, width/height in pixels.
   */
  onExrLoaded: (imageData: Float32Array, width: number, height: number, fileType: LoadedFileType) => void;
  /** Called when a DDS file is dropped. buffer is the raw ArrayBuffer. */
  onDdsLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  /** Whether the app has BC texture compression support. */
  hasBC: boolean;
}

/**
 * Global drag-and-drop overlay using window-level event listeners.
 * Invisible by default, shows a visual indicator when files are dragged over.
 * Does NOT block pointer events on the underlying UI.
 */
export function DropZone({ onExrLoaded, onDdsLoaded, hasBC }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragCountRef = useRef(0);

  // Clear error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

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

        let float32Data: Float32Array;
        if (data instanceof Float32Array) {
          float32Data = data;
        } else {
          float32Data = new Float32Array(data.length);
          for (let i = 0; i < data.length; i++) {
            float32Data[i] = halfToFloat(data[i] as number);
          }
        }

        console.log(`[DropZone] Loaded EXR: ${fileName} (${width}x${height})`);
        onExrLoaded(float32Data, width, height, 'exr');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DropZone] EXR load error:`, err);
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [onExrLoaded]
  );

  const handleFileDrop = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();

      if (name.endsWith('.exr')) {
        const buffer = await file.arrayBuffer();
        await processExrBytes(buffer, file.name);
      } else if (name.endsWith('.dds')) {
        if (!hasBC) {
          setError('DDS files require BC texture compression support (not available on this GPU).');
          return;
        }
        setIsLoading(true);
        setError(null);
        try {
          const buffer = await file.arrayBuffer();
          console.log(`[DropZone] Loaded DDS: ${file.name} (${buffer.byteLength} bytes)`);
          onDdsLoaded(buffer, file.name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[DropZone] DDS load error:`, err);
          setError(msg);
        } finally {
          setIsLoading(false);
        }
      } else {
        setError('Unsupported file type. Drop an .exr or .dds file.');
      }
    },
    [processExrBytes, onDdsLoaded, hasBC]
  );

  // Window-level drag event listeners — no blocking overlay needed
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current++;
      if (dragCountRef.current === 1) {
        setIsDragging(true);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setIsDragging(false);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      dragCountRef.current = 0;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      handleFileDrop(files[0]);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFileDrop]);

  return (
    <>
      {/* Visual overlay when dragging — only rendered while dragging */}
      {isDragging && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: 1001,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        >
          <div
            className="p-12 rounded-2xl flex flex-col items-center gap-4"
            style={{
              border: '2px dashed var(--color-accent)',
              background: 'rgba(0, 0, 0, 0.5)',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-accent)' }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            <p className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>
              Drop EXR or DDS file
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Release to load into pipeline
            </p>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg"
          style={{
            zIndex: 1002,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        >
          Loading...
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg max-w-md text-center"
          style={{
            zIndex: 1002,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
            pointerEvents: 'none',
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Generate a procedural 256x256 HDR gradient for quick testing.
 * X = brightness 0.0 to 10.0+, Y = hue sweep (HSL).
 */
export function generateSampleImage(): { data: Float32Array; width: number; height: number } {
  const width = 256;
  const height = 256;
  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const hue = y / height;
    for (let x = 0; x < width; x++) {
      const brightness = (x / (width - 1)) * 10.0;
      const [r, g, b] = hslToLinear(hue, 0.8, 0.5);
      const idx = (y * width + x) * 4;
      data[idx + 0] = r * brightness;
      data[idx + 1] = g * brightness;
      data[idx + 2] = b * brightness;
      data[idx + 3] = 1.0;
    }
  }

  return { data, width, height };
}

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

  const toLinear = (v: number) => Math.pow(Math.max(v + m, 0), 2.2);
  return [toLinear(r), toLinear(g), toLinear(b)];
}
