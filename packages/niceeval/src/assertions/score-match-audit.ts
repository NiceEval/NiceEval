import { InspectionSha256, utf8ByteLength } from "../inspection/bytes.ts";

export type ScoreMatchAuditFailure = {
  readonly state: "unavailable" | "errored";
  readonly code: string;
  readonly message: string;
};
export type ScoreMatchAuditAttempt = {
  readonly ordinal: number;
  readonly transport: "attempted";
  readonly result:
    | { readonly state: "returned"; readonly response: string }
    | { readonly state: "failed"; readonly code: string; readonly message: string }
    | { readonly state: "interrupted" };
};
export type ScoreMatchAuditCall =
  | {
      readonly ordinal: number;
      readonly operation: "score" | "classify" | "extract" | "batchClassify";
      readonly state: "rejected";
      readonly transport: "not-sent";
      readonly failure: ScoreMatchAuditFailure;
    }
  | {
      readonly ordinal: number;
      readonly operation: "score" | "classify" | "extract" | "batchClassify";
      readonly state: "admitted";
      readonly request: string;
      readonly attempts: readonly ScoreMatchAuditAttempt[];
      readonly result:
        | { readonly state: "completed"; readonly output: string }
        | ScoreMatchAuditFailure
        | { readonly state: "interrupted" };
    };
export interface ScoreMatchAudit {
  readonly schemaVersion: 1;
  readonly protocol: "niceeval.score-match-audit/v1";
  readonly definition: {
    readonly name: string;
    readonly version: string;
    readonly config: string;
    readonly digest: string;
    readonly limits: {
      readonly maxCalls: number;
      readonly maxMaterialBytes: number;
      readonly maxAuditBytes: number;
    };
  };
  readonly input: string;
  readonly calls: readonly ScoreMatchAuditCall[];
  readonly result:
    | { readonly state: "measured"; readonly value: number }
    | ScoreMatchAuditFailure
    | { readonly state: "interrupted" };
}
export interface ScoreMatchAuditEnvelope {
  readonly manifest: {
    readonly schemaVersion: 1;
    readonly protocol: "niceeval.score-match-audit/v1";
    readonly byteLength: number;
    readonly digest: string;
    readonly chunkByteLengths: readonly number[];
  };
  readonly content: readonly string[];
}
export type ScoreMatchAuditReadResult =
  | { readonly state: "available"; readonly audit: ScoreMatchAudit }
  | { readonly state: "invalid" }
  | { readonly state: "unsupported"; readonly schemaVersion: number };

const protocol = "niceeval.score-match-audit/v1" as const;
const encoder = new TextEncoder();

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  const actual = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) return undefined;
  const captured: Record<string, unknown> = {};
  for (const key of actual) {
    const descriptor = Reflect.getOwnPropertyDescriptor(candidate, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

export function canonicalScoreMatchAuditJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("ScoreMatch audit contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalScoreMatchAuditJson).join(",")}]`;
  const candidate = record(value);
  if (candidate === undefined) throw new TypeError("ScoreMatch audit contains a non-JSON value");
  return `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${canonicalScoreMatchAuditJson(candidate[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return new InspectionSha256().update(encoder.encode(value)).digestHex();
}

export function scoreMatchDefinitionDigest(input: {
  readonly name: string;
  readonly version: string;
  readonly config: string;
  readonly limits: ScoreMatchAudit["definition"]["limits"];
}): string {
  return sha256(canonicalScoreMatchAuditJson({
    protocol,
    name: input.name,
    version: input.version,
    config: input.config,
    limits: input.limits,
  }));
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function failure(value: unknown): value is ScoreMatchAuditFailure {
  const item = exact(value, ["state", "code", "message"]);
  return item !== undefined && (item.state === "unavailable" || item.state === "errored") && text(item.code) && text(item.message);
}
function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

interface PrimitiveRequest {
  readonly choices?: ReadonlySet<string>;
  readonly maxItems?: number;
  readonly itemIds?: ReadonlySet<string>;
}

function primitiveRequest(operation: ScoreMatchAuditCall["operation"], value: unknown): PrimitiveRequest | undefined {
  const body = record(value);
  if (body === undefined || !Array.isArray(body.messages) || body.messages.length !== 2) return undefined;
  const toolChoice = exact(body.tool_choice, ["type", "function"]);
  const chosenFunction = exact(toolChoice?.function, ["name"]);
  if (toolChoice?.type !== "function" || chosenFunction?.name !== "record_score_match") return undefined;
  if (!Array.isArray(body.tools) || body.tools.length !== 1) return undefined;
  const tool = exact(body.tools[0], ["type", "function"]);
  const toolFunction = record(tool?.function);
  if (tool?.type !== "function" || toolFunction?.name !== "record_score_match") return undefined;
  const systemMessage = exact(body.messages[0], ["role", "content"]);
  const userMessage = exact(body.messages[1], ["role", "content"]);
  if (systemMessage?.role !== "system" || userMessage?.role !== "user" || typeof systemMessage.content !== "string" || typeof userMessage.content !== "string") return undefined;
  let system: unknown;
  let user: unknown;
  try {
    system = JSON.parse(systemMessage.content);
    user = JSON.parse(userMessage.content);
  } catch { return undefined; }
  if (canonicalScoreMatchAuditJson(system) !== systemMessage.content || canonicalScoreMatchAuditJson(user) !== userMessage.content) return undefined;
  const systemKeys = operation === "score" ? ["operation", "rubric", "anchors"]
    : operation === "classify" || operation === "batchClassify" ? ["operation", "rubric", "choices"]
    : ["operation", "rubric", "maxItems"];
  const systemInput = exact(system, [...systemKeys, "protocol", "instruction"]);
  const userInput = exact(user, operation === "batchClassify" ? ["material", "items"] : ["material"]);
  if (systemInput === undefined || userInput === undefined || systemInput.protocol !== protocol || !text(systemInput.instruction) || systemInput.operation !== operation || !text(systemInput.rubric)) return undefined;
  if (operation === "score") {
    if (!Array.isArray(systemInput.anchors) || systemInput.anchors.length < 2 || systemInput.anchors.length > 32) return undefined;
    let previous = -1;
    for (const raw of systemInput.anchors) {
      const anchor = exact(raw, ["measurement", "description"]);
      if (anchor === undefined || !unit(anchor.measurement) || anchor.measurement <= previous || !text(anchor.description)) return undefined;
      previous = anchor.measurement;
    }
    if (record(systemInput.anchors[0])?.measurement !== 0 || record(systemInput.anchors.at(-1))?.measurement !== 1) return undefined;
    return Object.freeze({});
  }
  if (operation === "extract") {
    return positiveInteger(systemInput.maxItems, 32)
      ? Object.freeze({ maxItems: systemInput.maxItems })
      : undefined;
  }
  if (!Array.isArray(systemInput.choices) || systemInput.choices.length < 2 || systemInput.choices.length > 32 || systemInput.choices.some((choice) => !text(choice))) return undefined;
  const choices = new Set(systemInput.choices as string[]);
  if (choices.size !== systemInput.choices.length) return undefined;
  if (operation === "classify") return Object.freeze({ choices });
  if (!Array.isArray(userInput.items) || userInput.items.length === 0 || userInput.items.length > 32) return undefined;
  const itemIds = new Set<string>();
  for (const raw of userInput.items) {
    const item = exact(raw, ["id", "text"]);
    if (item === undefined || !text(item.id) || !text(item.text) || itemIds.has(item.id)) return undefined;
    itemIds.add(item.id);
  }
  return Object.freeze({ choices, itemIds });
}

function primitiveOutput(operation: ScoreMatchAuditCall["operation"], output: string, request: string): boolean {
  let value: unknown;
  let requestValue: unknown;
  try {
    value = JSON.parse(output);
    requestValue = JSON.parse(request);
  } catch { return false; }
  if (canonicalScoreMatchAuditJson(value) !== output || canonicalScoreMatchAuditJson(requestValue) !== request) return false;
  const requestInput = primitiveRequest(operation, requestValue);
  if (requestInput === undefined) return false;
  if (operation === "score") {
    const item = exact(value, ["measurement", "rationale"]);
    return item !== undefined && unit(item.measurement) && text(item.rationale);
  }
  if (operation === "classify") {
    const item = exact(value, ["choice", "rationale"]);
    return item !== undefined && text(item.choice) && text(item.rationale) && requestInput.choices?.has(item.choice) === true;
  }
  if (operation === "extract") {
    const item = exact(value, ["items", "complete", "rationale"]);
    if (item === undefined || !Array.isArray(item.items) || item.items.some((entry) => !text(entry)) || item.complete !== true || !text(item.rationale)) return false;
    return requestInput.maxItems !== undefined && item.items.length <= requestInput.maxItems;
  }
  const item = exact(value, ["items"]);
  if (item === undefined || !Array.isArray(item.items)) return false;
  const ids = new Set<string>();
  for (const raw of item.items) {
    const result = exact(raw, ["id", "choice", "rationale"]);
    if (result === undefined || !text(result.id) || ids.has(result.id) || !text(result.choice) || !text(result.rationale) || requestInput.choices?.has(result.choice) !== true) return false;
    ids.add(result.id);
  }
  return requestInput.itemIds !== undefined && requestInput.itemIds.size === ids.size && [...requestInput.itemIds].every((id) => ids.has(id));
}

function validAttempt(value: unknown, ordinal: number): value is ScoreMatchAuditAttempt {
  const item = exact(value, ["ordinal", "transport", "result"]);
  if (item === undefined || item.ordinal !== ordinal || item.transport !== "attempted") return false;
  const result = record(item.result);
  if (result?.state === "returned") return exact(result, ["state", "response"]) !== undefined && typeof result.response === "string";
  if (result?.state === "failed") return exact(result, ["state", "code", "message"]) !== undefined && text(result.code) && text(result.message);
  return result?.state === "interrupted" && exact(result, ["state"]) !== undefined;
}

function validCall(value: unknown, ordinal: number): value is ScoreMatchAuditCall {
  const item = record(value);
  if (item === undefined || item.ordinal !== ordinal || !["score", "classify", "extract", "batchClassify"].includes(String(item.operation))) return false;
  if (item.state === "rejected") {
    return exact(item, ["ordinal", "operation", "state", "transport", "failure"]) !== undefined && item.transport === "not-sent" && failure(item.failure);
  }
  const admitted = exact(item, ["ordinal", "operation", "state", "request", "attempts", "result"]);
  if (admitted === undefined || admitted.state !== "admitted" || typeof admitted.request !== "string" || !Array.isArray(admitted.attempts) || admitted.attempts.length > 3 || admitted.attempts.some((attempt, index) => !validAttempt(attempt, index + 1))) return false;
  try {
    const requestValue: unknown = JSON.parse(admitted.request);
    if (canonicalScoreMatchAuditJson(requestValue) !== admitted.request || primitiveRequest(item.operation as ScoreMatchAuditCall["operation"], requestValue) === undefined) return false;
  } catch { return false; }
  const result = record(admitted.result);
  if (result?.state === "completed") return exact(result, ["state", "output"]) !== undefined && typeof result.output === "string" && primitiveOutput(item.operation as ScoreMatchAuditCall["operation"], result.output, admitted.request);
  return failure(result) || result?.state === "interrupted" && exact(result, ["state"]) !== undefined;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Browser- and Node-neutral strict decoder for the complete managed ScoreMatch audit. */
export function readScoreMatchAudit(value: unknown, expectedName?: string, expectedMeasurement?: number): ScoreMatchAuditReadResult {
  try {
    const outerRecord = record(value);
    const manifestRecord = record(outerRecord?.manifest);
    const version = manifestRecord?.schemaVersion;
    if (typeof version === "number" && Number.isInteger(version) && version !== 1) {
      return Object.freeze({ state: "unsupported", schemaVersion: version });
    }
    if (version === 1 && typeof manifestRecord?.protocol === "string" && manifestRecord.protocol !== protocol) {
      return Object.freeze({ state: "unsupported", schemaVersion: 1 });
    }
    const outer = exact(value, ["manifest", "content"]);
    const manifest = exact(outer?.manifest, ["schemaVersion", "protocol", "byteLength", "digest", "chunkByteLengths"]);
    if (outer === undefined || manifest === undefined || manifest.schemaVersion !== 1 || manifest.protocol !== protocol || !Array.isArray(outer.content) || outer.content.length === 0 || !Array.isArray(manifest.chunkByteLengths) || manifest.chunkByteLengths.length !== outer.content.length || !positiveInteger(manifest.byteLength, 256 * 1024) || typeof manifest.digest !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.digest)) return Object.freeze({ state: "invalid" });
    const chunks: string[] = [];
    for (let index = 0; index < outer.content.length; index += 1) {
      const chunk = outer.content[index];
      const bytes = manifest.chunkByteLengths[index];
      if (typeof chunk !== "string" || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 4 * 1024 || utf8ByteLength(chunk) !== bytes) return Object.freeze({ state: "invalid" });
      chunks.push(chunk);
    }
    const content = chunks.join("");
    if (utf8ByteLength(content) !== manifest.byteLength || sha256(content) !== manifest.digest) return Object.freeze({ state: "invalid" });
    const parsed = JSON.parse(content) as unknown;
    if (canonicalScoreMatchAuditJson(parsed) !== content) return Object.freeze({ state: "invalid" });
    const audit = exact(parsed, ["schemaVersion", "protocol", "definition", "input", "calls", "result"]);
    const definition = exact(audit?.definition, ["name", "version", "config", "digest", "limits"]);
    const limits = exact(definition?.limits, ["maxCalls", "maxMaterialBytes", "maxAuditBytes"]);
    if (audit === undefined || audit.schemaVersion !== 1 || audit.protocol !== protocol || definition === undefined || !text(definition.name) || !text(definition.version) || expectedName !== undefined && definition.name !== expectedName || typeof definition.config !== "string" || typeof definition.digest !== "string" || limits === undefined || !positiveInteger(limits.maxCalls, 16) || !positiveInteger(limits.maxMaterialBytes, 48 * 1024) || !positiveInteger(limits.maxAuditBytes, 256 * 1024) || manifest.byteLength > limits.maxAuditBytes) return Object.freeze({ state: "invalid" });
    const configValue = JSON.parse(definition.config);
    if (canonicalScoreMatchAuditJson(configValue) !== definition.config || definition.digest !== scoreMatchDefinitionDigest({ name: definition.name, version: definition.version, config: definition.config, limits: limits as unknown as ScoreMatchAudit["definition"]["limits"] })) return Object.freeze({ state: "invalid" });
    if (typeof audit.input !== "string" || utf8ByteLength(audit.input) > limits.maxMaterialBytes || canonicalScoreMatchAuditJson(JSON.parse(audit.input)) !== audit.input || !Array.isArray(audit.calls) || audit.calls.length > limits.maxCalls + 1 || audit.calls.length > limits.maxCalls && record(audit.calls.at(-1))?.state !== "rejected" || audit.calls.some((call, index) => !validCall(call, index + 1))) return Object.freeze({ state: "invalid" });
    const result = record(audit.result);
    const validResult = result?.state === "measured"
      ? exact(result, ["state", "value"]) !== undefined && unit(result.value) && (expectedMeasurement === undefined || Object.is(result.value, expectedMeasurement))
      : failure(result) || result?.state === "interrupted" && exact(result, ["state"]) !== undefined;
    if (!validResult || result?.state === "measured" && audit.calls.some((call) => record(call)?.state !== "admitted" || record(record(call)?.result)?.state !== "completed")) return Object.freeze({ state: "invalid" });
    return Object.freeze({ state: "available", audit: deepFreeze(parsed as ScoreMatchAudit) });
  } catch {
    return Object.freeze({ state: "invalid" });
  }
}
