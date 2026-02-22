import { useRef, useEffect } from 'react';
import previewBlitWGSL from '../shaders/generated/preview-blit.wgsl?raw';

export interface ThumbnailCanvasProps {
  device: GPUDevice;
  format: GPUTextureFormat;
  texture: GPUTexture | null;
  width: number;
  height: number;
  /** Incremented after each pipeline render to trigger thumbnail refresh. */
  renderVersion?: number;
}

/**
 * Shared GPU resources for thumbnail rendering.
 * Created once per device, reused across all ThumbnailCanvas instances.
 */
interface SharedThumbnailGPU {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

const sharedGPUMap = new WeakMap<GPUDevice, SharedThumbnailGPU>();

function getOrCreateSharedGPU(device: GPUDevice, format: GPUTextureFormat): SharedThumbnailGPU {
  let shared = sharedGPUMap.get(device);
  if (shared) return shared;

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });

  const shaderModule = device.createShaderModule({ code: previewBlitWGSL });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shaderModule, entryPoint: 'vs' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Uniform buffer: zoom=1, pan=0,0, exposure=0 (no adjustment for thumbnails)
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([0.0, 1.0, 0.0, 0.0]));

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  shared = { pipeline, uniformBuffer, bindGroupLayout, sampler };
  sharedGPUMap.set(device, shared);
  return shared;
}

/**
 * Small WebGPU canvas that renders a stage texture as an SDR thumbnail.
 * Uses the same preview-blit shader as Preview2D but with fixed zoom/pan.
 * All instances share a single render pipeline and uniform buffer.
 */
export function ThumbnailCanvas({ device, format, texture, width, height, renderVersion }: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<GPUCanvasContext | null>(null);

  // Configure the canvas WebGPU context on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;

    const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    ctx.configure({ device, format, alphaMode: 'premultiplied' });
    ctxRef.current = ctx;

    return () => {
      ctxRef.current = null;
    };
  }, [device, format, width, height]);

  // Render the texture to the thumbnail canvas
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !texture) return;

    try {
      const shared = getOrCreateSharedGPU(device, format);

      const bindGroup = device.createBindGroup({
        layout: shared.bindGroupLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: shared.uniformBuffer } },
          { binding: 2, resource: shared.sampler },
        ],
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        }],
      });
      pass.setPipeline(shared.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    } catch {
      // getCurrentTexture() can throw during resize — safe to skip this frame
    }
  }, [device, format, texture, renderVersion]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
        borderRadius: '3px',
      }}
    />
  );
}
