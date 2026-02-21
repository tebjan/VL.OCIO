/**
 * Shared render target and texture utilities for the pipeline.
 *
 * Key constants:
 * - rgba32float = 16 bytes/pixel (4 channels x 4 bytes)
 * - WebGPU copyTextureToBuffer requires 256-byte bytesPerRow alignment
 * - writeTexture (upload) does NOT require 256-byte alignment
 */

/** Bytes per pixel for rgba32float: 4 channels x 4 bytes. */
export const BYTES_PER_PIXEL = 16;

/** WebGPU bytesPerRow alignment requirement for copyTextureToBuffer. */
export const ROW_ALIGNMENT = 256;

/**
 * Calculate the 256-byte aligned bytesPerRow for a given width.
 * Required for copyTextureToBuffer (readback), NOT for writeTexture (upload).
 */
export function alignedBytesPerRow(width: number): number {
  return Math.ceil(width * BYTES_PER_PIXEL / ROW_ALIGNMENT) * ROW_ALIGNMENT;
}

/**
 * Copy aligned readback data to a contiguous Float32Array.
 * When bytesPerRow has padding (from 256-byte alignment), each row
 * in the mapped buffer has extra bytes that must be skipped.
 *
 * @param mapped - The mapped Float32Array from a staging buffer
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param bytesPerRow - The aligned bytesPerRow used in copyTextureToBuffer
 * @returns Contiguous Float32Array with width*height*4 elements
 */
export function copyAlignedToContiguous(
  mapped: Float32Array,
  width: number,
  height: number,
  bytesPerRow: number
): Float32Array {
  const result = new Float32Array(width * height * 4);
  const floatsPerAlignedRow = bytesPerRow / 4; // 4 bytes per float

  for (let y = 0; y < height; y++) {
    const srcOffset = y * floatsPerAlignedRow;
    const dstOffset = y * width * 4;
    result.set(
      mapped.subarray(srcOffset, srcOffset + width * 4),
      dstOffset
    );
  }

  return result;
}

/**
 * Upload a Float32Array of RGBA pixel data to a GPUTexture.
 * Used by Stage 1 (EXR Load) to create the source texture.
 *
 * The texture has TEXTURE_BINDING (for sampling by subsequent stages),
 * COPY_SRC (for pixel readback), and COPY_DST (for upload).
 *
 * @param device - The WebGPU device
 * @param data - RGBA float32 pixel data (width * height * 4 elements)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns The created GPUTexture containing the uploaded data
 */
export function uploadFloat32Texture(
  device: GPUDevice,
  data: Float32Array,
  width: number,
  height: number
): GPUTexture {
  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING
         | GPUTextureUsage.COPY_SRC
         | GPUTextureUsage.COPY_DST,
    label: 'EXR Source',
  });

  device.queue.writeTexture(
    { texture },
    data.buffer,
    {
      bytesPerRow: width * BYTES_PER_PIXEL,
      rowsPerImage: height,
    },
    { width, height }
  );

  return texture;
}
