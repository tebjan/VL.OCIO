import type { BCFormatHandler } from './handler';
import bc7Shader from '../shaders/bc7-compress.wgsl?raw';

/**
 * BC7 — 8 modes, high quality RGBA, full 8-bit alpha, 16 bytes/block.
 *
 * Quality modes:
 * - fast: Mode 6 only (no partitioning, RGBA 7+1 bit)
 * - normal: Mode 6 + try Mode 5
 * - high: Mode 6 + Mode 5 + Mode 3
 */
export const bc7Handler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: true,

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc7Shader });
    module.getCompilationInfo().then(info => {
      for (const msg of info.messages) {
        const prefix = msg.type === 'error' ? '🔴' : msg.type === 'warning' ? '🟡' : 'ℹ️';
        console.error(`${prefix} [BC7 Shader ${msg.type}] line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
      }
      if (info.messages.length === 0) {
        console.log('[BC7] Shader compiled successfully');
      }
    });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
