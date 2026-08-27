import { Result } from "effect";

import type { RepoRef } from "../docs/trace/ref.js";
import { FeedbackReferenceConflict } from "./errors.js";
import type { FeedbackClosure, FeedbackMemoryRelation, FeedbackV2 } from "./schema.js";

function conflict(operation: string, message: string): Result.Result<never, FeedbackReferenceConflict> {
  return Result.fail(new FeedbackReferenceConflict({ operation, message }));
}

export function linkMemory(
  feedback: FeedbackV2,
  relation: FeedbackMemoryRelation,
): Result.Result<FeedbackV2, FeedbackReferenceConflict> {
  if (feedback.id === relation.memory) return conflict("link", "feedback cannot relate to itself");
  if (feedback.memoryRelations.some((item) => item.kind === relation.kind && item.memory === relation.memory)) {
    return conflict("link", "memory relation already exists");
  }
  return Result.succeed({ ...feedback, memoryRelations: [...feedback.memoryRelations, relation] });
}

export function adoptFeedback(
  feedback: FeedbackV2,
  target: RepoRef,
): Result.Result<FeedbackV2, FeedbackReferenceConflict> {
  if (feedback.state === "closed") {
    return conflict("adopt", "closed Feedback must be reopened before adding a current adoption");
  }
  if (feedback.adoptions.current.includes(target)) return conflict("adopt", `exact target ${target} is already current`);
  return Result.succeed({
    ...feedback,
    adoptions: { ...feedback.adoptions, current: [...feedback.adoptions.current, target] },
  });
}

export function retireFeedback(
  feedback: FeedbackV2,
  target: RepoRef,
  commit: string,
): Result.Result<FeedbackV2, FeedbackReferenceConflict> {
  if (!feedback.adoptions.current.includes(target)) return conflict("retire", `exact target ${target} is not current`);
  return Result.succeed({
    ...feedback,
    adoptions: {
      current: feedback.adoptions.current.filter((item) => item !== target),
      history: [...feedback.adoptions.history, { target, commit }],
    },
  });
}

export function closeFeedback(
  feedback: FeedbackV2,
  closure: FeedbackClosure,
): Result.Result<FeedbackV2, FeedbackReferenceConflict> {
  if (feedback.state === "closed") return conflict("close", "feedback is already closed");
  if (closure.kind === "fixed" && (
    feedback.subject === "dependency" || (feedback.claim !== "defect" && feedback.claim !== "friction")
  )) return conflict("close", "fixed closure requires a product/repository defect or friction");
  if (closure.kind === "delivered" && feedback.claim !== "request") {
    return conflict("close", "delivered closure is only valid for a request");
  }
  if (closure.kind === "external-fixed" && feedback.subject !== "dependency") {
    return conflict("close", "external-fixed closure requires dependency Feedback");
  }
  if (closure.kind === "declined" && feedback.claim !== "request" && feedback.claim !== "friction") {
    return conflict("close", "declined closure requires a request or friction");
  }
  if (closure.kind === "duplicate" && closure.canonical === feedback.id) {
    return conflict("close", "duplicate feedback cannot name itself as canonical");
  }
  if ((closure.kind === "fixed" || closure.kind === "delivered" || closure.kind === "declined") &&
    closure.memory === feedback.id) return conflict("close", "closure memory cannot be the feedback itself");
  if ((closure.kind === "declined" || closure.kind === "invalid" || closure.kind === "duplicate") &&
    feedback.adoptions.current.length > 0) {
    return conflict("close", "closure requires empty current adoptions; retire each exact target first");
  }
  if (closure.kind === "delivered" &&
    !feedback.adoptions.current.includes(closure.target) &&
    !feedback.adoptions.history.some((item) => item.target === closure.target)) {
    return conflict("close", `delivered target ${closure.target} is absent from current and history adoptions`);
  }
  return Result.succeed({ ...feedback, state: "closed", closure });
}

export function reopenFeedback(feedback: FeedbackV2): Result.Result<FeedbackV2, FeedbackReferenceConflict> {
  if (feedback.state === "open") return conflict("reopen", "feedback is already open");
  const { closure: _closure, ...open } = feedback;
  return Result.succeed({ ...open, state: "open" });
}
