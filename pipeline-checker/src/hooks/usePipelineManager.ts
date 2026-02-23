import { useState, useCallback, useMemo, useRef } from 'react';
import { type PipelineSettings, createDefaultSettings } from '../types/settings';
import type { StageState } from '../types/pipeline';
import { type StageInfo, STAGE_NAMES } from '../pipeline/types/StageInfo';
import type { LoadedFileType } from '../components/DropZone';
import type { ImageMetadata } from '../components/MetadataPanel';
import { PipelineRenderer } from '../pipeline/PipelineRenderer';
import { createColorPipelineStages } from '../pipeline/stages';
import { BCCompressStage } from '../pipeline/stages/BCCompressStage';
import { BCDecompressStage } from '../pipeline/stages/BCDecompressStage';
import { type PipelineId, type PipelineInstance, PIPELINE_COLORS, MAX_PIPELINES } from '../types/PipelineInstance';

const STAGE_COUNT = STAGE_NAMES.length;
const LOCKED_STAGES = new Set([0, STAGE_COUNT - 1]);

function createDefaultStages(): StageState[] {
  return Array.from({ length: STAGE_COUNT }, () => ({ enabled: true }));
}

/** Stage index to auto-select based on loaded file type. */
const STAGE_FOR_FILE_TYPE: Record<LoadedFileType, number> = {
  exr: STAGE_COUNT - 1,
  dds: STAGE_COUNT - 1,
  image: STAGE_COUNT - 1,
  sample: STAGE_COUNT - 1,
};

/**
 * Determine whether a file type represents scene-linear HDR data.
 * Scene-linear content needs tonemapping (RRT+ODT); display-referred sRGB content does not.
 *
 * - EXR: always scene-linear (ACEScg)
 * - DDS BC6H: HDR linear data
 * - DDS BC7/other: display-referred sRGB
 * - PNG/JPEG/WebP/etc: display-referred sRGB
 * - Sample: scene-linear HDR gradient
 */
function isSceneLinear(fileType: LoadedFileType, ddsFormatLabel?: string): boolean {
  if (fileType === 'exr' || fileType === 'sample') return true;
  if (fileType === 'dds') return ddsFormatLabel?.startsWith('BC6H') ?? false;
  return false;
}

/**
 * Create pipeline settings appropriate for the given file type.
 * Scene-linear content: ACEScg input, RRT+ODT enabled (full ACES pipeline).
 * Display-referred sRGB: sRGB input, RRT+ODT disabled (already tonemapped).
 */
function createSettingsForFileType(fileType: LoadedFileType, ddsFormatLabel?: string): PipelineSettings {
  const defaults = createDefaultSettings();
  const linear = isSceneLinear(fileType, ddsFormatLabel);
  return {
    ...defaults,
    inputColorSpace: linear ? 2 : 5,  // ACEScg : sRGB
    rrtEnabled: linear,
    odtEnabled: linear,
    applySRGB: true,                    // always on — GPU texture sampling linearizes sRGB data
    outputSpace: 0,                    // always Linear Rec.709
  };
}

/** Get a short format label from a filename extension (e.g. "photo.jpg" → "JPEG"). */
function formatLabelFromFileName(fileName: string | null): string | null {
  if (!fileName) return null;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  const labels: Record<string, string> = {
    jpg: 'JPEG', jpeg: 'JPEG', jpe: 'JPEG',
    png: 'PNG', bmp: 'BMP', webp: 'WebP',
    avif: 'AVIF', gif: 'GIF', ico: 'ICO',
    tif: 'TIFF', tiff: 'TIFF', svg: 'SVG',
  };
  return labels[ext] ?? null;
}

/** Derive StageInfo[] from an instance's state */
function deriveStages(inst: PipelineInstance): StageInfo[] {
  // For generic 'image' types, override stage 0 label with the actual format
  const formatLabel = inst.fileType === 'image' ? formatLabelFromFileName(inst.fileName) : null;
  return inst.stageStates.map((state, i) => ({
    index: i,
    name: i === 0 && formatLabel ? `${formatLabel} Load` : STAGE_NAMES[i].name,
    shortName: i === 0 && formatLabel ? formatLabel : STAGE_NAMES[i].shortName,
    description: STAGE_NAMES[i].description,
    enabled: state.enabled,
    available: !inst.unavailableStages.has(i),
    thumbnail: null,
  }));
}

export interface PipelineManagerReturn {
  pipelines: PipelineInstance[];
  selectedPipelineId: PipelineId | null;
  selectedPipeline: PipelineInstance | null;
  renderVersion: number;

  addPipeline(
    device: GPUDevice,
    sourceTexture: GPUTexture,
    width: number,
    height: number,
    metadata: ImageMetadata,
    fileType: LoadedFileType,
    fileName?: string,
    fileHandle?: FileSystemFileHandle,
    ddsFormatLabel?: string,
  ): PipelineId;
  removePipeline(id: PipelineId): void;
  replacePipelineSource(
    id: PipelineId,
    device: GPUDevice,
    sourceTexture: GPUTexture,
    width: number,
    height: number,
    metadata: ImageMetadata,
    fileType: LoadedFileType,
    fileName?: string,
    fileHandle?: FileSystemFileHandle,
    ddsFormatLabel?: string,
  ): void;
  selectPipeline(id: PipelineId): void;

  // Per-pipeline mutations (operate on selected pipeline if id omitted)
  // When linkedSettings is true, updateSettings/toggleStage/resetAll apply to ALL pipelines
  updateSettings(patch: Partial<PipelineSettings>, id?: PipelineId): void;
  toggleStage(index: number, enabled: boolean, id?: PipelineId): void;
  selectStage(index: number, id?: PipelineId): void;
  setStageAvailability(indices: number[], available: boolean, id?: PipelineId): void;
  resetAll(id?: PipelineId): void;

  // Link mode: apply settings to all pipelines simultaneously
  linkedSettings: boolean;
  setLinkedSettings(linked: boolean): void;

  // Derived helpers for selected pipeline
  selectedStages: StageInfo[];
  selectedSettings: PipelineSettings;
  selectedStageIndex: number;
  selectedMetadata: ImageMetadata | null;

  bcEncodeVersion: number;
  bumpBcEncodeVersion(): void;
  bumpRenderVersion(): void;
}

export function usePipelineManager(): PipelineManagerReturn {
  const [instanceMap, setInstanceMap] = useState<Map<PipelineId, PipelineInstance>>(new Map());
  const [selectedId, setSelectedId] = useState<PipelineId | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [bcEncodeVersion, setBcEncodeVersion] = useState(0);
  const [linkedSettings, setLinkedSettings] = useState(false);
  const nextIdRef = useRef(0);

  const bumpRenderVersion = useCallback(() => {
    setRenderVersion((v) => v + 1);
  }, []);

  const bumpBcEncodeVersion = useCallback(() => {
    setBcEncodeVersion((v) => v + 1);
  }, []);

  const updateInstance = useCallback((id: PipelineId, updater: (inst: PipelineInstance) => PipelineInstance) => {
    setInstanceMap((prev) => {
      const inst = prev.get(id);
      if (!inst) return prev;
      const next = new Map(prev);
      next.set(id, updater(inst));
      return next;
    });
  }, []);

  const addPipeline = useCallback((
    device: GPUDevice,
    sourceTexture: GPUTexture,
    width: number,
    height: number,
    metadata: ImageMetadata,
    fileType: LoadedFileType,
    fileName?: string,
    fileHandle?: FileSystemFileHandle,
    ddsFormatLabel?: string,
  ): PipelineId => {
    const id = `pipeline-${nextIdRef.current++}` as PipelineId;

    setInstanceMap((prev) => {
      if (prev.size >= MAX_PIPELINES) return prev;

      const colorIndex = prev.size % PIPELINE_COLORS.length;
      const renderer = new PipelineRenderer(device);
      const stages = createColorPipelineStages();
      renderer.setStages(stages);
      renderer.setSize(width, height);

      const unavailableStages = new Set<number>();
      const settings = createSettingsForFileType(fileType, ddsFormatLabel);

      // Sync stage enable/disable for RRT (4) and ODT (5) from settings
      const stageStates = createDefaultStages();
      stageStates[4] = { enabled: settings.rrtEnabled };
      stageStates[5] = { enabled: settings.odtEnabled };

      // Create BC stages (only for non-DDS files on hardware that supports BC)
      const hasBC = device.features.has('texture-compression-bc');
      const createBC = hasBC && fileType !== 'dds';
      let bcCompress: BCCompressStage | null = null;
      let bcDecompress: BCDecompressStage | null = null;
      if (createBC) {
        bcCompress = new BCCompressStage(device, true);
        bcDecompress = new BCDecompressStage(true);
        bcDecompress.initialize(device, width, height);
      }
      // Mark stage availability for BC stages
      if (fileType === 'dds') {
        // DDS: stage 0 (load) and 1 (compress) not applicable; stage 2 shows the decoded DDS
        unavailableStages.add(0);
        unavailableStages.add(1);
      } else if (!createBC) {
        // No BC hardware: both compress and decompress unavailable
        unavailableStages.add(1);
        unavailableStages.add(2);
      }

      const instance: PipelineInstance = {
        id,
        colorIndex,
        fileName: fileName ?? null,
        fileType,
        fileHandle,
        ddsFormatLabel,
        device,
        renderer,
        sourceTexture,
        bcCompress,
        bcDecompress,
        settings,
        stageStates,
        selectedStageIndex: STAGE_FOR_FILE_TYPE[fileType],
        unavailableStages,
        metadata,
      };

      const next = new Map(prev);
      next.set(id, instance);
      return next;
    });

    setSelectedId(id);
    return id;
  }, []);

  const removePipeline = useCallback((id: PipelineId) => {
    setInstanceMap((prev) => {
      const inst = prev.get(id);
      if (!inst) return prev;

      // Destroy GPU resources
      inst.bcCompress?.destroy();
      inst.bcDecompress?.destroy();
      inst.renderer.destroy();
      inst.sourceTexture.destroy();

      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    setSelectedId((prevSelected) => {
      if (prevSelected === id) {
        // Select the first remaining pipeline
        const remaining = Array.from(instanceMap.keys()).filter((k) => k !== id);
        return remaining[0] ?? null;
      }
      return prevSelected;
    });
  }, [instanceMap]);

  const replacePipelineSource = useCallback((
    id: PipelineId,
    _device: GPUDevice,
    sourceTexture: GPUTexture,
    width: number,
    height: number,
    metadata: ImageMetadata,
    fileType: LoadedFileType,
    fileName?: string,
    fileHandle?: FileSystemFileHandle,
    ddsFormatLabel?: string,
  ) => {
    updateInstance(id, (inst) => {
      inst.sourceTexture.destroy();
      inst.renderer.setSize(width, height);
      const unavailableStages = new Set<number>();
      const settings = createSettingsForFileType(fileType, ddsFormatLabel);

      // Sync stage enable/disable for RRT (4) and ODT (5) from settings
      const stageStates = createDefaultStages();
      stageStates[4] = { enabled: settings.rrtEnabled };
      stageStates[5] = { enabled: settings.odtEnabled };

      // Recreate BC stages for new source dimensions / file type
      inst.bcCompress?.destroy();
      inst.bcDecompress?.destroy();
      const hasBC = inst.device.features.has('texture-compression-bc');
      const createBC = hasBC && fileType !== 'dds';
      let bcCompress: BCCompressStage | null = null;
      let bcDecompress: BCDecompressStage | null = null;
      if (createBC) {
        bcCompress = new BCCompressStage(inst.device, true);
        bcDecompress = new BCDecompressStage(true);
        bcDecompress.initialize(inst.device, width, height);
      }
      if (fileType === 'dds') {
        unavailableStages.add(0);
        unavailableStages.add(1);
      } else if (!createBC) {
        unavailableStages.add(1);
        unavailableStages.add(2);
      }

      return {
        ...inst,
        sourceTexture,
        bcCompress,
        bcDecompress,
        metadata,
        fileType,
        fileName: fileName ?? null,
        fileHandle,
        ddsFormatLabel,
        settings,
        stageStates,
        selectedStageIndex: STAGE_FOR_FILE_TYPE[fileType],
        unavailableStages,
      };
    });
  }, [updateInstance]);

  const selectPipeline = useCallback((id: PipelineId) => {
    setSelectedId(id);
  }, []);

  const updateSettings = useCallback((patch: Partial<PipelineSettings>, id?: PipelineId) => {
    if (linkedSettings && !id) {
      // Apply to all pipelines
      setInstanceMap((prev) => {
        const next = new Map(prev);
        for (const [pid, inst] of prev) {
          next.set(pid, { ...inst, settings: { ...inst.settings, ...patch } });
        }
        return next;
      });
    } else {
      const targetId = id ?? selectedId;
      if (!targetId) return;
      updateInstance(targetId, (inst) => ({
        ...inst,
        settings: { ...inst.settings, ...patch },
      }));
    }
  }, [selectedId, updateInstance, linkedSettings]);

  const toggleStage = useCallback((index: number, enabled: boolean, id?: PipelineId) => {
    if (LOCKED_STAGES.has(index)) return;
    const applyToggle = (inst: PipelineInstance): PipelineInstance => {
      const nextStates = inst.stageStates.slice();
      nextStates[index] = { enabled };
      // Link BC Compress (1) and BC Decompress (2) — always toggle together
      if (index === 1 || index === 2) {
        nextStates[1] = { enabled };
        nextStates[2] = { enabled };
      }
      let nextSettings = inst.settings;
      if (index === 4 && inst.settings.rrtEnabled !== enabled) {
        nextSettings = { ...nextSettings, rrtEnabled: enabled };
      }
      if (index === 5 && inst.settings.odtEnabled !== enabled) {
        nextSettings = { ...nextSettings, odtEnabled: enabled };
      }
      return { ...inst, stageStates: nextStates, settings: nextSettings };
    };

    if (linkedSettings && !id) {
      setInstanceMap((prev) => {
        const next = new Map(prev);
        for (const [pid, inst] of prev) {
          next.set(pid, applyToggle(inst));
        }
        return next;
      });
    } else {
      const targetId = id ?? selectedId;
      if (!targetId) return;
      updateInstance(targetId, applyToggle);
    }
  }, [selectedId, updateInstance, linkedSettings]);

  const selectStage = useCallback((index: number, id?: PipelineId) => {
    const targetId = id ?? selectedId;
    if (!targetId) return;
    updateInstance(targetId, (inst) => {
      if (index >= 0 && index < STAGE_COUNT && !inst.unavailableStages.has(index)) {
        return { ...inst, selectedStageIndex: index };
      }
      return inst;
    });
  }, [selectedId, updateInstance]);

  const setStageAvailability = useCallback((indices: number[], available: boolean, id?: PipelineId) => {
    const targetId = id ?? selectedId;
    if (!targetId) return;
    updateInstance(targetId, (inst) => {
      const next = new Set(inst.unavailableStages);
      for (const idx of indices) {
        if (available) next.delete(idx);
        else next.add(idx);
      }
      return { ...inst, unavailableStages: next };
    });
  }, [selectedId, updateInstance]);

  const resetAll = useCallback((id?: PipelineId) => {
    const applyReset = (inst: PipelineInstance): PipelineInstance => {
      const settings = createSettingsForFileType(inst.fileType, inst.ddsFormatLabel);
      const stageStates = createDefaultStages();
      stageStates[4] = { enabled: settings.rrtEnabled };
      stageStates[5] = { enabled: settings.odtEnabled };
      const unavailableStages = new Set<number>();
      if (inst.fileType === 'dds') {
        unavailableStages.add(0);
        unavailableStages.add(1);
      } else if (!inst.bcCompress) {
        unavailableStages.add(1);
        unavailableStages.add(2);
      }
      return { ...inst, settings, stageStates, selectedStageIndex: STAGE_FOR_FILE_TYPE[inst.fileType], unavailableStages };
    };

    if (linkedSettings && !id) {
      setInstanceMap((prev) => {
        const next = new Map(prev);
        for (const [pid, inst] of prev) {
          next.set(pid, applyReset(inst));
        }
        return next;
      });
    } else {
      const targetId = id ?? selectedId;
      if (!targetId) return;
      updateInstance(targetId, applyReset);
    }
  }, [selectedId, updateInstance, linkedSettings]);

  const pipelines = useMemo(() => Array.from(instanceMap.values()), [instanceMap]);
  const selectedPipeline = selectedId ? instanceMap.get(selectedId) ?? null : null;

  const selectedStages = useMemo<StageInfo[]>(() => {
    if (!selectedPipeline) {
      return STAGE_NAMES.map((s, i) => ({
        index: i, name: s.name, shortName: s.shortName, description: s.description,
        enabled: true, available: true, thumbnail: null,
      }));
    }
    return deriveStages(selectedPipeline);
  }, [selectedPipeline]);

  const selectedSettings = selectedPipeline?.settings ?? createDefaultSettings();
  const selectedStageIndex = selectedPipeline?.selectedStageIndex ?? (STAGE_COUNT - 1);
  const selectedMetadata = selectedPipeline?.metadata ?? null;

  return {
    pipelines,
    selectedPipelineId: selectedId,
    selectedPipeline,
    renderVersion,
    bcEncodeVersion,
    bumpBcEncodeVersion,
    addPipeline,
    removePipeline,
    replacePipelineSource,
    selectPipeline,
    updateSettings,
    toggleStage,
    selectStage,
    setStageAvailability,
    resetAll,
    linkedSettings,
    setLinkedSettings,
    selectedStages,
    selectedSettings,
    selectedStageIndex,
    selectedMetadata,
    bumpRenderVersion,
  };
}
