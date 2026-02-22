/**
 * Shared render target and texture utilities for the pipeline.
 *
 * Key constants:
 * - rgba16float = 8 bytes/pixel (4 channels x 2 bytes)
 * - WebGPU copyTextureToBuffer requires 256-byte bytesPerRow alignment
 * - writeTexture (upload) does NOT require 256-byte alignment
 */

import type { DDSParseResult } from './DDSParser';
import decompressWGSL from './shaders/bc-decompress.wgsl?raw';

/** Bytes per pixel for rgba16float: 4 channels x 2 bytes. */
export const BYTES_PER_PIXEL = 8;

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
 * Copy aligned readback data from an rgba16float staging buffer to a
 * contiguous Float32Array. The mapped buffer contains float16 values
 * (2 bytes each) with 256-byte row padding from copyTextureToBuffer.
 *
 * @param mappedBuffer - The ArrayBuffer from staging buffer getMappedRange()
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param bytesPerRow - The aligned bytesPerRow used in copyTextureToBuffer
 * @returns Contiguous Float32Array with width*height*4 elements
 */
export function copyAlignedToContiguous(
  mappedBuffer: ArrayBuffer,
  width: number,
  height: number,
  bytesPerRow: number
): Float32Array {
  const result = new Float32Array(width * height * 4);
  const dv = new DataView(mappedBuffer);
  const pixelBytes = BYTES_PER_PIXEL; // 8 bytes per pixel (4 x float16)

  for (let y = 0; y < height; y++) {
    const rowByteOffset = y * bytesPerRow;
    const dstOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const srcByte = rowByteOffset + x * pixelBytes;
      const dst = dstOffset + x * 4;
      result[dst + 0] = dv.getFloat16(srcByte + 0, true);
      result[dst + 1] = dv.getFloat16(srcByte + 2, true);
      result[dst + 2] = dv.getFloat16(srcByte + 4, true);
      result[dst + 3] = dv.getFloat16(srcByte + 6, true);
    }
  }

  return result;
}

/** WGSL for GPU-side float32→float16 conversion via fullscreen triangle. */
const CONVERT_F32_TO_F16_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
  let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(src, vec2<u32>(u32(pos.x), u32(pos.y)), 0);
}
`;

/**
 * Upload a Float32Array of RGBA pixel data to an rgba16float GPUTexture.
 * Flips rows to WebGPU convention (row 0 = top) since Three.js EXRLoader
 * returns bottom-to-top data (OpenGL convention).
 * GPU handles float32→float16 conversion via render pass.
 */
export function uploadFloat32Texture(
  device: GPUDevice,
  data: Float32Array,
  width: number,
  height: number
): GPUTexture {
  // Flip rows in-place: Three.js EXRLoader returns bottom-to-top (OpenGL order),
  // WebGPU expects top-to-bottom (row 0 = image top).
  const rowSize = width * 4; // 4 floats per pixel (RGBA)
  const temp = new Float32Array(rowSize);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const topOffset = y * rowSize;
    const bottomOffset = (height - 1 - y) * rowSize;
    temp.set(data.subarray(topOffset, topOffset + rowSize));
    data.set(data.subarray(bottomOffset, bottomOffset + rowSize), topOffset);
    data.set(temp, bottomOffset);
  }

  // 1. Upload float32 data to temporary rgba32float texture (no CPU conversion)
  const staging = device.createTexture({
    size: [width, height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: 'Float32 Staging',
  });

  device.queue.writeTexture(
    { texture: staging },
    data as Float32Array<ArrayBuffer>,
    { bytesPerRow: width * 16 },  // 16 bytes/pixel for rgba32float
    { width, height }
  );

  // 2. Create final rgba16float output texture
  const output = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING
         | GPUTextureUsage.RENDER_ATTACHMENT
         | GPUTextureUsage.COPY_SRC,
    label: 'EXR Source',
  });

  // 3. GPU pass: read rgba32float, GPU converts to float16 on write
  const module = device.createShaderModule({
    label: 'f32→f16 convert',
    code: CONVERT_F32_TO_F16_WGSL,
  });

  const bgl = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float' },
    }],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
  });

  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [{ binding: 0, resource: staging.createView() }],
  });

  const encoder = device.createCommandEncoder({ label: 'f32→f16 convert' });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: output.createView(),
      loadOp: 'clear' as GPULoadOp,
      storeOp: 'store' as GPUStoreOp,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  staging.destroy();
  return output;
}

/**
 * Upload a Uint16Array of half-float RGBA pixel data directly to an rgba16float GPUTexture.
 * No staging texture or GPU conversion needed — the data is already in the native format.
 */
export function uploadFloat16Texture(
  device: GPUDevice,
  data: Uint16Array,
  width: number,
  height: number,
): GPUTexture {
  // Flip rows: Three.js EXRLoader returns bottom-to-top (OpenGL order),
  // WebGPU expects top-to-bottom (row 0 = image top).
  const rowSize = width * 4; // 4 x uint16 per pixel
  const temp = new Uint16Array(rowSize);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const topOffset = y * rowSize;
    const bottomOffset = (height - 1 - y) * rowSize;
    temp.set(data.subarray(topOffset, topOffset + rowSize));
    data.set(data.subarray(bottomOffset, bottomOffset + rowSize), topOffset);
    data.set(temp, bottomOffset);
  }

  const output = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING
         | GPUTextureUsage.RENDER_ATTACHMENT
         | GPUTextureUsage.COPY_SRC,
    label: 'EXR Source (f16 direct)',
  });

  device.queue.writeTexture(
    { texture: output },
    data as Uint16Array<ArrayBuffer>,
    { bytesPerRow: width * 8 },  // 8 bytes/pixel for rgba16float
    { width, height },
  );

  return output;
}

/**
 * Upload DDS block data as a native compressed texture and decompress it
 * to an rgba16float texture via a one-shot GPU render pass.
 *
 * The GPU hardware handles decompression automatically during textureSample.
 * Returns the decompressed rgba16float texture ready for the color pipeline.
 */
export function uploadDDSTexture(
  device: GPUDevice,
  dds: DDSParseResult,
): GPUTexture {
  // 1. Create the compressed texture and upload block data
  const compressedTex = device.createTexture({
    size: [dds.width, dds.height],
    format: dds.format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: `DDS Compressed (${dds.formatLabel})`,
  });

  device.queue.writeTexture(
    { texture: compressedTex },
    dds.blockData as Uint8Array<ArrayBuffer>,
    { bytesPerRow: dds.blocksPerRow * dds.blockSize },
    { width: dds.width, height: dds.height },
  );

  // 2. Create rgba16float render target for decompressed output
  const outputTex = device.createTexture({
    size: [dds.width, dds.height],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING
         | GPUTextureUsage.RENDER_ATTACHMENT
         | GPUTextureUsage.COPY_SRC,
    label: 'DDS Decompressed',
  });

  // 3. One-shot decompress pass using the bc-decompress shader
  const shaderModule = device.createShaderModule({
    label: 'DDS Decompress (one-shot)',
    code: decompressWGSL,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shaderModule, entryPoint: 'vs' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: compressedTex.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const encoder = device.createCommandEncoder({ label: 'DDS decompress' });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputTex.createView(),
      loadOp: 'clear' as GPULoadOp,
      storeOp: 'store' as GPUStoreOp,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  // Clean up the compressed texture — we only need the decompressed output
  compressedTex.destroy();

  return outputTex;
}
