import type { JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import type { EffectiveUsageCall } from "./adapter-usage-projection.ts";

export const JUDGE_USAGE_PREVIEW_CALL_LIMIT = 128;
export const JUDGE_USAGE_PREVIEW_BYTE_LIMIT = 128 * 1024;

export function compareJudgeUsageCalls(left: JudgeUsageCall, right: JudgeUsageCall): number {
  return (
    left.entryIndex - right.entryIndex ||
    left.logicalOrdinal - right.logicalOrdinal ||
    left.transmissionOrdinal - right.transmissionOrdinal
  );
}

/** Tuple order is stable across hosts, with missing identities before strings. */
export function compareAdapterModelGroups(
  left: Pick<EffectiveUsageCall, "modelRole" | "provider" | "model">,
  right: Pick<EffectiveUsageCall, "modelRole" | "provider" | "model">,
): number {
  for (const key of ["modelRole", "provider", "model"] as const) {
    const a = left[key];
    const b = right[key];
    if (a === b) continue;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}
