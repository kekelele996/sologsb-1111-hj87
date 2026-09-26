import { useCallback, useMemo } from 'react';
import { useRunStore } from '../stores/runStore';
import {
  footageOf,
  gapsWithin,
  gradeOf,
  isActiveRun,
  isAnomaly,
  mergeRanges,
  reachedDepthOf,
  recoveryOf,
  validateRange,
} from '../utils/recovery';
import type { DrillRun } from '../types/drill-run';

export interface HoleDepthSummary {
  runs: DrillRun[];
  runCount: number;
  /** 累计进尺（m），仅统计未作废回次 */
  totalFootage: number;
  /** 累计岩芯长度（m），仅统计未作废回次 */
  totalCore: number;
  /** 加权平均采取率（%），仅统计未作废回次 */
  averageRecovery: number;
  /** 异常回次数（采取率 < 75%），仅统计未作废回次 */
  anomalyCount: number;
  /** 已钻进深度（m），仅统计未作废回次 */
  reachedDepth: number;
  /** 深度覆盖区间，仅统计未作废回次 */
  coverage: Array<{ from: number; to: number }>;
  /** 作废回次数 */
  voidedCount: number;
}

/** 进尺、岩芯长度、采取率与深度覆盖计算（回次页与岩芯箱页共用，作废回次不参与） */
export function useDepthCalc() {
  const allRuns = useRunStore((s) => s.runs);
  const runs = useMemo(() => allRuns.filter(isActiveRun), [allRuns]);

  const runsOf = useCallback((holeId: string) => runs.filter((run) => run.holeId === holeId), [runs]);

  const coverage = useCallback(
    (holeId: string) => mergeRanges(runsOf(holeId).map((run) => ({ from: run.fromDepth, to: run.toDepth }))),
    [runsOf],
  );

  const summarize = useCallback(
    (holeId: string): HoleDepthSummary => {
      const holeRuns = runsOf(holeId);
      const totalFootage = Number(holeRuns.reduce((sum, run) => sum + run.footage, 0).toFixed(2));
      const totalCore = Number(holeRuns.reduce((sum, run) => sum + run.coreLength, 0).toFixed(2));
      return {
        runs: [...holeRuns].sort((a, b) => a.fromDepth - b.fromDepth),
        runCount: holeRuns.length,
        totalFootage,
        totalCore,
        averageRecovery: recoveryOf(totalCore, totalFootage),
        anomalyCount: holeRuns.filter((run) => isAnomaly(run.recovery)).length,
        reachedDepth: reachedDepthOf(holeRuns),
        coverage: mergeRanges(holeRuns.map((run) => ({ from: run.fromDepth, to: run.toDepth }))),
        voidedCount: allRuns.filter((run) => run.holeId === holeId && !isActiveRun(run)).length,
      };
    },
    [runsOf, allRuns],
  );

  const gapsIn = useCallback(
    (holeId: string, fromDepth: number, toDepth: number) => gapsWithin(fromDepth, toDepth, runsOf(holeId)),
    [runsOf],
  );

  return {
    runs,
    runsOf,
    coverage,
    summarize,
    gapsIn,
    footageOf,
    recoveryOf,
    gradeOf,
    validateRange,
  };
}
