import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC2 — BC1 color + 4-bit explicit alpha, 16 bytes/block. */
export const bc2Handler: BCFormatHandler = {
  blockSize: 16,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc2-compress.wgsl, create compute pipeline
    throw new Error('BC2 encoder not yet implemented');
  },
};
