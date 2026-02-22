import { useState, useEffect, useRef, useCallback } from 'react';
import { initWebGPU, type GPUContext } from './gpu/WebGPUContext';
import { DropZone } from './components/DropZone';
import { WebGPUCanvas } from './components/WebGPUCanvas';
import { Filmstrip } from './components/Filmstrip';
import { ControlsPanel } from './components/ControlsPanel';
import { MainPreview } from './components/MainPreview';
import { ViewExposureHeader } from './components/ViewExposureHeader';
import { MetadataPanel, computeChannelStats, type ImageMetadata } from './components/MetadataPanel';
import { usePipeline } from './hooks/usePipeline';
import { PipelineRenderer } from './pipeline/PipelineRenderer';
import { createColorPipelineStages } from './pipeline/stages';
import { uploadFloat32Texture } from './pipeline/TextureUtils';
import {
  serializeUniforms,
  type PipelineSettings as GPUPipelineSettings,
} from './pipeline/PipelineUniforms';
import type { PipelineSettings } from './types/settings';

type AppState =
  | { kind: 'initializing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; gpu: GPUContext }
  | { kind: 'loaded'; gpu: GPUContext; sourceTexture: GPUTexture; metadata: ImageMetadata };

/**
 * Map UI-facing PipelineSettings (types/settings.ts) to the GPU uniform
 * buffer format (PipelineUniforms.ts). The two interfaces use different
 * field names — the UI uses descriptive prefixed names while the GPU
 * struct uses WGSL-matching compact names.
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

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'initializing' });
  const [viewExposure, setViewExposure] = useState(0);
  const [renderVersion, setRenderVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PipelineRenderer | null>(null);
  const sourceTextureRef = useRef<GPUTexture | null>(null);

  const pipeline = usePipeline();

  // Initialize WebGPU on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initWebGPU(canvas)
      .then((gpu) => setState({ kind: 'ready', gpu }))
      .catch((err) => setState({ kind: 'error', message: err.message }));
  }, []);

  // Handle image load: upload to GPU texture, create pipeline renderer + stages
  const handleImageLoaded = useCallback(
    (imageData: Float32Array, width: number, height: number) => {
      if (state.kind !== 'ready' && state.kind !== 'loaded') return;
      const { gpu } = state;

      // Destroy previous source texture if reloading
      sourceTextureRef.current?.destroy();

      // Upload EXR pixel data to GPU
      const sourceTexture = uploadFloat32Texture(gpu.device, imageData, width, height);
      sourceTextureRef.current = sourceTexture;

      // Create pipeline renderer on first load
      if (!rendererRef.current) {
        const renderer = new PipelineRenderer(gpu.device);
        const stages = createColorPipelineStages();
        renderer.setStages(stages);
        renderer.setSize(width, height);
        rendererRef.current = renderer;
      } else {
        rendererRef.current.setSize(width, height);
      }

      // Compute EXR metadata for the info panel
      const stats = computeChannelStats(imageData, width, height);
      const metadata: ImageMetadata = {
        width,
        height,
        channels: 'RGBA Float32',
        fileSizeMB: (imageData.byteLength / (1024 * 1024)).toFixed(2),
        stats,
      };

      setState({ kind: 'loaded', gpu, sourceTexture, metadata });
    },
    [state],
  );

  // Re-render the pipeline whenever settings, stage toggles, or view exposure change
  useEffect(() => {
    if (state.kind !== 'loaded' || !rendererRef.current) return;
    const renderer = rendererRef.current;

    // Sync stage enable/disable from UI state to renderer stages.
    // The renderer holds only the 6 color stages (Input Interp through Display Remap),
    // which correspond to UI stage indices 3-8. UI stages 0-2 (EXR, BC Compress,
    // BC Decompress) and 9 (Final Display) are not in the renderer.
    const pipelineStages = renderer.getStages();
    for (let i = 0; i < pipelineStages.length; i++) {
      const uiStage = pipeline.stages[i + 3];
      if (uiStage) {
        (pipelineStages[i] as { enabled: boolean }).enabled = uiStage.enabled;
      }
    }

    // Serialize UI settings -> GPU uniform buffer layout
    const gpuSettings = toGPUSettings(pipeline.settings, viewExposure);
    const uniformData = serializeUniforms(gpuSettings);
    renderer.updateUniforms(uniformData);

    // Push GPU error scopes to catch validation errors
    const device = state.gpu.device;
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');

    // Render all enabled stages
    renderer.render(state.sourceTexture);

    // Pop error scopes and log any issues
    device.popErrorScope().then((err) => {
      if (err) console.warn(`[Pipeline] GPU out-of-memory: ${err.message}`);
    });
    device.popErrorScope().then((err) => {
      if (err) console.warn(`[Pipeline] GPU validation error: ${err.message}`);
    });

    // Bump version so Preview2D re-renders (same texture ref, new content)
    setRenderVersion((v) => v + 1);
  }, [state, pipeline.settings, pipeline.stages, viewExposure]);

  // Get the output texture for the currently selected filmstrip stage
  const getSelectedTexture = (): GPUTexture | null => {
    if (state.kind !== 'loaded') return null;
    const renderer = rendererRef.current;
    if (!renderer) return state.sourceTexture;

    // UI stages 0-2 (EXR Load, BC Compress, BC Decompress): show source texture
    if (pipeline.selectedStageIndex < 3) {
      return state.sourceTexture;
    }

    // UI stages 3-8 map to renderer stages 0-5
    // UI stage 9 (Final Display) = last renderer stage output
    const rendererIndex = Math.min(pipeline.selectedStageIndex - 3, renderer.getStages().length - 1);
    return renderer.getStageOutput(rendererIndex) ?? state.sourceTexture;
  };

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* Hidden canvas for initial WebGPU context */}
      <WebGPUCanvas ref={canvasRef} />

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
            <p className="mb-4" style={{ color: 'var(--color-text-muted)' }}>
              {state.message}
            </p>
            <p style={{ color: 'var(--color-text-muted)' }}>
              WebGPU requires Chrome 113+, Edge 113+, or Firefox Nightly with
              <code
                className="px-1 mx-1 rounded text-sm"
                style={{ background: 'var(--color-bg)' }}
              >
                dom.webgpu.enabled
              </code>
              set to true.
            </p>
          </div>
        </div>
      )}

      {state.kind === 'ready' && (
        <DropZone onImageLoaded={handleImageLoaded} />
      )}

      {state.kind === 'loaded' && (
        <>
          {/* Filmstrip: horizontal strip of stage cards at the top */}
          <Filmstrip
            stages={pipeline.stages}
            selectedIndex={pipeline.selectedStageIndex}
            onSelect={pipeline.selectStage}
            onToggle={pipeline.toggleStage}
          />

          {/* Main content: preview + controls panel side-by-side */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: preview area (exposure header + 2D/3D view) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ViewExposureHeader exposure={viewExposure} onChange={setViewExposure} />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <MainPreview
                  device={state.gpu.device}
                  format={state.gpu.format}
                  stageTexture={getSelectedTexture()}
                  viewExposure={viewExposure}
                  renderVersion={renderVersion}
                />
              </div>
            </div>

            {/* Right: controls panel with settings + metadata */}
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
