/**
 * Хранение данных: проекты, сценарии, журнал версий расчёта.
 *
 * Хранилище абстрагировано интерфейсом KeyValueStore; в браузере — localStorage,
 * в тестах — память. Версия хранит исходные данные и компактный снимок результата
 * (сроки операций), чтобы сравнивать расчёты без повторного ввода.
 */
import { calculateSchedule } from '../engine/calculate';
import { cloneInput, createDefaultInput } from '../engine/defaults';
import { hashObject } from '../engine/hash';
import type { ProjectInput, ScheduleResult } from '../engine/types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

export interface VersionSnapshot {
  id: string;
  scenarioId: string;
  createdAt: string;
  comment: string;
  inputHash: string;
  resultHash: string;
  rulesetVersion: string;
  projectStart: string;
  projectFinish: string;
  durationCalendarDays: number;
  confidence: string;
  input: ProjectInput;
  /** id → [start, finish, totalFloat, critical] */
  ops: Record<string, [string, string, number, boolean]>;
  names: Record<string, string>;
}

export interface Scenario {
  id: string;
  name: string;
  input: ProjectInput;
  createdAt: string;
  basedOn: string | null;
}

export interface Project {
  id: string;
  name: string;
  scenarios: Scenario[];
  activeScenarioId: string;
  baselineScenarioId: string;
}

interface StoreState {
  schemaVersion: 1;
  projects: Project[];
  activeProjectId: string | null;
}

const KEY = 'gpr-engine/state/v1';
const VERSIONS_KEY = (projectId: string) => `gpr-engine/versions/v1/${projectId}`;
const MAX_VERSIONS = 50;

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class ProjectStore {
  private state: StoreState;

  constructor(private readonly kv: KeyValueStore) {
    this.state = this.load();
  }

  private load(): StoreState {
    try {
      const raw = this.kv.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as StoreState;
        if (s.schemaVersion === 1 && Array.isArray(s.projects)) return s;
      }
    } catch {
      /* повреждённые данные не удаляем — начинаем с нового состояния в памяти */
    }
    return { schemaVersion: 1, projects: [], activeProjectId: null };
  }

  private save() {
    this.kv.setItem(KEY, JSON.stringify(this.state));
  }

  get projects(): Project[] {
    return this.state.projects;
  }

  get activeProject(): Project | null {
    return this.state.projects.find((p) => p.id === this.state.activeProjectId) ?? null;
  }

  createProject(input: ProjectInput = createDefaultInput()): Project {
    const scenario: Scenario = { id: uid('sc'), name: 'Базовый сценарий', input: cloneInput(input), createdAt: new Date().toISOString(), basedOn: null };
    const p: Project = { id: uid('pr'), name: input.name, scenarios: [scenario], activeScenarioId: scenario.id, baselineScenarioId: scenario.id };
    this.state.projects.push(p);
    this.state.activeProjectId = p.id;
    this.save();
    return p;
  }

  setActiveProject(id: string) {
    this.state.activeProjectId = id;
    this.save();
  }

  deleteProject(id: string) {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    if (this.state.activeProjectId === id) this.state.activeProjectId = this.state.projects[0]?.id ?? null;
    this.kv.removeItem(VERSIONS_KEY(id));
    this.save();
  }

  updateScenarioInput(projectId: string, scenarioId: string, input: ProjectInput) {
    const p = this.mustProject(projectId);
    const s = p.scenarios.find((x) => x.id === scenarioId);
    if (!s) throw new Error('Сценарий не найден');
    s.input = cloneInput(input);
    if (scenarioId === p.baselineScenarioId) p.name = input.name;
    this.save();
  }

  addScenario(projectId: string, fromScenarioId: string, name: string): Scenario {
    const p = this.mustProject(projectId);
    const from = p.scenarios.find((x) => x.id === fromScenarioId)!;
    const s: Scenario = { id: uid('sc'), name, input: cloneInput(from.input), createdAt: new Date().toISOString(), basedOn: from.id };
    p.scenarios.push(s);
    p.activeScenarioId = s.id;
    this.save();
    return s;
  }

  renameScenario(projectId: string, scenarioId: string, name: string) {
    const s = this.mustProject(projectId).scenarios.find((x) => x.id === scenarioId);
    if (s) s.name = name;
    this.save();
  }

  deleteScenario(projectId: string, scenarioId: string) {
    const p = this.mustProject(projectId);
    if (scenarioId === p.baselineScenarioId) throw new Error('Базовый сценарий удалить нельзя');
    p.scenarios = p.scenarios.filter((s) => s.id !== scenarioId);
    if (p.activeScenarioId === scenarioId) p.activeScenarioId = p.baselineScenarioId;
    this.save();
  }

  setActiveScenario(projectId: string, scenarioId: string) {
    this.mustProject(projectId).activeScenarioId = scenarioId;
    this.save();
  }

  private mustProject(id: string): Project {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) throw new Error('Проект не найден');
    return p;
  }

  /* ───────────── Журнал версий ───────────── */

  versions(projectId: string): VersionSnapshot[] {
    try {
      const raw = this.kv.getItem(VERSIONS_KEY(projectId));
      return raw ? (JSON.parse(raw) as VersionSnapshot[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Сохранить версию расчёта. Если исходные данные и результат не изменились
   * с последней версии этого сценария — новая версия не создаётся.
   */
  recordVersion(projectId: string, scenarioId: string, input: ProjectInput, result: ScheduleResult, comment = ''): VersionSnapshot | null {
    const list = this.versions(projectId);
    const lastForScenario = [...list].reverse().find((v) => v.scenarioId === scenarioId);
    if (lastForScenario && lastForScenario.inputHash === result.meta.inputHash && lastForScenario.resultHash === result.meta.resultHash) return null;
    const v = makeSnapshot(scenarioId, input, result, comment);
    list.push(v);
    while (list.length > MAX_VERSIONS) list.shift();
    this.kv.setItem(VERSIONS_KEY(projectId), JSON.stringify(list));
    return v;
  }
}

export function makeSnapshot(scenarioId: string, input: ProjectInput, result: ScheduleResult, comment = ''): VersionSnapshot {
  const ops: VersionSnapshot['ops'] = {};
  const names: VersionSnapshot['names'] = {};
  for (const o of result.operations) {
    ops[o.id] = [o.start, o.finish, o.totalFloat, o.critical];
    names[o.id] = `${o.name} — ${o.locationLabel}`;
  }
  return {
    id: uid('v'),
    scenarioId,
    createdAt: new Date().toISOString(),
    comment,
    inputHash: result.meta.inputHash,
    resultHash: result.meta.resultHash,
    rulesetVersion: result.meta.rulesetVersion,
    projectStart: result.projectStart,
    projectFinish: result.projectFinish,
    durationCalendarDays: result.durationCalendarDays,
    confidence: result.confidence.level,
    input: cloneInput(input),
    ops,
    names,
  };
}

/* ───────────── Сравнение версий / сценариев ───────────── */

export interface OpDiff {
  id: string;
  name: string;
  startA: string | null;
  startB: string | null;
  finishA: string | null;
  finishB: string | null;
  shiftStartDays: number | null;
  shiftFinishDays: number | null;
  criticalA: boolean | null;
  criticalB: boolean | null;
}

export interface Comparison {
  finishA: string;
  finishB: string;
  finishShiftDays: number;
  durationA: number;
  durationB: number;
  changedOps: OpDiff[];
  addedOps: number;
  removedOps: number;
  becameCritical: number;
  leftCritical: number;
  inputChanges: string[];
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function compareSnapshots(a: VersionSnapshot, b: VersionSnapshot): Comparison {
  const changed: OpDiff[] = [];
  let added = 0;
  let removed = 0;
  let became = 0;
  let left = 0;
  const ids = new Set([...Object.keys(a.ops), ...Object.keys(b.ops)]);
  for (const id of ids) {
    const x = a.ops[id];
    const y = b.ops[id];
    if (!x) added++;
    if (!y) removed++;
    if (x && y) {
      if (!x[3] && y[3]) became++;
      if (x[3] && !y[3]) left++;
    }
    if (x && y && x[0] === y[0] && x[1] === y[1] && x[3] === y[3]) continue;
    changed.push({
      id,
      name: b.names[id] ?? a.names[id] ?? id,
      startA: x?.[0] ?? null,
      startB: y?.[0] ?? null,
      finishA: x?.[1] ?? null,
      finishB: y?.[1] ?? null,
      shiftStartDays: x && y ? dayDiff(x[0], y[0]) : null,
      shiftFinishDays: x && y ? dayDiff(x[1], y[1]) : null,
      criticalA: x?.[3] ?? null,
      criticalB: y?.[3] ?? null,
    });
  }
  changed.sort((p, q) => Math.abs(q.shiftFinishDays ?? 9999) - Math.abs(p.shiftFinishDays ?? 9999) || p.id.localeCompare(q.id));
  return {
    finishA: a.projectFinish,
    finishB: b.projectFinish,
    finishShiftDays: dayDiff(a.projectFinish, b.projectFinish),
    durationA: a.durationCalendarDays,
    durationB: b.durationCalendarDays,
    changedOps: changed,
    addedOps: added,
    removedOps: removed,
    becameCritical: became,
    leftCritical: left,
    inputChanges: diffInputs(a.input, b.input),
  };
}

/** Перечень изменённых исходных параметров (пути в объекте). */
export function diffInputs(a: unknown, b: unknown, path = ''): string[] {
  if (hashObject(a) === hashObject(b)) return [];
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    const out: string[] = [];
    for (const k of [...keys].sort()) {
      out.push(...diffInputs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  const fmt = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));
  return [`${path}: ${fmt(a)} → ${fmt(b)}`];
}

/** Сравнить два сценария (рассчитываются заново, без сохранения версий). */
export function compareScenarios(a: Scenario, b: Scenario): Comparison {
  const ra = calculateSchedule(a.input);
  const rb = calculateSchedule(b.input);
  return compareSnapshots(makeSnapshot(a.id, a.input, ra), makeSnapshot(b.id, b.input, rb));
}
