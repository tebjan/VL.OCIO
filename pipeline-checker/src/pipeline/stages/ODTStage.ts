import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/odt.wgsl?raw';

/** Stage 7: ODT (Device Transform) — ACES 1.3/2.0 gamut conversion, or passthrough */
export function createODTStage(): FragmentStage {
  return new FragmentStage('ODT', 7, fragmentWGSL);
}
