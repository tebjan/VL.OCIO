import { FragmentStage } from '../FragmentStage';
import fragmentWGSL from '../../shaders/generated/color-grade.wgsl?raw';

/** Stage 5: Color Grading — Log or Linear workflow, 22 parameters */
export function createColorGradeStage(): FragmentStage {
  return new FragmentStage('Color Grade', 5, fragmentWGSL);
}
