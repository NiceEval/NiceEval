// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import * as Schema from "effect/Schema";
import { InspectionSha256, utf8ByteLength, encodeBase64Bytes } from "../inspection/bytes.ts";
import { canonicalScoreMatchAuditJson as canonical } from "./score-match-audit.ts";

const text = Schema.String.check(Schema.isPattern(/\S/u));
const ordinal = Schema.Number.check(Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(1));
const bytes = Schema.Number.check(Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(0));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
export const AgentJudgeSubmissionSchema = Schema.Struct({
  measurement: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  rationale: text,
  evidence: Schema.NonEmptyArray(Schema.Struct({ kind: Schema.Literals(["file", "command", "observation"]), ref: text, note: text })),
});
export type AgentJudgeSubmission = typeof AgentJudgeSubmissionSchema.Type;
export const AgentJudgeFailureSchema = Schema.Struct({ state: Schema.Literals(["unavailable", "errored"]), code: text, message: text });
export type AgentJudgeFailure = typeof AgentJudgeFailureSchema.Type;
const result = Schema.Union([Schema.Struct({ state: Schema.Literal("measured"), value: Schema.Finite }), AgentJudgeFailureSchema, Schema.Struct({ state: Schema.Literal("interrupted") })]);
const submission = Schema.NullOr(Schema.Struct({ generation: ordinal, callId: text, value: AgentJudgeSubmissionSchema }));
export const AgentJudgeToolTraceSchema = Schema.Struct({
  ordinal, generation: ordinal, callId: text, name: text, arguments: Schema.String,
  validation: Schema.Literals(["valid", "invalid", "not-checked"]),
  state: Schema.Literals(["completed", "failed", "interrupted", "not-started"]),
  result: Schema.NullOr(Schema.String),
});
export type AgentJudgeToolTrace = typeof AgentJudgeToolTraceSchema.Type;
const attempt = Schema.Struct({ ordinal, result: Schema.Union([
  Schema.Struct({ state: Schema.Literal("returned"), response: Schema.String }),
  Schema.Struct({ state: Schema.Literal("failed"), code: text, message: text }),
  Schema.Struct({ state: Schema.Literal("interrupted") }),
]) });
export const AgentJudgeGenerationSchema = Schema.Struct({
  kind: Schema.Literals(["turn", "compaction"]),
  wireBody: Schema.Struct({ byteLength: bytes, sha256: digest }),
  ordinal, step: ordinal, state: Schema.Literals(["admitted", "rejected"]), request: Schema.NullOr(Schema.String),
  attempts: Schema.Array(attempt), failure: Schema.NullOr(AgentJudgeFailureSchema),
});
export type AgentJudgeGeneration = typeof AgentJudgeGenerationSchema.Type;
export const AgentJudgeTraceSchema = Schema.Struct({
  definition: Schema.Struct({ name: text, version: text, config: Schema.String, digest,
    limits: Schema.Struct({ maxTurns: ordinal, timeoutMs: ordinal, maxMaterialBytes: ordinal, maxAuditBytes: ordinal }) }),
  cleanup: Schema.Struct({ state: Schema.Literals(["released", "unconfirmed"]), diagnostic: Schema.NullOr(text) }),
  input: Schema.String,
  criteria: Schema.NonEmptyArray(text),
  steps: Schema.Array(Schema.Struct({ kind: Schema.Literals(["chat", "judge"]), message: text, key: Schema.NullOr(text),
    anchors: Schema.NullOr(Schema.Array(Schema.Struct({ measurement: Schema.Finite, description: text }))) })),
  images: Schema.Array(Schema.Struct({ imageId: text, evidenceIndex: bytes, mediaType: Schema.Literals(["image/png", "image/jpeg"]), byteLength: bytes, sha256: digest, paths: Schema.Array(Schema.String) })),
  generations: Schema.Array(AgentJudgeGenerationSchema), tools: Schema.Array(AgentJudgeToolTraceSchema),
  compactions: Schema.Array(Schema.Struct({ trigger: ordinal, generations: Schema.Array(ordinal), tokensBefore: Schema.NullOr(bytes),
    summary: Schema.NullOr(text), failure: Schema.NullOr(AgentJudgeFailureSchema) })),
});
/** One conversation trajectory shared by all questions in an Agent Judge session. */
export type AgentJudgeTrace = typeof AgentJudgeTraceSchema.Type;
export const AgentJudgeAuditSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1), protocol: Schema.Literal("niceeval.agent-judge-audit/v1"),
  trace: Schema.Union([Schema.Struct({ state: Schema.Literal("inline"), value: AgentJudgeTraceSchema }),
    Schema.Struct({ state: Schema.Literal("reference"), entryIndex: bytes, digest })]),
  criterion: text, prompt: text, submission, result,
});
/** Retained question result and its inline or referenced conversation trajectory. */
export type AgentJudgeAudit = typeof AgentJudgeAuditSchema.Type;
const envelope = Schema.Struct({
  manifest: Schema.Struct({ schemaVersion: Schema.Literal(1), protocol: Schema.Literal("niceeval.agent-judge-audit/v1"), byteLength: bytes, digest, chunkByteLengths: Schema.Array(bytes) }),
  content: Schema.Array(Schema.String),
});
export const AgentJudgeAuditReadResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), audit: AgentJudgeAuditSchema, trace: AgentJudgeTraceSchema }),
  Schema.Struct({ state: Schema.Literal("invalid") }),
  Schema.Struct({ state: Schema.Literal("unsupported") }),
]);
/** Strict historical validation result for an Agent Judge question. */
export type AgentJudgeAuditReadResult = typeof AgentJudgeAuditReadResultSchema.Type;
export function agentJudgeDigest(value: string): string { return new InspectionSha256().update(new TextEncoder().encode(value)).digestHex(); }

/** Verifies Content chunks and decodes one independent Agent Judge audit envelope. */
export function decodeAgentJudgeEnvelope(raw: unknown): AgentJudgeAudit {
  const value = Schema.decodeUnknownSync(envelope, { onExcessProperty: "error" })(raw);
  const body = value.content.join("");
  if (value.manifest.byteLength !== utf8ByteLength(body) || value.manifest.digest !== agentJudgeDigest(body) ||
    canonical(value.manifest.chunkByteLengths) !== canonical(value.content.map(utf8ByteLength))) throw new Error("Invalid Agent Judge envelope");
  return Schema.decodeUnknownSync(AgentJudgeAuditSchema, { onExcessProperty: "error" })(JSON.parse(body));
}

/** Strict historical reader; references are resolved only within this Assertion attachment. */
export function readAgentJudgeAudit(raw: unknown, name: string, measurement: number | undefined,
  resolve: (entryIndex: number) => unknown, imageContents: readonly { readonly mediaType: string; readonly bytes: Uint8Array }[] = []): AgentJudgeAuditReadResult {
  try {
    if (typeof raw === "object" && raw !== null && "manifest" in raw) {
      const manifest = raw.manifest;
      if (typeof manifest === "object" && manifest !== null && "protocol" in manifest && manifest.protocol !== "niceeval.agent-judge-audit/v1") return { state: "unsupported" };
    }
    const audit = decodeAgentJudgeEnvelope(raw);
    const root = audit.trace.state === "inline" ? audit : decodeAgentJudgeEnvelope(resolve(audit.trace.entryIndex));
    if (root.trace.state !== "inline") throw new Error("Chained Agent Judge reference");
    const trace = root.trace.value;
    if (audit.trace.state === "reference" && audit.trace.digest !== agentJudgeDigest(canonical(trace))) throw new Error("Agent Judge trace digest mismatch");
    if (trace.definition.name !== name || !trace.criteria.includes(audit.criterion) || new Set(trace.criteria).size !== trace.criteria.length ||
      trace.definition.digest !== agentJudgeDigest(canonical({ name: trace.definition.name, version: trace.definition.version, config: trace.definition.config, limits: trace.definition.limits }))) throw new Error("Agent Judge definition mismatch");
    for (const image of trace.images) {
      const content = imageContents[image.evidenceIndex];
      if (content === undefined || content.mediaType !== image.mediaType || content.bytes.byteLength !== image.byteLength ||
        new InspectionSha256().update(content.bytes).digestHex() !== image.sha256) throw new Error("Agent Judge image mismatch");
    }
    if (canonical(trace.steps.filter((step) => step.kind === "judge").map((step) => step.key)) !== canonical(trace.criteria) ||
      trace.steps.some((step) => step.kind === "chat" ? step.key !== null || step.anchors !== null : step.key === null || step.anchors === null) ||
      trace.steps.find((step) => step.key === audit.criterion)?.message !== audit.prompt) throw new Error("Invalid Agent Judge conversation");
    const config = JSON.parse(trace.definition.config);
    if (canonical(config) !== trace.definition.config || canonical(config.toolDefinitions) === undefined) throw new Error("Invalid canonical Agent Judge config");
    const ids = new Set<string>();
    const returned = new Map<string, { name: string; arguments: string; generation: number }>();
    // pi retains structured tool arguments and serializes them again when
    // replaying. Property order inside the JSON string is not conversation drift.
    const history = (messages: unknown[]) => JSON.parse(JSON.stringify(messages), (key, value) =>
      key === "arguments" && typeof value === "string" ? canonical(JSON.parse(value)) : value);
    let previousMessages: unknown[] | undefined;
    for (const [index, generation] of trace.generations.entries()) {
      if (generation.ordinal !== index + 1 || generation.state === "rejected" && (generation.request !== null || generation.attempts.length !== 0 || generation.failure === null)) throw new Error("Invalid generation sequence");
      if (generation.state === "rejected") continue;
      if (generation.request === null || generation.attempts.length === 0 || generation.attempts.length > 3) throw new Error("Missing generation request");
      const request = JSON.parse(generation.request);
      const wire = structuredClone(request);
      const restoreImages = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(restoreImages);
        if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreImages(item)]));
        if (typeof value !== "string" || !value.startsWith("niceeval-image:")) return value;
        const image = trace.images.find((image) => value === `niceeval-image:${image.imageId}`);
        if (image === undefined) throw new Error("Unknown Agent Judge image reference");
        return `data:${image.mediaType};base64,${encodeBase64Bytes(imageContents[image.evidenceIndex]!.bytes)}`;
      };
      const restored = restoreImages(wire);
      const body = canonical(restored);
      if (utf8ByteLength(body) !== generation.wireBody.byteLength || agentJudgeDigest(body) !== generation.wireBody.sha256) throw new Error("Agent Judge wire digest mismatch");
      if (canonical(request) !== generation.request || !Array.isArray(request.messages) || request.response_format !== undefined || (generation.kind === "turn" && (request.tool_choice !== "auto" || canonical(request.tools) !== canonical(config.toolDefinitions))) || trace.steps[generation.step - 1] === undefined || index > 0 && generation.step < trace.generations[index - 1]!.step) throw new Error("Invalid Agent Judge request");
      if (generation.kind === "turn") {
        const compact = trace.compactions.find((item) => item.summary !== null && item.generations.at(-1) === generation.ordinal - 1);
        if (compact !== undefined) {
          if (!request.messages.some((message: { role?: string; content?: unknown }) => message.role === "user" && canonical(message.content).includes(JSON.stringify(`<summary>\n${compact.summary}\n</summary>`).slice(1, -1)))) throw new Error("Missing compacted context");
          previousMessages = undefined;
        }
        if (previousMessages !== undefined && canonical(history(request.messages.slice(0, previousMessages.length))) !== canonical(history(previousMessages))) throw new Error("Agent Judge history mismatch");
      }
      for (const [offset, transmission] of generation.attempts.entries()) if (transmission.ordinal !== offset + 1 || offset < generation.attempts.length - 1 && transmission.result.state !== "failed") throw new Error("Invalid transmission sequence");
      const last = generation.attempts.at(-1)!.result;
      if (last.state !== "returned") { previousMessages = undefined; continue; }
      if (generation.kind === "compaction") continue;
      if (generation.failure?.state === "errored") { previousMessages = undefined; continue; }
      const response = JSON.parse(last.response);
      const message = response.choices?.[0]?.message;
      if (message === undefined) throw new Error("Missing assistant message");
      const calls = message.tool_calls ?? [];
      for (const call of calls) {
        if (typeof call.id !== "string" || ids.has(call.id) || call.type !== "function" || typeof call.function?.name !== "string" || typeof call.function?.arguments !== "string") throw new Error("Invalid model tool call");
        ids.add(call.id); returned.set(call.id, { ...call.function, generation: generation.ordinal });
      }
      previousMessages = [...request.messages, { role: "assistant", content: message.content ?? null, ...(calls.length === 0 ? {} : { tool_calls: calls }) }];
      for (const tool of trace.tools.filter((item) => item.generation === generation.ordinal)) {
        if (tool.result !== null) previousMessages.push({ role: "tool", tool_call_id: tool.callId, content: tool.result });
      }
    }
    const summaryGenerations = new Set<number>();
    for (const compact of trace.compactions) {
      const trigger = trace.generations[compact.trigger - 1];
      if (trigger === undefined || trigger.kind !== "turn" || trigger.attempts.at(-1)?.result.state !== "failed" || compact.generations.length === 0 && compact.summary !== null) throw new Error("Invalid compaction trigger");
      for (const ordinal of compact.generations) {
        const generation = trace.generations[ordinal - 1];
        if (summaryGenerations.has(ordinal) || ordinal <= compact.trigger || generation?.kind !== "compaction" || generation.step !== trigger.step) throw new Error("Invalid summary generation");
        summaryGenerations.add(ordinal);
      }
      if (compact.summary !== null && (compact.tokensBefore === null || compact.failure !== null || compact.generations.some((ordinal) => trace.generations[ordinal - 1]?.attempts.at(-1)?.result.state !== "returned"))) throw new Error("Invalid compaction result");
    }
    if (trace.generations.some((generation) => generation.kind === "compaction" && !summaryGenerations.has(generation.ordinal))) throw new Error("Unassociated summary generation");
    const executed = new Set<string>();
    for (const [index, tool] of trace.tools.entries()) {
      const call = returned.get(tool.callId);
      if (tool.ordinal !== index + 1 || call === undefined || call.name !== tool.name || call.arguments !== tool.arguments || call.generation !== tool.generation || executed.has(tool.callId)) throw new Error("Agent Judge tool association mismatch");
      executed.add(tool.callId);
    }
    // A successful submission closes that question's remaining actions, while later questions may continue.
    for (const tool of trace.tools) if (tool.name === "submit_evaluation" && tool.validation === "valid" && tool.state === "completed") {
      const step = trace.generations[tool.generation - 1]!.step;
      if (trace.generations.some((generation) => generation.ordinal > tool.generation && generation.step === step) ||
        trace.tools.some((later) => later.ordinal > tool.ordinal && trace.generations[later.generation - 1]!.step === step && later.state !== "not-started")) throw new Error("Actions after Agent Judge submission");
    }
    if (audit.submission !== null) {
      const submitted = audit.submission;
      const tool = trace.tools.find((item) => item.callId === submitted.callId);
      if (tool === undefined || tool.name !== "submit_evaluation" || tool.state !== "completed" || tool.validation !== "valid" || tool.generation !== submitted.generation || trace.steps[trace.generations[tool.generation - 1]!.step - 1]?.key !== audit.criterion ||
        canonical(JSON.parse(tool.arguments)) !== canonical(submitted.value) || trace.steps.find((step) => step.key === audit.criterion)?.message !== audit.prompt) throw new Error("Invalid Agent Judge submission");
    }
    if (audit.result.state === "measured" && (audit.submission === null || audit.result.value !== audit.submission.value.measurement || measurement !== audit.result.value) ||
      audit.result.state !== "measured" && measurement !== undefined) throw new Error("Agent Judge result mismatch");
    return { state: "available", audit, trace };
  } catch { return { state: "invalid" }; }
}
