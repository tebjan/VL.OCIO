import { useRef, useState, useEffect, useCallback } from 'react';
import previewBlitWGSL from '../shaders/generated/preview-blit.wgsl?raw';

export interface PreviewLayer {
  texture: GPUTexture;
  borderColor: [number, number, number];
  isSelected: boolean;
  applySRGB: boolean;
}

export interface Preview2DProps {
  device: GPUDevice;
  format: GPUTextureFormat;
  layers: PreviewLayer[];
  /** Incremented after each pipeline render to trigger preview refresh. */
  renderVersion?: number;
}

interface DragState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

/** Uniform buffer stride per layer — must satisfy minUniformBufferOffsetAlignment (256). */
const UNIFORM_STRIDE = 256;
/** Max layers supported. */
const MAX_LAYERS = 4;
/** Uniform struct size: 13 x f32 = 52 bytes. */
const UNIFORM_SIZE = 52;
/** Selected pipeline border width in local UV space. */
const SELECTED_BORDER_WIDTH = 0.003;

export function Preview2D({ device, format, layers, renderVersion }: Preview2DProps) {
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

    // Uniform buffer sized for MAX_LAYERS with 256-byte alignment per layer
    const uniformBuffer = device.createBuffer({
      size: UNIFORM_STRIDE * MAX_LAYERS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
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
    if (!gpu || layers.length === 0) return;

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      // Guard: skip render if canvas has zero dimensions (ResizeObserver hasn't fired yet)
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;

      try {
        const canvasAspect = canvas.width / canvas.height;

        // Compute side-by-side layout: each image scaled to same height, placed left-to-right
        const aspects = layers.map((l) => l.texture.width / l.texture.height);
        const combinedAspect = aspects.reduce((s, a) => s + a, 0);

        // Slot positions in combined-row UV [0,1]
        const slots: { left: number; right: number }[] = [];
        let cumX = 0;
        for (const a of aspects) {
          const left = cumX / combinedAspect;
          cumX += a;
          slots.push({ left, right: cumX / combinedAspect });
        }

        // Write uniform data for each layer at 256-byte aligned offsets
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          const slot = slots[i];
          const data = new Float32Array([
            0,                              // viewExposure
            zoom,                           // zoom
            panX,                           // panX
            panY,                           // panY
            layer.applySRGB ? 1.0 : 0.0,   // applySRGB
            canvasAspect,                   // canvasAspect
            combinedAspect,                 // combinedAspect
            slot.left,                      // slotLeft
            slot.right,                     // slotRight
            layer.borderColor[0],           // borderR
            layer.borderColor[1],           // borderG
            layer.borderColor[2],           // borderB
            layer.isSelected ? SELECTED_BORDER_WIDTH : 0.0,  // borderWidth
          ]);
          device.queue.writeBuffer(gpu.uniformBuffer, i * UNIFORM_STRIDE, data);
        }

        // Multi-pass rendering: one pass per layer
        const targetView = gpu.ctx.getCurrentTexture().createView();
        const encoder = device.createCommandEncoder();

        for (let i = 0; i < layers.length; i++) {
          const bindGroup = device.createBindGroup({
            layout: gpu.bindGroupLayout,
            entries: [
              { binding: 0, resource: layers[i].texture.createView() },
              { binding: 1, resource: { buffer: gpu.uniformBuffer, offset: i * UNIFORM_STRIDE, size: UNIFORM_SIZE } },
              { binding: 2, resource: gpu.sampler },
            ],
          });

          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: targetView,
              loadOp: i === 0 ? 'clear' : 'load',
              storeOp: 'store',
              ...(i === 0 ? { clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1 } } : {}),
            }],
          });
          pass.setPipeline(gpu.pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
        }

        device.queue.submit([encoder.finish()]);
      } catch {
        // getCurrentTexture() can throw during resize — safe to skip this frame
      }
    });

    return () => cancelAnimationFrame(frameRef.current);
  }, [device, layers, zoom, panX, panY, renderVersion, canvasSize]);

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

    // Prevent middle-click autoscroll (browser default for button 1).
    // Must prevent on both mousedown and pointerdown to fully suppress autoscroll.
    const preventMiddle = (e: Event) => {
      if ((e as MouseEvent).button === 1) e.preventDefault();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', preventMiddle);
    canvas.addEventListener('pointerdown', preventMiddle);
    canvas.addEventListener('auxclick', preventMiddle);
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', preventMiddle);
      canvas.removeEventListener('pointerdown', preventMiddle);
      canvas.removeEventListener('auxclick', preventMiddle);
    };
  }, []);

  // Click-drag pan (left, middle, or right button)
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

  const hasAnyTexture = layers.length > 0;

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
        onContextMenu={(e) => e.preventDefault()}
      />
      {!hasAnyTexture && (
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
