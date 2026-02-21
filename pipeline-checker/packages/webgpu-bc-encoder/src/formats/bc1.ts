import type { BCFormatHandler } from './handler';
import bc1Shader from '../shaders/bc1-compress.wgsl?raw';

/** BC1 (DXT1) — 2-color endpoints + 2-bit indices, 8 bytes/block. 1-bit alpha. */
export const bc1Handler: BCFormatHandler = {
  blockSize: 8,
  wordsPerBlock: 2,
  workgroupSize: [1, 1, 1],
  supportsAlpha: false,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc1Shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
