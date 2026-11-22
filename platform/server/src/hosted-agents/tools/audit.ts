import type { ToolExecutionRecord, ToolMetrics } from './types.js';

export function calculateToolMetrics(records: ToolExecutionRecord[]): ToolMetrics {
  const total = records.length;
  let successful = 0;
  let failed = 0;
  let totalDuration = 0;

  const byTool: Record<
    string,
    { total: number; success: number; failure: number; totalDuration: number }
  > = {};

  for (const r of records) {
    if (r.success) {
      successful++;
    } else {
      failed++;
    }

    const dur = typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) ? r.durationMs : 0;
    totalDuration += dur;

    if (!byTool[r.toolName]) {
      byTool[r.toolName] = { total: 0, success: 0, failure: 0, totalDuration: 0 };
    }
    byTool[r.toolName].total++;
    if (r.success) {
      byTool[r.toolName].success++;
    } else {
      byTool[r.toolName].failure++;
    }
    byTool[r.toolName].totalDuration += dur;
  }

  const toolStats: Record<string, { total: number; success: number; failure: number; averageDurationMs: number | null }> = {};
  for (const [name, s] of Object.entries(byTool)) {
    toolStats[name] = {
      total: s.total,
      success: s.success,
      failure: s.failure,
      averageDurationMs: s.total > 0 ? Math.round(s.totalDuration / s.total) : null
    };
  }

  return {
    totalExecutions: total,
    successfulExecutions: successful,
    failedExecutions: failed,
    averageDurationMs: total > 0 ? Math.round(totalDuration / total) : null,
    byTool: toolStats
  };
}
