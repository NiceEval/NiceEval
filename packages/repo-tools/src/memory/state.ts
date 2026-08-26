import { Result } from "effect";

import type { RepoRef } from "../docs/trace/ref.js";
import { MemoryReferenceConflict } from "./errors.js";
import type { MemoryV1, ProblemResolution, Promotion, PromotionKind } from "./schema.js";

function conflict(operation: string, message: string): Result.Result<never, MemoryReferenceConflict> {
  return Result.fail(new MemoryReferenceConflict({ operation, message }));
}

export function resolveProblem(memory: MemoryV1, resolution: ProblemResolution): Result.Result<MemoryV1, MemoryReferenceConflict> {
  if (memory.kind.type !== "problem") return conflict("resolve", "only Problem Memory can be resolved");
  if (memory.kind.state === "resolved") return conflict("resolve", "Problem Memory is already resolved");
  return Result.succeed({ ...memory, kind: { type: "problem", state: "resolved", resolution } });
}

export function reopenProblem(memory: MemoryV1): Result.Result<MemoryV1, MemoryReferenceConflict> {
  if (memory.kind.type !== "problem") return conflict("reopen", "only Problem Memory can be reopened");
  if (memory.kind.state === "open") return conflict("reopen", "Problem Memory is already open");
  return Result.succeed({ ...memory, kind: { type: "problem", state: "open" } });
}

export function supersedeMemory(
  memory: MemoryV1,
  replacement: MemoryV1,
  commit: string,
): Result.Result<MemoryV1, MemoryReferenceConflict> {
  if (memory.id === replacement.id) return conflict("supersede", "Memory cannot supersede itself");
  if (memory.kind.type === "problem" || replacement.kind.type !== memory.kind.type) {
    return conflict("supersede", "only Decision or Insight Memory of the same kind may supersede an entry");
  }
  if (memory.kind.state === "superseded") return conflict("supersede", "Memory is already superseded");
  if (replacement.kind.state === "superseded") return conflict("supersede", "replacement Memory must still be current");
  const promotions = memory.promotions.map((promotion): Promotion => ({
    ...promotion,
    history: [...promotion.history, ...promotion.current.map((target) => ({ target, commit }))],
    current: [],
  }));
  return Result.succeed({
    ...memory,
    kind: { type: memory.kind.type, state: "superseded", supersededBy: replacement.id },
    promotions,
  });
}

export function promoteMemory(
  memory: MemoryV1,
  kind: PromotionKind,
  target: RepoRef,
): Result.Result<MemoryV1, MemoryReferenceConflict> {
  if (memory.kind.type !== "problem" && memory.kind.state === "superseded") {
    return conflict("promote", "superseded Decision/Insight Memory cannot gain a current promotion");
  }
  const previous = memory.promotions.find((item) => item.kind === kind);
  if (previous?.current.includes(target) === true) return conflict("promote", `exact target ${target} is already current`);
  if (previous === undefined) {
    return Result.succeed({ ...memory, promotions: [...memory.promotions, { kind, current: [target], history: [] }] });
  }
  return Result.succeed({
    ...memory,
    promotions: memory.promotions.map((item) => item.kind === kind
      ? { ...item, current: [...item.current, target] }
      : item),
  });
}

export function retirePromotion(
  memory: MemoryV1,
  kind: PromotionKind,
  target: RepoRef,
  commit: string,
): Result.Result<MemoryV1, MemoryReferenceConflict> {
  const previous = memory.promotions.find((item) => item.kind === kind);
  if (previous === undefined || !previous.current.includes(target)) {
    return conflict("retire", `exact target ${target} is not current in the ${kind} bucket`);
  }
  return Result.succeed({
    ...memory,
    promotions: memory.promotions.map((item) => item.kind === kind
      ? {
          ...item,
          current: item.current.filter((value) => value !== target),
          history: [...item.history, { target, commit }],
        }
      : item),
  });
}
