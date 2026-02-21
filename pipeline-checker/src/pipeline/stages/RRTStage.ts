import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/rrt.wgsl?raw';

/** Stage 6: RRT (Tonemap Curve) — 12 operators, scene-referred → display-referred */
export function createRRTStage(): FragmentStage {
  return new FragmentStage('RRT', 6, fragmentWGSL);
}
