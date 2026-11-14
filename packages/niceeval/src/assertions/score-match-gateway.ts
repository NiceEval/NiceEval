import { ordinaryJudgeIdentity } from "../runner/judge-identity.ts";
import {
  SCORE_MATCH_INSTRUCTION,
  SCORE_MATCH_TOOL_DESCRIPTION,
  typesafeItemInstructions,
  typesafeMaterialInstructions,
} from "./score-match.prompt.ts";
import { fitJudgeContext, isJudgeContextOverflow } from "./judge-context-budget.ts";
import { Cause, Clock, Effect, Fiber, Predicate, Random, Schema } from "effect";
import { createHash } from "node:crypto";
import type { AssertionMaterial, MeasurementAssertionEvaluation, MeasurementAssertionRegistration } from "./api.ts";
import { captureFullAssertionSnapshot } from "./full-content.ts";
import type {
  ManagedScoreMatchDefinition,
  ScoreMatch,
  ScoreMatchContext,
  ScoreMatchLlmFailure,
  ScoreMatchResult,
} from "./match.ts";
import type { ResolvedJudgeConfig } from "./types.ts";
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { resolveJudgeCredential } from "../judge/provider.ts";
import { readJudgeImage, type JudgeImage, type JudgeMaterial } from "../judge/image.ts";
import {
  chunkUtf8,
  snapshotScoreMatchMaterial,
  snapshotJudgeMaterial,
  projectJudgeMaterial,
  type CapturedImageReference,
} from "./judge-material-capture.ts";
import {
  errorSummary,
  interruptibleByCaller,
  isTransientJudgeFailure,
  isTransportFailure,
  requestScoreMatchProvider,
  responseByteCap,
  retryAfterMs,
} from "./judge-transport.ts";
import {
  canonicalScoreMatchAuditJson as canonical,
  scoreMatchDefinitionDigest,
  type ScoreMatchAudit,
  type ScoreMatchAuditAny,
  type ScoreMatchAuditAttempt,
  type ScoreMatchAuditCall,
  type ScoreMatchAuditFailure,
  type TypedScoreMatchAudit,
  type TypeSafeAuditCall,
  type TypeSafeMapping,
} from "./score-match-audit.ts";

type Operation = keyof ScoreMatchContext["llm"];
type PrimitiveInput<K extends Operation> = Parameters<ScoreMatchContext["llm"][K]>[0];
type PrimitiveResult<K extends Operation> = Effect.Success<ReturnType<ScoreMatchContext["llm"][K]>>;
import { scoreSchema, classifySchema, extractSchema, batchSchema, citedClassifySchema } from "./score-match-schemas.ts";
import {
  exactProtocolObject as exactRecord,
  finiteUnit,
  probabilityTolerance,
  typeSafeProbabilities as probabilities,
  typeSafeScoreProjection,
  typeSafeChoiceProjection,
  typeSafeUsageSchema,
} from "./score-match-protocol.ts";
const utf8 = new TextEncoder();
const bytes = (value: string): number => utf8.encode(value).byteLength;
const toolName = "record_score_match";

function failure(state: "unavailable" | "errored", code: string, message: string): ScoreMatchAuditFailure {
  return { state, code: code.slice(0, 128), message: message.slice(0, 300) || code };
}
function typedFailure(value: ScoreMatchAuditFailure): ScoreMatchLlmFailure {
  return {
    _tag: value.state === "unavailable" ? "ScoreMatchLlmUnavailable" : "ScoreMatchLlmErrored",
    code: value.code,
    message: value.message,
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!Predicate.isObject(value)) throw new TypeError("Expected an object");
  return value;
}
function requiredText(value: unknown, label: string, maximum = 8192): string {
  if (typeof value !== "string" || !value.trim() || bytes(value) > maximum)
    throw new TypeError(`${label} must be non-empty and at most ${maximum} bytes`);
  return value;
}
function choicesOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32)
    throw new TypeError("choices must contain 2 to 32 distinct labels");
  const choices = value.map((entry) => requiredText(entry, "choice", 128));
  if (new Set(choices).size !== choices.length) throw new TypeError("choices must be distinct");
  return choices;
}
function schemaObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}
function primitiveOptions(
  operation: Operation,
  input: unknown,
  images?: ReadonlyMap<JudgeImage, CapturedImageReference>,
): Record<string, unknown> {
  const raw = record(input);
  const prototype = Reflect.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid LLM primitive arguments");
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") throw new TypeError("Invalid LLM primitive arguments");
    const descriptor = Reflect.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError("Invalid LLM primitive arguments");
    values[key] = descriptor.value;
  }
  const options = { ...record(snapshotScoreMatchMaterial({ ...values, material: null })) };
  const material = snapshotJudgeMaterial(values.material as JudgeMaterial);
  if (material.images.some((image) => !images?.has(image.image)))
    throw new TypeError("LLM material contains an image not captured by this Assertion");
  options.material = material.material;
  const allowed =
    operation === "score"
      ? ["rubric", "anchors", "material"]
      : operation === "classify"
        ? ["rubric", "choices", "material"]
        : operation === "extract"
          ? ["rubric", "maxItems", "material"]
          : ["rubric", "choices", "items", "material"];
  if (
    Object.keys(options).some(
      (key) => !allowed.includes(key) && !(operation === "classify" && key === "evidenceIds"),
    ) ||
    allowed.some((key) => !(key in options))
  )
    throw new TypeError("Invalid LLM primitive arguments");
  return options;
}
function validatePrimitiveOptions(operation: Operation, options: Record<string, unknown>): void {
  const rubric = requiredText(options.rubric, "rubric");
  if (options.evidenceIds !== undefined) validateEvidenceIds(options.evidenceIds);
  if (operation === "score") {
    if (!Array.isArray(options.anchors) || options.anchors.length < 2 || options.anchors.length > 32)
      throw new TypeError("anchors must contain 2 to 32 entries");
    let previous = -1;
    for (const entry of options.anchors) {
      const anchor = record(entry);
      if (
        Object.keys(anchor).sort().join(",") !== "description,measurement" ||
        typeof anchor.measurement !== "number" ||
        anchor.measurement < 0 ||
        anchor.measurement > 1 ||
        anchor.measurement <= previous
      )
        throw new TypeError("anchors must be strictly increasing in [0, 1]");
      requiredText(anchor.description, "anchor description", 1024);
      previous = anchor.measurement;
    }
    if (record(options.anchors[0]).measurement !== 0 || previous !== 1)
      throw new TypeError("anchors must include 0 and 1");
  } else if (operation === "extract") {
    if (
      typeof options.maxItems !== "number" ||
      !Number.isInteger(options.maxItems) ||
      options.maxItems < 1 ||
      options.maxItems > 32
    )
      throw new TypeError("maxItems must be between 1 and 32");
  } else {
    choicesOf(options.choices);
    if (operation === "batchClassify") {
      if (!Array.isArray(options.items) || options.items.length < 1 || options.items.length > 32)
        throw new TypeError("batch items must contain 1 to 32 entries");
      const ids = options.items.map((entry) => {
        const item = record(entry);
        if (Object.keys(item).sort().join(",") !== "id,text") throw new TypeError("batch items require id and text");
        requiredText(item.text, "item text");
        return requiredText(item.id, "item id", 128);
      });
      if (new Set(ids).size !== ids.length) throw new TypeError("batch item IDs must be unique");
    }
  }
  requiredText(rubric, "rubric");
}
interface PreparedRequest {
  readonly request: string;
  readonly requestTemplate?: string;
  readonly wireBody?: { readonly byteLength: number; readonly sha256: string };
  readonly imageCount: number;
  readonly material: string;
  readonly options: Record<string, unknown>;
  readonly mapping?: TypeSafeMapping;
}
function chatRequestFor(
  operation: Operation,
  input: unknown,
  profile: ResolvedJudgeConfig,
  images: ReadonlyMap<JudgeImage, CapturedImageReference>,
  imageAudit: boolean,
): PreparedRequest {
  if (profile.protocol.kind !== "chat-completions")
    throw new TypeError("Chat request requires a chat-completions Provider");
  const options = primitiveOptions(operation, input, images);
  validatePrimitiveOptions(operation, options);
  const rubric = options.rubric as string;
  const system: Record<string, unknown> = {
    operation,
    rubric,

    instruction: SCORE_MATCH_INSTRUCTION,
  };
  const projected = projectJudgeMaterial(options.material as JudgeMaterial, images);
  const user: Record<string, unknown> = { material: projected.json };
  const string = { type: "string", pattern: "\\S" };
  let parameters: Record<string, unknown>;
  if (operation === "score") {
    system.anchors = options.anchors;
    parameters = schemaObject({ measurement: { type: "number", minimum: 0, maximum: 1 }, rationale: string });
  } else if (operation === "extract") {
    system.maxItems = options.maxItems;
    parameters = schemaObject({
      items: { type: "array", items: string, maxItems: options.maxItems },
      complete: { type: "boolean" },
      rationale: string,
    });
  } else {
    const choices = choicesOf(options.choices);
    system.choices = choices;
    const choice = { type: "string", enum: choices };
    if (operation === "classify") {
      const evidenceIds = options.evidenceIds as readonly string[] | undefined;
      if (evidenceIds !== undefined) system.evidenceIds = evidenceIds;
      parameters = schemaObject({
        choice,
        rationale: string,
        ...(evidenceIds === undefined
          ? {}
          : { citations: { type: "array", items: { type: "string", enum: evidenceIds }, uniqueItems: true } }),
      });
    } else {
      const ids = (options.items as { id: string }[]).map((item) => item.id);
      user.items = options.items;
      parameters = schemaObject({
        items: {
          type: "array",
          minItems: ids.length,
          maxItems: ids.length,
          items: schemaObject({ id: { type: "string", enum: ids }, choice, rationale: string }),
        },
      });
    }
  }
  const envelope = {
    model: profile.model,
    max_completion_tokens: profile.protocol.maxOutputTokens,
    messages: [
      { role: "system", content: canonical(system) },
      {
        role: "user",
        content: imageAudit
          ? [
              { type: "text", text: canonical(user) },
              ...projected.parts.map((image) => ({
                type: "image_url",
                image_url: { url: `niceeval-image:${image.imageId}` },
              })),
            ]
          : canonical(user),
      },
    ],
    tools: [
      {
        type: "function",
        function: { name: toolName, description: SCORE_MATCH_TOOL_DESCRIPTION, strict: true, parameters },
      },
    ],
    tool_choice: { type: "function", function: { name: toolName } },
    parallel_tool_calls: false,
  };
  const requestTemplate = canonical(envelope);
  const wireBody = imageAudit
    ? canonical({
        ...envelope,
        messages: [
          envelope.messages[0],
          {
            role: "user",
            content: [
              { type: "text", text: canonical(user) },
              ...projected.parts.map((image) => ({
                type: "image_url",
                image_url: {
                  url: `data:${image.mediaType};base64,${Buffer.from(readJudgeImage(image.image).body).toString("base64")}`,
                },
              })),
            ],
          },
        ],
      })
    : requestTemplate;
  return {
    request: wireBody,
    ...(imageAudit
      ? {
          requestTemplate,
          wireBody: { byteLength: bytes(wireBody), sha256: createHash("sha256").update(wireBody).digest("hex") },
        }
      : {}),
    imageCount: projected.parts.length,
    material: canonical(user),
    options,
  };
}
function typesafeRequestFor(
  operation: Exclude<Operation, "extract">,
  input: unknown,
  profile: ResolvedJudgeConfig,
): PreparedRequest {
  if (profile.protocol.kind !== "typesafe-system-one")
    throw new TypeError("TypeSafe request requires a TypeSafe Provider");
  const options = primitiveOptions(operation, input);
  validatePrimitiveOptions(operation, options);
  const rubric = options.rubric as string;
  const state =
    operation === "batchClassify"
      ? { material: options.material, items: options.items }
      : { material: options.material };
  const criteria =
    operation === "score"
      ? (options.anchors as readonly { description: string }[]).map((anchor) => anchor.description)
      : Object.fromEntries(choicesOf(options.choices).map((choice) => [choice, choice]));
  const questions =
    operation === "batchClassify"
      ? Object.fromEntries(
          (options.items as readonly { id: string; text: string }[]).map((_item, index) => [
            `q${index}`,
            {
              type: "choice",
              instructions: typesafeItemInstructions(rubric, index),
              criteria,
            },
          ]),
        )
      : {
          q0: {
            type: operation === "score" ? "score" : "choice",
            instructions: typesafeMaterialInstructions(rubric),
            criteria,
          },
        };
  const mapping = Object.freeze({
    operation,
    input: snapshotScoreMatchMaterial(options),
  }) as unknown as TypeSafeMapping;
  return {
    request: canonical({ model: profile.model, state, questions }),
    material: canonical(state),
    options,
    mapping,
    imageCount: 0,
  };
}
function decodeChatOutput<K extends Operation>(
  operation: K,
  response: string,
  options: Record<string, unknown>,
): PrimitiveResult<K> {
  const envelope = record(JSON.parse(response));
  if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1)
    throw new TypeError("Expected exactly one model choice");
  const choice = record(envelope.choices[0]);
  const message = record(choice.message);
  if (choice.finish_reason !== "tool_calls" || !Array.isArray(message.tool_calls) || message.tool_calls.length !== 1)
    throw new TypeError("Expected one complete decision tool call");
  const call = record(message.tool_calls[0]);
  const fn = record(call.function);
  if (call.type !== "function" || fn.name !== toolName || typeof fn.arguments !== "string")
    throw new TypeError("Unexpected decision tool");
  const raw: unknown = JSON.parse(fn.arguments);
  const parse = { onExcessProperty: "error" as const };
  let output: unknown;
  if (operation === "score") output = Schema.decodeUnknownSync(scoreSchema, parse)(raw);
  else if (operation === "classify") {
    const result =
      options.evidenceIds === undefined
        ? Schema.decodeUnknownSync(classifySchema, parse)(raw)
        : Schema.decodeUnknownSync(
            citedClassifySchema,
            parse,
          )(raw);
    if (options.evidenceIds !== undefined) {
      const citations = (result as unknown as { citations: readonly string[] }).citations;
      validateEvidenceIds(citations, true);
      if (citations.some((id) => !(options.evidenceIds as readonly string[]).includes(id)))
        throw new TypeError("Unknown evidence citation");
    }
    if (!choicesOf(options.choices).includes(result.choice)) throw new TypeError("Unknown classification label");
    output = result;
  } else if (operation === "extract") {
    const result = Schema.decodeUnknownSync(extractSchema, parse)(raw);
    if (result.items.length > Number(options.maxItems)) throw new TypeError("Extraction exceeds maxItems");
    output = result;
  } else {
    const result = Schema.decodeUnknownSync(batchSchema, parse)(raw);
    const requested = (options.items as { id: string }[]).map((item) => item.id);
    const ids = result.items.map((item) => item.id);
    if (
      ids.length !== requested.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !requested.includes(id)) ||
      result.items.some((item) => !choicesOf(options.choices).includes(item.choice))
    )
      throw new TypeError("Batch must classify every requested ID exactly once");
    output = result;
  }
  return snapshotScoreMatchMaterial(output) as PrimitiveResult<K>;
}

function typesafeEnvelope(response: string, questionIds: readonly string[]): Record<string, unknown> {
  const envelope = exactRecord(JSON.parse(response), ["model", "answers", "usage"], "TypeSafe response");
  requiredText(envelope.model, "TypeSafe response model");
  const usage = exactRecord(envelope.usage, ["input_tokens", "output_tokens"], "TypeSafe usage");
  if (!Schema.is(typeSafeUsageSchema)(usage))
    throw new TypeError("TypeSafe usage must contain non-negative safe integers");
  exactRecord(envelope.answers, questionIds, "TypeSafe answers");
  return envelope;
}
function decodeTypesafeOutput<K extends Exclude<Operation, "extract">>(
  operation: K,
  response: string,
  options: Record<string, unknown>,
): PrimitiveResult<K> {
  const ids =
    operation === "batchClassify" ? (options.items as readonly unknown[]).map((_item, index) => `q${index}`) : ["q0"];
  const envelope = typesafeEnvelope(response, ids);
  const answers = record(envelope.answers);
  if (operation === "score") {
    const anchors = options.anchors as readonly { measurement: number; description: string }[];
    const labels = anchors.map((_anchor, index) => String(index));
    const answer = exactRecord(
      answers.q0,
      ["type", "score", "legend", "probabilities", "confidence"],
      "TypeSafe Score answer",
    );
    if (answer.type !== "score") throw new TypeError("TypeSafe answer type must be score");
    finiteUnit(answer.confidence, "TypeSafe confidence");
    const legend = exactRecord(answer.legend, labels, "TypeSafe Score legend");
    if (labels.some((label, index) => legend[label] !== anchors[index]?.description))
      throw new TypeError("TypeSafe Score legend does not match requested levels");
    const distribution = probabilities(answer.probabilities, labels);
    const expectedIndex = labels.reduce((sum, label, index) => sum + index * distribution[label]!, 0);
    if (
      typeof answer.score !== "number" ||
      !Number.isFinite(answer.score) ||
      Math.abs(answer.score - expectedIndex) > probabilityTolerance
    )
      throw new TypeError("TypeSafe Score value does not match probabilities");
    return snapshotScoreMatchMaterial(typeSafeScoreProjection(anchors, labels, distribution)) as PrimitiveResult<K>;
  }
  const choices = choicesOf(options.choices);
  const decodeChoice = (id: string): { readonly choice: string; readonly rationale: string } => {
    const answer = exactRecord(
      answers[id],
      ["type", "choice", "probabilities", "confidence"],
      "TypeSafe Choice answer",
    );
    if (answer.type !== "choice" || typeof answer.choice !== "string" || !choices.includes(answer.choice))
      throw new TypeError("TypeSafe Choice selected an unknown option");
    finiteUnit(answer.confidence, "TypeSafe confidence");
    const distribution = probabilities(answer.probabilities, choices);
    const maximum = Math.max(...choices.map((choice) => distribution[choice]!));
    if (distribution[answer.choice] !== maximum)
      throw new TypeError("TypeSafe Choice must select a highest-probability option");
    return typeSafeChoiceProjection(answer.choice);
  };
  if (operation === "classify") return snapshotScoreMatchMaterial(decodeChoice("q0")) as PrimitiveResult<K>;
  const items = options.items as readonly { id: string }[];
  return snapshotScoreMatchMaterial({
    items: items.map((item, index) => ({ id: item.id, ...decodeChoice(`q${index}`) })),
  }) as PrimitiveResult<K>;
}

class JudgeUsageAdmissionError extends Error {}

/** A managed Match contributes one ordinary measurement entry and terminal Content. */
export function prepareManagedScoreMatch(input: {
  readonly match: ScoreMatch<unknown>;
  readonly options: ManagedScoreMatchDefinition<unknown, unknown>;
  readonly material: unknown;
  readonly judge: ResolvedJudgeConfig | undefined;
  readonly signal?: AbortSignal;
  readonly usage?: import("../o11y/judge-usage.ts").JudgeUsageEntry;
}): MeasurementAssertionRegistration & {
  readonly terminalEvidence: () => readonly AssertionMaterial[];
  readonly actualRetainedBytes: () => number;
} {
  const { options } = input;
  let deadlineAt = Infinity;
  const snapshot = snapshotJudgeMaterial(
    input.material as JudgeMaterial,
    options.llm.maxMaterialBytes === undefined ? Infinity : options.llm.maxMaterialBytes - 13,
  );
  const material = snapshot.material;
  const imageByValue = snapshot.imageByValue;
  const images = snapshot.images;
  const captured = canonical(projectJudgeMaterial(material, imageByValue).json);
  const subject = captureFullAssertionSnapshot({ content: chunkUtf8(captured) }, Infinity).material;
  const contextWindow =
    input.judge === undefined ? undefined : (input.judge.contextWindow ?? builtinContextWindow(input.judge.model));
  const definitionBase = {
    version: options.version,
    config: canonical({ definition: JSON.parse(options.canonicalConfig), ordinaryJudge: ordinaryJudgeIdentity() }),
    limits: { ...options.llm, ...(contextWindow === undefined ? {} : { contextWindow }) },
  };
  const definition = { ...definitionBase, digest: scoreMatchDefinitionDigest(definitionBase) };
  const typesafe = input.judge?.protocol.kind === "typesafe-system-one";
  const calls: Array<ScoreMatchAuditCall | TypeSafeAuditCall | import("./score-match-audit.ts").ImageScoreMatchAuditCall> =
    [];
  let result: ScoreMatchAudit["result"] = { state: "interrupted" };
  let latched: ScoreMatchAuditFailure | undefined;
  let closed = false;
  let busy = false;
  let evaluationStarted = false;
  const pending = new Set<Fiber.Fiber<unknown, unknown>>();
  let sealed: readonly AssertionMaterial[] | undefined;
  const audit = (): ScoreMatchAuditAny =>
    images.length > 0
      ? {
          kind: "images",

          definition,
          input: captured,
          images: images.map(({ imageId, evidenceIndex, mediaType, byteLength, sha256, paths }) => ({
            imageId,
            evidenceIndex,
            mediaType,
            byteLength,
            sha256,
            paths,
          })),
          calls: calls as import("./score-match-audit.ts").ImageScoreMatchAudit["calls"],
          result,
        }
      : typesafe
        ? ({
            kind: "typed",

            definition,
            input: captured,
            calls: calls as TypeSafeAuditCall[],
            result,
          } as TypedScoreMatchAudit)
        : {
            kind: "chat",

            definition,
            input: captured,
            calls: calls as ScoreMatchAuditCall[],
            result,
          };
  const envelopeOf = (value: ScoreMatchAuditAny) => {
    const encoded = canonical(value);
    const chunks = chunkUtf8(encoded);
    return {
      manifest: {

        byteLength: bytes(encoded),
        digest: createHash("sha256").update(encoded).digest("hex"),
        chunkByteLengths: chunks.map(bytes),
      },
      content: chunks,
    };
  };
  const latch = (problem: ScoreMatchAuditFailure): ScoreMatchAuditFailure => {
    if (!closed) latched ??= problem;
    return latched ?? problem;
  };
  if (options.llm.maxMaterialBytes !== undefined && bytes(captured) > options.llm.maxMaterialBytes)
    latch(
      failure("unavailable", "score-match-material-budget", "ScoreMatch material exceeds its explicit byte budget"),
    );

  const invoke = <K extends Operation>(
    operation: K,
    raw: PrimitiveInput<K>,
  ): Effect.Effect<PrimitiveResult<K>, ScoreMatchLlmFailure> =>
    Effect.suspend(() => {
      if (closed || !evaluationStarted)
        return Effect.fail(
          typedFailure(
            failure("errored", "score-match-context-closed", "LLM context is outside its owning evaluation"),
          ),
        );
      if (latched !== undefined) return Effect.fail(typedFailure(latched));
      const reject = (problem: ScoreMatchAuditFailure): Effect.Effect<never, ScoreMatchLlmFailure> => {
        const value = latch(problem);
        if (calls.length <= options.llm.maxCalls)
          calls.push({
            ordinal: calls.length + 1,
            operation,
            state: "rejected",
            transport: "not-sent",
            failure: value,
          });
        return Effect.fail(typedFailure(value));
      };
      if (busy)
        return reject(failure("errored", "score-match-concurrent-call", "LLM primitives must execute serially"));
      if (calls.length >= options.llm.maxCalls)
        return reject(failure("unavailable", "score-match-call-budget", "LLM logical call budget exhausted"));
      if (input.judge === undefined)
        return reject(failure("unavailable", "judge-provider-unresolved", "Judge Provider is not configured"));
      const profile = input.judge;
      if (images.length > 0 && (profile.protocol.kind !== "chat-completions" || profile.supportsImages !== true)) {
        return reject(
          failure("unavailable", "judge-capability-unavailable", "Judge Provider does not support image material"),
        );
      }
      if (profile.protocol.kind === "typesafe-system-one" && operation === "extract") {
        return reject(
          failure("unavailable", "judge-capability-unavailable", "TypeSafe Provider does not support extract"),
        );
      }
      let prepared: PreparedRequest;
      try {
        prepared =
          profile.protocol.kind === "typesafe-system-one"
            ? typesafeRequestFor(operation as Exclude<Operation, "extract">, raw, profile)
            : chatRequestFor(operation, raw, profile, imageByValue, images.length > 0);
      } catch (error) {
        return reject(failure("errored", "score-match-invalid-input", errorSummary(error)));
      }
      if (
        profile.protocol.kind === "typesafe-system-one" &&
        operation === "score" &&
        (prepared.options.anchors as readonly unknown[]).length > 10
      ) {
        return reject(
          failure("unavailable", "judge-capability-unavailable", "TypeSafe Provider supports at most 10 score anchors"),
        );
      }
      if (options.llm.maxMaterialBytes !== undefined && bytes(prepared.material) > options.llm.maxMaterialBytes)
        return reject(
          failure("unavailable", "score-match-material-budget", "LLM step material exceeds its explicit byte budget"),
        );
      {
        const requestFor = (material: unknown) =>
          profile.protocol.kind === "chat-completions"
            ? chatRequestFor(operation, { ...prepared.options, material }, profile, imageByValue, images.length > 0)
            : typesafeRequestFor(
                operation as Exclude<Operation, "extract">,
                { ...prepared.options, material },
                profile,
              );
        const fitted = fitJudgeContext({
          model: profile.model,
          ...(profile.contextWindow === undefined ? {} : { contextWindow: profile.contextWindow }),
          maxOutputTokens: profile.protocol.kind === "chat-completions" ? profile.protocol.maxOutputTokens : 0,
          material: prepared.options.material,
          encodeRequest: (material) => {
            const request = requestFor(material);
            return request.requestTemplate ?? request.request;
          },
        });
        if (fitted.state === "unavailable") return reject(failure("unavailable", fitted.code, fitted.message));
        if (fitted.material !== prepared.options.material) prepared = requestFor(fitted.material);
      }
      const responseCap =
        profile.protocol.kind === "chat-completions"
          ? Math.min(profile.maxResponseBytes, responseByteCap(profile.protocol.maxOutputTokens))
          : profile.maxResponseBytes;
      const apiKey = resolveJudgeCredential(profile);
      if (!apiKey) {
        const source =
          profile.credential.kind === "environment" ? ` environment ${profile.credential.name}` : " inline credential";
        return reject(
          failure("unavailable", "judge-key-unresolved", `${profile.provider} Judge credential${source} is unresolved`),
        );
      }
      const index = calls.length;
      const attempts: ScoreMatchAuditAttempt[] = [];
      let callResult: Extract<ScoreMatchAuditCall, { state: "admitted" }>["result"] = { state: "interrupted" };
      const update = (): void => {
        if (!closed)
          calls[index] = {
            ordinal: index + 1,
            operation,
            state: "admitted",
            ...(prepared.requestTemplate === undefined
              ? { request: prepared.request }
              : { requestTemplate: prepared.requestTemplate, wireBody: prepared.wireBody }),
            attempts: [...attempts],
            result: callResult,
            ...(prepared.mapping === undefined ? {} : { mapping: prepared.mapping }),
          } as ScoreMatchAuditAny["calls"][number];
      };
      update();
      busy = true;
      const execute = Effect.gen(function* () {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          let received: Awaited<ReturnType<typeof requestScoreMatchProvider>>;
          const sent = Effect.tryPromise({
            try: (signal) => {
              if (signal.aborted) return Promise.reject(new DOMException("Judge request cancelled", "AbortError"));
              const usage = input.usage?.begin({
                logicalOrdinal: index + 1,
                transmissionOrdinal: attempt,
                operation,
                requestModel: profile.model,
                transportProvider: profile.provider,
              });
              if (input.usage !== undefined && usage === undefined)
                return Promise.reject(new JudgeUsageAdmissionError());
              attempts.push({ ordinal: attempt, transport: "attempted", result: { state: "interrupted" } });
              update();
              return requestScoreMatchProvider({
                baseUrl: profile.baseUrl,
                endpoint: profile.protocol.kind === "chat-completions" ? "chat/completions" : "systemone",
                apiKey,
                headers: profile.headers,
                body: prepared.request,
                maxBytes: responseCap,
                signal,
                ...(usage === undefined ? {} : { usage }),
                deadlineAt,
              });
            },
            catch: (error) => error,
          });
          const outcome = yield* sent.pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          );
          const error =
            outcome.ok && (outcome.value.status < 200 || outcome.value.status >= 300)
              ? Object.assign(new Error(`HTTP ${outcome.value.status}`), {
                  status: outcome.value.status,
                  headers: outcome.value.headers,
                })
              : outcome.ok
                ? undefined
                : outcome.error;
          if (error !== undefined) {
            if (outcome.ok && isJudgeContextOverflow(outcome.value.body)) {
              attempts[attempt - 1] = {
                ordinal: attempt,
                transport: "attempted",
                result: { state: "returned", response: outcome.value.body },
              };
              const problem = latch(
                failure("unavailable", "judge-context-overflow", "Judge model reported a context overflow"),
              );
              callResult = problem;
              update();
              return yield* Effect.fail(typedFailure(problem));
            }
            if (error instanceof JudgeUsageAdmissionError) {
              const problem = latch(
                failure(
                  "unavailable",
                  "judge-usage-capacity-exceeded",
                  "Judge usage cannot retain another physical transmission",
                ),
              );
              callResult = problem;
              update();
              return yield* Effect.fail(typedFailure(problem));
            }
            attempts[attempt - 1] = {
              ordinal: attempt,
              transport: "attempted",
              result: outcome.ok
                ? { state: "returned", response: outcome.value.body }
                : { state: "failed", code: "judge-call-failed", message: errorSummary(error) },
            };
            update();
            if (isTransientJudgeFailure(error) && attempt < 3) {
              const headers =
                typeof error === "object" && error !== null && "headers" in error ? error.headers : undefined;
              const delay =
                retryAfterMs(headers, yield* Clock.currentTimeMillis) ??
                (yield* Random.next) * 1000 * 2 ** (attempt - 1);
              yield* Effect.sleep(delay);
              continue;
            }
            const problem = latch(
              failure(isTransportFailure(error) ? "unavailable" : "errored", "judge-call-failed", errorSummary(error)),
            );
            callResult = problem;
            update();
            return yield* Effect.fail(typedFailure(problem));
          }
          if (!outcome.ok) return yield* Effect.die(new Error("Unreachable transport outcome"));
          received = outcome.value;
          attempts[attempt - 1] = {
            ordinal: attempt,
            transport: "attempted",
            result: { state: "returned", response: received.body },
          };
          update();
          let output: PrimitiveResult<K>;
          try {
            output =
              profile.protocol.kind === "chat-completions"
                ? decodeChatOutput(operation, received.body, prepared.options)
                : (decodeTypesafeOutput(
                    operation as Exclude<Operation, "extract">,
                    received.body,
                    prepared.options,
                  ) as PrimitiveResult<K>);
          } catch (error) {
            const problem = latch(failure("errored", "score-match-invalid-response", errorSummary(error)));
            callResult = problem;
            update();
            return yield* Effect.fail(typedFailure(problem));
          }
          if (operation === "extract" && !(output as PrimitiveResult<"extract">).complete) {
            const problem = latch(
              failure("unavailable", "score-match-incomplete-extraction", "Extraction did not cover the full material"),
            );
            callResult = problem;
            update();
            return yield* Effect.fail(typedFailure(problem));
          }
          callResult = { state: "completed", output: canonical(output) };
          update();
          return output;
        }
        return yield* Effect.die(new Error("Unreachable retry state"));
      });
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(execute);
        pending.add(fiber);
        return yield* Fiber.join(fiber).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              pending.delete(fiber);
              busy = false;
              update();
            }),
          ),
        );
      });
    });
  const context: ScoreMatchContext = Object.freeze({
    llm: Object.freeze({
      score: (value: PrimitiveInput<"score">) => invoke("score", value),
      classify: (value: PrimitiveInput<"classify">) => invoke("classify", value),
      extract: (value: PrimitiveInput<"extract">) => invoke("extract", value),
      batchClassify: (value: PrimitiveInput<"batchClassify">) => invoke("batchClassify", value),
    }),
  });
  const finish = (output: ScoreMatchResult): MeasurementAssertionEvaluation => {
    const genuine =
      latched === undefined &&
      typeof output === "object" &&
      (output.state === "measured" || output.state === "unavailable")
        ? output
        : undefined;
    const explanation =
      genuine === undefined
        ? {}
        : {
            ...(genuine.rationale === undefined
              ? {}
              : { rationale: { state: "available" as const, value: genuine.rationale } }),
            citations:
              genuine.citations === undefined
                ? { state: "unavailable" as const, reason: "not-recorded" as const }
                : { state: "available" as const, value: [...genuine.citations] },
          };
    if (latched === undefined && calls.some((call) => call.state !== "admitted" || call.result.state !== "completed")) {
      latch(failure("unavailable", "score-match-incomplete-step", "A necessary LLM step did not complete"));
    }
    if (latched === undefined) {
      if (typeof output === "number" || output?.state === "measured") {
        const measurement = typeof output === "number" ? output : output.measurement;
        if (typeof measurement !== "number" || !Number.isFinite(measurement) || measurement < 0 || measurement > 1)
          latch(
            failure("errored", "score-match-invalid-result", "ScoreMatch must return a finite measurement in [0, 1]"),
          );
        else {
          result = { state: "measured", value: measurement };
          return { state: "measured", value: measurement, detail: explanation };
        }
      } else if (output?.state === "unavailable")
        latch(failure("unavailable", "score-match-unavailable", output.reason));
      else if (output?.state === "errored") latch(failure("errored", output.code, output.message));
      else latch(failure("errored", "score-match-invalid-result", "ScoreMatch returned an invalid result"));
    }
    const problem = latched!;
    result = problem;
    return problem.state === "unavailable"
      ? {
          state: "unavailable",
          reason: "source-unavailable",
          detail: {
            failureDetail: problem.code,
            failureEvidence: problem.message,
            rationale: { state: "unavailable", reason: "not-recorded" },
            evidence: { state: "unavailable", reason: "not-recorded" },
            detail: { state: "unavailable", reason: "not-recorded" },
            citations: { state: "unavailable", reason: "not-recorded" },
            ...explanation,
          },
        }
      : { state: "errored", detail: { code: problem.code, message: problem.message } };
  };
  const evaluate = (): Effect.Effect<MeasurementAssertionEvaluation> => {
    const callback = Effect.suspend((): Effect.Effect<ScoreMatchResult, unknown> => {
      if (evaluationStarted || closed) return Effect.die(new Error("Managed ScoreMatch may only evaluate once"));
      evaluationStarted = true;
      deadlineAt = Date.now() + (input.judge?.timeoutMs ?? 180_000);
      if (latched !== undefined) return Effect.succeed({ state: "unavailable" as const, reason: latched.message });
      return options.score(material, context);
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.succeed({
              state: "errored" as const,
              code: "score-match-callback-error",
              message: errorSummary(Cause.squash(cause)),
            }),
      ),
      Effect.flatMap((output) =>
        Effect.gen(function* () {
          if (busy || pending.size > 0)
            latch(failure("errored", "score-match-pending-call", "ScoreMatch returned with an unfinished LLM step"));
          const value = finish(output);
          return value;
        }),
      ),
      Effect.timeoutOrElse({
        duration: input.judge?.timeoutMs ?? 180_000,
        orElse: () =>
          Effect.sync(() => {
            latch(failure("unavailable", "judge-call-failed", "Managed ScoreMatch evaluation timed out"));
            return finish(0);
          }),
      }),
      Effect.ensuring(
        Effect.gen(function* () {
          // Stop escaped child calls and await their finalizers before terminal Content.
          input.usage?.close();
          yield* Fiber.interruptAll([...pending]);
          closed = true;
        }),
      ),
    );
    return interruptibleByCaller(callback, input.signal);
  };
  return {
    criterion: { kind: "managed-score-measurement", name: options.name, scale: "unit-interval" },
    terminalCriterion: () => ({ kind: "managed-score-measurement", name: options.name, scale: "unit-interval" }),
    subject,
    retainedBytes: 0,
    retainedImageBytes: images.reduce((sum, image) => sum + image.byteLength, 0),
    evidence: Object.freeze(images.map((image) => ({ kind: "judge-image" as const, image: image.image }))),
    evaluate,
    terminalEvidence: () => {
      if (sealed !== undefined) return sealed;
      input.usage?.close();
      closed = true;
      const payload = envelopeOf(audit());
      sealed = Object.freeze([captureFullAssertionSnapshot(payload, Infinity).material]);
      return sealed;
    },
    actualRetainedBytes: () => 0,
  };
}

function validateEvidenceIds(value: unknown, empty = false): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16384 ||
    (!empty && value.length === 0) ||
    value.some(
      (id) => typeof id !== "string" || id.trim() === "" || bytes(id) > 128 || /[\u0000-\u001f\u007f]/u.test(id),
    ) ||
    new Set(value).size !== value.length
  )
    throw new TypeError("Evidence IDs must be unique bounded strings");
}
