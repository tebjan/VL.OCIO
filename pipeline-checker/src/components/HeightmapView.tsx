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
import { attribute, positionLocal, modelViewMatrix, uv, float, fwidth, smoothstep, vec3 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { HeightmapSettings } from '../types/pipeline';

export interface HeightmapLayer {
  texture: GPUTexture;
  wireframeColor: [number, number, number];
  isSelected: boolean;
}

export interface HeightmapViewProps {
  layers: HeightmapLayer[];
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

/** Uniform buffer layout — 48 bytes (12 x u32/f32), 16-byte aligned */
const UNIFORM_SIZE = 48;

class HeightmapCompute {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private count = 0;
  private posBuffer: GPUBuffer | null = null;
  private colBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

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
    u[0] = dsWidth;
    u[1] = dsHeight;
    f[2] = aspect;
    f[3] = settings.heightScale;
    f[4] = settings.exponent;
    u[5] = settings.heightMode;
    f[6] = settings.rangeMin;
    f[7] = settings.rangeMax;
    u[8] = fullWidth;
    u[9] = fullHeight;
    u[10] = settings.stopsMode ? 1 : 0;
    u[11] = settings.perceptualMode ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);
  }

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

// ---- Multi-layer heightmap scene ----

const LAYER_GAP = 0.05;

interface LayerEntry {
  mesh: Mesh;
  wireframe: LineSegments;
  offsetGpuBuffer: GPUBuffer;
  colorGpuBuffer: GPUBuffer;
  compute: HeightmapCompute;
  dsWidth: number;
  dsHeight: number;
  instanceCount: number;
  fullWidth: number;
  fullHeight: number;
  aspect: number;
  xOffset: number;
  texture: GPUTexture;
  color: [number, number, number];
  isSelected: boolean;
}

class HeightmapScene {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  ready = false;
  private animationId = 0;
  disposed = false;
  onError: ((message: string) => void) | null = null;

  private layerEntries: LayerEntry[] = [];
  private sharedMaterial: MeshBasicNodeMaterial | null = null;
  private currentHeightScale = 0.25;
  private totalWidth = 1;
  private maxAspect = 1;

  private boundDblClick: (() => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private device: GPUDevice | null = null;

  get layerCount(): number { return this.layerEntries.length; }

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

  /** Create the billboard node material (shared across all layer meshes). */
  private createMaterial(msaaOn: boolean): MeshBasicNodeMaterial {
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

    const instancePos = attribute('aOffset', 'vec4').xyz;
    const local = positionLocal;
    const billboardPos = instancePos
      .add(camRight.mul(local.x))
      .add(camUp.mul(local.y));

    const material = new MeshBasicNodeMaterial();
    (material as any).positionNode = billboardPos;
    (material as any).colorNode = attribute('aColor', 'vec4').xyz;

    const uvCentered = uv().sub(float(0.5));
    const dist = uvCentered.length().sub(float(0.5));
    const halfPx = fwidth(dist).mul(float(0.5));
    (material as any).opacityNode = float(1.0).sub(smoothstep(halfPx.negate(), halfPx, dist));
    material.depthWrite = true;
    this.applyAlphaMode(material, msaaOn);
    return material;
  }

  private applyAlphaMode(material: MeshBasicNodeMaterial, msaaOn: boolean): void {
    if (msaaOn) {
      material.alphaToCoverage = true;
      material.alphaTest = 0;
    } else {
      material.alphaToCoverage = false;
      material.alphaTest = 0.5;
    }
    material.needsUpdate = true;
  }

  /** Compute X offsets for N layers placed side by side. */
  private computeLayout(n: number): { totalWidth: number; offsets: number[] } {
    const totalWidth = n + (n - 1) * LAYER_GAP;
    const offsets: number[] = [];
    for (let i = 0; i < n; i++) {
      offsets.push(i * (1.0 + LAYER_GAP) - totalWidth / 2 + 0.5);
    }
    return { totalWidth, offsets };
  }

  /** Create a wireframe bounding box for a layer. */
  private createWireframe(
    aspect: number,
    heightScale: number,
    color: [number, number, number],
    xOffset: number,
    isSelected: boolean,
  ): LineSegments {
    const geometry = new BoxGeometry(1.0, heightScale, aspect);
    const edges = new EdgesGeometry(geometry);
    const material = new LineBasicMaterial({
      color: new Color(color[0], color[1], color[2]),
      opacity: isSelected ? 1.0 : 0.5,
      transparent: true,
    });
    const wireframe = new LineSegments(edges, material);
    wireframe.position.set(xOffset, heightScale * 0.5, 0);
    geometry.dispose();
    return wireframe;
  }

  /** Remove all layer entries and free GPU resources. */
  clearLayers(): void {
    for (const entry of this.layerEntries) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      this.scene.remove(entry.wireframe);
      entry.wireframe.geometry.dispose();
      (entry.wireframe.material as Material).dispose();
      entry.offsetGpuBuffer.destroy();
      entry.colorGpuBuffer.destroy();
      entry.compute.destroy();
    }
    this.layerEntries = [];
    if (this.sharedMaterial) {
      this.sharedMaterial.dispose();
      this.sharedMaterial = null;
    }
  }

  /**
   * Build all layers: meshes, wireframes, GPU buffers, compute.
   * Called when layer count or dimensions change.
   */
  setupLayers(layerData: HeightmapLayer[], settings: HeightmapSettings): void {
    this.clearLayers();
    if (layerData.length === 0 || !this.device) return;

    const n = layerData.length;
    const { totalWidth, offsets } = this.computeLayout(n);
    this.totalWidth = totalWidth;
    this.currentHeightScale = settings.heightScale;

    // Compute per-layer info
    let maxAspect = 0;
    const infos: Array<{
      dsW: number; dsH: number; count: number; aspect: number;
      fullW: number; fullH: number; dotSize: number;
    }> = [];

    for (let i = 0; i < n; i++) {
      const tex = layerData[i].texture;
      const fullW = tex.width;
      const fullH = tex.height;
      const aspect = fullH / fullW;
      if (aspect > maxAspect) maxAspect = aspect;

      // Auto-increase downsample if instance count would exceed budget
      const MAX_INSTANCES = 10_000_000;
      let ds = settings.downsample;
      let dsW = Math.max(1, Math.floor(fullW / ds));
      let dsH = Math.max(1, Math.floor(fullH / ds));
      while (dsW * dsH > MAX_INSTANCES && ds < 128) {
        ds *= 2;
        dsW = Math.max(1, Math.floor(fullW / ds));
        dsH = Math.max(1, Math.floor(fullH / ds));
      }
      const count = dsW * dsH;

      const cellW = 1.0 / dsW;
      const cellD = aspect / dsH;
      const dotSize = Math.max(cellW, cellD);

      infos.push({ dsW, dsH, count, aspect, fullW, fullH, dotSize });
    }
    this.maxAspect = maxAspect;

    // Create shared material
    this.sharedMaterial = this.createMaterial(settings.msaa > 0);

    // Create layer entries
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const tex = layerData[i].texture;
      const color = layerData[i].wireframeColor;
      const isSelected = layerData[i].isSelected;
      const xOffset = offsets[i];

      // GPU buffers shared between compute (storage) and render (vertex)
      const byteSize = info.count * 16;
      const offsetGpuBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
             | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        label: `hm-offset-${i}`,
      });
      const colorGpuBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
             | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        label: `hm-color-${i}`,
      });

      // Instanced geometry
      const baseGeo = new PlaneGeometry(info.dotSize, info.dotSize);
      const geo = new InstancedBufferGeometry();
      geo.index = baseGeo.index;
      geo.setAttribute('position', baseGeo.getAttribute('position'));
      geo.setAttribute('uv', baseGeo.getAttribute('uv'));
      geo.instanceCount = info.count;

      const offsetAttr = new InstancedBufferAttribute(new Float32Array(info.count * 4), 4);
      const colorAttr = new InstancedBufferAttribute(new Float32Array(info.count * 4), 4);
      geo.setAttribute('aOffset', offsetAttr);
      geo.setAttribute('aColor', colorAttr);

      // Register GPU buffers with Three.js backend
      const backend = (this.renderer as any).backend;
      backend.get(offsetAttr).buffer = offsetGpuBuffer;
      backend.get(colorAttr).buffer = colorGpuBuffer;

      // Mesh (shared material, positioned at X offset)
      const mesh = new Mesh(geo, this.sharedMaterial);
      mesh.frustumCulled = false;
      mesh.position.x = xOffset;
      this.scene.add(mesh);

      // Wireframe
      const wireframe = this.createWireframe(
        info.aspect, settings.heightScale, color, xOffset, isSelected,
      );
      this.scene.add(wireframe);

      // Compute
      const compute = new HeightmapCompute(this.device);
      compute.setup(
        info.dsW, info.dsH, info.aspect, info.fullW, info.fullH,
        offsetGpuBuffer, colorGpuBuffer, tex, settings,
      );
      compute.dispatch();

      this.layerEntries.push({
        mesh,
        wireframe,
        offsetGpuBuffer,
        colorGpuBuffer,
        compute,
        dsWidth: info.dsW,
        dsHeight: info.dsH,
        instanceCount: info.count,
        fullWidth: info.fullW,
        fullHeight: info.fullH,
        aspect: info.aspect,
        xOffset,
        texture: tex,
        color,
        isSelected,
      });
    }

    this.resetCamera();
  }

  /** Re-dispatch compute for all layers with (possibly new) texture content. */
  redispatchLayers(layerData: HeightmapLayer[]): void {
    for (let i = 0; i < this.layerEntries.length && i < layerData.length; i++) {
      const entry = this.layerEntries[i];
      const tex = layerData[i].texture;
      entry.compute.rebindTexture(tex);
      entry.compute.dispatch();
      entry.texture = tex;
    }
  }

  /** Update wireframe colors/opacity based on selection state. */
  updateWireframeColors(layerData: HeightmapLayer[]): void {
    for (let i = 0; i < this.layerEntries.length && i < layerData.length; i++) {
      const entry = this.layerEntries[i];
      const data = layerData[i];
      const mat = entry.wireframe.material as LineBasicMaterial;
      mat.color.setRGB(data.wireframeColor[0], data.wireframeColor[1], data.wireframeColor[2]);
      mat.opacity = data.isSelected ? 1.0 : 0.5;
      entry.color = data.wireframeColor;
      entry.isSelected = data.isSelected;
    }
  }

  /** Update settings for all layers (compute uniforms, wireframe, MSAA). */
  updateSettings(settings: HeightmapSettings): void {
    const heightChanged = settings.heightScale !== this.currentHeightScale;
    if (heightChanged) {
      this.currentHeightScale = settings.heightScale;
    }

    // MSAA — recreate renderer
    if (this.renderer && this.renderer.samples !== settings.msaa) {
      if (this.sharedMaterial) {
        this.applyAlphaMode(this.sharedMaterial, settings.msaa > 0);
      }
      this.recreateRenderer(settings.msaa);
    }

    // Update all layers
    for (const entry of this.layerEntries) {
      // Rebuild wireframe if height changed
      if (heightChanged) {
        this.scene.remove(entry.wireframe);
        entry.wireframe.geometry.dispose();
        (entry.wireframe.material as Material).dispose();
        entry.wireframe = this.createWireframe(
          entry.aspect, settings.heightScale, entry.color, entry.xOffset, entry.isSelected,
        );
        this.scene.add(entry.wireframe);
      }

      // Update compute uniforms and re-dispatch
      entry.compute.updateSettings(
        entry.dsWidth, entry.dsHeight, entry.aspect,
        entry.fullWidth, entry.fullHeight, settings,
      );
      entry.compute.dispatch();
    }
  }

  /**
   * Recreate the WebGPU renderer with a new MSAA sample count.
   * Re-registers all shared GPU buffers with the new backend instance.
   */
  private async recreateRenderer(msaa: number): Promise<void> {
    if (!this.device || !this.canvasEl) return;

    this.stopRenderLoop();
    try { this.renderer.dispose(); } catch { /* safe to ignore */ }

    this.renderer = new WebGPURenderer({
      canvas: this.canvasEl,
      antialias: msaa > 0,
      device: this.device,
    } as any);
    this.renderer.samples = msaa;
    await this.renderer.init();
    this.renderer.setPixelRatio(window.devicePixelRatio);

    const w = this.canvasEl.clientWidth;
    const h = this.canvasEl.clientHeight;
    if (w > 0 && h > 0) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // Re-register all GPU buffers with the new Three.js backend
    const backend = (this.renderer as any).backend;
    for (const entry of this.layerEntries) {
      const geo = entry.mesh.geometry;
      const offsetAttr = geo.getAttribute('aOffset');
      const colorAttr = geo.getAttribute('aColor');
      backend.get(offsetAttr).buffer = entry.offsetGpuBuffer;
      backend.get(colorAttr).buffer = entry.colorGpuBuffer;
    }

    if (!this.disposed) {
      this.startRenderLoop();
    }
  }

  computeAutoDistance(): number {
    const diagonal = Math.sqrt(
      this.totalWidth * this.totalWidth +
      this.maxAspect * this.maxAspect +
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
      this.totalWidth * this.totalWidth +
      this.maxAspect * this.maxAspect +
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

    this.clearLayers();
    try { if (this.controls) this.controls.dispose(); } catch { /* safe to ignore */ }
    try { if (this.renderer) this.renderer.dispose(); } catch { /* safe to ignore */ }
  }
}

/**
 * React component wrapping the Three.js WebGPU heightmap scene.
 * Supports multiple layers displayed side by side in the same 3D view.
 */
export function HeightmapView({ layers, device, active, renderVersion, settings }: HeightmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeightmapScene | null>(null);
  const initRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  // Keep latest layers accessible in effects via ref (avoids stale closures)
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // Stable structural key: changes when layer count, dimensions, or downsample change
  const ds = settings?.downsample ?? 1;
  const layerStructKey = `${layers.length}:${ds}:${layers.map(l => `${l.texture.width}x${l.texture.height}`).join(',')}`;
  const prevStructKeyRef = useRef('');

  // Stable selection key: changes when isSelected flags change
  const selectionKey = layers.map(l => l.isSelected ? '1' : '0').join('');

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

  // Setup or redispatch layers when structure/content changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !active || !sceneReady) return;

    if (!settings || layers.length === 0) {
      if (scene.layerCount > 0) {
        scene.clearLayers();
        prevStructKeyRef.current = '';
      }
      return;
    }

    if (layerStructKey !== prevStructKeyRef.current) {
      prevStructKeyRef.current = layerStructKey;
      scene.setupLayers(layersRef.current, settings);
    } else {
      scene.redispatchLayers(layersRef.current);
    }
  }, [active, sceneReady, layerStructKey, renderVersion]);

  // Wireframe color/selection updates
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || scene.layerCount === 0) return;
    scene.updateWireframeColors(layersRef.current);
  }, [selectionKey]);

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
