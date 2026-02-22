import { Component, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Preview2D } from './Preview2D';
import { HeightmapControls } from './HeightmapControls';
import {
  type HeightmapSettings,
  createDefaultHeightmapSettings,
} from '../types/pipeline';
import { STAGE_NAMES } from '../pipeline/types/StageInfo';

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
  stageTexture: GPUTexture | null;
  renderVersion?: number;
  applySRGB?: boolean;
  selectedStageIndex: number;
  stageName?: string;
}

type ViewMode = '2d' | '3d';

/**
 * Container component with [2D] / [3D] tab toggle.
 * Renders Preview2D or HeightmapView based on the active tab.
 * HeightmapView is lazy-loaded on first 3D activation to avoid
 * loading Three.js unless needed.
 */
export function MainPreview({
  device,
  format,
  stageTexture,
  renderVersion,
  applySRGB,
  selectedStageIndex,
  stageName,
}: MainPreviewProps) {
  // Final Display (last stage) always renders with sRGB gamma applied
  const effectiveApplySRGB = (selectedStageIndex === STAGE_NAMES.length - 1) ? true : applySRGB;
  const [mode, setMode] = useState<ViewMode>('2d');
  const [heightmapSettings, setHeightmapSettings] = useState<HeightmapSettings>(
    createDefaultHeightmapSettings,
  );
  // Track whether 3D was ever activated — once true, keep HeightmapView mounted
  const [ever3D, setEver3D] = useState(false);

  useEffect(() => {
    if (mode === '3d') setEver3D(true);
  }, [mode]);

  const handleSettingsChange = useCallback(
    (settings: HeightmapSettings) => setHeightmapSettings(settings),
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px',
          background: 'var(--surface-800)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => setMode('2d')}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '13px',
            background: mode === '2d' ? 'var(--surface-600)' : 'transparent',
            color: mode === '2d' ? 'var(--color-text)' : 'var(--color-text-muted)',
          }}
        >
          2D
        </button>
        <button
          onClick={() => setMode('3d')}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '13px',
            background: mode === '3d' ? 'var(--surface-600)' : 'transparent',
            color: mode === '3d' ? 'var(--color-text)' : 'var(--color-text-muted)',
          }}
        >
          3D
        </button>
        {stageName && (
          <span style={{
            marginLeft: 'auto',
            color: 'var(--color-text-muted)',
            fontSize: '13px',
            paddingRight: '8px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {stageName}
          </span>
        )}
      </div>

      {/* View area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', display: mode === '2d' ? 'block' : 'none' }}>
          <Preview2D
            device={device}
            format={format}
            stageTexture={stageTexture}
            renderVersion={renderVersion}
            applySRGB={effectiveApplySRGB}
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
                stageTexture={stageTexture}
                device={device}
                active={mode === '3d'}
                renderVersion={renderVersion}
                settings={heightmapSettings}
              />
            </Suspense>
          </HeightmapErrorBoundary>
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
