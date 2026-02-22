import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { initWebGPU, type GPUContext } from './gpu/WebGPUContext';
import { DropZone, generateSampleImage, halfToFloat, type LoadedFileType } from './components/DropZone';
import { WebGPUCanvas } from './components/WebGPUCanvas';
import { Filmstrip } from './components/Filmstrip';
import { ControlsPanel } from './components/ControlsPanel';
import { MainPreview } from './components/MainPreview';
import { MetadataPanel, computeChannelStats, type ImageMetadata, type ChannelStats } from './components/MetadataPanel';
import { usePipeline } from './hooks/usePipeline';
import { PipelineRenderer } from './pipeline/PipelineRenderer';
import { createColorPipelineStages } from './pipeline/stages';
import { uploadFloat32Texture, uploadFloat16Texture, uploadDDSTexture } from './pipeline/TextureUtils';
import { parseDDS } from './pipeline/DDSParser';
import {
  serializeUniforms,
  type PipelineSettings as GPUPipelineSettings,
} from './pipeline/PipelineUniforms';
import type { PipelineSettings } from './types/settings';
import { STAGE_NAMES } from './pipeline/types/StageInfo';
import { saveFileHandle, loadFileHandle, saveViewState, loadViewState } from './lib/sessionStore';

type AppState =
  | { kind: 'initializing' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; gpu: GPUContext; sourceTexture: GPUTexture; metadata: ImageMetadata };

/**
 * Map UI-facing PipelineSettings to the GPU uniform buffer format.
 */
function toGPUSettings(s: PipelineSettings, viewExposure: number): GPUPipelineSettings {
  return {
    inputSpace: s.inputColorSpace,
    gradingSpace: s.gradingSpace,
    gradeExposure: s.gradeExposure,
    contrast: s.gradeContrast,
    saturation: s.gradeSaturation,
    temperature: s.gradeTemperature,
    tint: s.gradeTint,
    highlights: s.gradeHighlights,
    shadows: s.gradeShadows,
    vibrance: s.gradeVibrance,
    lift: [s.gradeLift.x, s.gradeLift.y, s.gradeLift.z],
    gamma: [s.gradeGamma.x, s.gradeGamma.y, s.gradeGamma.z],
    gain: [s.gradeGain.x, s.gradeGain.y, s.gradeGain.z],
    offset: [s.gradeOffset.x, s.gradeOffset.y, s.gradeOffset.z],
    shadowColor: [s.gradeShadowColor.x, s.gradeShadowColor.y, s.gradeShadowColor.z],
    midtoneColor: [s.gradeMidtoneColor.x, s.gradeMidtoneColor.y, s.gradeMidtoneColor.z],
    highlightColor: [s.gradeHighlightColor.x, s.gradeHighlightColor.y, s.gradeHighlightColor.z],
    highlightSoftClip: s.gradeHighlightSoftClip,
    shadowSoftClip: s.gradeShadowSoftClip,
    highlightKnee: s.gradeHighlightKnee,
    shadowKnee: s.gradeShadowKnee,
    outputSpace: s.outputSpace,
    tonemapOp: s.tonemapOperator,
    tonemapExposure: s.tonemapExposure,
    whitePoint: s.tonemapWhitePoint,
    paperWhite: s.outputPaperWhite,
    peakBrightness: s.tonemapPeakBrightness,
    blackLevel: s.outputBlackLevel,
    whiteLevel: s.outputWhiteLevel,
    bcEnabled: false,
    rrtEnabled: s.rrtEnabled,
    odtEnabled: s.odtEnabled,
    bcFormat: 0,
    bcQuality: 1,
    viewExposure,
  };
}

/** Stage index to auto-select based on loaded file type. */
const STAGE_FOR_FILE_TYPE: Record<LoadedFileType, number> = {
  exr: STAGE_NAMES.length - 1,   // Final Display
  dds: 2,                         // BC Decompress
  sample: STAGE_NAMES.length - 1, // Final Display
};

/**
 * Compute per-channel min/max stats directly from a Uint16Array of half-float RGBA data.
 * Avoids allocating a full Float32Array (~362 MB for 4K+ images).
 */
function computeStatsFromHalf(data: Uint16Array, width: number, height: number): ChannelStats {
  const min: [number, number, number, number] = [Infinity, Infinity, Infinity, Infinity];
  const max: [number, number, number, number] = [-Infinity, -Infinity, -Infinity, -Infinity];
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    for (let c = 0; c < 4; c++) {
      const v = halfToFloat(data[base + c]);
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

/**
 * Parse EXR buffer and upload to GPU, returning the texture and stats.
 * Uses uploadFloat16Texture for half-float EXRs (direct, no staging texture),
 * uploadFloat32Texture for full-float EXRs.
 * Downscales if image exceeds GPU maxTextureDimension2D.
 */
async function parseAndUploadExr(
  device: GPUDevice,
  buffer: ArrayBuffer,
): Promise<{ sourceTexture: GPUTexture; stats: ChannelStats; width: number; height: number } | null> {
  const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
  const loader = new EXRLoader();
  const result = loader.parse(buffer);

  if (!result?.data) return null;

  let { data, width, height } = result;
  const maxDim = device.limits.maxTextureDimension2D;

  // Downscale if image exceeds GPU texture limits
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    const newW = Math.floor(width * scale);
    const newH = Math.floor(height * scale);
    console.warn(`[App] Image ${width}x${height} exceeds GPU limit ${maxDim}px, downscaling to ${newW}x${newH}`);
    data = downsampleRGBA(data, width, height, newW, newH);
    width = newW;
    height = newH;
  }

  let sourceTexture: GPUTexture;
  let stats: ChannelStats;

  if (data instanceof Float32Array) {
    stats = computeChannelStats(data, width, height);
    sourceTexture = uploadFloat32Texture(device, data, width, height);
  } else {
    // Half-float EXR: compute stats directly from Uint16, upload without conversion
    stats = computeStatsFromHalf(data as Uint16Array, width, height);
    sourceTexture = uploadFloat16Texture(device, data as Uint16Array, width, height);
  }

  return { sourceTexture, stats, width, height };
}

/**
 * Downsample RGBA pixel data (Float32Array or Uint16Array) using box filter.
 * Returns same type as input.
 */
function downsampleRGBA<T extends Float32Array | Uint16Array>(
  src: T,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): T {
  const isFloat32 = src instanceof Float32Array;
  const dst = (isFloat32 ? new Float32Array(dstW * dstH * 4) : new Uint16Array(dstW * dstH * 4)) as T;

  // For half-float, work in float32 for accurate averaging, then convert back
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * scaleY);
    const sy1 = Math.min(Math.ceil((dy + 1) * scaleY), srcH);
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * scaleX);
      const sx1 = Math.min(Math.ceil((dx + 1) * scaleX), srcW);
      const acc = [0, 0, 0, 0];
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (sy * srcW + sx) * 4;
          for (let c = 0; c < 4; c++) {
            acc[c] += isFloat32 ? src[si + c] : halfToFloat(src[si + c]);
          }
          count++;
        }
      }
      const di = (dy * dstW + dx) * 4;
      if (isFloat32) {
        for (let c = 0; c < 4; c++) (dst as Float32Array)[di + c] = acc[c] / count;
      } else {
        // Convert averaged float back to half-float
        for (let c = 0; c < 4; c++) (dst as Uint16Array)[di + c] = floatToHalf(acc[c] / count);
      }
    }
  }
  return dst;
}

/** Convert a float32 value to IEEE 754 half-float (uint16). */
function floatToHalf(v: number): number {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = v;
  const f = new Uint32Array(buf)[0];
  const sign = (f >>> 16) & 0x8000;
  const exponent = ((f >>> 23) & 0xff) - 127;
  const mantissa = f & 0x7fffff;
  if (exponent >= 16) return sign | 0x7c00; // Inf/NaN
  if (exponent < -14) return sign; // zero/denorm
  return sign | ((exponent + 15) << 10) | (mantissa >>> 13);
}

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'initializing' });
  const [renderVersion, setRenderVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PipelineRenderer | null>(null);
  const sourceTextureRef = useRef<GPUTexture | null>(null);
  const gpuRef = useRef<GPUContext | null>(null);

  const pipeline = usePipeline();

  // Load an rgba16float source texture and transition to 'loaded' state
  const loadSourceTexture = useCallback(
    (gpu: GPUContext, sourceTexture: GPUTexture, width: number, height: number, stats: ChannelStats | null, fileSizeMB: string, fileType: LoadedFileType, fileName?: string) => {
      sourceTextureRef.current?.destroy();
      sourceTextureRef.current = sourceTexture;

      if (!rendererRef.current) {
        const renderer = new PipelineRenderer(gpu.device);
        const stages = createColorPipelineStages();
        renderer.setStages(stages);
        renderer.setSize(width, height);
        rendererRef.current = renderer;
      } else {
        rendererRef.current.setSize(width, height);
      }

      const metadata: ImageMetadata = {
        width,
        height,
        channels: 'RGBA Float16',
        fileSizeMB,
        fileName,
        stats,
      };

      pipeline.selectStage(STAGE_FOR_FILE_TYPE[fileType]);
      if (fileType === 'dds') {
        pipeline.setStageAvailability([0, 1], false);
      } else {
        pipeline.setStageAvailability([0, 1], true);
      }
      setState({ kind: 'loaded', gpu, sourceTexture, metadata });
    },
    [pipeline],
  );

  // Initialize WebGPU, restore session or auto-load sample image.
  // Cleanup handles React StrictMode double-init (dev mode runs effects twice).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    initWebGPU(canvas)
      .then(async (gpu) => {
        if (cancelled) return;

        // Destroy previous GPU resources (StrictMode re-init)
        rendererRef.current?.destroy();
        rendererRef.current = null;
        sourceTextureRef.current?.destroy();
        sourceTextureRef.current = null;

        gpuRef.current = gpu;

        // Try to restore a previously dropped file via its FileSystemFileHandle
        const stored = await loadFileHandle();
        if (cancelled) return;

        if (stored) {
          console.log(`[App] Restoring session: ${stored.fileName} (${stored.fileType})`);
          try {
            const file = await stored.handle.getFile();
            const buffer = await file.arrayBuffer();
            if (cancelled) return;

            if (stored.fileType === 'exr') {
              const parsed = await parseAndUploadExr(gpu.device, buffer);
              if (cancelled) return;
              if (parsed) {
                const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
                loadSourceTexture(gpu, parsed.sourceTexture, parsed.width, parsed.height, parsed.stats, sizeMB, 'exr' as LoadedFileType, stored.fileName);
                const savedStage = loadViewState();
                if (savedStage !== null) pipeline.selectStage(savedStage);
                return;
              }
            } else if (stored.fileType === 'dds') {
              handleDdsLoaded(buffer, stored.fileName);
              const savedStage = loadViewState();
              if (savedStage !== null) {
                setTimeout(() => pipeline.selectStage(savedStage), 0);
              }
              return;
            }
          } catch (err) {
            console.warn('[App] Failed to restore session from file handle, loading sample:', err);
          }
        }

        // Fallback: auto-load sample image — no start screen
        const sample = generateSampleImage();
        const sourceTexture = uploadFloat32Texture(gpu.device, sample.data, sample.width, sample.height);
        const sampleStats = computeChannelStats(sample.data, sample.width, sample.height);
        const sampleSizeMB = (sample.data.byteLength / (1024 * 1024)).toFixed(2);
        loadSourceTexture(gpu, sourceTexture, sample.width, sample.height, sampleStats, sampleSizeMB, 'sample');
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: 'error', message: err.message });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle EXR buffer from drop — parse and upload via the efficient path
  const handleExrBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string, fileHandle?: FileSystemFileHandle) => {
      const gpu = gpuRef.current;
      if (!gpu) return;

      const parsed = await parseAndUploadExr(gpu.device, buffer);
      if (!parsed) throw new Error(`Failed to parse EXR file "${fileName}": no image data returned.`);

      const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
      loadSourceTexture(gpu, parsed.sourceTexture, parsed.width, parsed.height, parsed.stats, sizeMB, 'exr', fileName);

      // Persist file handle for session restore
      if (fileHandle) {
        saveFileHandle(fileHandle, 'exr', fileName);
      }
    },
    [loadSourceTexture],
  );

  // Handle DDS file loaded from drop (or session restore)
  const handleDdsLoaded = useCallback(
    (buffer: ArrayBuffer, fileName: string, fileHandle?: FileSystemFileHandle) => {
      const gpu = gpuRef.current;
      if (!gpu) return;

      try {
        const dds = parseDDS(buffer);
        console.log(`[App] Parsed DDS: ${fileName} (${dds.width}x${dds.height}, ${dds.formatLabel})`);

        const sourceTexture = uploadDDSTexture(gpu.device, dds);

        sourceTextureRef.current?.destroy();
        sourceTextureRef.current = sourceTexture;

        if (!rendererRef.current) {
          const renderer = new PipelineRenderer(gpu.device);
          const stages = createColorPipelineStages();
          renderer.setStages(stages);
          renderer.setSize(dds.width, dds.height);
          rendererRef.current = renderer;
        } else {
          rendererRef.current.setSize(dds.width, dds.height);
        }

        const metadata: ImageMetadata = {
          width: dds.width,
          height: dds.height,
          channels: dds.formatLabel,
          fileSizeMB: (buffer.byteLength / (1024 * 1024)).toFixed(2),
          fileName,
          stats: null as any,
        };

        pipeline.selectStage(STAGE_FOR_FILE_TYPE['dds']);
        pipeline.setStageAvailability([0, 1], false);
        setState({ kind: 'loaded', gpu, sourceTexture, metadata });

        // Persist file handle for session restore
        if (fileHandle) {
          saveFileHandle(fileHandle, 'dds', fileName);
        }
      } catch (err) {
        console.error(`[App] DDS load error for "${fileName}":`, err);
      }
    },
    [pipeline],
  );

  // Persist selected stage index to localStorage whenever it changes.
  // Only persist when a user-dropped image is loaded (not the sample).
  useEffect(() => {
    if (state.kind === 'loaded' && state.metadata.fileName) {
      saveViewState(pipeline.selectedStageIndex);
    }
  }, [pipeline.selectedStageIndex, state]);

  // Sync RRT/ODT toggle settings to stage enable/disable.
  // Stage 4 = RRT, Stage 5 = ODT.
  useEffect(() => {
    pipeline.toggleStage(4, pipeline.settings.rrtEnabled);
    pipeline.toggleStage(5, pipeline.settings.odtEnabled);
  }, [pipeline.settings.rrtEnabled, pipeline.settings.odtEnabled, pipeline.toggleStage]);

  // Re-render the pipeline whenever settings, stage toggles, or view exposure change.
  // Synchronous in useEffect — every change triggers one GPU submission.
  useEffect(() => {
    if (state.kind !== 'loaded' || !rendererRef.current) return;
    const renderer = rendererRef.current;

    // Sync stage enable/disable from UI state to renderer stages.
    // Renderer stages 0-5 correspond to UI stage indices 3-8.
    const pipelineStages = renderer.getStages();
    for (let i = 0; i < pipelineStages.length; i++) {
      const uiStage = pipeline.stages[i + 3];
      if (uiStage) {
        (pipelineStages[i] as { enabled: boolean }).enabled = uiStage.enabled;
      }
    }

    // Serialize UI settings → GPU uniform buffer layout
    const gpuSettings = toGPUSettings(pipeline.settings, 0);
    renderer.updateUniforms(serializeUniforms(gpuSettings));

    // Render all enabled stages
    renderer.render(state.sourceTexture);

    // Bump version so Preview2D + thumbnails re-render (same texture ref, new content)
    setRenderVersion((v) => v + 1);
  }, [state, pipeline.settings, pipeline.stages]);

  // Get the output texture for a given UI stage index
  const getStageTexture = useCallback((stageIndex: number): GPUTexture | null => {
    if (state.kind !== 'loaded') return null;
    const renderer = rendererRef.current;
    if (!renderer) return state.sourceTexture;

    if (stageIndex < 3) return state.sourceTexture;

    const rendererIndex = Math.min(stageIndex - 3, renderer.getStages().length - 1);
    return renderer.getStageOutput(rendererIndex) ?? state.sourceTexture;
  }, [state]);

  const getSelectedTexture = (): GPUTexture | null => {
    return getStageTexture(pipeline.selectedStageIndex);
  };

  const stageTextures = useMemo((): (GPUTexture | null)[] => {
    if (state.kind !== 'loaded') return [];
    return pipeline.stages.map((_, i) => getStageTexture(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, renderVersion, pipeline.stages, getStageTexture]);

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <WebGPUCanvas ref={canvasRef} />

      {/* Global drag-and-drop overlay — always active, invisible until dragging */}
      {gpuRef.current && (
        <DropZone
          onExrBuffer={handleExrBuffer}
          onDdsLoaded={handleDdsLoaded}
          hasBC={gpuRef.current.hasBC}
        />
      )}

      {state.kind === 'initializing' && (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-text-muted)' }}>Initializing WebGPU...</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            className="max-w-lg text-center p-8 rounded-lg"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-error)' }}>
              WebGPU Not Available
            </h2>
            <p className="mb-4" style={{ color: 'var(--color-text-muted)' }}>{state.message}</p>
            <p style={{ color: 'var(--color-text-muted)' }}>
              WebGPU requires Chrome 113+, Edge 113+, or Firefox Nightly with
              <code className="px-1 mx-1 rounded text-sm" style={{ background: 'var(--color-bg)' }}>
                dom.webgpu.enabled
              </code>
              set to true.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'loaded' && (
        <>
          <Filmstrip
            stages={pipeline.stages}
            selectedIndex={pipeline.selectedStageIndex}
            onSelect={pipeline.selectStage}
            onToggle={pipeline.toggleStage}
            device={state.gpu.device}
            format={state.gpu.format}
            stageTextures={stageTextures}
            renderVersion={renderVersion}
            applySRGB={pipeline.settings.applySRGB}
            settings={pipeline.settings}
          />

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <MainPreview
                device={state.gpu.device}
                format={state.gpu.format}
                stageTexture={getSelectedTexture()}
                renderVersion={renderVersion}
                applySRGB={pipeline.settings.applySRGB}
                selectedStageIndex={pipeline.selectedStageIndex}
                stageName={pipeline.stages[pipeline.selectedStageIndex]?.name}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ControlsPanel
                settings={pipeline.settings}
                onSettingsChange={pipeline.updateSettings}
                onReset={pipeline.resetAll}
              />
              <MetadataPanel metadata={state.metadata} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
