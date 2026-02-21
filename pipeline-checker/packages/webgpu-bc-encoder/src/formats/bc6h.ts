import type { BCQuality } from '../index';
import type { BCFormatHandler } from './handler';

/**
 * BC6H — HDR RGB compression, half-float, 14 modes, 16 bytes/block.
 * RGB-only — no alpha channel preserved.
 * Critical format for this project (HDR EXR data).
 *
 * Quality modes:
 * - fast: Mode 11 only
 * - normal: Top partition candidates
 * - high: Exhaustive mode search
 */
export const bc6hHandler: BCFormatHandler = {
  blockSize: 16,
  workgroupSize: [1, 1, 1],

  createPipeline(_device: GPUDevice, _quality: BCQuality): GPUComputePipeline {
    // TODO (task 5.2): Import bc6h-compress.wgsl, create compute pipeline
    // BC6H is the most complex format — 14 modes with different
    // partition patterns, endpoint quantization, and delta encoding.
    throw new Error('BC6H encoder not yet implemented');
  },
};
