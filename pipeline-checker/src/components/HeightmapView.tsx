import { useRef, useEffect, useCallback, useState } from 'react';
import { alignedBytesPerRow, copyAlignedToContiguous } from '../pipeline/TextureUtils';
import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  Color,
  DataTexture,
  RGBAFormat,
  FloatType,
  NearestFilter,
  ClampToEdgeWrapping,
  LinearSRGBColorSpace,
  SpriteNodeMaterial,
  Sprite,
  BoxGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
} from 'three/webgpu';
import type { Material } from 'three/webgpu';
import {
  instancedArray,
  Fn,
  instanceIndex,
  textureLoad,
  uniform,
  ivec2,
  vec2,
  vec3,
  float,
  int,
  select,
  dot,
  clamp,
  max,
  pow,
  log2,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import type { ShaderNodeObject } from 'three/src/nodes/tsl/TSLCore.js';
import type { HeightmapSettings } from '../types/pipeline';

export interface HeightmapViewProps {
  stageTexture: GPUTexture | null;
  /** The pipeline's GPUDevice — needed for GPU readback of stage textures. */
  device: GPUDevice | null;
  active: boolean;
  /** Incremented after each pipeline render to trigger readback refresh. */
  renderVersion?: number;
  /** 3D heightmap display settings from HeightmapControls. */
  settings?: HeightmapSettings;
}

/**
 * Manages Three.js WebGPU renderer, scene, camera, controls, and
 * the TSL compute shader that builds heightmap instance data on the GPU.
 * Instantiated once on first activation; persists across tab switches.
 */
class HeightmapScene {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  private animationId = 0;
  private disposed = false;
  computeFailed = false;
  /** Callback invoked on unrecoverable errors (render loop, device loss). */
  onError: ((message: string) => void) | null = null;

  // --- TSL compute state ---
  /** GPU storage buffer: per-instance vec3 positions */
  positionBuffer: ShaderNodeObject<StorageBufferNode> | null = null;
  /** GPU storage buffer: per-instance vec3 colors */
  colorBuffer: ShaderNodeObject<StorageBufferNode> | null = null;
  /** TSL compute node dispatched before each render */
  computeNode: ShaderNodeObject<ComputeNode> | null = null;
  /** Three.js DataTexture wrapping the stage pixel data (RGBA32F) */
  sourceTexture: DataTexture | null = null;
  /** Current downsampled dimensions */
  dsWidth = 0;
  dsHeight = 0;
  /** Current instance count */
  instanceCount = 0;
  /** Billboard sprite (instanced via .count with SpriteNodeMaterial for billboarding) */
  private billboardMesh: Sprite | null = null;
  /** Wireframe bounding box */
  private wireframeBox: LineSegments | null = null;
  /** Current aspect ratio (height/width) for camera/wireframe */
  private currentAspect = 1;
  /** Current height scale for camera/wireframe */
  private currentHeightScale = 0.1;
  /** Bound event handlers for cleanup */
  private boundDblClick: (() => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  // Uniforms (updated from HeightmapSettings)
  private uDsWidth: ShaderNodeObject<UniformNode<number>> | null = null;
  private uDsHeight: ShaderNodeObject<UniformNode<number>> | null = null;
  private uAspect: ShaderNodeObject<UniformNode<number>> | null = null;
  private uHeightScale: ShaderNodeObject<UniformNode<number>> | null = null;
  private uHeightMode: ShaderNodeObject<UniformNode<number>> | null = null;
  private uExponent: ShaderNodeObject<UniformNode<number>> | null = null;
  private uRangeMin: ShaderNodeObject<UniformNode<number>> | null = null;
  private uRangeMax: ShaderNodeObject<UniformNode<number>> | null = null;
  private uStopsMode: ShaderNodeObject<UniformNode<number>> | null = null;
  private uPerceptualMode: ShaderNodeObject<UniformNode<number>> | null = null;

  constructor() {
    this.renderer = null!;
    this.scene = new Scene();
    this.scene.background = new Color(0x0d0d0d);
    this.camera = new PerspectiveCamera(45, 1, 0.01, 100);
    this.controls = null!;
  }

  async init(canvas: HTMLCanvasElement, sharedDevice: GPUDevice): Promise<void> {
    // Share the pipeline's GPUDevice to avoid creating a second device
    // (dual WebGPU devices cause device loss / page blackout on many drivers)
    this.renderer = new WebGPURenderer({ canvas, antialias: true, device: sharedDevice } as any);
    await this.renderer.init();
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Monitor for device loss
    sharedDevice.lost.then((info: GPUDeviceLostInfo) => {
      if (info.reason !== 'destroyed') {
        console.error('[HeightmapView] GPU device lost:', info.message);
        this.onError?.(`GPU device lost: ${info.message}`);
      }
    });

    this.canvasEl = canvas;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 10;

    // Double-click to reset camera
    this.boundDblClick = () => this.resetCamera();
    canvas.addEventListener('dblclick', this.boundDblClick);

    // F key to frame object
    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (document.activeElement === canvas || canvas.contains(document.activeElement)) {
          this.frameObject();
        }
      }
    };
    window.addEventListener('keydown', this.boundKeyDown);

    this.resetCamera();
  }

  /**
   * Set up (or rebuild) the TSL compute pipeline for a given texture resolution.
   * Creates instancedArray buffers, uniforms, and the Fn() compute shader.
   * Called when the stage texture resolution or downsample factor changes.
   */
  setupCompute(
    fullWidth: number,
    fullHeight: number,
    downsample: number,
  ): void {
    const dsW = Math.max(1, Math.floor(fullWidth / downsample));
    const dsH = Math.max(1, Math.floor(fullHeight / downsample));

    // Skip if dimensions haven't changed
    if (dsW === this.dsWidth && dsH === this.dsHeight) return;

    this.dsWidth = dsW;
    this.dsHeight = dsH;
    const count = dsW * dsH;
    this.instanceCount = count;
    const aspect = fullHeight / fullWidth;

    // Create or recreate source DataTexture (RGBA32F)
    if (this.sourceTexture) this.sourceTexture.dispose();
    const placeholderData = new Float32Array(dsW * dsH * 4);
    this.sourceTexture = new DataTexture(
      placeholderData,
      dsW,
      dsH,
      RGBAFormat,
      FloatType,
    );
    this.sourceTexture.minFilter = NearestFilter;
    this.sourceTexture.magFilter = NearestFilter;
    this.sourceTexture.wrapS = ClampToEdgeWrapping;
    this.sourceTexture.wrapT = ClampToEdgeWrapping;
    this.sourceTexture.colorSpace = LinearSRGBColorSpace;
    this.sourceTexture.needsUpdate = true;

    // GPU storage buffers — data never leaves the GPU
    this.positionBuffer = instancedArray(count, 'vec3');
    this.colorBuffer = instancedArray(count, 'vec3');

    // Uniforms
    this.uDsWidth = uniform(dsW);
    this.uDsHeight = uniform(dsH);
    this.uAspect = uniform(aspect);
    this.uHeightScale = uniform(0.1);
    this.uHeightMode = uniform(0);
    this.uExponent = uniform(1.0);
    this.uRangeMin = uniform(0.0);
    this.uRangeMax = uniform(1.0);
    this.uStopsMode = uniform(0);
    this.uPerceptualMode = uniform(0);

    // Capture refs for the closure
    const posBuf = this.positionBuffer;
    const colBuf = this.colorBuffer;
    const srcTex = this.sourceTexture;
    const uDsW = this.uDsWidth;
    const uDsH = this.uDsHeight;
    const uAsp = this.uAspect;
    const uHS = this.uHeightScale;
    const uHM = this.uHeightMode;
    const uExp = this.uExponent;
    const uRMin = this.uRangeMin;
    const uRMax = this.uRangeMax;
    const uStop = this.uStopsMode;
    const uPerc = this.uPerceptualMode;

    // Luminance weight vectors
    const luminanceRec709 = vec3(0.2126, 0.7152, 0.0722);
    const luminanceAP1 = vec3(0.2722287, 0.6740818, 0.0536895);
    const SQRT3_INV = float(1.0 / Math.sqrt(3.0));

    // Build the TSL compute shader
    this.computeNode = Fn(() => {
      const idx = instanceIndex;
      const gx = idx.mod(uDsW);
      const gy = idx.div(uDsW);

      // textureLoad with integer coords — no sampler needed, valid in compute shaders
      const pixel = textureLoad(srcTex, ivec2(int(gx), int(gy)));

      // --- Height mode selection (GPU-side select() chain) ---
      const h = select(uHM.equal(0),
        pixel.rgb.length().mul(SQRT3_INV),
        select(uHM.equal(1),
          dot(pixel.rgb, luminanceRec709),
          select(uHM.equal(2), pixel.r,
          select(uHM.equal(3), pixel.g,
          select(uHM.equal(4), pixel.b,
          select(uHM.equal(5),
            max(pixel.r, max(pixel.g, pixel.b)),
            dot(pixel.rgb, luminanceAP1),
          )))))).toVar();

      // --- Modifier pipeline ---
      // 1. Range remap: [rangeMin, rangeMax] → [0, 1]
      h.assign(h.sub(uRMin).div(uRMax.sub(uRMin)).clamp(0.0, 1.0));

      // 2. Stops mode: -log2(h)
      h.assign(select(uStop.equal(1),
        log2(max(h, float(1e-10))).negate(), h));

      // 3. Perceptual mode: pow(h, 1/2.2)
      h.assign(select(uPerc.equal(1),
        pow(max(h, float(0.0)), float(1.0 / 2.2)), h));

      // 4. Exponent
      h.assign(pow(max(h, float(0.0)), uExp));

      // --- Grid position (centered, aspect-correct, height-scaled Y) ---
      const x = gx.add(0.5).div(uDsW).sub(0.5);
      const z = gy.add(0.5).div(uDsH).sub(0.5).mul(uAsp);
      const y = h.mul(uHS);

      // Write to GPU storage buffers
      posBuf.element(idx).assign(vec3(x, y, z));
      return colBuf.element(idx).assign(clamp(pixel.rgb, 0.0, 1.0));
    })().compute(count, [64]);
  }

  /**
   * Create or rebuild the billboard sprite mesh that renders the heightmap.
   * Must be called after setupCompute() so storage buffers exist.
   * Uses SpriteNodeMaterial for camera-facing billboards reading
   * position and color from the TSL compute storage buffers.
   */
  setupMesh(fullWidth: number, fullHeight: number): void {
    if (!this.positionBuffer || !this.colorBuffer) return;

    // Remove previous sprite
    if (this.billboardMesh) {
      this.scene.remove(this.billboardMesh);
      (this.billboardMesh.material as SpriteNodeMaterial).dispose();
      this.billboardMesh = null;
    }

    const aspect = fullHeight / fullWidth;
    this.currentAspect = aspect;

    // Update wireframe to match new aspect ratio
    this.updateWireframe(aspect, this.currentHeightScale);
    const cellW = 1.0 / this.dsWidth;
    const cellD = aspect / this.dsHeight;

    // SpriteNodeMaterial reads storage buffers:
    //   positionNode uses .toAttribute() — exposes buffer as per-instance vertex attribute
    //   colorNode uses .element(instanceIndex) — works in fragment shader context
    // (Pattern from Three.js webgpu_compute_particles.html)
    const material = new SpriteNodeMaterial();
    // @ts-expect-error Three.js WebGPU API: toAttribute() exists at runtime but missing from @types/three
    material.positionNode = this.positionBuffer.toAttribute();
    material.colorNode = this.colorBuffer.element(instanceIndex);
    material.scaleNode = vec2(cellW, cellD);
    material.depthWrite = true;
    material.depthTest = true;
    material.sizeAttenuation = true;
    material.transparent = false;

    // Sprite provides internal billboard quad; .count enables instanced rendering
    const sprite = new Sprite(material);
    // @ts-expect-error Three.js WebGPU API: Sprite.count exists at runtime but missing from @types/three
    sprite.count = this.instanceCount;
    sprite.frustumCulled = false;

    this.billboardMesh = sprite;
    this.scene.add(sprite);
  }

  /**
   * Update the source DataTexture with readback pixel data.
   * Called after CPU readback from the pipeline's raw GPUTexture.
   * @param data Float32Array of RGBA pixels (dsWidth * dsHeight * 4 floats)
   */
  updateSourceTexture(data: Float32Array): void {
    if (!this.sourceTexture) return;
    const img = this.sourceTexture.image;
    // DataTexture image.data type is Uint8Array but is actually Float32Array
    // when constructed with FloatType
    (img as unknown as { data: Float32Array }).data = data;
    this.sourceTexture.needsUpdate = true;
  }

  /**
   * Update uniforms from HeightmapSettings (called when settings change).
   */
  updateSettings(settings: HeightmapSettings): void {
    if (this.uHeightMode) this.uHeightMode.value = settings.heightMode;
    if (this.uHeightScale) this.uHeightScale.value = settings.heightScale;
    if (this.uExponent) this.uExponent.value = settings.exponent;
    if (this.uRangeMin) this.uRangeMin.value = settings.rangeMin;
    if (this.uRangeMax) this.uRangeMax.value = settings.rangeMax;
    if (this.uStopsMode) this.uStopsMode.value = settings.stopsMode ? 1 : 0;
    if (this.uPerceptualMode) this.uPerceptualMode.value = settings.perceptualMode ? 1 : 0;

    // Update wireframe if height scale changed
    if (settings.heightScale !== this.currentHeightScale) {
      this.currentHeightScale = settings.heightScale;
      this.updateWireframe(this.currentAspect, this.currentHeightScale);
    }
  }

  /**
   * Create or rebuild the wireframe bounding box surrounding the heightmap grid.
   * Width=1.0, Depth=aspect, Height=heightScale, centered at (0, heightScale*0.5, 0).
   */
  updateWireframe(aspect: number, heightScale: number): void {
    if (this.wireframeBox) {
      this.scene.remove(this.wireframeBox);
      this.wireframeBox.geometry.dispose();
      (this.wireframeBox.material as Material).dispose();
      this.wireframeBox = null;
    }

    const geometry = new BoxGeometry(1.0, heightScale, aspect);
    const edges = new EdgesGeometry(geometry);
    const material = new LineBasicMaterial({ color: 0x444444 });
    this.wireframeBox = new LineSegments(edges, material);
    this.wireframeBox.position.set(0, heightScale * 0.5, 0);
    this.scene.add(this.wireframeBox);
    geometry.dispose(); // EdgesGeometry copies the data; original can be freed
  }

  /**
   * Compute camera distance to fit the entire bounding box in view with 20% padding.
   */
  computeAutoDistance(): number {
    const diagonal = Math.sqrt(
      1.0 + this.currentAspect * this.currentAspect +
      this.currentHeightScale * this.currentHeightScale,
    );
    const fov = this.camera.fov * (Math.PI / 180);
    return (diagonal * 0.5) / Math.tan(fov * 0.5) * 1.2;
  }

  resetCamera(): void {
    const elev = Math.PI / 4; // 45 degrees
    const azim = Math.PI / 6; // 30 degrees
    const dist = this.computeAutoDistance();
    this.camera.position.set(
      dist * Math.cos(elev) * Math.sin(azim),
      dist * Math.sin(elev),
      dist * Math.cos(elev) * Math.cos(azim),
    );
    if (this.controls) {
      this.controls.target.set(0, this.currentHeightScale * 0.25, 0);
      this.controls.update();
    }
  }

  /**
   * Frame the entire object: keep current orbit angles, adjust distance to fit bounding box.
   */
  frameObject(): void {
    if (!this.controls) return;
    const diagonal = Math.sqrt(
      1.0 + this.currentAspect * this.currentAspect +
      this.currentHeightScale * this.currentHeightScale,
    );
    const fov = this.camera.fov * (Math.PI / 180);
    const distance = (diagonal * 0.5) / Math.tan(fov * 0.5);

    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, distance);
    this.controls.update();
  }

  resize(width: number, height: number): void {
    if (!this.renderer || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  startRenderLoop(): void {
    if (this.disposed) return;
    const loop = async () => {
      if (this.disposed) return;
      try {
        if (this.controls) this.controls.update();
        // Run TSL compute to update position/color buffers, then render
        if (this.computeNode && !this.computeFailed && this.renderer) {
          try {
            await this.renderer.computeAsync(this.computeNode);
          } catch (computeErr) {
            console.error('[HeightmapView] Compute shader failed:', computeErr);
            this.computeFailed = true;
            this.onError?.('3D compute shader failed — scene will render without heightmap data');
          }
        }
        // Re-check disposed after await — cleanup may have run during compute
        if (this.disposed || !this.renderer) return;
        await this.renderer.renderAsync(this.scene, this.camera);
      } catch (err) {
        if (this.disposed) return; // Error during shutdown is expected
        console.error('[HeightmapView] Render loop error:', err);
        this.onError?.(`3D render error: ${(err as Error).message}`);
        return;
      }
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stopRenderLoop();

    // Remove event listeners
    if (this.canvasEl && this.boundDblClick) {
      this.canvasEl.removeEventListener('dblclick', this.boundDblClick);
    }
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
    }

    // Wrap GPU resource cleanup in try/catch — dispose can be called while
    // async init is still in flight, leaving Three.js objects partially
    // constructed. Errors here are non-fatal (resources will be GC'd).
    try {
      if (this.billboardMesh) {
        (this.billboardMesh.material as SpriteNodeMaterial).dispose();
      }
    } catch { /* safe to ignore */ }
    try {
      if (this.wireframeBox) {
        this.wireframeBox.geometry.dispose();
        (this.wireframeBox.material as Material).dispose();
      }
    } catch { /* safe to ignore */ }
    try { if (this.controls) this.controls.dispose(); } catch { /* safe to ignore */ }
    try { if (this.sourceTexture) this.sourceTexture.dispose(); } catch { /* safe to ignore */ }
    try { if (this.renderer) this.renderer.dispose(); } catch { /* safe to ignore */ }
  }
}

/**
 * React component wrapping the Three.js WebGPU heightmap scene.
 * Creates its own canvas; the scene persists across tab switches.
 */
export function HeightmapView({ stageTexture, device, active, renderVersion, settings }: HeightmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeightmapScene | null>(null);
  const initRef = useRef(false);
  const readbackIdRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  // Initialize scene on first activation
  useEffect(() => {
    if (!active || initRef.current || !canvasRef.current) return;
    initRef.current = true;

    const scene = new HeightmapScene();
    scene.onError = setError;
    sceneRef.current = scene;

    if (!device) {
      setError('No GPU device available for 3D view');
      return;
    }

    // Track whether cleanup ran before init finished (React Strict Mode / HMR)
    let cancelled = false;

    scene.init(canvasRef.current, device)
      .then(() => {
        // Don't proceed if component was unmounted during async init
        // @ts-expect-error HeightmapScene.disposed is accessed for cleanup check; private access is intentional
        if (cancelled || scene.disposed) return;
        // Initial size
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          scene.resize(rect.width, rect.height);
        }
        scene.startRenderLoop();
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[HeightmapView] Init failed:', err);
        setError(`3D initialization failed: ${(err as Error).message}`);
      });

    return () => {
      cancelled = true;
      scene.dispose();
      sceneRef.current = null;
      initRef.current = false;
    };
  }, [active, device]);

  // GPU readback: read stage texture pixels and feed to Three.js DataTexture
  const doReadback = useCallback(async (
    pipelineDevice: GPUDevice,
    tex: GPUTexture,
    scene: HeightmapScene,
    readbackId: number,
  ) => {
    const { width, height } = tex;
    // Downsample to max ~256 on longest side for 3D view (caps instance count at ~65K)
    const MAX_SIDE = 256;
    const minDownsample = Math.max(1, Math.floor(Math.max(width, height) / MAX_SIDE));
    const downsample = Math.max(minDownsample, 1);
    const dsW = Math.max(1, Math.floor(width / downsample));
    const dsH = Math.max(1, Math.floor(height / downsample));

    if (dsW * dsH > 100_000) {
      console.warn(`[HeightmapView] Instance count ${dsW * dsH} exceeds safety limit, skipping`);
      return;
    }

    const bytesPerRow = alignedBytesPerRow(width);
    const bufferSize = bytesPerRow * height;

    const stagingBuffer = pipelineDevice.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'Heightmap readback',
    });

    const encoder = pipelineDevice.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: tex },
      { buffer: stagingBuffer, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    pipelineDevice.queue.submit([encoder.finish()]);

    // Timeout prevents infinite hang if GPU stalls
    const mapPromise = stagingBuffer.mapAsync(GPUMapMode.READ);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('GPU readback timeout (5s)')), 5000),
    );
    await Promise.race([mapPromise, timeout]);

    // Abort if a newer readback started while we were waiting
    if (readbackIdRef.current !== readbackId) {
      stagingBuffer.unmap();
      stagingBuffer.destroy();
      return;
    }

    const fullData = copyAlignedToContiguous(
      stagingBuffer.getMappedRange(),
      width, height, bytesPerRow,
    );
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    // Downsample to target resolution (nearest-neighbor)
    const dsData = new Float32Array(dsW * dsH * 4);
    for (let y = 0; y < dsH; y++) {
      const srcY = y * downsample;
      for (let x = 0; x < dsW; x++) {
        const srcX = x * downsample;
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * dsW + x) * 4;
        dsData[dstIdx] = fullData[srcIdx];
        dsData[dstIdx + 1] = fullData[srcIdx + 1];
        dsData[dstIdx + 2] = fullData[srcIdx + 2];
        dsData[dstIdx + 3] = fullData[srcIdx + 3];
      }
    }

    // Setup compute/mesh if dimensions changed, then update texture data
    scene.setupCompute(width, height, downsample);
    scene.setupMesh(width, height);
    scene.updateSourceTexture(dsData);
  }, []);

  // Trigger readback when stage texture or render version changes
  useEffect(() => {
    if (!active || !stageTexture || !device) return;
    const scene = sceneRef.current;
    if (!scene || !initRef.current) return;

    const id = ++readbackIdRef.current;
    doReadback(device, stageTexture, scene, id).catch((err) => {
      console.warn('[HeightmapView] Readback failed:', err);
    });
  }, [active, stageTexture, device, renderVersion, doReadback]);

  // Start/stop render loop on active change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (active) {
      scene.startRenderLoop();
    } else {
      scene.stopRenderLoop();
    }
  }, [active]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scene.resize(width, height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Forward HeightmapSettings to the scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !settings) return;
    scene.updateSettings(settings);
  }, [settings]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: active ? 'block' : 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(13, 13, 13, 0.85)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '400px', padding: '24px' }}>
            <div style={{ color: '#e06060', fontSize: '14px', marginBottom: '12px' }}>{error}</div>
            <button
              onClick={() => {
                setError(null);
                const scene = sceneRef.current;
                if (scene) {
                  scene.computeFailed = false;
                  scene.startRenderLoop();
                }
              }}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: '1px solid var(--color-border, #444)',
                background: 'var(--surface-600, #333)',
                color: 'var(--color-text, #ccc)',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
