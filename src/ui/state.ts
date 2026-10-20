import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { calculateSchedule, EngineError } from '../engine/calculate';
import { cloneInput, createDefaultInput } from '../engine/defaults';
import type { ProjectInput, ScheduleResult } from '../engine/types';
import { MemoryStore, ProjectStore, type KeyValueStore } from '../storage/projectStore';

function browserStore(): KeyValueStore {
  try {
    const k = '__gpr_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return new MemoryStore();
  }
}

const store = new ProjectStore(typeof window !== 'undefined' ? browserStore() : new MemoryStore());

export type CalcState = { result: ScheduleResult; error: null } | { result: null; error: { message: string; details: string[] } };

export function useApp() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  let project = store.activeProject;
  if (!project) project = store.createProject(createDefaultInput());
  const scenario = project.scenarios.find((s) => s.id === project!.activeScenarioId) ?? project.scenarios[0];
  const input = scenario.input;

  const calc: CalcState = useMemo(() => {
    try {
      return { result: calculateSchedule(input), error: null };
    } catch (e) {
      const details = e instanceof EngineError ? (e.details ?? []) : [];
      return { result: null, error: { message: e instanceof Error ? e.message : String(e), details } };
    }
  }, [input]);

  const setInput = useCallback(
    (update: (draft: ProjectInput) => void) => {
      const draft = cloneInput(input);
      update(draft);
      store.updateScenarioInput(project!.id, scenario.id, draft);
      bump();
    },
    [input, project, scenario.id],
  );

  // Журнал версий: каждый успешный пересчёт с изменёнными данными сохраняется (с задержкой)
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!calc.result) return;
    window.clearTimeout(timer.current);
    const pid = project!.id;
    const sid = scenario.id;
    const res = calc.result;
    timer.current = window.setTimeout(() => {
      if (store.recordVersion(pid, sid, input, res, 'Автосохранение при пересчёте')) bump();
    }, 1500);
    return () => window.clearTimeout(timer.current);
  }, [calc.result, input, project, scenario.id]);

  return {
    store,
    project,
    scenario,
    input,
    calc,
    setInput,
    refresh: bump,
  };
}

export type AppApi = ReturnType<typeof useApp>;
