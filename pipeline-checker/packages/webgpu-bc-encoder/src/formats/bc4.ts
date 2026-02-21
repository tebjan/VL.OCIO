import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC4 — Single-channel compression, 8 bytes/block. */
export const bc4Handler: BCFormatHandler = {
  blockSize: 8,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc4-compress.wgsl, create compute pipeline
    throw new Error('BC4 encoder not yet implemented');
  },
};
