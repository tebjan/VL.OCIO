import { useState, useCallback } from 'react';
import { Preview2D } from './Preview2D';
import { HeightmapView } from './HeightmapView';
import { HeightmapControls } from './HeightmapControls';
import {
  type HeightmapSettings,
  createDefaultHeightmapSettings,
} from '../types/pipeline';

export interface MainPreviewProps {
  device: GPUDevice;
  format: GPUTextureFormat;
  stageTexture: GPUTexture | null;
  viewExposure: number;
}

type ViewMode = '2d' | '3d';

/**
 * Container component with [2D] / [3D] tab toggle.
 * Renders Preview2D or HeightmapView based on the active tab.
 * Both views preserve their state across tab switches.
 */
export function MainPreview({
  device,
  format,
  stageTexture,
  viewExposure,
}: MainPreviewProps) {
  const [mode, setMode] = useState<ViewMode>('2d');
  const [heightmapSettings, setHeightmapSettings] = useState<HeightmapSettings>(
    createDefaultHeightmapSettings,
  );

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

      {/* View area — both mount always to preserve state, visibility toggled */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', display: mode === '2d' ? 'block' : 'none' }}>
          <Preview2D
            device={device}
            format={format}
            stageTexture={stageTexture}
            viewExposure={viewExposure}
          />
        </div>
        <HeightmapView stageTexture={stageTexture} active={mode === '3d'} />
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
