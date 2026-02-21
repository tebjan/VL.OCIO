import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/display-remap.wgsl?raw';

/** Stage 9: Display Remap — black/white level compensation */
export function createDisplayRemapStage(): FragmentStage {
  return new FragmentStage('Display Remap', 9, fragmentWGSL);
}
