import * as Schema from "effect/Schema";
import type { ExecutionTraceInput } from "../adapter-execution-trace.ts";
import type { AdapterAttachmentCollector } from "../runner/adapter-attachments.ts";
import type { AdapterExecutionTraceCollector } from "../runner/adapter-execution-trace.ts";
import { displayTextHasForbiddenCharacter } from "../record/family/execution-traces/schema.ts";

const Count = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0));
export const SimulatedUserGenerationSchema = Schema.Struct({
  kind: Schema.Literals(["turn", "compaction"]),
  inputTokens: Schema.NullOr(Count),
  outputTokens: Schema.NullOr(Count),
  costUSD: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SimulatedUserGeneration = Schema.Schema.Type<typeof SimulatedUserGenerationSchema>;
export const SimulatedUserActivitySchema = Schema.Struct({
  protocol: Schema.Literal("niceeval.simulated-user/v1"),
  id: Schema.String,
  sessionId: Schema.String,
  sourceTurnId: Schema.String,
  targetTurnId: Schema.NullOr(Schema.String),
  question: Schema.String,
  conversation: Schema.String,
  answer: Schema.NullOr(Schema.String),
  startOffsetMs: Schema.Finite,
  durationMs: Schema.Finite,
  failure: Schema.NullOr(Schema.Struct({ code: Schema.String, reason: Schema.String })),
  generations: Schema.Array(SimulatedUserGenerationSchema),
});
/** Sealed reply activity with its source Turn, pi session, answer and independent usage. */
export type SimulatedUserActivity = Schema.Schema.Type<typeof SimulatedUserActivitySchema>;

/** Decodes the sealed activity returned through execution evidence. */
export function decodeSimulatedUserActivity(input: unknown): SimulatedUserActivity {
  return Schema.decodeUnknownSync(SimulatedUserActivitySchema, { onExcessProperty: "error" })(input);
}

const retainedActivities = new WeakMap<import("../runner/types.ts").EvalResult, readonly SimulatedUserActivity[]>();
export function retainSimulatedUserActivities(result: import("../runner/types.ts").EvalResult, activities: readonly SimulatedUserActivity[]): void {
  if (activities.length > 0) retainedActivities.set(result, Object.freeze([...activities]));
}
export function simulatedUserActivitiesForResult(result: import("../runner/types.ts").EvalResult): readonly SimulatedUserActivity[] {
  return retainedActivities.get(result) ?? [];
}

/** Uses the existing sealed trace/evidence path with a distinct producer and actor. */
export async function captureSimulatedUserActivity(
  activity: SimulatedUserActivity,
  attachments: AdapterAttachmentCollector,
  traces: AdapterExecutionTraceCollector,
): Promise<void> {
  const body = JSON.stringify(activity);
  const artifact = await attachments.attach({ name: `${activity.id}.json`, mediaType: "application/json", body: {
    async *stream() {
      const bytes = new TextEncoder().encode(body);
      for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) yield bytes.subarray(offset, offset + 1024 * 1024);
    },
  } });
  const input: ExecutionTraceInput = {
    traceId: activity.id, schema: { id: "niceeval.simulated-user/v1" },
    collection: { state: "complete", limitations: [] }, scopes: [{ scopeId: activity.sourceTurnId, label: "Source Turn", boundary: { sessionId: activity.sessionId, turnId: activity.sourceTurnId } }], events: [{
      key: activity.id, type: "simulated-user.reply",
      source: { id: "niceeval.simulated-user" }, actor: { id: "simulated-user", label: "Simulated user" },
      summary: activity.failure === null ? "Simulated user answered the Agent" : `Simulated user failed: ${activity.failure.reason}`,
      scopeMemberships: [{ scopeId: activity.sourceTurnId, state: "included" }],
      ...(activity.answer === null || displayTextHasForbiddenCharacter(activity.answer) ? {} : {
        display: [{ kind: "code" as const, language: "json", text: [...activity.answer].slice(0, 1024).join("") }],
      }),
      payload: {
        sessionId: activity.sessionId, sourceTurnId: activity.sourceTurnId, targetTurnId: activity.targetTurnId,
        durationMs: activity.durationMs,
        usage: activity.generations.map(generation => ({ inputTokens: generation.inputTokens, outputTokens: generation.outputTokens, costUSD: generation.costUSD })),
      },
      evidence: [{ key: "audit", label: "Simulated user requests, responses and answer", artifactId: artifact.artifactId, pointer: "" }],
    }],
  };
  await traces.recordTrace(input);
}
