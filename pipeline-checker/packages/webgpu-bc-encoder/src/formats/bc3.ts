import type { BCFormatHandler } from './handler';
import bc3Shader from '../shaders/bc3-compress.wgsl?raw';

/** BC3 — BC1 color + BC4-style interpolated alpha, 16 bytes/block. */
export const bc3Handler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: true,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc3Shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
