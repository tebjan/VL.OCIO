import { type StageInfo } from '../pipeline/types/StageInfo';
import { type PipelineSettings, getStageColorSpace } from '../types/settings';
import { getStageVolume } from '../lib/colorSpaceVolume';
import { StageCard } from './StageCard';
import { GamutCone } from './GamutCone';

export interface FilmstripProps {
  stages: StageInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  device: GPUDevice | null;
  format: GPUTextureFormat;
  /** Per-stage output textures for thumbnail rendering (indexed by stage index). */
  stageTextures: (GPUTexture | null)[];
  renderVersion?: number;
  applySRGB?: boolean;
  settings: PipelineSettings;
}

export function Filmstrip({ stages, selectedIndex, onSelect, onToggle, device, format, stageTextures, renderVersion, applySRGB, settings }: FilmstripProps) {
  const isEnabled = (i: number) => stages[i]?.enabled ?? true;

  return (
    <div
      style={{
        background: 'var(--surface-900)',
        padding: '4px 6px',
        overflowX: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        flexShrink: 0,
      }}
    >
      {stages.map((stage, i) => {
        // Stages 0-2 show raw source data. For sRGB input, data is still
        // gamma-encoded → don't apply extra sRGB curve in the viewer.
        const isInputSRGB = settings.inputColorSpace === 5;
        const effectiveApplySRGB = (i < 3 && isInputSRGB) ? false : applySRGB;
        const colorSpace = getStageColorSpace(i, settings, isEnabled);
        return (
          <div key={stage.index} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {/* Gamut/range cone between adjacent stages */}
            {i > 0 && (
              <GamutCone
                leftVolume={getStageVolume(i - 1, settings, isEnabled)}
                rightVolume={getStageVolume(i, settings, isEnabled)}
              />
            )}

            <StageCard
              stage={stage}
              isSelected={i === selectedIndex}
              onSelect={() => onSelect(i)}
              onToggle={(enabled) => onToggle(i, enabled)}
              device={device}
              format={format}
              stageTexture={stageTextures[i] ?? null}
              renderVersion={renderVersion}
              applySRGB={effectiveApplySRGB}
              colorSpaceLabel={colorSpace}
            />
          </div>
        );
      })}
    </div>
  );
}
