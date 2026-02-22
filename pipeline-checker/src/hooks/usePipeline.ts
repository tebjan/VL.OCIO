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
  setStageAvailability: (indices: number[], available: boolean) => void;
  resetAll: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [settings, setSettings] = useState<PipelineSettings>(createDefaultSettings);
  const [stageStates, setStageStates] = useState<StageState[]>(createDefaultStages);
  const [selectedStageIndex, setSelectedStageIndex] = useState(STAGE_COUNT - 1);
  const [unavailableStages, setUnavailableStages] = useState<Set<number>>(new Set());

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

  const setStageAvailability = useCallback((indices: number[], available: boolean) => {
    setUnavailableStages((prev) => {
      const next = new Set(prev);
      for (const idx of indices) {
        if (available) next.delete(idx);
        else next.add(idx);
      }
      return next;
    });
  }, []);

  const selectStage = useCallback((index: number) => {
    if (index >= 0 && index < STAGE_COUNT && !unavailableStages.has(index)) {
      setSelectedStageIndex(index);
    }
  }, [unavailableStages]);

  const resetAll = useCallback(() => {
    setSettings(createDefaultSettings());
    setStageStates(createDefaultStages());
    setSelectedStageIndex(STAGE_COUNT - 1);
    setUnavailableStages(new Set());
  }, []);

  // Derive StageInfo[] from StageState[] + STAGE_NAMES + unavailableStages
  const stages: StageInfo[] = useMemo(() => {
    return stageStates.map((state, i) => ({
      index: i,
      name: STAGE_NAMES[i].name,
      shortName: STAGE_NAMES[i].shortName,
      enabled: state.enabled,
      available: !unavailableStages.has(i),
      thumbnail: null,  // set when PipelineRenderer provides stage textures
    }));
  }, [stageStates, unavailableStages]);

  return {
    settings,
    stages,
    selectedStageIndex,
    updateSettings,
    toggleStage,
    selectStage,
    setStageAvailability,
    resetAll,
  };
}
