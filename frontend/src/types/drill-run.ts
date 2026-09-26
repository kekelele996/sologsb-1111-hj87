/** 回次水位 */
export type RunShift = '甲班' | '乙班' | '丙班';

/** 回次状态：作废为软删除，保留台账但不参与采取率、异常清单与装箱连续性计算 */
export type RunStatus = '正常' | '作废';

/** 钻进回次 */
export interface DrillRun {
  id: string;
  /** 回次号 */
  runNo: string;
  /** 所属钻孔 */
  holeId: string;
  /** 起深度（m） */
  fromDepth: number;
  /** 止深度（m） */
  toDepth: number;
  /** 进尺（m），由起止深度自动计算 */
  footage: number;
  /** 岩芯长度（m） */
  coreLength: number;
  /** 采取率（%），由岩芯长度 / 进尺自动计算 */
  recovery: number;
  /** 回次水位（m） */
  waterLevel: number;
  /** 班次 */
  shift: RunShift;
  /** 钻进日期 ISO */
  drilledAt: string;
  /** 记录人 */
  recorder: string;
  /** 状态，历史数据缺省视为「正常」 */
  status?: RunStatus;
  /** 作废时间 ISO */
  voidedAt?: string;
  /** 作废操作人 */
  voidedBy?: string;
  /** 备注 */
  remark?: string;
}

/** 回次修订动作 */
export type RunRevisionAction = '调整' | '作废';

/** 纳入修订对比的回次字段（进尺、采取率为派生值，随原值一并留痕） */
export const RUN_REVISION_FIELDS = {
  runNo: '回次号',
  holeId: '所属钻孔',
  fromDepth: '起深度(m)',
  toDepth: '止深度(m)',
  footage: '进尺(m)',
  coreLength: '岩芯长度(m)',
  recovery: '采取率(%)',
  waterLevel: '回次水位(m)',
  shift: '班次',
  drilledAt: '钻进日期',
  recorder: '记录人',
  status: '状态',
  remark: '备注',
} as const;

export type RunRevisionFieldKey = keyof typeof RUN_REVISION_FIELDS;

/** 单个字段的原值 → 修改后值 */
export interface RunRevisionField {
  field: RunRevisionFieldKey;
  label: string;
  /** 原值（null 表示原本为空） */
  before: string | number | null;
  /** 修改后的值（null 表示被清空） */
  after: string | number | null;
}

/** 回次修订留痕：每次调整/作废生成一条不可变记录 */
export interface RunRevision {
  id: string;
  /** 被修订的回次 */
  runId: string;
  /** 修订时的回次号（冗余留存，便于台账直接展示） */
  runNo: string;
  /** 所属钻孔 */
  holeId: string;
  /** 调整 / 作废 */
  action: RunRevisionAction;
  /** 修订原因：与岩性编录深度重叠时必填 */
  reason?: string;
  /** 修订操作人 */
  operator: string;
  /** 修订时间 ISO */
  revisedAt: string;
  /** 变化字段明细 */
  changes: RunRevisionField[];
}

/** 采取率分级 */
export type RecoveryGrade = '优' | '合格' | '异常';

/** 异常回次（采取率低于阈值）派生项 */
export interface RunAnomaly {
  run: DrillRun;
  holeNo: string;
  grade: RecoveryGrade;
  advice: string;
}
