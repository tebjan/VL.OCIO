import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC1 — 2-color endpoints + 2-bit indices, 8 bytes/block. 1-bit alpha. */
export const bc1Handler: BCFormatHandler = {
  blockSize: 8,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc1-compress.wgsl, create compute pipeline
    throw new Error('BC1 encoder not yet implemented');
  },
};
