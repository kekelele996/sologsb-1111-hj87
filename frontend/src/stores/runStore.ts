import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { DrillRun, RunAnomaly, RunRevision, RunRevisionField, RunRevisionFieldKey, RunShift } from '../types/drill-run';
import { RUN_REVISION_FIELDS } from '../types/drill-run';
import type { LithoLog } from '../types/litho-log';
import { footageOf, gradeOf, isActiveRun, isAnomaly, overlappingLithos, recoveryOf, RECOVERY_GRADE_TEXT } from '../utils/recovery';

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

/** 修订审计信息：操作人必填；与岩性编录深度重叠时原因必填（由页面/存储双重校验） */
export interface RunAuditInput {
  reason?: string;
  operator: string;
}

/** 与回次深度重叠的岩性编录（用于页面提示必须填写原因） */
export interface RunOverlapInfo {
  lithoId: string;
  lithology: string;
  fromDepth: number;
  toDepth: number;
  overlapFrom: number;
  overlapTo: number;
}

export type RunMutationResult =
  | { ok: true; run: DrillRun; revision: RunRevision }
  | { ok: false; reason: 'reason-required'; run: DrillRun; overlaps: RunOverlapInfo[] }
  | { ok: false; reason: 'not-found' | 'voided' | 'unchanged' | 'operator-required'; run?: DrillRun };

interface RunState {
  runs: DrillRun[];
  /** 修订留痕，按修订时间倒序（最新在前） */
  revisions: RunRevision[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addRun: (input: RunInput) => Promise<DrillRun>;
  /**
   * 调整回次：与同孔岩性编录深度重叠时必须填写修订原因；
   * 原值、修改后的值、时间、操作人写入一条留痕。
   */
  updateRun: (id: string, patch: Partial<RunInput>, audit: RunAuditInput) => Promise<RunMutationResult>;
  /** 作废回次（软删除）：规则同调整，作废后不再参与任何派生计算 */
  voidRun: (id: string, audit: RunAuditInput) => Promise<RunMutationResult>;
  removeRun: (id: string) => Promise<void>;
  removeByHole: (holeId: string) => Promise<void>;
}

/** 回次与采取率派生值：进尺与采取率均由起止深度、岩芯长度自动计算 */
export const useRunStore = create<RunState>()((set, get) => ({
  runs: [],
  revisions: [],
  hydrated: false,

  hydrate: async () => {
    const [runs, revisions] = await Promise.all([
      db.runs.orderBy('fromDepth').toArray(),
      db.runRevisions.orderBy('revisedAt').reverse().toArray(),
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
      status: '正常',
      remark: input.remark?.trim() || undefined,
    };
    await db.runs.put(run);
    set({ runs: [run, ...get().runs] });
    return run;
  },

  updateRun: async (id, patch, audit) => {
    const current = get().runs.find((r) => r.id === id);
    if (!current) return { ok: false, reason: 'not-found' };
    if (!isActiveRun(current)) return { ok: false, reason: 'voided', run: current };
    if (!audit.operator.trim()) return { ok: false, reason: 'operator-required', run: current };

    const merged = { ...current, ...patch };
    const footage = footageOf(merged.fromDepth, merged.toDepth);
    const coreLength = Number(merged.coreLength) || 0;
    const next: DrillRun = {
      ...current,
      runNo: merged.runNo.trim(),
      holeId: merged.holeId,
      fromDepth: Number(merged.fromDepth) || 0,
      toDepth: Number(merged.toDepth) || 0,
      footage,
      coreLength,
      recovery: recoveryOf(coreLength, footage),
      waterLevel: Number(merged.waterLevel) || 0,
      shift: merged.shift,
      drilledAt: merged.drilledAt,
      recorder: merged.recorder.trim(),
      status: '正常',
      remark: merged.remark?.trim() || undefined,
    };

    const changes = diffRuns(current, next);
    if (changes.length === 0) return { ok: false, reason: 'unchanged', run: current };

    // 重叠判定以修订后的钻孔与深度区间为准（可能调整了孔号或深度）
    const block = await checkOverlapBlock(next, audit.reason);
    if (block) return block;

    const revision: RunRevision = {
      id: uid('rev'),
      runId: current.id,
      runNo: next.runNo,
      holeId: next.holeId,
      action: '调整',
      reason: audit.reason?.trim() || undefined,
      operator: audit.operator.trim(),
      revisedAt: new Date().toISOString(),
      changes,
    };
    await db.transaction('rw', db.runs, db.runRevisions, async () => {
      await db.runs.put(next);
      await db.runRevisions.put(revision);
    });
    set({
      runs: get().runs.map((r) => (r.id === id ? next : r)),
      revisions: [revision, ...get().revisions],
    });
    return { ok: true, run: next, revision };
  },

  voidRun: async (id, audit) => {
    const current = get().runs.find((r) => r.id === id);
    if (!current) return { ok: false, reason: 'not-found' };
    if (!isActiveRun(current)) return { ok: false, reason: 'voided', run: current };
    if (!audit.operator.trim()) return { ok: false, reason: 'operator-required', run: current };

    const block = await checkOverlapBlock(current, audit.reason);
    if (block) return block;

    const now = new Date().toISOString();
    const next: DrillRun = { ...current, status: '作废', voidedAt: now, voidedBy: audit.operator.trim() };
    const changes = diffRuns(current, next);
    const revision: RunRevision = {
      id: uid('rev'),
      runId: current.id,
      runNo: current.runNo,
      holeId: current.holeId,
      action: '作废',
      reason: audit.reason?.trim() || undefined,
      operator: audit.operator.trim(),
      revisedAt: now,
      changes,
    };
    await db.transaction('rw', db.runs, db.runRevisions, async () => {
      await db.runs.put(next);
      await db.runRevisions.put(revision);
    });
    set({
      runs: get().runs.map((r) => (r.id === id ? next : r)),
      revisions: [revision, ...get().revisions],
    });
    return { ok: true, run: next, revision };
  },

  removeRun: async (id) => {
    await db.transaction('rw', db.runs, db.runRevisions, async () => {
      await db.runs.delete(id);
      await db.runRevisions.where('runId').equals(id).delete();
    });
    set({
      runs: get().runs.filter((r) => r.id !== id),
      revisions: get().revisions.filter((rev) => rev.runId !== id),
    });
  },

  removeByHole: async (holeId) => {
    const ids = new Set(get().runs.filter((r) => r.holeId === holeId).map((r) => r.id));
    await db.transaction('rw', db.runs, db.runRevisions, async () => {
      await db.runs.where('holeId').equals(holeId).delete();
      await db.runRevisions.where('holeId').equals(holeId).delete();
    });
    set({
      runs: get().runs.filter((r) => r.holeId !== holeId),
      revisions: get().revisions.filter((rev) => !ids.has(rev.runId)),
    });
  },
}));

/** 字段原始值（空备注、历史回次缺省状态归一） */
function fieldValue(run: DrillRun, field: RunRevisionFieldKey): string | number | null {
  if (field === 'remark') return run.remark ?? null;
  if (field === 'status') return run.status ?? '正常';
  const value = run[field];
  return value === undefined || value === '' ? null : (value as string | number);
}

/** 对比两条回次记录，返回发生变化的字段明细（含进尺、采取率等派生值） */
export function diffRuns(before: DrillRun, after: DrillRun): RunRevisionField[] {
  return (Object.keys(RUN_REVISION_FIELDS) as RunRevisionFieldKey[]).flatMap((field) => {
    const oldValue = fieldValue(before, field);
    const newValue = fieldValue(after, field);
    return oldValue !== newValue ? [{ field, label: RUN_REVISION_FIELDS[field], before: oldValue, after: newValue }] : [];
  });
}

/** 重叠校验：回次与同孔岩性编录深度重叠且未填原因时阻断调整/作废 */
async function checkOverlapBlock(current: DrillRun, reason: string | undefined): Promise<RunMutationResult | null> {
  if (reason?.trim()) return null;
  let lithos: LithoLog[];
  try {
    lithos = await db.lithos.where('holeId').equals(current.holeId).toArray();
  } catch {
    lithos = [];
  }
  const overlaps = overlappingLithos(current, lithos);
  if (overlaps.length === 0) return null;
  return {
    ok: false,
    reason: 'reason-required',
    run: current,
    overlaps: overlaps.map(({ log, overlapFrom, overlapTo }) => ({
      lithoId: log.id,
      lithology: log.lithology,
      fromDepth: log.fromDepth,
      toDepth: log.toDepth,
      overlapFrom,
      overlapTo,
    })),
  };
}

/** 采取率异常清单（低于 75% 判异常；调用方应只传入未作废回次） */
export function anomalyList(runs: DrillRun[], holeNoOf: (holeId: string) => string): RunAnomaly[] {
  return runs
    .filter(isActiveRun)
    .filter((run) => isAnomaly(run.recovery))
    .map((run) => ({
      run,
      holeNo: holeNoOf(run.holeId),
      grade: gradeOf(run.recovery),
      advice: RECOVERY_GRADE_TEXT.异常.advice,
    }))
    .sort((a, b) => a.run.recovery - b.run.recovery);
}
