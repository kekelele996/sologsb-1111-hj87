import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { DrillRun, RunAnomaly, RunShift } from '../types/drill-run';
import type { RunRevision, RunSnapshot } from '../types/run-revision';
import { footageOf, gradeOf, isAnomaly, recoveryOf, RECOVERY_GRADE_TEXT } from '../utils/recovery';

export interface RunInput {
  runNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  coreLength: number;
  waterLevel: number;
  shift: RunShift;
  drilledAt: string;
  recorder: string;
  remark?: string;
}

/** 修订留痕信息：与岩性编录重叠的回次调整 / 作废时必填 */
export interface RevisionMeta {
  reason: string;
  operator: string;
}

interface RunState {
  runs: DrillRun[];
  revisions: RunRevision[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addRun: (input: RunInput) => Promise<DrillRun>;
  updateRun: (id: string, patch: Partial<RunInput>, revision?: RevisionMeta) => Promise<void>;
  removeRun: (id: string, revision?: RevisionMeta) => Promise<void>;
  removeByHole: (holeId: string) => Promise<void>;
}

/** 回次数值快照（留痕原值 / 新值用） */
export function snapshotOf(run: DrillRun): RunSnapshot {
  return {
    runNo: run.runNo,
    fromDepth: run.fromDepth,
    toDepth: run.toDepth,
    footage: run.footage,
    coreLength: run.coreLength,
    recovery: run.recovery,
    waterLevel: run.waterLevel,
    shift: run.shift,
    drilledAt: run.drilledAt,
    recorder: run.recorder,
    remark: run.remark,
  };
}

/** 回次与采取率派生值：进尺与采取率均由起止深度、岩芯长度自动计算 */
export const useRunStore = create<RunState>()((set, get) => ({
  runs: [],
  revisions: [],
  hydrated: false,

  hydrate: async () => {
    const [runs, revisions] = await Promise.all([
      db.runs.orderBy('fromDepth').toArray(),
      db.runRevisions.orderBy('revisedAt').toArray(),
    ]);
    set({ runs, revisions, hydrated: true });
  },

  addRun: async (input) => {
    const footage = footageOf(input.fromDepth, input.toDepth);
    const run: DrillRun = {
      id: uid('run'),
      runNo: input.runNo.trim(),
      holeId: input.holeId,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      footage,
      coreLength: Number(input.coreLength) || 0,
      recovery: recoveryOf(input.coreLength, footage),
      waterLevel: Number(input.waterLevel) || 0,
      shift: input.shift,
      drilledAt: input.drilledAt,
      recorder: input.recorder.trim(),
      remark: input.remark?.trim() || undefined,
    };
    await db.runs.put(run);
    set({ runs: [run, ...get().runs] });
    return run;
  },

  updateRun: async (id, patch, revision) => {
    const current = get().runs.find((r) => r.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    const footage = footageOf(merged.fromDepth, merged.toDepth);
    const next: DrillRun = {
      ...merged,
      footage,
      recovery: recoveryOf(merged.coreLength, footage),
    };
    if (revision) {
      const record: RunRevision = {
        id: uid('rev'),
        runId: id,
        holeId: current.holeId,
        action: '调整',
        reason: revision.reason.trim(),
        before: snapshotOf(current),
        after: snapshotOf(next),
        operator: revision.operator.trim(),
        revisedAt: new Date().toISOString(),
      };
      await db.transaction('rw', db.runs, db.runRevisions, async () => {
        await db.runs.put(next);
        await db.runRevisions.put(record);
      });
      set({ runs: get().runs.map((r) => (r.id === id ? next : r)), revisions: [...get().revisions, record] });
      return;
    }
    await db.runs.put(next);
    set({ runs: get().runs.map((r) => (r.id === id ? next : r)) });
  },

  removeRun: async (id, revision) => {
    const current = get().runs.find((r) => r.id === id);
    if (revision && current) {
      const record: RunRevision = {
        id: uid('rev'),
        runId: id,
        holeId: current.holeId,
        action: '作废',
        reason: revision.reason.trim(),
        before: snapshotOf(current),
        after: null,
        operator: revision.operator.trim(),
        revisedAt: new Date().toISOString(),
      };
      await db.transaction('rw', db.runs, db.runRevisions, async () => {
        await db.runs.delete(id);
        await db.runRevisions.put(record);
      });
      set({ runs: get().runs.filter((r) => r.id !== id), revisions: [...get().revisions, record] });
      return;
    }
    await db.runs.delete(id);
    set({ runs: get().runs.filter((r) => r.id !== id) });
  },

  removeByHole: async (holeId) => {
    const ids = get().runs.filter((r) => r.holeId === holeId).map((r) => r.id);
    const revisionIds = get().revisions.filter((r) => r.holeId === holeId).map((r) => r.id);
    await db.transaction('rw', db.runs, db.runRevisions, async () => {
      await db.runs.bulkDelete(ids);
      await db.runRevisions.bulkDelete(revisionIds);
    });
    set({
      runs: get().runs.filter((r) => r.holeId !== holeId),
      revisions: get().revisions.filter((r) => r.holeId !== holeId),
    });
  },
}));

/** 采取率异常清单（低于 75% 判异常） */
export function anomalyList(runs: DrillRun[], holeNoOf: (holeId: string) => string): RunAnomaly[] {
  return runs
    .filter((run) => isAnomaly(run.recovery))
    .map((run) => ({
      run,
      holeNo: holeNoOf(run.holeId),
      grade: gradeOf(run.recovery),
      advice: RECOVERY_GRADE_TEXT.异常.advice,
    }))
    .sort((a, b) => a.run.recovery - b.run.recovery);
}

/** 某回次的修订留痕（按时间正序） */
export function revisionsOfRun(revisions: RunRevision[], runId: string): RunRevision[] {
  return revisions
    .filter((revision) => revision.runId === runId)
    .sort((a, b) => a.revisedAt.localeCompare(b.revisedAt));
}
