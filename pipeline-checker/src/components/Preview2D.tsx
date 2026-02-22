import { useRef, useState, useEffect, useCallback } from 'react';
import previewBlitWGSL from '../shaders/generated/preview-blit.wgsl?raw';

export interface Preview2DProps {
  device: GPUDevice;
  format: GPUTextureFormat;
  stageTexture: GPUTexture | null;
  /** Incremented after each pipeline render to trigger preview refresh. */
  renderVersion?: number;
}

interface DragState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

export function Preview2D({ device, format, stageTexture, renderVersion }: Preview2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gpuRef = useRef<{
    ctx: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    bindGroupLayout: GPUBindGroupLayout;
    sampler: GPUSampler;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number>(0);

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0.0);
  const [panY, setPanY] = useState(0.0);
  const [isDragging, setIsDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState(0); // triggers re-render on resize

  // Initialize WebGPU pipeline on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    ctx.configure({ device, format, alphaMode: 'premultiplied' });

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

    const uniformBuffer = device.createBuffer({
      size: 20, // 5 x f32: viewExposure, zoom, panX, panY, applySRGB
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    gpuRef.current = { ctx, pipeline, uniformBuffer, bindGroupLayout, sampler };

    return () => {
      uniformBuffer.destroy();
    };
  }, [device, format]);

  // Resize canvas to match container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Set initial size synchronously so the first render has valid dimensions
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.max(1, Math.floor(width * devicePixelRatio));
        const h = Math.max(1, Math.floor(height * devicePixelRatio));
        canvas.width = w;
        canvas.height = h;
        // Trigger re-render after resize so the preview updates to new dimensions
        setCanvasSize(w + h);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Render frame when dependencies change
  useEffect(() => {
    const gpu = gpuRef.current;
    if (!gpu || !stageTexture) return;

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      // Guard: skip render if canvas has zero dimensions (ResizeObserver hasn't fired yet)
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;

      try {
        // Write uniforms
        const data = new Float32Array([0, zoom, panX, panY, 1.0]);
        device.queue.writeBuffer(gpu.uniformBuffer, 0, data);

        // Create bind group for current stage texture
        const bindGroup = device.createBindGroup({
          layout: gpu.bindGroupLayout,
          entries: [
            { binding: 0, resource: stageTexture.createView() },
            { binding: 1, resource: { buffer: gpu.uniformBuffer } },
            { binding: 2, resource: gpu.sampler },
          ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: gpu.ctx.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          }],
        });
        pass.setPipeline(gpu.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      } catch {
        // getCurrentTexture() can throw during resize — safe to skip this frame
      }
    });

    return () => cancelAnimationFrame(frameRef.current);
  }, [device, stageTexture, zoom, panX, panY, renderVersion, canvasSize]);

  // Mouse wheel zoom (centered on cursor).
  // Uses a native event listener with { passive: false } to ensure preventDefault()
  // actually works. React's synthetic onWheel is passive in React 17+.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseU = (e.clientX - rect.left) / rect.width;
      const mouseV = (e.clientY - rect.top) / rect.height;

      setZoom((prevZoom) => {
        const newZoom = Math.max(0.1, Math.min(100, prevZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        const du = (mouseU - 0.5) * (1 / prevZoom - 1 / newZoom);
        const dv = (mouseV - 0.5) * (1 / prevZoom - 1 / newZoom);
        setPanX((prev) => prev + du);
        setPanY((prev) => prev + dv);
        return newZoom;
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Click-drag pan
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX, panY };
    setIsDragging(true);
  }, [panX, panY]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / rect.width;
    const dy = (e.clientY - drag.y) / rect.height;
    setPanX(drag.panX - dx / zoom);
    setPanY(drag.panY - dy / zoom);
  }, [zoom]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Double-click fit-to-view
  const handleDoubleClick = useCallback(() => {
    setZoom(1.0);
    setPanX(0.0);
    setPanY(0.0);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--color-bg, #0d0d0d)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
      {!stageTexture && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--color-text-muted, #808080)', fontSize: '14px' }}>
            No image loaded
          </span>
        </div>
      )}
    </div>
  );
}
