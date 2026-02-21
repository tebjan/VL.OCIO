import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC3 — BC1 color + BC4-style interpolated alpha, 16 bytes/block. */
export const bc3Handler: BCFormatHandler = {
  blockSize: 16,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc3-compress.wgsl, create compute pipeline
    throw new Error('BC3 encoder not yet implemented');
  },
};
