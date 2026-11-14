// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import * as Schema from "effect/Schema";
import { InspectionSha256, utf8ByteLength } from "../inspection/bytes.ts";
import { canonicalScoreMatchAuditJson as canonical } from "./score-match-audit.ts";

const text = Schema.String.check(Schema.isPattern(/\S/u));
const ordinal = Schema.Number.check(Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(1));
const bytes = Schema.Number.check(Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(0));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const submissionEvidence = Schema.NonEmptyArray(
  Schema.Struct({ kind: Schema.Literals(["file", "command", "observation"]), ref: text, note: text }),
);
export const AgentJudgeGradeSubmissionSchema = Schema.Struct({
  measurement: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  rationale: text,
  evidence: submissionEvidence,
});
export const AgentJudgeBinarySubmissionSchema = Schema.Struct({
  satisfied: Schema.Boolean,
  rationale: text,
  evidence: submissionEvidence,
});
export const AgentJudgeSubmissionSchema = Schema.Union([
  AgentJudgeBinarySubmissionSchema,
  AgentJudgeGradeSubmissionSchema,
]);
export type AgentJudgeSubmission = typeof AgentJudgeSubmissionSchema.Type;
export const agentJudgeMeasurement = (value: AgentJudgeSubmission): number =>
  "satisfied" in value ? (value.satisfied ? 1 : 0) : value.measurement;
export const AgentJudgeFailureSchema = Schema.Struct({
  state: Schema.Literals(["unavailable", "errored"]),
  code: text,
  message: text,
});
export type AgentJudgeFailure = typeof AgentJudgeFailureSchema.Type;
const result = Schema.Union([
  Schema.Struct({ state: Schema.Literal("measured"), value: Schema.Finite }),
  AgentJudgeFailureSchema,
  Schema.Struct({ state: Schema.Literal("interrupted") }),
]);
const submission = Schema.NullOr(
  Schema.Struct({ generation: ordinal, callId: text, value: AgentJudgeSubmissionSchema }),
);
export const AgentJudgeToolTraceSchema = Schema.Struct({
  ordinal,
  step: ordinal,
  generation: ordinal,
  callId: text,
  name: text,
  arguments: Schema.String,
  validation: Schema.Literals(["valid", "invalid", "not-checked"]),
  state: Schema.Literals(["completed", "failed", "interrupted", "not-started"]),
  result: Schema.NullOr(Schema.String),
});
export type AgentJudgeToolTrace = typeof AgentJudgeToolTraceSchema.Type;
export const AgentJudgeTraceSchema = Schema.Struct({
  definition: Schema.Struct({
    version: text,
    config: Schema.String,
    digest,
    limits: Schema.Struct({ maxTurns: ordinal, timeoutMs: ordinal, maxMaterialBytes: Schema.optionalKey(ordinal) }),
  }),
  cleanup: Schema.Struct({ state: Schema.Literals(["released", "unconfirmed"]), diagnostic: Schema.NullOr(text) }),
  input: Schema.String,
  systemPrompt: Schema.String,
  criteria: Schema.NonEmptyArray(text),
  steps: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["chat", "judge", "grade"]),
      message: text,
      key: Schema.NullOr(text),
      anchors: Schema.NullOr(Schema.Array(Schema.Struct({ measurement: Schema.Finite, description: text }))),
    }),
  ),
  images: Schema.Array(
    Schema.Struct({
      imageId: text,
      evidenceIndex: bytes,
      mediaType: Schema.Literals(["image/png", "image/jpeg"]),
      byteLength: bytes,
      sha256: digest,
      paths: Schema.Array(Schema.String),
    }),
  ),
  session: Schema.Array(Schema.Unknown),
  tools: Schema.Array(AgentJudgeToolTraceSchema),
  compactions: Schema.Array(
    Schema.Struct({
      trigger: ordinal,
      tokensBefore: Schema.NullOr(bytes),
      summary: Schema.NullOr(text),
      failure: Schema.NullOr(AgentJudgeFailureSchema),
    }),
  ),
});
/** One conversation trajectory shared by all questions in an Agent Judge session. */
export type AgentJudgeTrace = typeof AgentJudgeTraceSchema.Type;
export const AgentJudgeAuditSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  protocol: Schema.Literal("niceeval.agent-judge-audit/v1"),
  trace: Schema.Struct({ state: Schema.Literal("reference"), entryIndex: bytes, digest }),
  criterion: text,
  prompt: text,
  submission,
  result,
});
/** Retained question result and its referenced conversation trajectory. */
export type AgentJudgeAudit = typeof AgentJudgeAuditSchema.Type;
const envelope = Schema.Struct({
  manifest: Schema.Struct({
    schemaVersion: Schema.Literal(1),
    protocol: Schema.Literal("niceeval.agent-judge-audit/v1"),
    byteLength: bytes,
    digest,
    chunkByteLengths: Schema.Array(bytes),
  }),
  content: Schema.Array(Schema.String),
});
export const AgentJudgeAuditReadResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), audit: AgentJudgeAuditSchema, trace: AgentJudgeTraceSchema }),
  Schema.Struct({ state: Schema.Literal("invalid") }),
  Schema.Struct({ state: Schema.Literal("unsupported") }),
]);
/** Strict historical validation result for an Agent Judge question. */
export type AgentJudgeAuditReadResult = typeof AgentJudgeAuditReadResultSchema.Type;
export function agentJudgeDigest(value: string): string {
  return new InspectionSha256().update(new TextEncoder().encode(value)).digestHex();
}

/** Verifies Content chunks and decodes one independent Agent Judge audit envelope. */
export function decodeAgentJudgeEnvelope(raw: unknown): AgentJudgeAudit {
  const value = Schema.decodeUnknownSync(envelope, { onExcessProperty: "error" })(raw);
  const body = value.content.join("");
  if (
    value.manifest.byteLength !== utf8ByteLength(body) ||
    value.manifest.digest !== agentJudgeDigest(body) ||
    canonical(value.manifest.chunkByteLengths) !== canonical(value.content.map(utf8ByteLength))
  )
    throw new Error("Invalid Agent Judge envelope");
  return Schema.decodeUnknownSync(AgentJudgeAuditSchema, { onExcessProperty: "error" })(JSON.parse(body));
}

/** Decodes the complete pi trajectory retrieved through Content pagination. */
export function decodeAgentJudgeTrace(raw: unknown): AgentJudgeTrace {
  return Schema.decodeUnknownSync(AgentJudgeTraceSchema, { onExcessProperty: "error" })(raw);
}

/** Strict historical reader; references are resolved only within this Assertion attachment. */
export function readAgentJudgeAudit(
  raw: unknown,
  measurement: number | undefined,
  resolve: (entryIndex: number) => unknown,
  imageContents: readonly { readonly mediaType: string; readonly bytes: Uint8Array }[] = [],
): AgentJudgeAuditReadResult {
  try {
    if (typeof raw === "object" && raw !== null && "manifest" in raw) {
      const manifest = raw.manifest;
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "protocol" in manifest &&
        manifest.protocol !== "niceeval.agent-judge-audit/v1"
      )
        return { state: "unsupported" };
    }
    const audit = decodeAgentJudgeEnvelope(raw);
    const trace = decodeAgentJudgeTrace(resolve(audit.trace.entryIndex));
    if (audit.trace.state === "reference" && audit.trace.digest !== agentJudgeDigest(canonical(trace)))
      throw new Error("Agent Judge trace digest mismatch");
    if (
      !trace.criteria.includes(audit.criterion) ||
      new Set(trace.criteria).size !== trace.criteria.length ||
      trace.definition.digest !==
        agentJudgeDigest(
          canonical({
            version: trace.definition.version,
            config: trace.definition.config,
            limits: trace.definition.limits,
          }),
        )
    )
      throw new Error("Agent Judge definition mismatch");
    for (const image of trace.images) {
      const content = imageContents[image.evidenceIndex];
      if (
        content === undefined ||
        content.mediaType !== image.mediaType ||
        content.bytes.byteLength !== image.byteLength ||
        new InspectionSha256().update(content.bytes).digestHex() !== image.sha256
      )
        throw new Error("Agent Judge image mismatch");
    }
    if (
      canonical(trace.steps.filter((step) => step.kind !== "chat").map((step) => step.key)) !==
        canonical(trace.criteria) ||
      trace.steps.some((step) =>
        step.kind === "chat"
          ? step.key !== null || step.anchors !== null
          : step.key === null || (step.kind === "judge" ? step.anchors !== null : step.anchors === null),
      ) ||
      trace.steps.find((step) => step.key === audit.criterion)?.message !== audit.prompt
    )
      throw new Error("Invalid Agent Judge conversation");
    const config = JSON.parse(trace.definition.config);
    if (canonical(config) !== trace.definition.config) throw new Error("Invalid canonical Agent Judge config");
    // Read the pi session itself. No reconstructed request history or wire body.
    const calls = new Map<string, { name: string; arguments: string; generation: number }>();
    const ids = new Set<string>();
    let generation = 0;
    for (const raw of trace.session) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("id" in raw) ||
        typeof raw.id !== "string" ||
        ids.has(raw.id) ||
        !("type" in raw)
      )
        throw new Error("Invalid pi session entry");
      ids.add(raw.id);
      if (raw.type === "message") {
        if (!("message" in raw) || typeof raw.message !== "object" || raw.message === null || !("role" in raw.message))
          throw new Error("Invalid pi message");
        const message = raw.message as { role: string; content: unknown };
        if (message.role === "assistant") {
          generation += 1;
          if (!Array.isArray(message.content)) throw new Error("Invalid pi assistant content");
          for (const item of message.content)
            if (item.type === "toolCall") {
              if (typeof item.id !== "string" || calls.has(item.id) || typeof item.name !== "string")
                throw new Error("Invalid pi tool call");
              calls.set(item.id, { name: item.name, arguments: canonical(item.arguments), generation });
            }
        }
      }
    }
    const executed = new Set<string>();
    for (const [index, tool] of trace.tools.entries()) {
      const call = calls.get(tool.callId);
      if (
        tool.ordinal !== index + 1 ||
        call === undefined ||
        call.name !== tool.name ||
        call.arguments !== tool.arguments ||
        call.generation !== tool.generation ||
        executed.has(tool.callId)
      )
        throw new Error("Agent Judge tool association mismatch");
      executed.add(tool.callId);
    }
    for (const compact of trace.compactions)
      if (
        compact.summary !== null &&
        !trace.session.some((raw) => {
          const entry = raw as { type?: string; summary?: string; tokensBefore?: number };
          return (
            entry.type === "compaction" &&
            entry.summary === compact.summary &&
            entry.tokensBefore === compact.tokensBefore
          );
        })
      )
        throw new Error("Missing pi compaction entry");
    if (audit.submission !== null) {
      const submitted = audit.submission;
      const tool = trace.tools.find((item) => item.callId === submitted.callId);
      if (
        tool === undefined ||
        tool.name !== "submit_evaluation" ||
        tool.state !== "completed" ||
        tool.validation !== "valid" ||
        tool.generation !== submitted.generation ||
        trace.steps[tool.step - 1]?.key !== audit.criterion ||
        canonical(JSON.parse(tool.arguments)) !== canonical(submitted.value) ||
        trace.steps.find((step) => step.key === audit.criterion)?.message !== audit.prompt
      )
        throw new Error("Invalid Agent Judge submission");
    }
    if (audit.submission !== null) {
      const step = trace.steps.find((step) => step.key === audit.criterion)!;
      Schema.decodeUnknownSync(
        step.kind === "judge" ? AgentJudgeBinarySubmissionSchema : AgentJudgeGradeSubmissionSchema,
        { onExcessProperty: "error" },
      )(audit.submission.value);
    }
    if (
      (audit.result.state === "measured" &&
        (audit.submission === null ||
          audit.result.value !== agentJudgeMeasurement(audit.submission.value) ||
          measurement !== audit.result.value)) ||
      (audit.result.state !== "measured" && measurement !== undefined)
    )
      throw new Error("Agent Judge result mismatch");
    return { state: "available", audit, trace };
  } catch {
    return { state: "invalid" };
  }
}
