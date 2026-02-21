import type { PipelineStage } from '../PipelineStage';
import { createInputConvertStage } from './InputConvertStage';
import { createColorGradeStage } from './ColorGradeStage';
import { createRRTStage } from './RRTStage';
import { createODTStage } from './ODTStage';
import { createOutputEncodeStage } from './OutputEncodeStage';
import { createDisplayRemapStage } from './DisplayRemapStage';

/**
 * Create all 6 color pipeline stages in order (Stages 4-9).
 * Pass the returned array to PipelineRenderer.setStages().
 */
export function createColorPipelineStages(): PipelineStage[] {
  return [
    createInputConvertStage(),   // Stage 4: Input Interpretation
    createColorGradeStage(),     // Stage 5: Color Grading
    createRRTStage(),            // Stage 6: RRT (Tonemap Curve)
    createODTStage(),            // Stage 7: ODT (Device Transform)
    createOutputEncodeStage(),   // Stage 8: Output Encoding
    createDisplayRemapStage(),   // Stage 9: Display Remap
  ];
}

export { createInputConvertStage } from './InputConvertStage';
export { createColorGradeStage } from './ColorGradeStage';
export { createRRTStage } from './RRTStage';
export { createODTStage } from './ODTStage';
export { createOutputEncodeStage } from './OutputEncodeStage';
export { createDisplayRemapStage } from './DisplayRemapStage';
