import type { BCFormatHandler } from './handler';
import bc2Shader from '../shaders/bc2-compress.wgsl?raw';

/** BC2 — BC1 color + 4-bit explicit alpha, 16 bytes/block. */
export const bc2Handler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: true,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc2Shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
