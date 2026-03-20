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
  interactionMode?: 'desktop' | 'mobile';
  showTouchControls?: boolean;
}

interface DragState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

interface PointerPos {
  x: number;
  y: number;
}

interface PinchState {
  baseDistance: number;
  baseZoom: number;
  basePanX: number;
  basePanY: number;
  baseCentroidX: number;
  baseCentroidY: number;
  baseU: number;
  baseV: number;
}

interface TapCandidate {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

/** Uniform buffer stride per layer — must satisfy minUniformBufferOffsetAlignment (256). */
const UNIFORM_STRIDE = 256;
/** Max layers supported. */
const MAX_LAYERS = 4;
/** Uniform struct size: 13 x f32 = 52 bytes. */
const UNIFORM_SIZE = 52;
/** Selected pipeline border width in local UV space. */
const SELECTED_BORDER_WIDTH = 0.003;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 100;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DIST_PX = 24;
const TAP_MOVE_PX = 12;

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function Preview2D({
  device,
  format,
  layers,
  renderVersion,
  interactionMode = 'desktop',
  showTouchControls = false,
}: Preview2DProps) {
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
  const pointerPositionsRef = useRef<Map<number, PointerPos>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const tapCandidateRef = useRef<TapCandidate | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const viewRef = useRef({ zoom: 1.0, panX: 0.0, panY: 0.0 });

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0.0);
  const [panY, setPanY] = useState(0.0);
  const [isDragging, setIsDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState(0); // triggers re-render on resize

  useEffect(() => {
    viewRef.current = { zoom, panX, panY };
  }, [zoom, panX, panY]);

  const setView = useCallback((nextZoom: number, nextPanX: number, nextPanY: number) => {
    const z = clampZoom(nextZoom);
    viewRef.current = { zoom: z, panX: nextPanX, panY: nextPanY };
    setZoom(z);
    setPanX(nextPanX);
    setPanY(nextPanY);
  }, []);

  const resetView = useCallback(() => {
    setView(1.0, 0.0, 0.0);
  }, [setView]);

  const applyZoomAt = useCallback((anchorU: number, anchorV: number, targetZoom: number) => {
    const { zoom: prevZoom, panX: prevPanX, panY: prevPanY } = viewRef.current;
    const newZoom = clampZoom(targetZoom);
    const du = (anchorU - 0.5) * (1 / prevZoom - 1 / newZoom);
    const dv = (anchorV - 0.5) * (1 / prevZoom - 1 / newZoom);
    setView(newZoom, prevPanX + du, prevPanY + dv);
  }, [setView]);

  const applyZoomFactorAtPoint = useCallback((anchorU: number, anchorV: number, factor: number) => {
    applyZoomAt(anchorU, anchorV, viewRef.current.zoom * factor);
  }, [applyZoomAt]);

  const initializePinch = useCallback((canvas: HTMLCanvasElement) => {
    const pointers = [...pointerPositionsRef.current.values()];
    if (pointers.length < 2) return;

    const [a, b] = pointers;
    const rect = canvas.getBoundingClientRect();
    const centroidX = (a.x + b.x) / 2;
    const centroidY = (a.y + b.y) / 2;
    const baseDistance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const { zoom: baseZoom, panX: basePanX, panY: basePanY } = viewRef.current;
    const baseU = rect.width > 0 ? (centroidX - rect.left) / rect.width : 0.5;
    const baseV = rect.height > 0 ? (centroidY - rect.top) / rect.height : 0.5;

    pinchRef.current = {
      baseDistance,
      baseZoom,
      basePanX,
      basePanY,
      baseCentroidX: centroidX,
      baseCentroidY: centroidY,
      baseU,
      baseV,
    };
  }, []);

  const rebaseDragFromRemainingPointer = useCallback(() => {
    const remaining = [...pointerPositionsRef.current.values()][0];
    if (!remaining) {
      dragRef.current = null;
      setIsDragging(false);
      return;
    }
    const { panX: curPanX, panY: curPanY } = viewRef.current;
    dragRef.current = { x: remaining.x, y: remaining.y, panX: curPanX, panY: curPanY };
    setIsDragging(true);
  }, []);

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
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;

      try {
        const canvasAspect = canvas.width / canvas.height;
        const aspects = layers.map((l) => l.texture.width / l.texture.height);
        const combinedAspect = aspects.reduce((s, a) => s + a, 0);

        const slots: { left: number; right: number }[] = [];
        let cumX = 0;
        for (const a of aspects) {
          const left = cumX / combinedAspect;
          cumX += a;
          slots.push({ left, right: cumX / combinedAspect });
        }

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          const slot = slots[i];
          const data = new Float32Array([
            0,
            zoom,
            panX,
            panY,
            layer.applySRGB ? 1.0 : 0.0,
            canvasAspect,
            combinedAspect,
            slot.left,
            slot.right,
            layer.borderColor[0],
            layer.borderColor[1],
            layer.borderColor[2],
            layer.isSelected ? SELECTED_BORDER_WIDTH : 0.0,
          ]);
          device.queue.writeBuffer(gpu.uniformBuffer, i * UNIFORM_STRIDE, data);
        }

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

  // Desktop mouse wheel zoom
  useEffect(() => {
    if (interactionMode !== 'desktop') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const mouseU = (e.clientX - rect.left) / rect.width;
      const mouseV = (e.clientY - rect.top) / rect.height;
      applyZoomFactorAtPoint(mouseU, mouseV, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };

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
  }, [interactionMode, applyZoomFactorAtPoint]);

  const handleDesktopPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const { panX: curPanX, panY: curPanY } = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, panX: curPanX, panY: curPanY };
    setIsDragging(true);
  }, []);

  const handleDesktopPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (e.clientX - drag.x) / rect.width;
    const dy = (e.clientY - drag.y) / rect.height;
    const z = viewRef.current.zoom;
    setView(z, drag.panX - dx / z, drag.panY - dy / z);
  }, [setView]);

  const handleDesktopPointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const handleMobilePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.setPointerCapture(e.pointerId);
    pointerPositionsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (e.pointerType !== 'mouse') {
      tapCandidateRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
    }

    if (pointerPositionsRef.current.size >= 2) {
      dragRef.current = null;
      setIsDragging(false);
      tapCandidateRef.current = null;
      initializePinch(canvas);
      return;
    }

    const { panX: curPanX, panY: curPanY } = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, panX: curPanX, panY: curPanY };
    pinchRef.current = null;
    setIsDragging(true);
  }, [initializePinch]);

  const handleMobilePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (pointerPositionsRef.current.has(e.pointerId)) {
      pointerPositionsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const tapCandidate = tapCandidateRef.current;
    if (tapCandidate && tapCandidate.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > TAP_MOVE_PX) {
        tapCandidate.moved = true;
      }
    }

    if (pointerPositionsRef.current.size >= 2) {
      if (!pinchRef.current) initializePinch(canvas);
      const pinch = pinchRef.current;
      if (!pinch) return;

      const points = [...pointerPositionsRef.current.values()];
      if (points.length < 2) return;
      const [a, b] = points;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const centroidX = (a.x + b.x) / 2;
      const centroidY = (a.y + b.y) / 2;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const scale = dist / Math.max(1, pinch.baseDistance);
      const targetZoom = clampZoom(pinch.baseZoom * scale);

      const du = (pinch.baseU - 0.5) * (1 / pinch.baseZoom - 1 / targetZoom);
      const dv = (pinch.baseV - 0.5) * (1 / pinch.baseZoom - 1 / targetZoom);
      const deltaCx = (centroidX - pinch.baseCentroidX) / rect.width;
      const deltaCy = (centroidY - pinch.baseCentroidY) / rect.height;

      const nextPanX = pinch.basePanX + du - deltaCx / targetZoom;
      const nextPanY = pinch.basePanY + dv - deltaCy / targetZoom;
      setView(targetZoom, nextPanX, nextPanY);
      setIsDragging(false);
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (e.clientX - drag.x) / rect.width;
    const dy = (e.clientY - drag.y) / rect.height;
    const z = viewRef.current.zoom;
    setView(z, drag.panX - dx / z, drag.panY - dy / z);
  }, [initializePinch, setView]);

  const finishMobilePointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>, allowTap: boolean) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    const tapCandidate = tapCandidateRef.current;
    const validTap = allowTap
      && e.pointerType !== 'mouse'
      && tapCandidate
      && tapCandidate.pointerId === e.pointerId
      && !tapCandidate.moved;

    pointerPositionsRef.current.delete(e.pointerId);
    if (tapCandidate?.pointerId === e.pointerId) tapCandidateRef.current = null;

    if (validTap) {
      const now = performance.now();
      const prev = lastTapRef.current;
      if (prev && now - prev.t <= DOUBLE_TAP_MS && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) <= DOUBLE_TAP_DIST_PX) {
        lastTapRef.current = null;
        resetView();
      } else {
        lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      }
    }

    pinchRef.current = null;

    if (pointerPositionsRef.current.size === 1) {
      rebaseDragFromRemainingPointer();
    } else if (pointerPositionsRef.current.size === 0) {
      dragRef.current = null;
      setIsDragging(false);
    }
  }, [rebaseDragFromRemainingPointer, resetView]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'mobile') {
      handleMobilePointerDown(e);
      return;
    }
    handleDesktopPointerDown(e);
  }, [interactionMode, handleDesktopPointerDown, handleMobilePointerDown]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'mobile') {
      handleMobilePointerMove(e);
      return;
    }
    handleDesktopPointerMove(e);
  }, [interactionMode, handleDesktopPointerMove, handleMobilePointerMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'mobile') {
      finishMobilePointer(e, true);
      return;
    }
    handleDesktopPointerUp();
  }, [interactionMode, finishMobilePointer, handleDesktopPointerUp]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'mobile') {
      finishMobilePointer(e, false);
      return;
    }
    handleDesktopPointerUp();
  }, [interactionMode, finishMobilePointer, handleDesktopPointerUp]);

  const handleDoubleClick = useCallback(() => {
    if (interactionMode === 'desktop') resetView();
  }, [interactionMode, resetView]);

  const hasAnyTexture = layers.length > 0;
  const isMobile = interactionMode === 'mobile';

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
          cursor: isMobile ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          touchAction: isMobile ? 'none' : 'auto',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={isMobile ? undefined : handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />

      {isMobile && showTouchControls && (
        <div style={{
          position: 'absolute',
          right: '8px',
          bottom: '8px',
          zIndex: 10,
          display: 'flex',
          gap: '6px',
          background: 'rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '6px',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}>
          <button
            type="button"
            onClick={() => applyZoomFactorAtPoint(0.5, 0.5, 1.15)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '6px',
              border: '1px solid var(--surface-700)',
              background: 'var(--surface-800)',
              color: 'var(--color-text)',
              fontSize: '16px',
              cursor: 'pointer',
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => applyZoomFactorAtPoint(0.5, 0.5, 1 / 1.15)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '6px',
              border: '1px solid var(--surface-700)',
              background: 'var(--surface-800)',
              color: 'var(--color-text)',
              fontSize: '16px',
              cursor: 'pointer',
            }}
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={resetView}
            style={{
              height: '30px',
              minWidth: '44px',
              borderRadius: '6px',
              border: '1px solid var(--surface-700)',
              background: 'var(--surface-800)',
              color: 'var(--color-text)',
              fontSize: '12px',
              padding: '0 8px',
              cursor: 'pointer',
            }}
            title="Fit view"
          >
            Fit
          </button>
        </div>
      )}

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
