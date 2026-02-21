import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC7 — 8 modes, high quality RGBA, full 8-bit alpha, 16 bytes/block. */
export const bc7Handler: BCFormatHandler = {
  blockSize: 16,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc7-compress.wgsl, create compute pipeline
    throw new Error('BC7 encoder not yet implemented');
  },
};
