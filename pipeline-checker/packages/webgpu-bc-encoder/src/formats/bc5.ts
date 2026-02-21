import type { BCFormatHandler } from './handler';
import bc5Shader from '../shaders/bc5-compress.wgsl?raw';

/** BC5 — Two independent BC4 blocks (RG channels), 16 bytes/block. */
export const bc5Handler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: false,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc5Shader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
