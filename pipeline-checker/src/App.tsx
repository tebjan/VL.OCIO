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
import { type PipelineId, MAX_PIPELINES, PIPELINE_COLORS } from './types/PipelineInstance';
import type { PreviewLayer } from './components/Preview2D';
import type { HeightmapLayer } from './components/HeightmapView';
import { parseDDS } from './pipeline/DDSParser';
import {
  serializeUniforms,
  type PipelineSettings as GPUPipelineSettings,
} from './pipeline/PipelineUniforms';
import { type PipelineSettings, getStageColorSpace, isLinearStageOutput } from './types/settings';
import type { BCFormat, BCQuality } from '@vl-ocio/webgpu-bc-encoder';
import { saveFileHandle, loadFileHandle, saveViewState, loadViewState } from './lib/sessionStore';

/** Map bcFormat setting index (0-6) to BCFormat string key. */
const BC_FORMAT_KEYS: BCFormat[] = ['bc1', 'bc2', 'bc3', 'bc4', 'bc5', 'bc6h', 'bc7'];
/** Map bcQuality setting index (0-2) to BCQuality string key. */
const BC_QUALITY_KEYS: BCQuality[] = ['fast', 'normal', 'high'];

/** Extensions decodable by the browser via createImageBitmap. */
const BROWSER_IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'jpe', 'png', 'bmp', 'webp', 'avif', 'gif', 'ico', 'svg',
]);

type AppState =
  | { kind: 'initializing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; gpu: GPUContext };

/**
 * Map UI-facing PipelineSettings to the GPU uniform buffer format.
 */
/**
 * Compute effective input color space after BC stages.
 * BC6H stores linear data — when input is sRGB, the BC pipeline linearizes it,
 * so stages after BC see Linear Rec.709.
 */
function getEffectiveInputSpace(s: PipelineSettings, bcEnabled: boolean): number {
  if (bcEnabled && s.bcFormat === 5 /* BC6H */ && s.inputColorSpace === 5 /* sRGB */) {
    return 0; // Linear Rec.709
  }
  return s.inputColorSpace;
}

function toGPUSettings(s: PipelineSettings, viewExposure: number, effectiveInputSpace: number): GPUPipelineSettings {
  return {
    inputSpace: effectiveInputSpace,
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

/**
 * Decode a JPEG/PNG file to Float32 RGBA, preserving sRGB encoding.
 * The Color Grade shader's DecodeInput() handles sRGB→linear conversion.
 */
async function decodeImageToFloat32(
  file: File,
): Promise<{ data: Float32Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data; // Uint8ClampedArray, sRGB
  const dst = new Float32Array(width * height * 4);
  for (let i = 0; i < src.length; i += 4) {
    // Keep sRGB values — shader handles linearization via DecodeInput
    dst[i] = src[i] / 255;
    dst[i + 1] = src[i + 1] / 255;
    dst[i + 2] = src[i + 2] / 255;
    dst[i + 3] = src[i + 3] / 255;
  }
  return { data: dst, width, height };
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

  // Loading / error toast state
  const [dropLoading, setDropLoading] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // Shader compilation indicator — true while GPU is compiling pipelines for the first render.
  // Set when a new pipeline is created; cleared by onSubmittedWorkDone() after the first render.
  const [isShaderCompiling, setIsShaderCompiling] = useState(false);
  const shaderCompilePendingRef = useRef(false);

  // Auto-clear error toast after 5 seconds
  useEffect(() => {
    if (!dropError) return;
    const t = setTimeout(() => setDropError(null), 5000);
    return () => clearTimeout(t);
  }, [dropError]);

  // Load a file into the pipeline manager.
  // targetPipelineId = specific pipeline to replace; null = add new (or replace selected if at capacity).
  const loadFile = useCallback(
    (gpu: GPUContext, sourceTexture: GPUTexture, width: number, height: number, stats: ChannelStats | null, fileSizeMB: string, fileType: LoadedFileType, fileName?: string, fileHandle?: FileSystemFileHandle, targetPipelineId?: PipelineId | null, ddsFormatLabel?: string) => {
      const metadata: ImageMetadata = {
        width,
        height,
        channels: fileType === 'dds' ? 'BC Compressed' : fileType === 'image' ? 'RGBA 8-bit (sRGB)' : 'RGBA Float16',
        fileSizeMB,
        fileName,
        stats,
      };

      // Signal that new GPU pipelines are being created — shaders will compile
      // on the first render. onSubmittedWorkDone() in the render effect clears this.
      shaderCompilePendingRef.current = true;
      setIsShaderCompiling(true);

      if (targetPipelineId) {
        // Replace a specific pipeline
        manager.replacePipelineSource(targetPipelineId, gpu.device, sourceTexture, width, height, metadata, fileType, fileName, fileHandle, ddsFormatLabel);
      } else if (manager.pipelines.length < MAX_PIPELINES) {
        // Add new pipeline
        manager.addPipeline(gpu.device, sourceTexture, width, height, metadata, fileType, fileName, fileHandle, ddsFormatLabel);
      } else {
        // At capacity — replace the currently selected pipeline
        const fallbackId = manager.selectedPipelineId ?? manager.pipelines[0].id;
        manager.replacePipelineSource(fallbackId, gpu.device, sourceTexture, width, height, metadata, fileType, fileName, fileHandle, ddsFormatLabel);
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
                const saved = loadViewState();
                if (saved !== null) manager.selectStage(saved.stageIndex);
                return;
              }
            } else if (stored.fileType === 'dds') {
              const dds = parseDDS(buffer);
              const sourceTexture = uploadDDSTexture(gpu.device, dds);
              const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
              loadFile(gpu, sourceTexture, dds.width, dds.height, null, sizeMB, 'dds', stored.fileName, undefined, null, dds.formatLabel);
              const saved = loadViewState();
              if (saved !== null) setTimeout(() => manager.selectStage(saved.stageIndex), 0);
              return;
            } else if (stored.fileType === 'image') {
              const restoredFile = await stored.handle.getFile();
              const decoded = await decodeImageToFloat32(restoredFile);
              if (cancelled) return;
              const stats = computeChannelStats(decoded.data, decoded.width, decoded.height);
              const sourceTexture = uploadFloat32Texture(gpu.device, decoded.data, decoded.width, decoded.height, true);
              const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
              loadFile(gpu, sourceTexture, decoded.width, decoded.height, stats, sizeMB, 'image', stored.fileName);
              const saved = loadViewState();
              if (saved !== null) manager.selectStage(saved.stageIndex);
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

  /**
   * Unified file drop handler.
   * Detects file type from extension, parses, uploads, and routes to the correct pipeline.
   * targetPipelineId: specific pipeline to replace, or null to add a new one.
   */
  const handleFileDrop = useCallback(
    async (file: File, fileHandle: FileSystemFileHandle | undefined, targetPipelineId: PipelineId | null) => {
      const gpu = gpuRef.current;
      if (!gpu) return;

      const fileName = file.name;
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

      setDropLoading(true);
      setDropError(null);

      try {
        const buffer = await file.arrayBuffer();
        const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);

        if (ext === 'exr') {
          const parsed = await parseAndUploadExr(gpu.device, buffer);
          if (!parsed) throw new Error(`Failed to parse EXR file "${fileName}": no image data returned.`);
          loadFile(gpu, parsed.sourceTexture, parsed.width, parsed.height, parsed.stats, sizeMB, 'exr', fileName, fileHandle, targetPipelineId);
          if (fileHandle) saveFileHandle(fileHandle, 'exr', fileName);
        } else if (ext === 'dds') {
          const dds = parseDDS(buffer);
          console.log(`[App] Parsed DDS: ${fileName} (${dds.width}x${dds.height}, ${dds.formatLabel})`);
          const sourceTexture = uploadDDSTexture(gpu.device, dds);
          loadFile(gpu, sourceTexture, dds.width, dds.height, null, sizeMB, 'dds', fileName, fileHandle, targetPipelineId, dds.formatLabel);
          if (fileHandle) saveFileHandle(fileHandle, 'dds', fileName);
        } else if (BROWSER_IMAGE_EXTS.has(ext)) {
          const decoded = await decodeImageToFloat32(file);
          const stats = computeChannelStats(decoded.data, decoded.width, decoded.height);
          const sourceTexture = uploadFloat32Texture(gpu.device, decoded.data, decoded.width, decoded.height, true);
          loadFile(gpu, sourceTexture, decoded.width, decoded.height, stats, sizeMB, 'image', fileName, fileHandle, targetPipelineId);
          if (fileHandle) saveFileHandle(fileHandle, 'image', fileName);
        } else {
          throw new Error(`Unsupported file type: .${ext}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[App] File drop error for "${fileName}":`, msg);
        setDropError(msg);
      } finally {
        setDropLoading(false);
      }
    },
    [loadFile],
  );

  // Tab key cycles selected pipeline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && manager.pipelines.length > 1) {
        e.preventDefault();
        const ids = manager.pipelines.map((p) => p.id);
        const curIdx = ids.indexOf(manager.selectedPipelineId ?? '');
        const nextIdx = e.shiftKey
          ? (curIdx - 1 + ids.length) % ids.length
          : (curIdx + 1) % ids.length;
        manager.selectPipeline(ids[nextIdx]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [manager.pipelines, manager.selectedPipelineId, manager.selectPipeline]);

  // Persist view state to localStorage whenever it changes.
  useEffect(() => {
    const sel = manager.selectedPipeline;
    if (sel && sel.fileName) {
      saveViewState({ stageIndex: manager.selectedStageIndex });
    }
  }, [manager.selectedStageIndex, manager.selectedPipeline]);

  // Sync RRT/ODT toggle settings to stage enable/disable.
  useEffect(() => {
    manager.toggleStage(4, manager.selectedSettings.rrtEnabled);
    manager.toggleStage(5, manager.selectedSettings.odtEnabled);
  }, [manager.selectedSettings.rrtEnabled, manager.selectedSettings.odtEnabled, manager.toggleStage]);

  // Trigger async BC encoding when source texture or BC settings change.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    let cancelled = false;
    let trackingCompile = false;

    (async () => {
      for (const inst of manager.pipelines) {
        const bc = inst.bcCompress;
        if (!bc?.available || inst.stageStates[1]?.enabled === false || cancelled) continue;

        // Sync format/quality/color space from settings
        bc.setFormat(BC_FORMAT_KEYS[inst.settings.bcFormat] ?? 'bc6h');
        bc.setQuality(BC_QUALITY_KEYS[inst.settings.bcQuality] ?? 'normal');
        bc.inputColorSpace = inst.settings.inputColorSpace;

        // Show indicator on first pipeline that actually has work to do
        if (!trackingCompile) {
          trackingCompile = true;
          setIsShaderCompiling(true);
        }

        const result = await bc.runEncode(inst.sourceTexture);
        if (result && inst.bcDecompress && !cancelled) {
          const didUpload = inst.bcDecompress.uploadBCData(result);
          if (didUpload) manager.bumpBcEncodeVersion();
        }
      }
      if (trackingCompile && !cancelled) setIsShaderCompiling(false);
    })();

    return () => { cancelled = true; if (trackingCompile) setIsShaderCompiling(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, manager.pipelines, manager.selectedSettings.bcFormat, manager.selectedSettings.bcQuality, manager.selectedSettings.inputColorSpace]);

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

      // Compute effective input space (BC6H + sRGB → Linear Rec.709).
      // Must check unavailableStages — for loaded DDS files stage 1 is unavailable
      // (stageStates[1] stays true by default), so bcEnabled must be false for DDS.
      const bcEnabled = !inst.unavailableStages.has(1) && !inst.unavailableStages.has(2)
        && inst.stageStates[1]?.enabled !== false && inst.stageStates[2]?.enabled !== false;
      const effectiveInputSpace = getEffectiveInputSpace(inst.settings, bcEnabled);

      // Serialize UI settings → GPU uniform buffer layout
      const gpuSettings = toGPUSettings(inst.settings, 0, effectiveInputSpace);
      renderer.updateUniforms(serializeUniforms(gpuSettings));

      // Run BC decompress + color pipeline in a single command buffer submission.
      // BC decompress is encoded as a preEncode callback so all render passes
      // share one encoder — WebGPU guarantees writes from earlier passes are
      // visible to reads in later passes within the same submission.
      let colorPipelineInput = inst.sourceTexture;
      let preEncode: ((encoder: GPUCommandEncoder) => void) | undefined;

      if (bcEnabled && inst.bcDecompress && inst.bcCompress?.encodeResult) {
        inst.bcDecompress.showDelta = inst.settings.bcShowDelta;
        inst.bcDecompress.amplification = inst.settings.bcDeltaAmplification;
        const LINEAR_INPUTS = new Set([0, 1, 2, 8]);
        inst.bcDecompress.isLinear = LINEAR_INPUTS.has(effectiveInputSpace);
        // For BC6H + sRGB, delta should compare against linearized source
        inst.bcDecompress.deltaReference = inst.bcCompress.linearizedSource;

        const bcDecompress = inst.bcDecompress;
        const srcTex = inst.sourceTexture;
        const uniforms = renderer.getUniformBuffer();
        preEncode = (encoder) => {
          bcDecompress.encode(encoder, srcTex, uniforms);
        };

        colorPipelineInput = inst.bcDecompress.getDecompressedOutput() ?? inst.sourceTexture;
      }

      // Render all enabled color pipeline stages
      renderer.render(colorPipelineInput, preEncode);
    }

    // Bump version so Preview2D + thumbnails re-render
    manager.bumpRenderVersion();

    // After the first render following pipeline creation, wait for the GPU to finish.
    // The first render stalls until shader compilation is complete — onSubmittedWorkDone
    // resolves only after that stall, giving us an accurate "done compiling" signal.
    if (shaderCompilePendingRef.current) {
      shaderCompilePendingRef.current = false;
      void state.gpu.device.queue.onSubmittedWorkDone().then(() => setIsShaderCompiling(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, manager.pipelines, manager.selectedSettings, manager.selectedStages, manager.bcEncodeVersion]);

  // Get the output texture for a given UI stage index of a specific pipeline
  const getStageTexture = useCallback((stageIndex: number, inst?: { renderer: { getStageOutput(i: number): GPUTexture | null; getStages(): ReadonlyArray<unknown> }; sourceTexture: GPUTexture; bcDecompress?: { output: GPUTexture | null } | null }): GPUTexture | null => {
    if (!inst) {
      const sel = manager.selectedPipeline;
      if (!sel) return null;
      inst = sel;
    }
    if (stageIndex <= 1) return inst.sourceTexture;
    if (stageIndex === 2) return inst.bcDecompress?.output ?? inst.sourceTexture;
    const rendererIndex = Math.min(stageIndex - 3, inst.renderer.getStages().length - 1);
    return inst.renderer.getStageOutput(rendererIndex) ?? inst.sourceTexture;
  }, [manager.selectedPipeline]);

  const getStageTexturesForPipeline = useCallback((inst: { renderer: { getStageOutput(i: number): GPUTexture | null; getStages(): ReadonlyArray<unknown> }; sourceTexture: GPUTexture; stageStates: { enabled: boolean }[] }): (GPUTexture | null)[] => {
    return inst.stageStates.map((_, i) => getStageTexture(i, inst));
  }, [getStageTexture]);

  const buildPreviewLayers = useCallback((): PreviewLayer[] => {
    return manager.pipelines
      .map((pipeline) => {
        const texture = getStageTexture(pipeline.selectedStageIndex, pipeline);
        if (!texture) return null;
        const color = PIPELINE_COLORS[pipeline.colorIndex];
        return {
          texture,
          borderColor: [color.rgb[0], color.rgb[1], color.rgb[2]] as [number, number, number],
          isSelected: manager.pipelines.length > 1 && pipeline.id === manager.selectedPipelineId,
          applySRGB: pipeline.selectedStageIndex === 8
            ? isLinearStageOutput(getStageColorSpace(7, pipeline.settings, (idx) => !pipeline.unavailableStages.has(idx) && (pipeline.stageStates[idx]?.enabled ?? true)))
            : (pipeline.selectedStageIndex === 2 && pipeline.settings.bcShowDelta)
              ? false  // Delta view: raw error values, no curves
              : (pipeline.selectedStageIndex <= 1 && pipeline.settings.inputColorSpace === 5)
                ? false
                : (pipeline.selectedStageIndex === 2 && pipeline.settings.inputColorSpace === 5)
                  ? isLinearStageOutput(getStageColorSpace(2, pipeline.settings, (idx) => !pipeline.unavailableStages.has(idx) && (pipeline.stageStates[idx]?.enabled ?? true)))
                  : (pipeline.settings.applySRGB ?? true),
        };
      })
      .filter((l): l is PreviewLayer => l !== null);
  }, [manager.pipelines, manager.selectedPipelineId, getStageTexture]);

  const buildHeightmapLayers = useCallback((): HeightmapLayer[] => {
    const multi = manager.pipelines.length > 1;
    return manager.pipelines
      .map((pipeline) => {
        const texture = getStageTexture(pipeline.selectedStageIndex, pipeline);
        if (!texture) return null;
        const color = PIPELINE_COLORS[pipeline.colorIndex];
        return {
          texture,
          wireframeColor: multi
            ? [color.rgb[0], color.rgb[1], color.rgb[2]] as [number, number, number]
            : [0.267, 0.267, 0.267] as [number, number, number],
          isSelected: multi && pipeline.id === manager.selectedPipelineId,
        };
      })
      .filter((l): l is HeightmapLayer => l !== null);
  }, [manager.pipelines, manager.selectedPipelineId, getStageTexture]);

  const gpu = state.kind === 'ready' ? state.gpu : null;

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <WebGPUCanvas ref={canvasRef} />

      {gpuRef.current && (
        <DropZone
          onFileDrop={(file, fileHandle) => handleFileDrop(file, fileHandle, null)}
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
          {/* Top header bar — branding + linked toggle + global compact */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '0 10px', gap: '8px', height: '28px', flexShrink: 0,
            background: 'var(--surface-950)', borderBottom: '1px solid var(--surface-800)',
          }}>
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Pipeline Checker
              <span style={{ opacity: 0.4, margin: '0 5px' }}>·</span>
              <a
                href="https://github.com/tebjan/VL.OCIO"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', opacity: 0.6, textDecoration: 'none' }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.6'; }}
              >
                VL.OCIO ↗
              </a>
            </span>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Linked toggle — slider style, only when >1 pipeline */}
              {manager.pipelines.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Linked</span>
                  <button
                    onClick={() => manager.setLinkedSettings(!manager.linkedSettings)}
                    title={manager.linkedSettings
                      ? 'Unlink — each pipeline has its own settings'
                      : 'Link — all pipelines share the same settings'}
                    style={{
                      width: '30px', height: '16px', borderRadius: '8px',
                      border: 'none', cursor: 'pointer',
                      background: 'var(--surface-700)',
                      position: 'relative', padding: 0, flexShrink: 0,
                    }}
                  >
                    <span style={{
                      display: 'block', width: '10px', height: '10px', borderRadius: '50%',
                      background: manager.linkedSettings ? 'var(--surface-300)' : 'var(--surface-500)',
                      position: 'absolute', top: '3px',
                      left: manager.linkedSettings ? '17px' : '3px',
                      transition: 'left 0.15s, background 0.15s',
                    }} />
                  </button>
                </div>
              )}

              {/* Global compact toggle — slider style, always visible */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Compact</span>
                <button
                  onClick={() => {
                    const compact = !(manager.pipelines[0]?.compactMode ?? true);
                    manager.pipelines.forEach((p) => manager.setCompactMode(compact, p.id));
                  }}
                  title="Compact filmstrip — hide BC Compress and Output Encode stages"
                  style={{
                    width: '30px', height: '16px', borderRadius: '8px',
                    border: 'none', cursor: 'pointer',
                    background: 'var(--surface-700)',
                    position: 'relative', padding: 0, flexShrink: 0,
                  }}
                >
                  <span style={{
                    display: 'block', width: '10px', height: '10px', borderRadius: '50%',
                    background: (manager.pipelines[0]?.compactMode ?? true) ? 'var(--surface-300)' : 'var(--surface-500)',
                    position: 'absolute', top: '3px',
                    left: (manager.pipelines[0]?.compactMode ?? true) ? '17px' : '3px',
                    transition: 'left 0.15s, background 0.15s',
                  }} />
                </button>
              </div>
            </div>
          </div>

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
            onFileDrop={handleFileDrop}
            linkedSettings={manager.linkedSettings}
            onCompactModeChange={(id, compact) => manager.setCompactMode(compact, id)}
          />

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <MainPreview
                device={gpu.device}
                format={gpu.format}
                layers={buildPreviewLayers()}
                heightmapLayers={buildHeightmapLayers()}
                renderVersion={manager.renderVersion}
                stageName={manager.selectedStages[manager.selectedStageIndex]?.name}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ControlsPanel
                key={manager.selectedPipelineId}
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

      {/* Shader compilation indicator */}
      {isShaderCompiling && (
        <div style={{
          position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-700, #333)', color: 'var(--color-text, #ccc)',
          padding: '8px 20px', borderRadius: '6px', fontSize: '13px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)', zIndex: 100,
        }}>
          Compiling shaders...
        </div>
      )}

      {/* Loading / error toasts */}
      {dropLoading && (
        <div style={{
          position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-700, #333)', color: 'var(--color-text, #ccc)',
          padding: '8px 20px', borderRadius: '6px', fontSize: '13px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)', zIndex: 100,
        }}>
          Loading file...
        </div>
      )}
      {dropError && (
        <div
          onClick={() => setDropError(null)}
          style={{
            position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
            background: '#4a1c1c', color: '#f08080', border: '1px solid #6a2c2c',
            padding: '8px 20px', borderRadius: '6px', fontSize: '13px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)', zIndex: 100, cursor: 'pointer',
          }}
        >
          {dropError}
        </div>
      )}
    </div>
  );
}
