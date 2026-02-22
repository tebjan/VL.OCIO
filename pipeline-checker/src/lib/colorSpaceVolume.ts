import type { PipelineSettings } from '../types/settings';

/**
 * Theoretical color volume at a pipeline stage — gamut (chromaticity area)
 * and dynamic range (luminance range), each normalized 0–1.
 */
export interface StageVolume {
  gamut: number;  // 0–1, relative chromaticity area (AP1 = 1.0)
  range: number;  // 0–1, relative dynamic range (scene-linear = 1.0)
}

// --- Base gamut by HDR_COLOR_SPACES index ---
// Approximate CIE xy triangle area relative to AP1.
const GAMUT_BY_CS: number[] = [
  0.40,  // 0: Linear Rec.709
  0.75,  // 1: Linear Rec.2020
  1.00,  // 2: ACEScg  (AP1)
  1.00,  // 3: ACEScc  (AP1)
  1.00,  // 4: ACEScct (AP1)
  0.40,  // 5: sRGB    (Rec.709 primaries)
  0.75,  // 6: PQ Rec.2020
  0.75,  // 7: HLG Rec.2020
  0.40,  // 8: scRGB   (Rec.709 primaries, extended range)
];

// --- Base dynamic range by HDR_COLOR_SPACES index ---
// Relative usable stops / encoding headroom.
const RANGE_BY_CS: number[] = [
  0.90,  // 0: Linear Rec.709   (float, but gamut-limited)
  0.95,  // 1: Linear Rec.2020  (float, wide gamut)
  1.00,  // 2: ACEScg            (scene-linear, full range)
  1.00,  // 3: ACEScc            (log, same scene range)
  1.00,  // 4: ACEScct           (log, same scene range)
  0.25,  // 5: sRGB              (~8 stops, display-referred)
  0.65,  // 6: PQ Rec.2020       (~14 stops, HDR display)
  0.50,  // 7: HLG Rec.2020      (~12 stops, HDR broadcast)
  0.80,  // 8: scRGB             (extended linear range)
];

/**
 * Per-stage transform factor. Each stage multiplies the incoming volume by
 * these factors. A factor of 1.0 means the stage is transparent (no loss).
 *
 * Stages marked `clamp: true` set an absolute ceiling instead of multiplying
 * (the result is clamped to the ceiling, never increased).
 */
interface StageFactor {
  gamut: number;
  range: number;
  clamp?: boolean;  // true = treat values as max ceiling, not multiplier
}

function getStageFactor(stageIndex: number, _settings: PipelineSettings): StageFactor {
  switch (stageIndex) {
    // --- Stages 0–4: all float, non-destructive transforms ---
    // Matrix conversions (ACEScg↔Lin709) are invertible in float.
    // RRT remaps but doesn't clip in float.
    case 0:  // EXR Load
    case 1:  // BC Compress
    case 2:  // BC Decompress
    case 3:  // Color Grade (hub normalization — invertible matrix)
    case 4:  // RRT (tonemapping — non-destructive in float)
      return { gamut: 1.0, range: 1.0 };

    // --- ODT: display adaptation — contrast squashed, gamut barely affected ---
    case 5:
      return { gamut: 0.97, range: 0.55 };

    // --- Output Encode: transfer function slightly limits effective range ---
    case 6:
      return { gamut: 1.0, range: 0.90 };

    // --- Display Remap: black/white level adjustment ---
    case 7:
      return { gamut: 1.0, range: 0.95 };

    // --- Final Display: sRGB clamp — hard ceiling on both ---
    case 8:
      return { gamut: 0.40, range: 0.25, clamp: true };

    default:
      return { gamut: 1.0, range: 1.0 };
  }
}

/**
 * Returns the theoretical color volume at the output of a given pipeline stage.
 *
 * Propagation model: the input color space defines the starting volume, then
 * each enabled stage multiplies it by its factor. Bypassed stages pass through
 * unchanged (factor 1.0). The Final stage clamps to sRGB ceiling.
 *
 * This means the volume can only decrease through the pipeline — never increase.
 */
export function getStageVolume(
  stageIndex: number,
  settings: PipelineSettings,
  stageEnabled: (index: number) => boolean,
): StageVolume {
  // Start with input color space volume
  let gamut = GAMUT_BY_CS[settings.inputColorSpace] ?? 0.50;
  let range = RANGE_BY_CS[settings.inputColorSpace] ?? 0.50;

  // Propagate through each stage up to stageIndex
  for (let i = 0; i <= stageIndex; i++) {
    // Bypassed stages don't transform the signal
    if (i > 0 && !stageEnabled(i)) continue;

    const f = getStageFactor(i, settings);

    if (f.clamp) {
      // Clamp to ceiling — never increase
      gamut = Math.min(gamut, f.gamut);
      range = Math.min(range, f.range);
    } else {
      gamut *= f.gamut;
      range *= f.range;
    }
  }

  return { gamut, range };
}
