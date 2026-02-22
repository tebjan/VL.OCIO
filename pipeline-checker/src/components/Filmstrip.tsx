import { type StageInfo, STAGE_NAMES } from '../pipeline/types/StageInfo';
import { StageCard } from './StageCard';

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
}

export function Filmstrip({ stages, selectedIndex, onSelect, onToggle, device, format, stageTextures, renderVersion, applySRGB }: FilmstripProps) {
  return (
    <div
      style={{
        background: 'var(--surface-900)',
        borderBottom: '1px solid var(--surface-700)',
        padding: '8px 12px',
        overflowX: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
      }}
    >
      {stages.map((stage, i) => {
        // Final Display (last stage) always renders with sRGB gamma applied
        const effectiveApplySRGB = (i === STAGE_NAMES.length - 1) ? true : applySRGB;
        return (
          <div key={stage.index} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Arrow connector before each card (except first) */}
            {i > 0 && (
              <span
                style={{
                  color: 'var(--surface-600)',
                  fontSize: '18px',
                  lineHeight: 1,
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                &rsaquo;
              </span>
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
            />
          </div>
        );
      })}
    </div>
  );
}
