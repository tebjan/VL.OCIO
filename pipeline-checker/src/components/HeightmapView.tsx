import { useRef, useEffect, useState } from 'react';
import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  Color,
  PlaneGeometry,
  BoxGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
} from 'three/webgpu';
import type { Material } from 'three/webgpu';
import { attribute, positionLocal, modelViewMatrix, uv, float, step, vec3 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { HeightmapSettings } from '../types/pipeline';

export interface HeightmapViewProps {
  stageTexture: GPUTexture | null;
  /** The pipeline's GPUDevice — needed for compute shader dispatch. */
  device: GPUDevice | null;
  active: boolean;
  /** Incremented after each pipeline render to trigger refresh. */
  renderVersion?: number;
  /** 3D heightmap display settings from HeightmapControls. */
  settings?: HeightmapSettings;
}

// ---- Raw WebGPU compute shader (bypasses Three.js TSL which fails on shared devices) ----

const HEIGHTMAP_COMPUTE_WGSL = /* wgsl */`
struct Params {
  dsWidth:        u32,
  dsHeight:       u32,
  aspect:         f32,
  heightScale:    f32,
  exponent:       f32,
  heightMode:     u32,
  rangeMin:       f32,
  rangeMax:       f32,
  fullWidth:      u32,
  fullHeight:     u32,
  stopsMode:      u32,
  perceptualMode: u32,
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> colors:    array<vec4<f32>>;
@group(0) @binding(3) var srcTex: texture_2d<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= p.dsWidth * p.dsHeight) { return; }

  let gx = idx % p.dsWidth;
  let gy = idx / p.dsWidth;

  // Map downsampled grid to full-resolution texture coordinates
  let srcX = gx * p.fullWidth / p.dsWidth;
  let srcY = gy * p.fullHeight / p.dsHeight;
  let pixel = textureLoad(srcTex, vec2<u32>(srcX, srcY), 0);
  let r = pixel.r;
  let g = pixel.g;
  let b = pixel.b;

  // Height mode selection
  var h: f32;
  switch (p.heightMode) {
    case 0u: { h = sqrt(r * r + g * g + b * b) / sqrt(3.0); }
    case 1u: { h = 0.2126 * r + 0.7152 * g + 0.0722 * b; }
    case 2u: { h = r; }
    case 3u: { h = g; }
    case 4u: { h = b; }
    case 5u: { h = max(r, max(g, b)); }
    case 6u: { h = 0.2722287 * r + 0.6740818 * g + 0.0536895 * b; }
    default: { h = 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  }

  // Range remap — no clamping, exact values for scientific display
  let range = max(p.rangeMax - p.rangeMin, 0.0001);
  h = (h - p.rangeMin) / range;

  // Stops mode: -log2(h)
  if (p.stopsMode != 0u) {
    h = -log2(max(h, 0.00001));
  }

  // Perceptual mode: gamma 2.2
  if (p.perceptualMode != 0u) {
    let ps = select(-1.0, 1.0, h >= 0.0);
    h = ps * pow(abs(h), 1.0 / 2.2);
  }

  // Exponent (sign-preserving) + scale
  let sign = select(-1.0, 1.0, h >= 0.0);
  h = sign * pow(abs(h), p.exponent) * p.heightScale;

  // Grid position
  let x = (f32(gx) + 0.5) / f32(p.dsWidth) - 0.5;
  let z = ((f32(gy) + 0.5) / f32(p.dsHeight) - 0.5) * p.aspect;

  positions[idx] = vec4<f32>(x, h, z, 1.0);
  colors[idx]    = vec4<f32>(r, g, b, 1.0);
}
`;

/**
 * Raw WebGPU compute pipeline for heightmap data.
 * Writes directly to shared GPU buffers (STORAGE|VERTEX) — no readback.
 * The same buffers are read by Three.js as vertex instance attributes.
 */
/** Uniform buffer layout — 48 bytes (12 x u32/f32), 16-byte aligned */
const UNIFORM_SIZE = 48;

class HeightmapCompute {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private count = 0;
  // Cached references for re-binding when texture changes
  private posBuffer: GPUBuffer | null = null;
  private colBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Create pipeline (once) and bind storage buffers + texture. */
  setup(
    dsWidth: number, dsHeight: number, aspect: number,
    fullWidth: number, fullHeight: number,
    positionBuffer: GPUBuffer, colorBuffer: GPUBuffer,
    texture: GPUTexture,
    settings: HeightmapSettings,
  ): void {
    this.count = dsWidth * dsHeight;
    this.posBuffer = positionBuffer;
    this.colBuffer = colorBuffer;

    this.uniformBuffer?.destroy();
    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'hm-params',
    });

    this.writeUniforms(dsWidth, dsHeight, aspect, fullWidth, fullHeight, settings);

    // Create pipeline once (cached across setup() calls)
    if (!this.pipeline) {
      const module = this.device.createShaderModule({
        code: HEIGHTMAP_COMPUTE_WGSL,
        label: 'hm-compute',
      });
      this.pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
    }

    this.rebindTexture(texture);
  }

  /** Rebind with a (potentially new) texture view — call after pipeline render. */
  rebindTexture(texture: GPUTexture): void {
    if (!this.pipeline || !this.uniformBuffer || !this.posBuffer || !this.colBuffer) return;

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.posBuffer } },
        { binding: 2, resource: { buffer: this.colBuffer } },
        { binding: 3, resource: texture.createView() },
      ],
    });
  }

  /** Update uniforms without recreating buffers/pipeline. */
  updateSettings(
    dsWidth: number, dsHeight: number, aspect: number,
    fullWidth: number, fullHeight: number,
    settings: HeightmapSettings,
  ): void {
    this.writeUniforms(dsWidth, dsHeight, aspect, fullWidth, fullHeight, settings);
  }

  private writeUniforms(
    dsWidth: number, dsHeight: number, aspect: number,
    fullWidth: number, fullHeight: number,
    settings: HeightmapSettings,
  ): void {
    if (!this.uniformBuffer) return;
    const buf = new ArrayBuffer(UNIFORM_SIZE);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    // Offset 0: dsWidth (u32)
    u[0] = dsWidth;
    // Offset 4: dsHeight (u32)
    u[1] = dsHeight;
    // Offset 8: aspect (f32)
    f[2] = aspect;
    // Offset 12: heightScale (f32)
    f[3] = settings.heightScale;
    // Offset 16: exponent (f32)
    f[4] = settings.exponent;
    // Offset 20: heightMode (u32)
    u[5] = settings.heightMode;
    // Offset 24: rangeMin (f32)
    f[6] = settings.rangeMin;
    // Offset 28: rangeMax (f32)
    f[7] = settings.rangeMax;
    // Offset 32: fullWidth (u32)
    u[8] = fullWidth;
    // Offset 36: fullHeight (u32)
    u[9] = fullHeight;
    // Offset 40: stopsMode (u32)
    u[10] = settings.stopsMode ? 1 : 0;
    // Offset 44: perceptualMode (u32)
    u[11] = settings.perceptualMode ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);
  }

  /** Dispatch compute — writes directly to bound GPU buffers, no readback. */
  dispatch(): void {
    if (!this.pipeline || !this.bindGroup) {
      throw new Error('HeightmapCompute not set up');
    }
    const encoder = this.device.createCommandEncoder({ label: 'hm-compute-enc' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
  }
}

/**
 * Manages Three.js WebGPU renderer, scene, camera, controls, and
 * instanced geometry that renders the heightmap point cloud.
 *
 * GPU-only path: compute shader writes vec4 position/color to storage buffers
 * that are simultaneously used as vertex instance attributes by Three.js —
 * no CPU readback or data transfer.
 */
class HeightmapScene {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  ready = false;
  private animationId = 0;
  disposed = false;
  /** Callback invoked on unrecoverable errors (render loop, device loss). */
  onError: ((message: string) => void) | null = null;

  /** Current downsampled dimensions */
  dsWidth = 0;
  dsHeight = 0;
  /** Current instance count */
  instanceCount = 0;
  /** Instanced mesh rendering the heightmap points */
  private pointsMesh: Mesh | null = null;
  /** Wireframe bounding box */
  private wireframeBox: LineSegments | null = null;
  /** Current aspect ratio (height/width) for camera/wireframe */
  private currentAspect = 1;
  /** Current height scale for camera/wireframe */
  private currentHeightScale = 0.25;
  /** Bound event handlers for cleanup */
  private boundDblClick: (() => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  // GPU buffers shared between compute (storage) and render (vertex)
  private offsetGpuBuffer: GPUBuffer | null = null;
  private colorGpuBuffer: GPUBuffer | null = null;
  private device: GPUDevice | null = null;
  private compute: HeightmapCompute | null = null;
  // Cached references for re-dispatch
  private currentTexture: GPUTexture | null = null;
  private fullWidth = 0;
  private fullHeight = 0;

  constructor() {
    this.renderer = null!;
    this.scene = new Scene();
    this.scene.background = new Color(0x0d0d0d);
    this.camera = new PerspectiveCamera(45, 1, 0.01, 100);
    this.controls = null!;
  }

  async init(canvas: HTMLCanvasElement, sharedDevice: GPUDevice): Promise<void> {
    this.device = sharedDevice;
    this.renderer = new WebGPURenderer({ canvas, antialias: true, device: sharedDevice } as any);
    await this.renderer.init();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.compute = new HeightmapCompute(sharedDevice);

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

    this.boundDblClick = () => this.resetCamera();
    canvas.addEventListener('dblclick', this.boundDblClick);

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (document.activeElement === canvas || canvas.contains(document.activeElement)) {
          this.frameObject();
        }
      }
    };
    window.addEventListener('keydown', this.boundKeyDown);

    this.resetCamera();
    this.ready = true;
  }

  /**
   * Set up dimensions for a given texture resolution.
   * Returns true if dimensions changed.
   */
  setupDimensions(
    fullWidth: number,
    fullHeight: number,
    downsample: number,
  ): boolean {
    const dsW = Math.max(1, Math.floor(fullWidth / downsample));
    const dsH = Math.max(1, Math.floor(fullHeight / downsample));

    if (dsW === this.dsWidth && dsH === this.dsHeight) return false;

    this.dsWidth = dsW;
    this.dsHeight = dsH;
    this.instanceCount = dsW * dsH;
    return true;
  }

  /**
   * Create or rebuild the instanced geometry and GPU buffers.
   * GPU buffers are created with STORAGE|VERTEX so they can be written by
   * compute and read as vertex attributes — zero CPU involvement.
   */
  setupMesh(fullWidth: number, fullHeight: number, texture: GPUTexture, settings: HeightmapSettings): void {
    // Remove previous mesh
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      this.pointsMesh.geometry.dispose();
      (this.pointsMesh.material as Material).dispose();
      this.pointsMesh = null;
    }

    // Destroy old GPU buffers
    this.offsetGpuBuffer?.destroy();
    this.colorGpuBuffer?.destroy();
    this.offsetGpuBuffer = null;
    this.colorGpuBuffer = null;

    const dsW = this.dsWidth;
    const dsH = this.dsHeight;
    const count = this.instanceCount;
    if (count === 0 || !this.device) return;

    const aspect = fullHeight / fullWidth;
    this.currentAspect = aspect;
    this.updateWireframe(aspect, this.currentHeightScale);

    const cellW = 1.0 / dsW;
    const cellD = aspect / dsH;
    const dotSize = Math.max(cellW, cellD);

    // ---- GPU buffers shared between compute and render ----
    const byteSize = count * 16; // vec4<f32> = 16 bytes per instance
    this.offsetGpuBuffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
           | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'hm-offset',
    });
    this.colorGpuBuffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
           | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'hm-color',
    });

    // ---- Instanced geometry (XY plane quad, no rotation — billboard handles orientation) ----
    const baseGeo = new PlaneGeometry(dotSize, dotSize);

    const geo = new InstancedBufferGeometry();
    geo.index = baseGeo.index;
    geo.setAttribute('position', baseGeo.getAttribute('position'));
    geo.setAttribute('uv', baseGeo.getAttribute('uv'));
    geo.instanceCount = count;

    // Instance attributes — CPU arrays are dummy; compute fills the GPU buffers directly
    const offsetAttr = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const colorAttr = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    geo.setAttribute('aOffset', offsetAttr);
    geo.setAttribute('aColor', colorAttr);

    // Pre-register our GPU buffers with Three.js backend.
    // Setting .buffer before the first render makes Three.js skip its own
    // buffer creation and use ours instead (which have STORAGE usage).
    const backend = (this.renderer as any).backend;
    backend.get(offsetAttr).buffer = this.offsetGpuBuffer;
    backend.get(colorAttr).buffer = this.colorGpuBuffer;

    // ---- Billboard node material ----
    // Extract camera right/up from modelViewMatrix (= viewMatrix since model is identity).
    // Row 0 = camera right, Row 1 = camera up in world space.
    // Column-major: row i component j = element(j)[i].
    const camRight = vec3(
      modelViewMatrix.element(0).x,
      modelViewMatrix.element(1).x,
      modelViewMatrix.element(2).x,
    );
    const camUp = vec3(
      modelViewMatrix.element(0).y,
      modelViewMatrix.element(1).y,
      modelViewMatrix.element(2).y,
    );

    // Billboard: quad offset in camera-aligned frame
    const instancePos = attribute('aOffset', 'vec4').xyz;
    const local = positionLocal;
    const billboardPos = instancePos
      .add(camRight.mul(local.x))
      .add(camUp.mul(local.y));

    const material = new MeshBasicNodeMaterial();
    (material as any).positionNode = billboardPos;
    (material as any).colorNode = attribute('aColor', 'vec4').xyz;

    // Round dot: discard fragments outside a circle in UV space
    const uvCentered = uv().sub(float(0.5));
    const distSq = uvCentered.dot(uvCentered);
    (material as any).opacityNode = float(1.0).sub(step(float(0.25), distSq));
    material.alphaTest = 0.5;
    material.depthWrite = true;

    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    this.pointsMesh = mesh;
    this.scene.add(mesh);

    // ---- Dispatch compute to fill buffers from texture ----
    this.currentTexture = texture;
    // settings consumed via compute uniforms
    this.fullWidth = fullWidth;
    this.fullHeight = fullHeight;
    this.compute!.setup(
      dsW, dsH, aspect, fullWidth, fullHeight,
      this.offsetGpuBuffer, this.colorGpuBuffer,
      texture, settings,
    );
    this.compute!.dispatch();
  }

  /**
   * Re-dispatch compute with new texture content (same dimensions).
   * Called when renderVersion changes but texture size hasn't.
   */
  redispatch(texture: GPUTexture): void {
    if (!this.compute || !this.offsetGpuBuffer || !this.colorGpuBuffer) return;
    this.currentTexture = texture;
    this.compute.rebindTexture(texture);
    this.compute.dispatch();
  }

  /**
   * Update settings from HeightmapControls.
   * For mock data only the wireframe reacts; texture-based height will
   * re-dispatch compute with updated uniforms.
   */
  updateSettings(settings: HeightmapSettings): void {
    if (settings.heightScale !== this.currentHeightScale) {
      this.currentHeightScale = settings.heightScale;
      this.updateWireframe(this.currentAspect, this.currentHeightScale);
    }
    // Re-dispatch compute with updated uniforms
    // settings consumed via compute uniforms
    if (this.compute && this.offsetGpuBuffer && this.currentTexture) {
      this.compute.updateSettings(
        this.dsWidth, this.dsHeight, this.currentAspect,
        this.fullWidth, this.fullHeight, settings,
      );
      this.compute.dispatch();
    }
  }

  /**
   * Create or rebuild the wireframe bounding box.
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
    geometry.dispose();
  }

  computeAutoDistance(): number {
    const diagonal = Math.sqrt(
      1.0 + this.currentAspect * this.currentAspect +
      this.currentHeightScale * this.currentHeightScale,
    );
    const fov = this.camera.fov * (Math.PI / 180);
    return (diagonal * 0.5) / Math.tan(fov * 0.5) * 1.2;
  }

  resetCamera(): void {
    const elev = Math.PI / 4;
    const azim = Math.PI / 6;
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
        if (this.disposed || !this.renderer) return;
        await this.renderer.renderAsync(this.scene, this.camera);
      } catch (err) {
        if (this.disposed) return;
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

    if (this.canvasEl && this.boundDblClick) {
      this.canvasEl.removeEventListener('dblclick', this.boundDblClick);
    }
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
    }

    try {
      if (this.pointsMesh) {
        this.pointsMesh.geometry.dispose();
        (this.pointsMesh.material as Material).dispose();
      }
    } catch { /* safe to ignore */ }
    try {
      if (this.wireframeBox) {
        this.wireframeBox.geometry.dispose();
        (this.wireframeBox.material as Material).dispose();
      }
    } catch { /* safe to ignore */ }
    try { if (this.controls) this.controls.dispose(); } catch { /* safe to ignore */ }
    try { if (this.renderer) this.renderer.dispose(); } catch { /* safe to ignore */ }

    this.compute?.destroy();
    this.offsetGpuBuffer?.destroy();
    this.colorGpuBuffer?.destroy();
  }
}

/**
 * React component wrapping the Three.js WebGPU heightmap scene.
 * Fully GPU-driven: compute shader → shared buffers → instanced render.
 */
export function HeightmapView({ stageTexture, device, active, renderVersion, settings }: HeightmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeightmapScene | null>(null);
  const initRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  // Initialise Three.js scene + renderer
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

    let cancelled = false;

    scene.init(canvasRef.current, device)
      .then(() => {
        if (cancelled || scene.disposed) return;
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          scene.resize(rect.width, rect.height);
        }
        scene.startRenderLoop();
        setSceneReady(true);
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
      setSceneReady(false);
    };
  }, [active, device]);

  // Setup mesh when texture dimensions or downsample change; re-dispatch on renderVersion
  useEffect(() => {
    if (!active || !stageTexture || !device || !sceneReady || !settings) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const { width, height } = stageTexture;
    const MAX_SIDE = 256;
    const minDownsample = Math.max(1, Math.floor(Math.max(width, height) / MAX_SIDE));
    const downsample = Math.max(minDownsample, settings.downsample);

    const dsW = Math.max(1, Math.floor(width / downsample));
    const dsH = Math.max(1, Math.floor(height / downsample));

    if (dsW * dsH > 100_000) {
      console.warn(`[HeightmapView] Instance count ${dsW * dsH} exceeds safety limit, skipping`);
      return;
    }

    const changed = scene.setupDimensions(width, height, downsample);
    if (changed) {
      scene.setupMesh(width, height, stageTexture, settings);
    } else {
      // Dimensions unchanged — just re-dispatch with (possibly new) texture content
      scene.redispatch(stageTexture);
    }
  }, [active, stageTexture, device, renderVersion, settings?.downsample, sceneReady]);

  // Render loop start/stop on visibility
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (active) {
      scene.startRenderLoop();
    } else {
      scene.stopRenderLoop();
    }
  }, [active]);

  // Container resize
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

  // Settings changes
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
                if (scene) scene.startRenderLoop();
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
