import type { BCFormatHandler } from './handler';
import bc4Shader from '../shaders/bc4-compress.wgsl?raw';

/** BC4 — Single-channel (R) compression, 8 bytes/block. */
export const bc4Handler: BCFormatHandler = {
  blockSize: 8,
  wordsPerBlock: 2,
  workgroupSize: [1, 1, 1],
  supportsAlpha: false,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc4Shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
