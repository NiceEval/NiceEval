import { Either } from "effect";
import { MemoryReferenceConflict } from "./errors.js";
import type { MemoryV1, ProblemResolution, Promotion } from "./schema.js";

function conflict(operation: string, message: string): Either.Either<never, MemoryReferenceConflict> {
  return Either.left(new MemoryReferenceConflict({ operation, message }));
}

export function resolveProblem(
  memory: MemoryV1,
  resolution: ProblemResolution,
): Either.Either<MemoryV1, MemoryReferenceConflict> {
  if (memory.kind.type !== "problem") return conflict("resolve", "only Problem Memory can be resolved");
  if (memory.kind.state === "resolved") return conflict("resolve", "Problem Memory is already resolved");
  return Either.right({ ...memory, kind: { type: "problem", state: "resolved", resolution } });
}

export function reopenProblem(memory: MemoryV1): Either.Either<MemoryV1, MemoryReferenceConflict> {
  if (memory.kind.type !== "problem") return conflict("reopen", "only Problem Memory can be reopened");
  if (memory.kind.state === "open") return conflict("reopen", "Problem Memory is already open");
  return Either.right({ ...memory, kind: { type: "problem", state: "open" } });
}

export function supersedeMemory(
  memory: MemoryV1,
  replacement: MemoryV1,
): Either.Either<MemoryV1, MemoryReferenceConflict> {
  if (memory.id === replacement.id) return conflict("supersede", "Memory cannot supersede itself");
  if (memory.kind.type === "problem" || replacement.kind.type !== memory.kind.type) {
    return conflict("supersede", "only Decision or Insight Memory of the same kind may supersede an entry");
  }
  if (memory.kind.state === "superseded") return conflict("supersede", "Memory is already superseded");
  return Either.right({ ...memory, kind: { type: memory.kind.type, state: "superseded", supersededBy: replacement.id } });
}

export function promoteMemory(
  memory: MemoryV1,
  promotion: Promotion,
  commit: string,
): Either.Either<MemoryV1, MemoryReferenceConflict> {
  const previous = memory.promotions.find((item) => item.kind === promotion.kind);
  if (previous === undefined) return Either.right({ ...memory, promotions: [...memory.promotions, promotion] });
  const history = [...previous.history];
  if (previous.current !== undefined &&
    (promotion.current === undefined || previous.current.path !== promotion.current.path ||
      previous.current.anchor !== promotion.current.anchor)) {
    history.push({ ...previous.current, commit });
  }
  const updated: Promotion = { ...promotion, history };
  return Either.right({
    ...memory,
    promotions: memory.promotions.map((item) => item.kind === promotion.kind ? updated : item),
  });
}
