import type { RunShift } from './drill-run';

/** 修订动作：调整（改值）或作废（删回次） */
export type RevisionAction = '调整' | '作废';

/** 回次数值快照（修订前 / 修订后各留一份） */
export interface RunSnapshot {
  runNo: string;
  fromDepth: number;
  toDepth: number;
  footage: number;
  coreLength: number;
  recovery: number;
  waterLevel: number;
  shift: RunShift;
  drilledAt: string;
  recorder: string;
  remark?: string;
}

/** 回次修订留痕：与岩性编录重叠的回次调整 / 作废时必填原因并落一条记录 */
export interface RunRevision {
  id: string;
  /** 被修订的回次 id（作废后回次已删，仅靠该 id 与快照追溯） */
  runId: string;
  /** 所属钻孔 */
  holeId: string;
  /** 修订动作 */
  action: RevisionAction;
  /** 修订原因（必填） */
  reason: string;
  /** 原值快照 */
  before: RunSnapshot;
  /** 修改后的值快照；作废时为 null */
  after: RunSnapshot | null;
  /** 操作人 */
  operator: string;
  /** 修订时间 ISO */
  revisedAt: string;
}
