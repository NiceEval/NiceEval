import type { AttemptNote } from "../record/family/attempt-note/schema.ts";
import type { EvalResult } from "./types.ts";
const notesByResult = new WeakMap<EvalResult, readonly AttemptNote[]>();
export function retainAttemptNotes(result: EvalResult, notes: readonly AttemptNote[]): void {
  notesByResult.set(result, notes);
}
export function attemptNotesForResult(result: EvalResult): readonly AttemptNote[] {
  return notesByResult.get(result) ?? [];
}
