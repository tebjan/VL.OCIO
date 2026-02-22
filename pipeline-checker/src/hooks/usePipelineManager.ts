import { useState, useCallback, useMemo, useRef } from 'react';
import { type PipelineSettings, createDefaultSettings } from '../types/settings';
import type { StageState } from '../types/pipeline';
import { type StageInfo, STAGE_NAMES } from '../pipeline/types/StageInfo';
import type { LoadedFileType } from '../components/DropZone';
import type { ImageMetadata } from '../components/MetadataPanel';
import { PipelineRenderer } from '../pipeline/PipelineRenderer';
import { createColorPipelineStages } from '../pipeline/stages';
import { type PipelineId, type PipelineInstance, PIPELINE_COLORS, MAX_PIPELINES } from '../types/PipelineInstance';

const STAGE_COUNT = STAGE_NAMES.length;
const LOCKED_STAGES = new Set([0, STAGE_COUNT - 1]);

function createDefaultStages(): StageState[] {
  return Array.from({ length: STAGE_COUNT }, () => ({ enabled: true }));
}

/** Stage index to auto-select based on loaded file type. */
const STAGE_FOR_FILE_TYPE: Record<LoadedFileType, number> = {
  exr: STAGE_COUNT - 1,
  dds: 2,
  sample: STAGE_COUNT - 1,
};

/** Derive StageInfo[] from an instance's state */
function deriveStages(inst: PipelineInstance): StageInfo[] {
  return inst.stageStates.map((state, i) => ({
    index: i,
    name: STAGE_NAMES[i].name,
    shortName: STAGE_NAMES[i].shortName,
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
  ): void;
  selectPipeline(id: PipelineId): void;

  // Per-pipeline mutations (operate on selected pipeline if id omitted)
  updateSettings(patch: Partial<PipelineSettings>, id?: PipelineId): void;
  toggleStage(index: number, enabled: boolean, id?: PipelineId): void;
  selectStage(index: number, id?: PipelineId): void;
  setStageAvailability(indices: number[], available: boolean, id?: PipelineId): void;
  resetAll(id?: PipelineId): void;

  // Derived helpers for selected pipeline
  selectedStages: StageInfo[];
  selectedSettings: PipelineSettings;
  selectedStageIndex: number;
  selectedMetadata: ImageMetadata | null;

  bumpRenderVersion(): void;
}

export function usePipelineManager(): PipelineManagerReturn {
  const [instanceMap, setInstanceMap] = useState<Map<PipelineId, PipelineInstance>>(new Map());
  const [selectedId, setSelectedId] = useState<PipelineId | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const nextIdRef = useRef(0);

  const bumpRenderVersion = useCallback(() => {
    setRenderVersion((v) => v + 1);
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
  ): PipelineId => {
    const id = `pipeline-${nextIdRef.current++}` as PipelineId;

    setInstanceMap((prev) => {
      if (prev.size >= MAX_PIPELINES) return prev;

      const colorIndex = prev.size % PIPELINE_COLORS.length;
      const renderer = new PipelineRenderer(device);
      const stages = createColorPipelineStages();
      renderer.setStages(stages);
      renderer.setSize(width, height);

      const unavailableStages = fileType === 'dds' ? new Set([0, 1]) : new Set<number>();

      const instance: PipelineInstance = {
        id,
        colorIndex,
        fileName: fileName ?? null,
        fileType,
        fileHandle,
        renderer,
        sourceTexture,
        settings: createDefaultSettings(),
        stageStates: createDefaultStages(),
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
  ) => {
    updateInstance(id, (inst) => {
      inst.sourceTexture.destroy();
      inst.renderer.setSize(width, height);
      const unavailableStages = fileType === 'dds' ? new Set([0, 1]) : new Set<number>();
      return {
        ...inst,
        sourceTexture,
        metadata,
        fileType,
        fileName: fileName ?? null,
        fileHandle,
        selectedStageIndex: STAGE_FOR_FILE_TYPE[fileType],
        unavailableStages,
      };
    });
  }, [updateInstance]);

  const selectPipeline = useCallback((id: PipelineId) => {
    setSelectedId(id);
  }, []);

  const updateSettings = useCallback((patch: Partial<PipelineSettings>, id?: PipelineId) => {
    const targetId = id ?? selectedId;
    if (!targetId) return;
    updateInstance(targetId, (inst) => ({
      ...inst,
      settings: { ...inst.settings, ...patch },
    }));
  }, [selectedId, updateInstance]);

  const toggleStage = useCallback((index: number, enabled: boolean, id?: PipelineId) => {
    if (LOCKED_STAGES.has(index)) return;
    const targetId = id ?? selectedId;
    if (!targetId) return;
    updateInstance(targetId, (inst) => {
      const nextStates = inst.stageStates.slice();
      nextStates[index] = { enabled };
      let nextSettings = inst.settings;
      if (index === 4 && inst.settings.rrtEnabled !== enabled) {
        nextSettings = { ...nextSettings, rrtEnabled: enabled };
      }
      if (index === 5 && inst.settings.odtEnabled !== enabled) {
        nextSettings = { ...nextSettings, odtEnabled: enabled };
      }
      return { ...inst, stageStates: nextStates, settings: nextSettings };
    });
  }, [selectedId, updateInstance]);

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
    const targetId = id ?? selectedId;
    if (!targetId) return;
    updateInstance(targetId, (inst) => ({
      ...inst,
      settings: createDefaultSettings(),
      stageStates: createDefaultStages(),
      selectedStageIndex: STAGE_COUNT - 1,
      unavailableStages: new Set<number>(),
    }));
  }, [selectedId, updateInstance]);

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
    addPipeline,
    removePipeline,
    replacePipelineSource,
    selectPipeline,
    updateSettings,
    toggleStage,
    selectStage,
    setStageAvailability,
    resetAll,
    selectedStages,
    selectedSettings,
    selectedStageIndex,
    selectedMetadata,
    bumpRenderVersion,
  };
}
