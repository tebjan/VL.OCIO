import { useState, useEffect, useRef, useCallback } from 'react';
import { initWebGPU, type GPUContext } from './gpu/WebGPUContext';
import { DropZone, generateSampleImage, halfToFloat, type LoadedFileType } from './components/DropZone';
import { WebGPUCanvas } from './components/WebGPUCanvas';
import { PipelineFilmstripArea } from './components/PipelineFilmstripArea';
import { ControlsPanel } from './components/ControlsPanel';
import { MainPreview } from './components/MainPreview';
import { MetadataPanel, computeChannelStats, type ImageMetadata, type ChannelStats } from './components/MetadataPanel';
import { usePipelineManager } from './hooks/usePipelineManager';
import { uploadFloat32Texture, uploadFloat16Texture, uploadDDSTexture } from './pipeline/TextureUtils';
import { MAX_PIPELINES, PIPELINE_COLORS } from './types/PipelineInstance';
import { STAGE_NAMES } from './pipeline/types/StageInfo';
import type { PreviewLayer } from './components/Preview2D';
import { parseDDS } from './pipeline/DDSParser';
import {
  serializeUniforms,
  type PipelineSettings as GPUPipelineSettings,
} from './pipeline/PipelineUniforms';
import type { PipelineSettings } from './types/settings';
import { saveFileHandle, loadFileHandle, saveViewState, loadViewState } from './lib/sessionStore';

type AppState =
  | { kind: 'initializing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; gpu: GPUContext };

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
    stats = computeStatsFromHalf(data as Uint16Array, width, height);
    sourceTexture = uploadFloat16Texture(device, data as Uint16Array, width, height);
  }

  return { sourceTexture, stats, width, height };
}

/** Downsample RGBA pixel data using box filter. */
function downsampleRGBA<T extends Float32Array | Uint16Array>(
  src: T, srcW: number, srcH: number, dstW: number, dstH: number,
): T {
  const isFloat32 = src instanceof Float32Array;
  const dst = (isFloat32 ? new Float32Array(dstW * dstH * 4) : new Uint16Array(dstW * dstH * 4)) as T;
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
  if (exponent >= 16) return sign | 0x7c00;
  if (exponent < -14) return sign;
  return sign | ((exponent + 15) << 10) | (mantissa >>> 13);
}

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'initializing' });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<GPUContext | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const manager = usePipelineManager();

  // Load a file into the pipeline manager — adds a new pipeline or replaces selected if at capacity
  const loadFile = useCallback(
    (gpu: GPUContext, sourceTexture: GPUTexture, width: number, height: number, stats: ChannelStats | null, fileSizeMB: string, fileType: LoadedFileType, fileName?: string, fileHandle?: FileSystemFileHandle) => {
      const metadata: ImageMetadata = {
        width,
        height,
        channels: fileType === 'dds' ? 'BC Compressed' : 'RGBA Float16',
        fileSizeMB,
        fileName,
        stats,
      };

      if (manager.pipelines.length < MAX_PIPELINES) {
        manager.addPipeline(gpu.device, sourceTexture, width, height, metadata, fileType, fileName, fileHandle);
      } else {
        // At capacity — replace the currently selected pipeline
        const targetId = manager.selectedPipelineId ?? manager.pipelines[0].id;
        manager.replacePipelineSource(targetId, gpu.device, sourceTexture, width, height, metadata, fileType, fileName, fileHandle);
      }

      setState({ kind: 'ready', gpu });
    },
    [manager],
  );

  // Initialize WebGPU, restore session or auto-load sample image.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    initWebGPU(canvas)
      .then(async (gpu) => {
        if (cancelled) return;

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
                loadFile(gpu, parsed.sourceTexture, parsed.width, parsed.height, parsed.stats, sizeMB, 'exr', stored.fileName);
                const savedStage = loadViewState();
                if (savedStage !== null) manager.selectStage(savedStage);
                return;
              }
            } else if (stored.fileType === 'dds') {
              const dds = parseDDS(buffer);
              const sourceTexture = uploadDDSTexture(gpu.device, dds);
              const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
              loadFile(gpu, sourceTexture, dds.width, dds.height, null, sizeMB, 'dds', stored.fileName);
              const savedStage = loadViewState();
              if (savedStage !== null) {
                setTimeout(() => manager.selectStage(savedStage), 0);
              }
              return;
            }
          } catch (err) {
            console.warn('[App] Failed to restore session from file handle, loading sample:', err);
          }
        }

        // Fallback: auto-load sample image
        const sample = generateSampleImage();
        const sourceTexture = uploadFloat32Texture(gpu.device, sample.data, sample.width, sample.height);
        const sampleStats = computeChannelStats(sample.data, sample.width, sample.height);
        const sampleSizeMB = (sample.data.byteLength / (1024 * 1024)).toFixed(2);
        loadFile(gpu, sourceTexture, sample.width, sample.height, sampleStats, sampleSizeMB, 'sample');
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: 'error', message: err.message });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle EXR buffer from drop
  const handleExrBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string, fileHandle?: FileSystemFileHandle) => {
      const gpu = gpuRef.current;
      if (!gpu) return;

      const parsed = await parseAndUploadExr(gpu.device, buffer);
      if (!parsed) throw new Error(`Failed to parse EXR file "${fileName}": no image data returned.`);

      const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
      loadFile(gpu, parsed.sourceTexture, parsed.width, parsed.height, parsed.stats, sizeMB, 'exr', fileName, fileHandle);

      if (fileHandle) saveFileHandle(fileHandle, 'exr', fileName);
    },
    [loadFile],
  );

  // Handle DDS file loaded from drop
  const handleDdsLoaded = useCallback(
    (buffer: ArrayBuffer, fileName: string, fileHandle?: FileSystemFileHandle) => {
      const gpu = gpuRef.current;
      if (!gpu) return;

      try {
        const dds = parseDDS(buffer);
        console.log(`[App] Parsed DDS: ${fileName} (${dds.width}x${dds.height}, ${dds.formatLabel})`);
        const sourceTexture = uploadDDSTexture(gpu.device, dds);
        const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
        loadFile(gpu, sourceTexture, dds.width, dds.height, null, sizeMB, 'dds', fileName, fileHandle);

        if (fileHandle) saveFileHandle(fileHandle, 'dds', fileName);
      } catch (err) {
        console.error(`[App] DDS load error for "${fileName}":`, err);
      }
    },
    [loadFile],
  );

  // Persist selected stage index to localStorage whenever it changes.
  useEffect(() => {
    const sel = manager.selectedPipeline;
    if (sel && sel.fileName) {
      saveViewState(manager.selectedStageIndex);
    }
  }, [manager.selectedStageIndex, manager.selectedPipeline]);

  // Sync RRT/ODT toggle settings to stage enable/disable.
  useEffect(() => {
    manager.toggleStage(4, manager.selectedSettings.rrtEnabled);
    manager.toggleStage(5, manager.selectedSettings.odtEnabled);
  }, [manager.selectedSettings.rrtEnabled, manager.selectedSettings.odtEnabled, manager.toggleStage]);

  // Re-render ALL pipelines whenever any settings or stage toggles change.
  useEffect(() => {
    if (state.kind !== 'ready') return;

    for (const inst of manager.pipelines) {
      const renderer = inst.renderer;

      // Sync stage enable/disable from instance state to renderer stages.
      // Renderer stages 0-5 correspond to UI stage indices 3-8.
      const pipelineStages = renderer.getStages();
      for (let i = 0; i < pipelineStages.length; i++) {
        const uiStageIdx = i + 3;
        const enabled = inst.stageStates[uiStageIdx]?.enabled ?? true;
        (pipelineStages[i] as { enabled: boolean }).enabled = enabled;
      }

      // Serialize UI settings → GPU uniform buffer layout
      const gpuSettings = toGPUSettings(inst.settings, 0);
      renderer.updateUniforms(serializeUniforms(gpuSettings));

      // Render all enabled stages
      renderer.render(inst.sourceTexture);
    }

    // Bump version so Preview2D + thumbnails re-render
    manager.bumpRenderVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, manager.pipelines, manager.selectedSettings, manager.selectedStages]);

  // Get the output texture for a given UI stage index of a specific pipeline
  const getStageTexture = useCallback((stageIndex: number, inst?: { renderer: { getStageOutput(i: number): GPUTexture | null; getStages(): ReadonlyArray<unknown> }; sourceTexture: GPUTexture }): GPUTexture | null => {
    if (!inst) {
      const sel = manager.selectedPipeline;
      if (!sel) return null;
      inst = sel;
    }
    if (stageIndex < 3) return inst.sourceTexture;
    const rendererIndex = Math.min(stageIndex - 3, inst.renderer.getStages().length - 1);
    return inst.renderer.getStageOutput(rendererIndex) ?? inst.sourceTexture;
  }, [manager.selectedPipeline]);

  const getSelectedTexture = (): GPUTexture | null => {
    return getStageTexture(manager.selectedStageIndex);
  };

  const getStageTexturesForPipeline = useCallback((inst: { renderer: { getStageOutput(i: number): GPUTexture | null; getStages(): ReadonlyArray<unknown> }; sourceTexture: GPUTexture; stageStates: { enabled: boolean }[] }): (GPUTexture | null)[] => {
    return inst.stageStates.map((_, i) => getStageTexture(i, inst));
  }, [getStageTexture]);

  const buildPreviewLayers = useCallback((): PreviewLayer[] => {
    const lastStageIdx = STAGE_NAMES.length - 1;
    return manager.pipelines
      .map((pipeline) => {
        const texture = getStageTexture(pipeline.selectedStageIndex, pipeline);
        if (!texture) return null;
        const color = PIPELINE_COLORS[pipeline.colorIndex];
        const isLastStage = pipeline.selectedStageIndex === lastStageIdx;
        return {
          texture,
          borderColor: [color.rgb[0], color.rgb[1], color.rgb[2]] as [number, number, number],
          isSelected: manager.pipelines.length > 1 && pipeline.id === manager.selectedPipelineId,
          applySRGB: isLastStage ? true : (pipeline.settings.applySRGB ?? true),
        };
      })
      .filter((l): l is PreviewLayer => l !== null);
  }, [manager.pipelines, manager.selectedPipelineId, getStageTexture]);

  const gpu = state.kind === 'ready' ? state.gpu : null;

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <WebGPUCanvas ref={canvasRef} />

      {gpuRef.current && (
        <DropZone
          onExrBuffer={handleExrBuffer}
          onDdsLoaded={handleDdsLoaded}
          hasBC={gpuRef.current.hasBC}
          onDragStateChange={setIsDragging}
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

      {gpu && manager.selectedPipeline && (
        <>
          <PipelineFilmstripArea
            pipelines={manager.pipelines}
            selectedPipelineId={manager.selectedPipelineId}
            onSelectPipeline={(id) => manager.selectPipeline(id)}
            onRemovePipeline={(id) => manager.removePipeline(id)}
            onStageSelect={(i, id) => manager.selectStage(i, id)}
            onStageToggle={(i, enabled, id) => manager.toggleStage(i, enabled, id)}
            device={gpu.device}
            format={gpu.format}
            renderVersion={manager.renderVersion}
            getStageTextures={getStageTexturesForPipeline}
            isDragging={isDragging}
          />

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <MainPreview
                device={gpu.device}
                format={gpu.format}
                layers={buildPreviewLayers()}
                stageTexture={getSelectedTexture()}
                renderVersion={manager.renderVersion}
                stageName={manager.selectedStages[manager.selectedStageIndex]?.name}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ControlsPanel
                settings={manager.selectedSettings}
                onSettingsChange={(patch) => manager.updateSettings(patch)}
                onReset={() => manager.resetAll()}
              />
              {manager.selectedMetadata && (
                <MetadataPanel metadata={manager.selectedMetadata} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
