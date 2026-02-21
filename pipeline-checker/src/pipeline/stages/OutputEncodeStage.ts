import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/output-encode.wgsl?raw';

/** Stage 8: Output Encoding — transfer functions (sRGB, PQ, HLG, scRGB) */
export function createOutputEncodeStage(): FragmentStage {
  return new FragmentStage('Output Encode', 8, fragmentWGSL);
}
