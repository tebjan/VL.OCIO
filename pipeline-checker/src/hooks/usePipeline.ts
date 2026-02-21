import { useState, useCallback, useMemo } from 'react';
import { type PipelineSettings, createDefaultSettings } from '../types/settings';
import type { StageState } from '../types/pipeline';
import { type StageInfo, STAGE_NAMES } from '../pipeline/types/StageInfo';

const STAGE_COUNT = STAGE_NAMES.length;

/** Stages that cannot be disabled (first and last) */
const LOCKED_STAGES = new Set([0, STAGE_COUNT - 1]);

function createDefaultStages(): StageState[] {
  return Array.from({ length: STAGE_COUNT }, () => ({ enabled: true }));
}

export interface UsePipelineReturn {
  settings: PipelineSettings;
  stages: StageInfo[];
  selectedStageIndex: number;
  updateSettings: (patch: Partial<PipelineSettings>) => void;
  toggleStage: (index: number, enabled: boolean) => void;
  selectStage: (index: number) => void;
  resetAll: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [settings, setSettings] = useState<PipelineSettings>(createDefaultSettings);
  const [stageStates, setStageStates] = useState<StageState[]>(createDefaultStages);
  const [selectedStageIndex, setSelectedStageIndex] = useState(STAGE_COUNT - 1);

  const updateSettings = useCallback((patch: Partial<PipelineSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleStage = useCallback((index: number, enabled: boolean) => {
    if (LOCKED_STAGES.has(index)) return;
    setStageStates((prev) => {
      const next = prev.slice();
      next[index] = { enabled };
      return next;
    });
  }, []);

  const selectStage = useCallback((index: number) => {
    if (index >= 0 && index < STAGE_COUNT) {
      setSelectedStageIndex(index);
    }
  }, []);

  const resetAll = useCallback(() => {
    setSettings(createDefaultSettings());
    setStageStates(createDefaultStages());
    setSelectedStageIndex(STAGE_COUNT - 1);
  }, []);

  // Derive StageInfo[] from StageState[] + STAGE_NAMES
  const stages: StageInfo[] = useMemo(() => {
    return stageStates.map((state, i) => ({
      index: i,
      name: STAGE_NAMES[i].name,
      shortName: STAGE_NAMES[i].shortName,
      enabled: state.enabled,
      available: true,  // availability determined by GPU features (set externally later)
      thumbnail: null,  // set when PipelineRenderer provides stage textures
    }));
  }, [stageStates]);

  return {
    settings,
    stages,
    selectedStageIndex,
    updateSettings,
    toggleStage,
    selectStage,
    resetAll,
  };
}
