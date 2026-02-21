import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/** BC5 — Two independent BC4 blocks (RG channels), 16 bytes/block. */
export const bc5Handler: BCFormatHandler = {
  blockSize: 16,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc5-compress.wgsl, create compute pipeline
    throw new Error('BC5 encoder not yet implemented');
  },
};
