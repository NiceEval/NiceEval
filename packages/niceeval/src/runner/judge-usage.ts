import type { JudgeUsageAttachment } from "../record/family/judge-usage/schema.ts";
import type { EvalResult } from "./types.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";

const captures = new WeakMap<EvalResult, JudgeUsageAttachment>();
export function retainJudgeUsage(result: EvalResult, value: JudgeUsageAttachment): void { captures.set(result, value); }
export function judgeUsageForResult(result: EvalResult, entryIds: readonly AssertionEntryId[]): JudgeUsageAttachment | undefined {
  const value = captures.get(result);
  if (value === undefined) return undefined;
  return Object.freeze({ ...value, calls: Object.freeze(value.calls.map((call) => {
    const entryId = entryIds[call.entryIndex];
    if (entryId === undefined) throw new Error("Judge usage references an unsealed Assertion entry");
    return Object.freeze({ ...call, entryId });
  })) });
}
