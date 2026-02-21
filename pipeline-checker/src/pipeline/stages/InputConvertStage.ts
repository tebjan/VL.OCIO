import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/input-convert.wgsl?raw';

/** Stage 4: Input Interpretation — any of 9 color spaces → Linear Rec.709 */
export function createInputConvertStage(): FragmentStage {
  return new FragmentStage('Input Convert', 4, fragmentWGSL);
}
