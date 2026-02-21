import { useState, useEffect, useRef, useCallback } from 'react';
import { initWebGPU, type GPUContext } from './gpu/WebGPUContext';
import { DropZone } from './components/DropZone';
import { WebGPUCanvas } from './components/WebGPUCanvas';

type AppState =
  | { kind: 'initializing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; gpu: GPUContext }
  | { kind: 'loaded'; gpu: GPUContext; imageData: Float32Array; width: number; height: number };

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'initializing' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize WebGPU on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initWebGPU(canvas)
      .then((gpu) => {
        setState({ kind: 'ready', gpu });
      })
      .catch((err) => {
        setState({ kind: 'error', message: err.message });
      });
  }, []);

  // Called when an EXR file is loaded (from drop or sample button)
  const handleImageLoaded = useCallback(
    (imageData: Float32Array, width: number, height: number) => {
      if (state.kind !== 'ready' && state.kind !== 'loaded') return;
      setState({ kind: 'loaded', gpu: state.gpu, imageData, width, height });
    },
    [state]
  );

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* Hidden canvas for WebGPU context -- always mounted */}
      <WebGPUCanvas ref={canvasRef} />

      {state.kind === 'initializing' && (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-text-muted)' }}>Initializing WebGPU...</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            className="max-w-lg text-center p-8 rounded-lg"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-error)' }}>
              WebGPU Not Available
            </h2>
            <p className="mb-4" style={{ color: 'var(--color-text-muted)' }}>
              {state.message}
            </p>
            <p style={{ color: 'var(--color-text-muted)' }}>
              WebGPU requires Chrome 113+, Edge 113+, or Firefox Nightly with
              <code
                className="px-1 mx-1 rounded text-sm"
                style={{ background: 'var(--color-bg)' }}
              >
                dom.webgpu.enabled
              </code>
              set to true.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'ready' && (
        <DropZone onImageLoaded={handleImageLoaded} />
      )}

      {state.kind === 'loaded' && (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-text-muted)' }}>
            Image loaded: {state.width} x {state.height} ({(state.imageData.length / 4).toLocaleString()} pixels)
            -- Pipeline stages will appear here in Phase 3+
          </p>
        </div>
      )}
    </div>
  );
}
