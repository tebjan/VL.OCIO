import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Preview2D } from './Preview2D';
import { HeightmapControls } from './HeightmapControls';
import {
  type HeightmapSettings,
  createDefaultHeightmapSettings,
} from '../types/pipeline';

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
  viewExposure: number;
  renderVersion?: number;
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
  viewExposure,
  renderVersion,
}: MainPreviewProps) {
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
      </div>

      {/* View area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', display: mode === '2d' ? 'block' : 'none' }}>
          <Preview2D
            device={device}
            format={format}
            stageTexture={stageTexture}
            viewExposure={viewExposure}
            renderVersion={renderVersion}
          />
        </div>
        {ever3D && (
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
            />
          </Suspense>
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
