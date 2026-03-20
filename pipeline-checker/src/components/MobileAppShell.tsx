import { useMemo, useState } from 'react';
import type { GPUContext } from '../gpu/WebGPUContext';
import type { PipelineManagerReturn } from '../hooks/usePipelineManager';
import type { PipelineInstance } from '../types/PipelineInstance';
import type { PreviewLayer } from './Preview2D';
import type { HeightmapLayer } from './HeightmapView';
import { FilePickerButton } from './FilePickerButton';
import { PipelineFilmstripArea } from './PipelineFilmstripArea';
import { MainPreview } from './MainPreview';
import { ControlsPanel } from './ControlsPanel';
import { MetadataPanel } from './MetadataPanel';

type BottomTab = 'controls' | 'metadata';

export interface MobileAppShellProps {
  gpu: GPUContext;
  manager: PipelineManagerReturn;
  previewLayers: PreviewLayer[];
  heightmapLayers: HeightmapLayer[];
  getStageTexturesForPipeline: (inst: PipelineInstance) => (GPUTexture | null)[];
  onOpenFile: (file: File) => void | Promise<void>;
  onPipelineFileDrop?: (file: File, fileHandle: FileSystemFileHandle | undefined, targetPipelineId: string | null) => void | Promise<void>;
}

function MiniToggle({
  label,
  value,
  onToggle,
  title,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{label}</span>
      <button
        onClick={onToggle}
        title={title}
        style={{
          width: '30px',
          height: '16px',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--surface-700)',
          position: 'relative',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: value ? 'var(--surface-300)' : 'var(--surface-500)',
            position: 'absolute',
            top: '3px',
            left: value ? '17px' : '3px',
            transition: 'left 0.15s, background 0.15s',
          }}
        />
      </button>
    </div>
  );
}

export function MobileAppShell({
  gpu,
  manager,
  previewLayers,
  heightmapLayers,
  getStageTexturesForPipeline,
  onOpenFile,
  onPipelineFileDrop,
}: MobileAppShellProps) {
  const [tab, setTab] = useState<BottomTab>('controls');
  const compactEnabled = manager.pipelines[0]?.compactMode ?? true;
  const stageName = manager.selectedStages[manager.selectedStageIndex]?.name;

  const tabContent = useMemo(() => {
    if (tab === 'controls') {
      return (
        <div style={{ height: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          <ControlsPanel
            key={`mobile-${manager.selectedPipelineId ?? 'none'}`}
            settings={manager.selectedSettings}
            onSettingsChange={(patch) => manager.updateSettings(patch)}
            onReset={() => manager.resetAll()}
          />
        </div>
      );
    }

    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: '10px 10px 8px' }}>
        {manager.selectedMetadata ? (
          <MetadataPanel metadata={manager.selectedMetadata} />
        ) : (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
            No metadata available.
          </div>
        )}
      </div>
    );
  }, [tab, manager]);

  return (
    <div className="mobile-shell mobile-safe-top mobile-safe-bottom" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      overflow: 'hidden',
      background: 'var(--color-bg)',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px 6px',
        background: 'var(--surface-950)',
        borderBottom: '1px solid var(--surface-800)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text)' }}>PipeScope</div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
              Open EXR or image (DDS disabled on mobile)
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {manager.pipelines.length > 1 && (
              <MiniToggle
                label="Linked"
                value={manager.linkedSettings}
                onToggle={() => manager.setLinkedSettings(!manager.linkedSettings)}
                title={manager.linkedSettings
                  ? 'Unlink — each pipeline has its own settings'
                  : 'Link — all pipelines share the same settings'}
              />
            )}
            <MiniToggle
              label="Compact"
              value={compactEnabled}
              onToggle={() => {
                const compact = !compactEnabled;
                manager.pipelines.forEach((p) => manager.setCompactMode(compact, p.id));
              }}
              title="Compact filmstrip — hide BC Compress and Output Encode stages"
            />
            <FilePickerButton onFileSelected={onOpenFile} label="Open" />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <MainPreview
            device={gpu.device}
            format={gpu.format}
            layers={previewLayers}
            heightmapLayers={heightmapLayers}
            renderVersion={manager.renderVersion}
            stageName={stageName}
            interactionMode="mobile"
            defaultMode="2d"
            allow3D
          />
        </div>

        <PipelineFilmstripArea
          pipelines={manager.pipelines}
          selectedPipelineId={manager.selectedPipelineId}
          onSelectPipeline={(id) => manager.selectPipeline(id)}
          onRemovePipeline={(id) => manager.removePipeline(id)}
          onStageSelect={(i, id) => manager.selectStage(i, id)}
          onStageToggle={(i, enabled, id) => manager.toggleStage(i, enabled, id)}
          device={gpu.device}
          format={gpu.format}
          renderVersion={manager.renderVersion}
          getStageTextures={getStageTexturesForPipeline}
          isDragging={false}
          onFileDrop={onPipelineFileDrop}
          linkedSettings={manager.linkedSettings}
          onCompactModeChange={(id, compact) => manager.setCompactMode(compact, id)}
        />
      </div>

      <div style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-950)',
        borderTop: '1px solid var(--surface-800)',
        maxHeight: 'min(46dvh, 420px)',
      }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tabContent}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          padding: '8px 10px calc(env(safe-area-inset-bottom, 0px) + 8px)',
          borderTop: '1px solid var(--surface-800)',
          background: 'var(--surface-950)',
        }}>
          <button
            type="button"
            onClick={() => setTab('controls')}
            style={{
              height: '34px',
              borderRadius: '8px',
              border: '1px solid var(--surface-700)',
              background: tab === 'controls' ? 'var(--surface-800)' : 'transparent',
              color: tab === 'controls' ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Controls
          </button>
          <button
            type="button"
            onClick={() => setTab('metadata')}
            style={{
              height: '34px',
              borderRadius: '8px',
              border: '1px solid var(--surface-700)',
              background: tab === 'metadata' ? 'var(--surface-800)' : 'transparent',
              color: tab === 'metadata' ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Metadata
          </button>
        </div>
      </div>
    </div>
  );
}
