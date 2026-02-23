import type { BCFormatHandler } from './handler';
import bc6hShader from '../shaders/bc6h-compress.wgsl?raw';

/**
 * BC6H — HDR RGB compression, half-float, 14 modes, 16 bytes/block.
 * RGB-only — no alpha channel preserved.
 * Critical format for this project (HDR EXR data).
 *
 * Quality modes:
 * - fast (0): 1-subset, 10-bit endpoints, 4-bit indices
 * - normal (1): + 1-subset transformed + 2-subset modes 0,1,5,9 x 32 partitions
 * - high (2): all 14 modes x 32 partitions — full exhaustive search
 */
export const bc6hHandler: BCFormatHandler = {
  blockSize: 16,
  wordsPerBlock: 4,
  workgroupSize: [1, 1, 1],
  supportsAlpha: false,
  alphaWarning: 'Alpha not preserved in BC6H format. Use BC7 for RGBA.',

  createPipeline(device: GPUDevice): GPUComputePipeline {
    const module = device.createShaderModule({ code: bc6hShader });
    module.getCompilationInfo().then(info => {
      for (const msg of info.messages) {
        const prefix = msg.type === 'error' ? '🔴' : msg.type === 'warning' ? '🟡' : 'ℹ️';
        console.error(`${prefix} [BC6H Shader ${msg.type}] line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
      }
      if (info.messages.length === 0) {
        console.log('[BC6H] Shader compiled successfully');
      }
    });
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  },
};
