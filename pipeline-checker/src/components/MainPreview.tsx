import { Component, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Preview2D, type PreviewLayer } from './Preview2D';
import { HeightmapControls } from './HeightmapControls';
import {
  type HeightmapSettings,
  createDefaultHeightmapSettings,
} from '../types/pipeline';
import type { HeightmapLayer } from './HeightmapView';
/**
 * Error boundary that catches render/lifecycle errors from HeightmapView
 * and displays a fallback instead of crashing the entire app.
 */
class HeightmapErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[HeightmapErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', background: 'var(--color-bg, #0d0d0d)',
        }}>
          <div style={{ textAlign: 'center', maxWidth: '400px', padding: '24px' }}>
            <div style={{ color: '#e06060', fontSize: '14px', marginBottom: '12px' }}>
              3D view crashed: {this.state.error}
            </div>
            <button
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset();
              }}
              style={{
                padding: '6px 16px', borderRadius: '4px',
                border: '1px solid var(--color-border, #444)',
                background: 'var(--surface-600, #333)',
                color: 'var(--color-text, #ccc)',
                cursor: 'pointer', fontSize: '13px',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy-load HeightmapView to prevent Three.js WebGPU module from being
// evaluated at app startup. Three.js WebGPU imports can interfere with
// direct WebGPU usage (the color pipeline). Only loaded when user first
// switches to 3D mode.
const LazyHeightmapView = lazy(() =>
  import('./HeightmapView').then((m) => ({ default: m.HeightmapView })),
);

export interface MainPreviewProps {
  device: GPUDevice;
  format: GPUTextureFormat;
  /** Multi-pipeline layers for 2D side-by-side rendering. */
  layers: PreviewLayer[];
  /** Multi-pipeline layers for 3D heightmap side-by-side rendering. */
  heightmapLayers: HeightmapLayer[];
  renderVersion?: number;
  stageName?: string;
}

type ViewMode = '2d' | '3d';

const overlayBtnBase: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '12px',
  transition: 'background 0.1s, color 0.1s',
};

/**
 * Container component with floating [2D] / [3D] toggle overlaid on the canvas.
 * Renders Preview2D or HeightmapView based on the active tab.
 * HeightmapView is lazy-loaded on first 3D activation to avoid
 * loading Three.js unless needed.
 */
export function MainPreview({
  device,
  format,
  layers,
  heightmapLayers,
  renderVersion,
  stageName,
}: MainPreviewProps) {
  const [mode, setMode] = useState<ViewMode>('3d');
  const [heightmapSettings, setHeightmapSettings] = useState<HeightmapSettings>(
    createDefaultHeightmapSettings,
  );
  // Track whether 3D was ever activated — once true, keep HeightmapView mounted
  const [ever3D, setEver3D] = useState(true);

  useEffect(() => {
    if (mode === '3d') setEver3D(true);
  }, [mode]);

  const handleSettingsChange = useCallback(
    (settings: HeightmapSettings) => setHeightmapSettings(settings),
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* View area — full height, controls float on top */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', display: mode === '2d' ? 'block' : 'none' }}>
          <Preview2D
            device={device}
            format={format}
            layers={layers}
            renderVersion={renderVersion}
          />
        </div>
        {ever3D && (
          <HeightmapErrorBoundary onReset={() => setEver3D(false)}>
            <Suspense fallback={
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: 'var(--color-text-muted)',
              }}>
                Loading 3D view...
              </div>
            }>
              <LazyHeightmapView
                layers={heightmapLayers}
                device={device}
                active={mode === '3d'}
                renderVersion={renderVersion}
                settings={heightmapSettings}
              />
            </Suspense>
          </HeightmapErrorBoundary>
        )}

        {/* Floating 2D/3D selector pill — top-left */}
        <div style={{
          position: 'absolute', top: '8px', left: '8px', zIndex: 10,
          display: 'flex', gap: '2px',
          background: 'rgba(0,0,0,0.50)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderRadius: '6px',
          padding: '3px',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <button
            onClick={() => setMode('2d')}
            title="Flat image view — drag to pan, scroll to zoom"
            style={{
              ...overlayBtnBase,
              background: mode === '2d' ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: mode === '2d' ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}
          >
            2D
          </button>
          <button
            onClick={() => setMode('3d')}
            title="3D heightmap — pixel luminance as elevation, drag to orbit"
            style={{
              ...overlayBtnBase,
              background: mode === '3d' ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: mode === '3d' ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}
          >
            3D
          </button>
        </div>

        {/* Stage name badge — top-right */}
        {stageName && (
          <span style={{
            position: 'absolute', top: '8px', right: '8px', zIndex: 10,
            fontSize: '12px', color: 'var(--color-text-muted)',
            background: 'rgba(0,0,0,0.40)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            borderRadius: '4px',
            padding: '3px 8px',
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {stageName}
          </span>
        )}
      </div>

      {/* 3D controls shown only in 3D mode */}
      {mode === '3d' && (
        <HeightmapControls
          settings={heightmapSettings}
          onChange={handleSettingsChange}
        />
      )}
    </div>
  );
}
