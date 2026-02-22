import type { PipelineStage } from '../PipelineStage';
import { createColorGradeStage } from './ColorGradeStage';
import { createRRTStage } from './RRTStage';
import { createODTStage } from './ODTStage';
import { createOutputEncodeStage } from './OutputEncodeStage';
import { createDisplayRemapStage } from './DisplayRemapStage';

/**
 * Create all 5 color pipeline stages in order.
 * Pass the returned array to PipelineRenderer.setStages().
 */
export function createColorPipelineStages(): PipelineStage[] {
  return [
    createColorGradeStage(),     // Color Grading (handles inputSpace → AP1 internally)
    createRRTStage(),            // RRT (Tonemap Curve)
    createODTStage(),            // ODT (Device Transform)
    createOutputEncodeStage(),   // Output Encoding
    createDisplayRemapStage(),   // Display Remap
  ];
}

export { createColorGradeStage } from './ColorGradeStage';
export { createRRTStage } from './RRTStage';
export { createODTStage } from './ODTStage';
export { createOutputEncodeStage } from './OutputEncodeStage';
export { createDisplayRemapStage } from './DisplayRemapStage';
