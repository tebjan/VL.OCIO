import { type StageInfo } from '../pipeline/types/StageInfo';
import { type PipelineSettings, getStageColorSpace, isLinearStageOutput } from '../types/settings';
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
        // Per-stage sRGB logic:
        // - Stage 8 (Final Display): sRGB based on whether pipeline output is linear,
        //   independent of vvvv viewer toggle (simulates DX11 sRGB backbuffer)
        // - Stages 0-2 with sRGB input: don't double-apply gamma
        // - All others: use vvvv viewer toggle
        const isInputSRGB = settings.inputColorSpace === 5;
        const effectiveApplySRGB = i === 8
          ? isLinearStageOutput(getStageColorSpace(7, settings, isEnabled))
          : (i < 3 && isInputSRGB) ? false : applySRGB;
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
