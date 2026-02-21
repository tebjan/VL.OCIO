import { useRef, useEffect } from 'react';
import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  Color,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface HeightmapViewProps {
  stageTexture: GPUTexture | null;
  active: boolean;
}

/**
 * Manages Three.js WebGPU renderer, scene, camera, and controls.
 * Instantiated once on first activation; persists across tab switches.
 */
class HeightmapScene {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  private animationId = 0;
  private disposed = false;

  constructor() {
    this.renderer = null!;
    this.scene = new Scene();
    this.scene.background = new Color(0x0d0d0d);
    this.camera = new PerspectiveCamera(45, 1, 0.01, 100);
    this.controls = null!;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.renderer = new WebGPURenderer({ canvas, antialias: true });
    await this.renderer.init();
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.resetCamera();
  }

  resetCamera(): void {
    // 45 deg elevation, 30 deg azimuth, distance ~1.2
    const dist = 1.2;
    const elev = Math.PI / 4;   // 45 degrees
    const azim = Math.PI / 6;   // 30 degrees
    this.camera.position.set(
      dist * Math.cos(elev) * Math.sin(azim),
      dist * Math.sin(elev),
      dist * Math.cos(elev) * Math.cos(azim),
    );
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  resize(width: number, height: number): void {
    if (!this.renderer || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  startRenderLoop(): void {
    if (this.disposed) return;
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.renderAsync(this.scene, this.camera);
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
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

/**
 * React component wrapping the Three.js WebGPU heightmap scene.
 * Creates its own canvas; the scene persists across tab switches.
 */
export function HeightmapView({ active }: HeightmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeightmapScene | null>(null);
  const initRef = useRef(false);

  // Initialize scene on first activation
  useEffect(() => {
    if (!active || initRef.current || !canvasRef.current) return;
    initRef.current = true;

    const scene = new HeightmapScene();
    sceneRef.current = scene;

    scene.init(canvasRef.current).then(() => {
      // Initial size
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        scene.resize(rect.width, rect.height);
      }
      scene.startRenderLoop();
    });

    return () => {
      scene.dispose();
      sceneRef.current = null;
      initRef.current = false;
    };
  }, [active]);

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

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: active ? 'block' : 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
