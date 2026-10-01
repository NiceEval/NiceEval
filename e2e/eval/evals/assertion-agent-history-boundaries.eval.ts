import { defineScoreEval, type StreamEvent } from "niceeval";
import { completeEvidenceCoverage, defineAgent, makeSendFailure, type SendFailure } from "niceeval/adapter";
import { equals } from "niceeval/expect";

// Only the external Agent protocol is simulated. Coverage, joining, cuts,
// source retention, QA evaluation and provider requests belong to the candidate.
export const boundaryAgent = defineAgent({
  name: "eval-agent-qa-boundaries",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    const events: StreamEvent[] = [];
    switch (input.text) {
      case "boundary/cross-a":
        events.push(
          { type: "operation.started", operationId: "cross-operation", operation: { kind: "tool", name: "boundary_cross", input: { marker: "CROSS_A_INPUT" } } },
          { type: "context.injected", text: "CROSS_A_INJECTED", source: "fixture-hook" },
          { type: "thinking", text: "CROSS_A_THINKING" },
          { type: "skill.loaded", skill: "cross-a-skill" },
          { type: "compaction", reason: "CROSS_A_SUMMARY_REASON" },
          { type: "message", role: "assistant", text: "CROSS_A_ASSISTANT" },
        );
        break;
      case "boundary/cross-b":
        events.push(
          { type: "operation.finished", operationId: "cross-operation", kind: "tool", status: "completed", output: { marker: "CROSS_B_OUTPUT" } },
          { type: "message", role: "assistant", text: "CROSS_B_ASSISTANT" },
        );
        break;
      case "boundary/failure":
        throw makeSendFailure({
          acceptance: "started",
          message: "BOUNDARY_SEND_FAILURE",
          events: [
            { type: "operation.started", operationId: "failure-operation", operation: { kind: "tool", name: "boundary_failure", input: { marker: "FAILURE_INPUT" } } },
            { type: "operation.finished", operationId: "failure-operation", kind: "tool", status: "failed", output: { marker: "FAILURE_OUTPUT" } },
            { type: "error", message: "FAILURE_ERROR_EVENT" },
            { type: "message", role: "assistant", text: "FAILURE_ASSISTANT" },
          ],
        });
      case "boundary/orphan":
        events.push(
          { type: "operation.finished", operationId: "orphan-operation", kind: "tool", status: "completed", output: { summary: "ORPHAN_OUTPUT_SUMMARY" } },
          { type: "message", role: "assistant", text: "ORPHAN_ASSISTANT" },
        );
        break;
      case "boundary/ambiguous":
        events.push(
          { type: "operation.started", operationId: "ambiguous-operation", operation: { kind: "tool", name: "boundary_ambiguous", input: { marker: "AMBIGUOUS_FIRST_INPUT" } } },
          { type: "operation.started", operationId: "ambiguous-operation", operation: { kind: "tool", name: "boundary_ambiguous", input: { marker: "AMBIGUOUS_SECOND_INPUT" } } },
          { type: "operation.finished", operationId: "ambiguous-operation", kind: "tool", status: "completed", output: { summary: "AMBIGUOUS_OUTPUT_SUMMARY" } },
          { type: "message", role: "assistant", text: "AMBIGUOUS_ASSISTANT" },
        );
        break;
      case "boundary/truncated":
        // The returned observation supplies a summary and a formal truncation
        // receipt, with no full output for the candidate to reconstruct.
        events.push(
          { type: "operation.started", operationId: "truncated-operation", operation: { kind: "tool", name: "boundary_truncated", input: { marker: "TRUNCATED_INPUT" } } },
          { type: "operation.finished", operationId: "truncated-operation", kind: "tool", status: "completed", output: { summary: "TRUNCATED_OUTPUT_SUMMARY" }, truncated: [{ path: "output", originalBytes: 10000 }] },
          { type: "message", role: "assistant", text: "TRUNCATED_ASSISTANT" },
        );
        break;
      case "boundary/events":
      case "boundary/messages":
      case "boundary/actions":
      case "boundary/metrics":
      case "boundary/baseline":
        events.push({ type: "message", role: "assistant", text: `COVERAGE_ASSISTANT:${input.text}` });
        break;
      default:
        throw new Error(`Unknown Agent QA boundary input: ${input.text}`);
    }
    return {
      status: "completed" as const,
      events,
      ...(input.text === "boundary/events" ? { evidenceCoverage: { events: { status: "partial" as const, reason: "BOUNDARY_EVENTS_PARTIAL" } } }
        : input.text === "boundary/messages" ? { evidenceCoverage: { messages: { status: "partial" as const, reason: "BOUNDARY_MESSAGES_PARTIAL" } } }
        : input.text === "boundary/actions" ? { evidenceCoverage: { actions: { status: "partial" as const, reason: "BOUNDARY_ACTIONS_PARTIAL" } } }
        : input.text === "boundary/metrics" ? { evidenceCoverage: {
          usage: { status: "partial" as const, reason: "BOUNDARY_USAGE_PARTIAL" },
          data: { status: "partial" as const, reason: "BOUNDARY_DATA_PARTIAL" },
        } } : {}),
    };
  },
});

const events = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/events");
    turn.closeQA("ACCEPT: partial events turn").label("Boundary events turn");
    session.closeQA("ACCEPT: partial events session").label("Boundary events session");
    t.closeQA("ACCEPT: partial events root").label("Boundary events root");
  },
});
const messages = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/messages");
    turn.closeQA("ACCEPT: partial messages turn").label("Boundary messages turn");
    session.closeQA("ACCEPT: partial messages session").label("Boundary messages session");
    t.closeQA("ACCEPT: partial messages root").label("Boundary messages root");
  },
});
const actions = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/actions");
    turn.closeQA("ACCEPT: partial actions turn").label("Boundary actions turn");
    session.closeQA("ACCEPT: partial actions session").label("Boundary actions session");
    t.closeQA("ACCEPT: partial actions root").label("Boundary actions root");
  },
});
const metrics = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/metrics");
    turn.closeQA("ACCEPT: partial metrics turn history").gate(1).score(1).label("Boundary metrics turn");
    session.closeQA("ACCEPT: partial metrics session history").gate(1).score(1).label("Boundary metrics session");
    t.closeQA("ACCEPT: partial metrics root history").gate(1).score(1).label("Boundary metrics root");
  },
});
const crossTurn = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const a = await session.send("boundary/cross-a");
    const b = await session.send("boundary/cross-b");
    const { closeQA } = a;
    closeQA("ACCEPT: cross A cut after B").gate(1).score(1).label("Boundary cross A");
    b.closeQA("ACCEPT: cross B joined input and output").gate(1).score(1).label("Boundary cross B");
    session.closeQA("ACCEPT: cross whole session history").gate(1).score(1).label("Boundary cross session");
  },
});
const failure = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    await session.send("boundary/baseline");
    let rejected: SendFailure | undefined;
    try {
      await session.send("boundary/failure");
    } catch (error) {
      if (typeof error !== "object" || error === null || !("type" in error) || error.type !== "agent-send-failed") throw error;
      rejected = error as SendFailure;
    }
    t.check(rejected?.message, equals("BOUNDARY_SEND_FAILURE")).gate().label("Boundary SendFailure caught");
    session.closeQA("ACCEPT: failed session observed history").label("Boundary failure session");
    t.closeQA("ACCEPT: failed root observed history").label("Boundary failure root");
  },
});
const orphan = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/orphan");
    turn.closeQA("ACCEPT: orphan turn history").label("Boundary orphan turn");
    session.closeQA("ACCEPT: orphan session history").label("Boundary orphan session");
    t.closeQA("ACCEPT: orphan root history").label("Boundary orphan root");
  },
});
const ambiguous = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/ambiguous");
    turn.closeQA("ACCEPT: ambiguous turn history").label("Boundary ambiguous turn");
    session.closeQA("ACCEPT: ambiguous session history").label("Boundary ambiguous session");
    t.closeQA("ACCEPT: ambiguous root history").label("Boundary ambiguous root");
  },
});
const truncated = defineScoreEval({
  judge: "judge-eval-override",
  async test(t) {
    const session = t.newSession();
    const turn = await session.send("boundary/truncated");
    turn.closeQA("ACCEPT: truncated turn history").label("Boundary truncated turn");
    session.closeQA("ACCEPT: truncated session history").label("Boundary truncated session");
    t.closeQA("ACCEPT: truncated root history").label("Boundary truncated root");
  },
});

export default { actions, ambiguous, crossTurn, events, failure, messages, metrics, orphan, truncated };
