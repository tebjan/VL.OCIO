import type { BCFormatHandler } from './handler';
import bc6hShader from '../shaders/bc6h-compress.wgsl?raw';

/**
 * BC6H — HDR RGB compression, half-float, 14 modes, 16 bytes/block.
 * RGB-only — no alpha channel preserved.
 * Critical format for this project (HDR EXR data).
 *
 * Quality modes:
 * - fast: Mode 11 only (no partitioning)
 * - normal: Mode 11 + try Modes 1, 2
 * - high: Mode 11 + Modes 1, 2, 6
 */
export const bc6hHandler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: false,
  alphaWarning: 'Alpha not preserved in BC6H format. Use BC7 for RGBA.',

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc6hShader });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
