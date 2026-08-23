import { Either } from "effect";
import { FeedbackReferenceConflict } from "./errors.js";
import type { FeedbackClosure, FeedbackMemoryRelation, FeedbackV1 } from "./schema.js";

function conflict(operation: string, message: string): Either.Either<never, FeedbackReferenceConflict> {
  return Either.left(new FeedbackReferenceConflict({ operation, message }));
}

export function linkMemory(
  feedback: FeedbackV1,
  relation: FeedbackMemoryRelation,
): Either.Either<FeedbackV1, FeedbackReferenceConflict> {
  if (feedback.id === relation.memory) return conflict("link", "feedback cannot relate to itself");
  if (feedback.memoryRelations.some((item) => item.kind === relation.kind && item.memory === relation.memory)) {
    return conflict("link", "memory relation already exists");
  }
  return Either.right({ ...feedback, memoryRelations: [...feedback.memoryRelations, relation] });
}

export function closeFeedback(
  feedback: FeedbackV1,
  closure: FeedbackClosure,
): Either.Either<FeedbackV1, FeedbackReferenceConflict> {
  if (feedback.state === "closed") return conflict("close", "feedback is already closed");
  if (closure.kind === "delivered" && feedback.claim !== "request") {
    return conflict("close", "delivered closure is only valid for a request");
  }
  if (closure.kind === "duplicate" && closure.canonical === feedback.id) {
    return conflict("close", "duplicate feedback cannot name itself as canonical");
  }
  if ((closure.kind === "fixed" || closure.kind === "delivered" || closure.kind === "declined") &&
    closure.memory === feedback.id) return conflict("close", "closure memory cannot be the feedback itself");
  return Either.right({
    ...feedback,
    state: "closed",
    closure,
    ...(closure.kind === "duplicate" ? { duplicateOf: closure.canonical } : {}),
  });
}

export function reopenFeedback(
  feedback: FeedbackV1,
): Either.Either<FeedbackV1, FeedbackReferenceConflict> {
  if (feedback.state === "open") return conflict("reopen", "feedback is already open");
  const { closure: _closure, duplicateOf: _duplicateOf, ...open } = feedback;
  return Either.right({ ...open, state: "open" });
}
