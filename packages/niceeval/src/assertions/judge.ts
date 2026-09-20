// Native LLM-as-Judge evaluator. Definition and material capture are pure;
// provider I/O, timeout, retry, and interruption stay in the owning Effect.

import { Effect, Predicate } from "effect";
import { defineScoreMatch, type ScoreMatch } from "./match.ts";
import type { JsonValue } from "../shared/types.ts";

export interface JudgeAnchor {
  readonly measurement: number;
  readonly description: string;
}
export interface JudgeOptions {
  readonly name: string;
  readonly rubric: string;
  readonly anchors?: readonly JudgeAnchor[];
  readonly maxMaterialBytes?: number;
  readonly maxCalls?: number;
  readonly maxAuditBytes?: number;
}
export type JudgeDefinition = ScoreMatch<unknown>;

const UTF8 = new TextEncoder();
const DEFAULT_ANCHORS = Object.freeze([
  Object.freeze({ measurement: 0, description: "Does not satisfy the rubric." }),
  Object.freeze({ measurement: 1, description: "Fully satisfies the rubric." }),
]);

function utf8Bytes(value: string): number { return UTF8.encode(value).byteLength; }
function compareCodeUnits(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function exactDataObject(value: unknown, label: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  let ownKeys: readonly PropertyKey[];
  try { ownKeys = Reflect.ownKeys(value); } catch { throw new TypeError(`${label} cannot be reflected`); }
  const captured: Array<readonly [string, unknown]> = [];
  for (const key of ownKeys) {
    if (typeof key !== "string" || !keys.includes(key)) throw new TypeError(`${label} has unknown option ${String(key)}`);
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Reflect.getOwnPropertyDescriptor(value, key); } catch { throw new TypeError(`${label}.${key} cannot be reflected`); }
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError(`${label}.${key} must be a data property`);
    captured.push([key, descriptor.value]);
  }
  return Object.freeze(Object.fromEntries(captured));
}
function boundedText(value: unknown, label: string, maximumBytes: number, controlFree = false): string {
  if (typeof value !== "string" || value.trim().length === 0 || utf8Bytes(value) > maximumBytes || controlFree && /\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must be non-empty and at most ${maximumBytes} UTF-8 bytes${controlFree ? " without control characters" : ""}`);
  }
  return value;
}
function positiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0 || value > maximum) throw new TypeError(`${label} must be a positive integer at most ${maximum}`);
  return value;
}

/** Defines one immutable scoring standard and returns the managed Match itself. */
export function defineJudge(options: JudgeOptions): JudgeDefinition {
  const input = exactDataObject(options, "defineJudge() options", ["name", "rubric", "anchors", "maxMaterialBytes", "maxCalls", "maxAuditBytes"]);
  const name = boundedText(input.name, "Judge name", 128, true);
  const rubric = boundedText(input.rubric, "Judge rubric", 8 * 1024);
  const rawAnchors = input.anchors ?? DEFAULT_ANCHORS;
  if (!Array.isArray(rawAnchors) || rawAnchors.length < 2 || rawAnchors.length > 32) throw new TypeError("Judge anchors must contain between 2 and 32 entries");
  let previous = -1;
  const anchors: JudgeAnchor[] = [];
  const anchorKeys = Reflect.ownKeys(rawAnchors);
  if (anchorKeys.some((key) => key !== "length" && !(typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < rawAnchors.length))) {
    throw new TypeError("Judge anchors cannot contain custom properties");
  }
  for (let index = 0; index < rawAnchors.length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(rawAnchors, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError(`Judge anchors[${index}] must be a data property`);
    const raw = descriptor.value;
    const anchor = exactDataObject(raw, `Judge anchors[${index}]`, ["measurement", "description"]);
    const measurement = anchor.measurement;
    if (typeof measurement !== "number" || !Number.isFinite(measurement) || measurement < 0 || measurement > 1 || measurement <= previous) throw new TypeError("Judge anchors must be strictly increasing finite measurements in [0, 1]");
    previous = measurement;
    anchors.push(Object.freeze({ measurement, description: boundedText(anchor.description, `Judge anchors[${index}].description`, 1024) }));
  }
  if (anchors[0]?.measurement !== 0 || anchors.at(-1)?.measurement !== 1) throw new TypeError("Judge anchors must include 0 and 1");
  const maxMaterialBytes = input.maxMaterialBytes === undefined ? 32 * 1024 : positiveInteger(input.maxMaterialBytes, "Judge maxMaterialBytes", 48 * 1024);
  const definition = defineScoreMatch<unknown>({
    name,
    version: "1",
    config: { rubric, anchors: anchors.map((anchor) => ({ ...anchor })) },
    llm: {
      maxMaterialBytes,
      ...(input.maxCalls === undefined ? {} : { maxCalls: positiveInteger(input.maxCalls, "Judge maxCalls", 16) }),
      ...(input.maxAuditBytes === undefined ? {} : { maxAuditBytes: positiveInteger(input.maxAuditBytes, "Judge maxAuditBytes", 256 * 1024) }),
    },
    score: (material, context) => context.llm.score({ rubric, anchors, material: material as JsonValue })
      .pipe(Effect.map((result) => ({ state: "measured" as const, ...result }))),
  });
  return definition;
}

interface SnapshotState { nodes: number; readonly ancestors: WeakSet<object>; }
function snapshotMaterial(value: unknown, state: SnapshotState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > 16_384) throw new TypeError("Judge material exceeds 16,384 traversal nodes");
  if (depth > 32) throw new TypeError("Judge material exceeds depth 32");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Judge material numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === null || value instanceof Date || value instanceof RegExp) throw new TypeError(`Judge material cannot contain ${typeof value}`);
  if (state.ancestors.has(value)) throw new TypeError("Judge material cannot contain an ancestor cycle");
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let keys: readonly PropertyKey[];
      try { keys = Reflect.ownKeys(value); } catch { throw new TypeError("Judge material array reflection failed"); }
      for (const key of keys) {
        if (key === "length" || typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length) continue;
        let descriptor: PropertyDescriptor | undefined;
        try { descriptor = Reflect.getOwnPropertyDescriptor(value, key); } catch { throw new TypeError("Judge material array reflection failed"); }
        if (descriptor?.enumerable) throw new TypeError("Judge material arrays cannot contain extra enumerable properties or toJSON");
      }
      const entries: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try { descriptor = Reflect.getOwnPropertyDescriptor(value, String(index)); } catch { throw new TypeError("Judge material array reflection failed"); }
        if (descriptor === undefined || !("value" in descriptor) || descriptor.value === undefined) throw new TypeError("Judge material arrays cannot contain holes, accessors, or undefined");
        entries.push(snapshotMaterial(descriptor.value, state, depth + 1));
      }
      return Object.freeze(entries);
    }
    let prototype: object | null;
    try { prototype = Reflect.getPrototypeOf(value); } catch { throw new TypeError("Judge material prototype reflection failed"); }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Judge material objects must be plain or null-prototype objects");
    let keys: readonly PropertyKey[];
    try { keys = Reflect.ownKeys(value); } catch { throw new TypeError("Judge material key reflection failed"); }
    const entries: Array<readonly [string, unknown]> = [];
    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Reflect.getOwnPropertyDescriptor(value, key); } catch { throw new TypeError("Judge material property reflection failed"); }
      if (descriptor === undefined || !descriptor.enumerable) continue;
      if (typeof key !== "string" || !("value" in descriptor)) throw new TypeError("Judge material enumerable properties must be string data properties");
      if (descriptor.value !== undefined) entries.push([key, snapshotMaterial(descriptor.value, state, depth + 1)]);
    }
    return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => compareCodeUnits(left, right))));
  } finally { state.ancestors.delete(value); }
}
/** @internal Shared strict call-time capture for all managed Match material. */
export function snapshotScoreMatchMaterial(value: unknown): JsonValue {
  return snapshotMaterial(value, { nodes: 0, ancestors: new WeakSet() }) as JsonValue;
}

export function chunkUtf8(value: string): readonly string[] {
  const chunks: string[] = [];
  let current = ""; let bytes = 0;
  for (const point of value) {
    const size = utf8Bytes(point);
    if (bytes + size > 4 * 1024) { chunks.push(current); current = ""; bytes = 0; }
    current += point; bytes += size;
  }
  if (current !== "" || value === "") chunks.push(current);
  return Object.freeze(chunks);
}
const RESPONSE_BYTES_PER_TOKEN = 8;

export function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function judgeStatus(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const status = objectField(current, "status");
    if (typeof status === "number" && Number.isInteger(status)) return status;
    const nested = objectField(current, "error");
    const nestedStatus = objectField(nested, "status");
    if (typeof nestedStatus === "number" && Number.isInteger(nestedStatus)) return nestedStatus;
    current = objectField(current, "cause");
  }
  return undefined;
}

function judgeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const code = objectField(current, "code");
    if (typeof code === "string" && code !== "") return code;
    const nestedCode = objectField(objectField(current, "error"), "code");
    if (typeof nestedCode === "string" && nestedCode !== "") return nestedCode;
    current = objectField(current, "cause");
  }
  return undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
}

export function retryAfterMs(headers: unknown, nowMs: number): number | undefined {
  const raw = headerValue(headers, "retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : undefined;
}

function isTransientJudgeStatus(status: number | undefined): boolean {
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const name = objectField(current, "name");
    const code = objectField(current, "code");
    if (name === "APIUserAbortError") return false;
    if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true;
    if (typeof code === "string" && /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ERR_TLS)/i.test(code)) return true;
    if (/fetch failed|socket hang up|connection (?:reset|closed|refused)|network error|other side closed|timed? out|timeout|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i.test(errorSummary(current))) {
      return true;
    }
    current = objectField(current, "cause");
  }
  return false;
}

export function isTransportFailure(error: unknown): boolean {
  const status = judgeStatus(error);
  return isConnectionFailure(error) || isTransientJudgeStatus(status);
}

export function isTransientJudgeFailure(error: unknown): boolean {
  const status = judgeStatus(error);
  return isTransientJudgeStatus(status) || (status === undefined && isConnectionFailure(error));
}

/**
 * An author-facing AbortSignal is external to this fiber. It must interrupt
 * the owning Effect instead of being reclassified as a Judge result.
 */
function interruptWhenAborted(signal: AbortSignal): Effect.Effect<never> {
  return Effect.callback<never>((resume) => {
    let completed = false;
    const interrupted = () => {
      if (completed) return;
      completed = true;
      resume(Effect.interrupt);
    };
    signal.addEventListener("abort", interrupted, { once: true });
    // Register first, then inspect state so an abort cannot fall between the
    // initial check and listener installation.
    if (signal.aborted) interrupted();
    return Effect.sync(() => {
      completed = true;
      signal.removeEventListener("abort", interrupted);
    });
  });
}

export function interruptibleByCaller<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E, R> {
  if (signal === undefined) return effect;
  return Effect.suspend(() =>
    signal.aborted
      ? Effect.interrupt
      : Effect.raceFirst(effect, interruptWhenAborted(signal)));
}

class JudgeResponseTooLarge extends Error {}

export function responseByteCap(maxOutputTokens: number): number {
  return Math.max(1_024, maxOutputTokens * RESPONSE_BYTES_PER_TOKEN);
}

/** @internal transport seam: cap bytes before any JSON parser observes them. */
export async function readJudgeResponseCapped(response: Response, maxBytes: number): Promise<Response> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && Number(advertised) > maxBytes) throw new JudgeResponseTooLarge("judge response exceeds the byte cap");
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) return controller.close();
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return controller.error(new JudgeResponseTooLarge("judge response exceeds the byte cap"));
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** The single bounded HTTP adapter used by every managed LLM primitive. */
export async function requestScoreMatchProvider(input: {
  readonly baseUrl: string;
  readonly endpoint: "chat/completions" | "systemone";
  readonly apiKey: string;
  readonly body: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}): Promise<{ readonly status: number; readonly headers: Headers; readonly body: string }> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/u, "")}/${input.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: input.body,
    signal: input.signal,
  });
  const bounded = await readJudgeResponseCapped(response, input.maxBytes);
  return { status: response.status, headers: response.headers, body: await bounded.text() };
}
