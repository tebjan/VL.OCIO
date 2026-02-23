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
  /** Per-stage visibility (indexed by stage index). Hidden stages are skipped in rendering. */
  stageVisibility?: boolean[];
}

export function Filmstrip({ stages, selectedIndex, onSelect, onToggle, device, format, stageTextures, renderVersion, applySRGB, settings, stageVisibility }: FilmstripProps) {
  const isEnabled = (i: number) => stages[i]?.enabled ?? true;
  const vis = stageVisibility ?? Array(stages.length).fill(true);

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
        if (!vis[i]) return null;

        // Per-stage sRGB logic:
        // - Stage 8 (Final Display): sRGB based on whether pipeline output is linear,
        //   independent of vvvv viewer toggle (simulates DX11 sRGB backbuffer)
        // - Stages 0-2 with sRGB input: don't double-apply gamma
        // - All others: use vvvv viewer toggle
        const isInputSRGB = settings.inputColorSpace === 5;
        const effectiveApplySRGB = i === 8
          ? isLinearStageOutput(getStageColorSpace(7, settings, isEnabled))
          : (i === 2 && settings.bcShowDelta) ? false  // Delta view: raw error values, no curves
          : (i <= 1 && isInputSRGB) ? false  // Stages 0-1: thumbnail shows raw sRGB input
          : (i === 2 && isInputSRGB) ? isLinearStageOutput(getStageColorSpace(2, settings, isEnabled))  // Stage 2: linear after BC6H+sRGB decompression
          : applySRGB;
        const colorSpace = getStageColorSpace(i, settings, isEnabled);

        // Find previous visible stage for GamutCone bridging
        let prevVisible = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (vis[j]) { prevVisible = j; break; }
        }

        return (
          <div key={stage.index} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {/* Gamut/range cone bridging to previous visible stage */}
            {prevVisible >= 0 && (
              <GamutCone
                leftVolume={getStageVolume(prevVisible, settings, isEnabled)}
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
