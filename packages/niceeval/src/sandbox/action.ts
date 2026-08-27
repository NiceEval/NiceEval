// SandboxAction 作者声明面：同步 Schema 输入、封闭 step protocol 与纯调度元数据。
// 本模块只构造、规范化和冻结计划；step 解释、Provider capability 与 cache I/O 属于 runtime seam。

import { Data, Schema } from "effect";
import type { JsonValue } from "../shared/types.ts";
import { digestBytes, digestOf } from "./identity.ts";
import {
  isRegisteredSandboxContent,
  registerSandboxContent,
  type RegisteredSandboxContent,
} from "./content.ts";

const SANDBOX_ACTION_REF: unique symbol = Symbol("niceeval.sandbox.action-ref");
const SANDBOX_STEP: unique symbol = Symbol("niceeval.sandbox.step");
const SANDBOX_ACTION: unique symbol = Symbol("niceeval.sandbox.action");
const SANDBOX_AFTER_ACTION: unique symbol = Symbol("niceeval.sandbox.after-action");

const SANDBOX_ACTION_REFS = new WeakSet<object>();
const SANDBOX_STEPS = new WeakSet<object>();
const SANDBOX_ACTIONS = new WeakSet<object>();
const SANDBOX_AFTER_ACTIONS = new WeakSet<object>();
const SANDBOX_STEP_DATA = new WeakMap<object, SandboxStepData>();
const SANDBOX_ACTION_DATA = new WeakMap<object, SandboxActionData>();
const SANDBOX_AFTER_ACTION_DATA = new WeakMap<object, SandboxActionData>();

export const changeFrequency = Object.freeze({
  rare: 10,
  normal: 100,
  frequent: 1_000,
} as const);

/** Complete mutable-state promises understood by V1 Setup Prefix providers. */
export const sandboxState = Object.freeze({
  all: "all",
  dockerData: "dockerData",
} as const);

export type SandboxState = typeof sandboxState[keyof typeof sandboxState];
/** @internal Provider/runtime spelling for the same public V1 state values. */
export type SandboxActionState = SandboxState;

/** @internal `all` dominates a cumulative action lineage. */
export function mergeSandboxActionState(
  ancestor: SandboxActionState | undefined,
  declared: SandboxActionState,
): SandboxActionState {
  return ancestor === sandboxState.all || declared === sandboxState.all
    ? sandboxState.all
    : sandboxState.dockerData;
}

/** @internal A complete `all` provider covers either V1 state promise. */
export function sandboxActionStateCovers(
  coverage: SandboxActionState,
  required: SandboxActionState,
): boolean {
  return coverage === sandboxState.all || required === sandboxState.dockerData;
}

export interface SandboxActionRef {
  readonly [SANDBOX_ACTION_REF]: true;
  readonly id: string;
}

export type SandboxCapability = string;

export interface SandboxChangeFrequency {
  readonly value: number;
  readonly source: "explicit" | "defaulted";
  readonly preset?: keyof typeof changeFrequency;
}

export interface SandboxBeforeActionOptions {
  readonly id: string;
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
  readonly requires?: readonly SandboxCapability[];
  readonly provides?: readonly SandboxCapability[];
  readonly cache?: SandboxActionCacheOptions;
}

export interface SandboxActionCacheOptions {
  /**
   * Complete side-effect surface changed by this action. Omission is the
   * conservative `all` promise; this is never a partial-cache selector.
   */
  readonly state?: SandboxActionState;
  readonly fingerprint?: JsonValue;
}

/** Reusable family instances default to the family id; inline built-ins keep SandboxBeforeActionOptions. */
export interface SandboxActionInstanceOptions {
  readonly id?: string;
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
  readonly requires?: readonly SandboxCapability[];
  readonly provides?: readonly SandboxCapability[];
  readonly cache?: SandboxActionCacheOptions;
}

export interface SandboxAfterActionOptions {
  readonly id?: string;
}

export interface NormalizedSandboxBeforeMetadata {
  readonly id: string;
  readonly changeFrequency: SandboxChangeFrequency;
  readonly dependsOn: readonly SandboxActionRef[];
  readonly requires: readonly SandboxCapability[];
  readonly provides: readonly SandboxCapability[];
}

export interface ExecSandboxStepInput {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface PutTextSandboxStepInput {
  readonly path: string;
  readonly text: string;
}

export interface PutBytesSandboxStepInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Low-level transfer steps only accept an immutable, digest-backed content handle. */
export type SandboxTransferSource = RegisteredSandboxContent;

export interface TransferFileSandboxStepInput {
  readonly source: SandboxTransferSource;
  readonly to: string;
}

export interface TransferDirectorySandboxStepInput {
  readonly source: SandboxTransferSource;
  readonly to: string;
}

export interface CheckoutGitSandboxStepInput {
  readonly repository: string;
  readonly ref: string;
  readonly to: string;
  readonly sparse?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
}

export interface SandboxStep {
  readonly [SANDBOX_STEP]: true;
  readonly kind:
    | "exec"
    | "putText"
    | "putBytes"
    | "transferFile"
    | "transferDirectory"
    | "checkoutGit";
}

export type SandboxStepPlan =
  | {
      readonly kind: "exec";
      readonly executable: string;
      readonly args: readonly string[];
      readonly cwd?: string;
      readonly user?: string;
      readonly timeoutMs?: number;
      readonly envKeys?: readonly string[];
      readonly stdinDigest?: string;
      readonly stdinBytes?: number;
    }
  | { readonly kind: "putText"; readonly path: string; readonly digest: string; readonly bytes: number }
  | { readonly kind: "putBytes"; readonly path: string; readonly digest: string; readonly bytes: number }
  | {
      readonly kind: "transferFile" | "transferDirectory";
      readonly source: { readonly kind: "content"; readonly digest: string };
      readonly to: string;
    }
  | {
      readonly kind: "checkoutGit";
      readonly repository: string;
      readonly ref: string;
      readonly to: string;
      readonly sparse?: {
        readonly include: readonly string[];
        readonly exclude: readonly string[];
      };
    };

interface SandboxStepData {
  readonly identity: JsonValue;
  readonly plan: SandboxStepPlan;
  readonly execution: SandboxStepExecution;
}

export type SandboxStepExecution =
  | { readonly kind: "exec"; readonly input: Readonly<ExecSandboxStepInput> }
  | { readonly kind: "putText"; readonly input: Readonly<PutTextSandboxStepInput> }
  | { readonly kind: "putBytes"; readonly input: Readonly<PutBytesSandboxStepInput> }
  | { readonly kind: "transferFile"; readonly input: Readonly<TransferFileSandboxStepInput> }
  | { readonly kind: "transferDirectory"; readonly input: Readonly<TransferDirectorySandboxStepInput> }
  | { readonly kind: "checkoutGit"; readonly input: Readonly<CheckoutGitSandboxStepInput> };

export interface SandboxActionFingerprintPlan {
  readonly automatic: string;
  readonly supplemental: string;
  readonly combined: string;
}

export interface SandboxActionPlan {
  readonly id: string;
  readonly family: string;
  readonly state: SandboxActionState;
  readonly input: JsonValue;
  readonly steps: readonly SandboxStepPlan[];
  readonly fingerprint: SandboxActionFingerprintPlan;
}

export interface SandboxActionData {
  readonly metadata: NormalizedSandboxBeforeMetadata;
  readonly plan: SandboxActionPlan;
  readonly steps: readonly SandboxStep[];
}

export interface SandboxAction {
  readonly [SANDBOX_ACTION]: true;
  readonly id: string;
}

export interface SandboxAfterAction {
  readonly [SANDBOX_AFTER_ACTION]: true;
  readonly id: string;
}

export type NonEmptySandboxSteps = readonly [SandboxStep, ...SandboxStep[]];

export interface SandboxActionDefinition<A, I extends JsonValue> {
  readonly id: string;
  readonly input: Schema.Codec<A, I, never, never>;
  readonly cache?: {
    readonly state?: SandboxActionState;
    readonly fingerprint?: JsonValue | ((input: A) => JsonValue);
  };
  readonly steps: (input: A) => NonEmptySandboxSteps;
}

export interface SandboxActionFamily<A> {
  (input: A, options?: SandboxActionInstanceOptions): SandboxAction;
  readonly after: (input: A, options?: SandboxAfterActionOptions) => SandboxAfterAction;
}

export type SandboxActionDefinitionErrorReason =
  | "definition"
  | "schema"
  | "input"
  | "canonical-input"
  | "cache-state"
  | "cache-fingerprint"
  | "steps"
  | "metadata";

export class SandboxActionDefinitionError extends Data.TaggedError("SandboxActionDefinitionError")<{
  readonly reason: SandboxActionDefinitionErrorReason;
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
}> {}

function actionError(
  reason: SandboxActionDefinitionErrorReason,
  message: string,
  field?: string,
  cause?: unknown,
): SandboxActionDefinitionError {
  return new SandboxActionDefinitionError({
    reason,
    message,
    ...(field === undefined ? {} : { field }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function assertRecord(value: unknown, path: string): asserts value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw actionError("definition", `${path} must be an object`, path);
  }
}

function assertOnlyKeys(
  value: globalThis.Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw actionError("definition", `${path}.${key} is not supported`, `${path}.${key}`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw actionError("definition", `${path} must be a non-empty string`, path);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw actionError("steps", `${path} must be an array of non-empty strings`, path);
  }
  return Object.freeze([...value]);
}

function presetFor(value: number): keyof typeof changeFrequency | undefined {
  if (value === changeFrequency.rare) return "rare";
  if (value === changeFrequency.normal) return "normal";
  if (value === changeFrequency.frequent) return "frequent";
  return undefined;
}

export function normalizeSandboxChangeFrequency(
  value: unknown,
  path = "changeFrequency",
): SandboxChangeFrequency {
  const source = value === undefined ? "defaulted" as const : "explicit" as const;
  const selected = value === undefined ? changeFrequency.normal : value;
  if (typeof selected !== "number" || !Number.isFinite(selected) || selected < 0) {
    throw actionError("metadata", `${path} must be a finite non-negative number`, path);
  }
  const normalized = Object.is(selected, -0) ? 0 : selected;
  const preset = presetFor(normalized);
  return Object.freeze({
    value: normalized,
    source,
    ...(preset === undefined ? {} : { preset }),
  });
}

function normalizeCapabilities(value: unknown, path: string): readonly SandboxCapability[] {
  if (value === undefined) return Object.freeze([]);
  const capabilities = stringArray(value, path);
  if (new Set(capabilities).size !== capabilities.length) {
    throw actionError("metadata", `${path} must not contain duplicate capabilities`, path);
  }
  return capabilities;
}

export function actionRef(id: string): SandboxActionRef {
  const normalized = nonEmptyString(id, "actionRef id");
  const ref = { id: normalized } as SandboxActionRef;
  Object.defineProperty(ref, SANDBOX_ACTION_REF, { value: true });
  SANDBOX_ACTION_REFS.add(ref);
  return Object.freeze(ref);
}

export function isSandboxActionRef(value: unknown): value is SandboxActionRef {
  return value !== null && typeof value === "object" && SANDBOX_ACTION_REFS.has(value);
}

export function normalizeSandboxBeforeMetadata(
  value: unknown,
  path = "Sandbox before options",
): NormalizedSandboxBeforeMetadata {
  assertRecord(value, path);
  assertOnlyKeys(value, new Set(["id", "changeFrequency", "dependsOn", "requires", "provides", "cache"]), path);
  normalizeSandboxActionCache(value.cache, `${path}.cache`);
  const dependsOn = value.dependsOn === undefined ? [] : value.dependsOn;
  if (!Array.isArray(dependsOn) || dependsOn.some((ref) => !isSandboxActionRef(ref))) {
    throw actionError("metadata", `${path}.dependsOn must contain actionRef() values`, `${path}.dependsOn`);
  }
  const ids = dependsOn.map((ref) => ref.id);
  if (new Set(ids).size !== ids.length) {
    throw actionError("metadata", `${path}.dependsOn must not contain duplicate refs`, `${path}.dependsOn`);
  }
  return Object.freeze({
    id: nonEmptyString(value.id, `${path}.id`),
    changeFrequency: normalizeSandboxChangeFrequency(value.changeFrequency, `${path}.changeFrequency`),
    dependsOn: Object.freeze([...dependsOn]),
    requires: normalizeCapabilities(value.requires, `${path}.requires`),
    provides: normalizeCapabilities(value.provides, `${path}.provides`),
  });
}

function cloneJson(value: unknown, path: string, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw actionError("canonical-input", `${path} contains a non-finite number`, path);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw actionError(
      "canonical-input",
      `${path} must contain only JSON values (no undefined, functions, symbols, bigint, or class instances)`,
      path,
    );
  }
  if (ancestors.has(value)) throw actionError("canonical-input", `${path} must not contain a cycle`, path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((child, index) => cloneJson(child, `${path}[${index}]`, ancestors)),
      ) as unknown as JsonValue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw actionError("canonical-input", `${path} must contain only plain JSON objects`, path);
    }
    const output = Object.create(null) as globalThis.Record<string, JsonValue>;
    for (const key of Object.keys(value as globalThis.Record<string, unknown>).sort()) {
      output[key] = cloneJson((value as globalThis.Record<string, unknown>)[key], `${path}.${key}`, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function normalizeSandboxActionCache(
  value: unknown,
  path: string,
): Readonly<SandboxActionCacheOptions> | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, path);
  assertOnlyKeys(value, new Set(["state", "fingerprint"]), path);
  const state = normalizeSandboxActionState(value.state, `${path}.state`);
  if (value.fingerprint !== undefined) cloneJson(value.fingerprint, `${path}.fingerprint`);
  return Object.freeze({
    ...(value.state === undefined ? {} : { state }),
    ...(value.fingerprint === undefined ? {} : { fingerprint: value.fingerprint as JsonValue }),
  });
}

function normalizeSandboxActionState(value: unknown, path: string): SandboxActionState {
  if (value === undefined) return sandboxState.all;
  if (value === sandboxState.all || value === sandboxState.dockerData) return value;
  throw actionError(
    "cache-state",
    `${path} must be sandboxState.all or sandboxState.dockerData`,
    path,
  );
}

function envRecord(value: unknown, path: string): Readonly<globalThis.Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw actionError("steps", `${path} must be an object of string values`, path);
  }
    const env = Object.create(null) as globalThis.Record<string, string>;
  for (const key of Object.keys(value as globalThis.Record<string, unknown>).sort()) {
    const child = (value as globalThis.Record<string, unknown>)[key];
    if (key === "" || typeof child !== "string") {
      throw actionError("steps", `${path}.${key} must be a string`, `${path}.${key}`);
    }
    env[key] = child;
  }
  return Object.freeze(env);
}

function makeStep(kind: SandboxStep["kind"], data: SandboxStepData): SandboxStep {
  const step = { kind } as SandboxStep;
  Object.defineProperty(step, SANDBOX_STEP, { value: true });
  SANDBOX_STEPS.add(step);
  SANDBOX_STEP_DATA.set(step, Object.freeze(data));
  return Object.freeze(step);
}

function normalizeTransferSource(
  source: SandboxTransferSource,
  expectedKind: RegisteredSandboxContent["kind"],
  path: string,
): {
  readonly identity: JsonValue;
  readonly plan: Extract<SandboxStepPlan, { readonly kind: "transferFile" | "transferDirectory" }>["source"];
} {
  if (!isRegisteredSandboxContent(source) || source.kind !== expectedKind) {
    throw actionError(
      "steps",
      `${path} must be a ${expectedKind} handle returned by registerSandboxContent()`,
      path,
    );
  }
  return Object.freeze({
    identity: Object.freeze({ kind: "content", contentKind: source.kind, digest: source.digest }),
    plan: Object.freeze({ kind: "content", digest: source.digest }),
  });
}

export const sandboxStep = Object.freeze({
  exec(input: ExecSandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.exec input");
    assertOnlyKeys(
      input,
      new Set(["executable", "args", "cwd", "env", "user", "timeoutMs", "stdin"]),
      "sandboxStep.exec input",
    );
    const executable = nonEmptyString(input.executable, "sandboxStep.exec input.executable");
    const args = input.args === undefined ? Object.freeze([]) : stringArray(input.args, "sandboxStep.exec input.args");
    const cwd = input.cwd === undefined ? undefined : nonEmptyString(input.cwd, "sandboxStep.exec input.cwd");
    const user = input.user === undefined ? undefined : nonEmptyString(input.user, "sandboxStep.exec input.user");
    if (
      input.timeoutMs !== undefined &&
      (typeof input.timeoutMs !== "number" || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)
    ) {
      throw actionError("steps", "sandboxStep.exec input.timeoutMs must be a positive finite number", "timeoutMs");
    }
    if (input.stdin !== undefined && typeof input.stdin !== "string") {
      throw actionError("steps", "sandboxStep.exec input.stdin must be a string", "stdin");
    }
    const env = envRecord(input.env, "sandboxStep.exec input.env");
    const identity: JsonValue = Object.freeze({
      kind: "exec",
      executable,
      args: [...args],
      ...(cwd === undefined ? {} : { cwd }),
      ...(user === undefined ? {} : { user }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(env === undefined ? {} : { env: { ...env } }),
      ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
    });
    const plan: SandboxStepPlan = Object.freeze({
      kind: "exec",
      executable,
      args,
      ...(cwd === undefined ? {} : { cwd }),
      ...(user === undefined ? {} : { user }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(env === undefined || Object.keys(env).length === 0 ? {} : { envKeys: Object.freeze(Object.keys(env)) }),
      ...(input.stdin === undefined
        ? {}
        : {
            stdinDigest: `sha256:${digestBytes(input.stdin)}`,
            stdinBytes: Buffer.byteLength(input.stdin),
          }),
    });
    return makeStep("exec", {
      identity,
      plan,
      execution: Object.freeze({
        kind: "exec" as const,
        input: Object.freeze({
          executable,
          args,
          ...(cwd === undefined ? {} : { cwd }),
          ...(env === undefined ? {} : { env }),
          ...(user === undefined ? {} : { user }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        }),
      }),
    });
  },

  putText(input: PutTextSandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.putText input");
    assertOnlyKeys(input, new Set(["path", "text"]), "sandboxStep.putText input");
    const path = nonEmptyString(input.path, "sandboxStep.putText input.path");
    if (typeof input.text !== "string") throw actionError("steps", "sandboxStep.putText input.text must be a string", "text");
    const digest = `sha256:${digestBytes(input.text)}`;
    const bytes = Buffer.byteLength(input.text);
    return makeStep("putText", {
      identity: Object.freeze({ kind: "putText", path, digest, bytes }),
      plan: Object.freeze({ kind: "putText", path, digest, bytes }),
      execution: Object.freeze({
        kind: "putText" as const,
        input: Object.freeze({ path, text: input.text }),
      }),
    });
  },

  putBytes(input: PutBytesSandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.putBytes input");
    assertOnlyKeys(input, new Set(["path", "bytes"]), "sandboxStep.putBytes input");
    const path = nonEmptyString(input.path, "sandboxStep.putBytes input.path");
    if (!(input.bytes instanceof Uint8Array)) {
      throw actionError("steps", "sandboxStep.putBytes input.bytes must be a Uint8Array", "bytes");
    }
    const bytes = Uint8Array.from(input.bytes);
    const digest = `sha256:${digestBytes(bytes)}`;
    return makeStep("putBytes", {
      identity: Object.freeze({ kind: "putBytes", path, digest, bytes: bytes.byteLength }),
      plan: Object.freeze({ kind: "putBytes", path, digest, bytes: bytes.byteLength }),
      execution: Object.freeze({
        kind: "putBytes" as const,
        input: Object.freeze({ path, bytes }),
      }),
    });
  },

  transferFile(input: TransferFileSandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.transferFile input");
    assertOnlyKeys(input, new Set(["source", "to"]), "sandboxStep.transferFile input");
    const source = normalizeTransferSource(input.source, "file", "sandboxStep.transferFile input.source");
    const to = nonEmptyString(input.to, "sandboxStep.transferFile input.to");
    return makeStep("transferFile", {
      identity: Object.freeze({ kind: "transferFile", source: source.identity, to }),
      plan: Object.freeze({ kind: "transferFile", source: source.plan, to }),
      execution: Object.freeze({
        kind: "transferFile" as const,
        input: Object.freeze({ source: input.source, to }),
      }),
    });
  },

  transferDirectory(input: TransferDirectorySandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.transferDirectory input");
    assertOnlyKeys(input, new Set(["source", "to"]), "sandboxStep.transferDirectory input");
    const source = normalizeTransferSource(input.source, "directory", "sandboxStep.transferDirectory input.source");
    const to = nonEmptyString(input.to, "sandboxStep.transferDirectory input.to");
    return makeStep("transferDirectory", {
      identity: Object.freeze({ kind: "transferDirectory", source: source.identity, to }),
      plan: Object.freeze({ kind: "transferDirectory", source: source.plan, to }),
      execution: Object.freeze({
        kind: "transferDirectory" as const,
        input: Object.freeze({ source: input.source, to }),
      }),
    });
  },

  checkoutGit(input: CheckoutGitSandboxStepInput): SandboxStep {
    assertRecord(input, "sandboxStep.checkoutGit input");
    assertOnlyKeys(input, new Set(["repository", "ref", "to", "sparse"]), "sandboxStep.checkoutGit input");
    const repository = nonEmptyString(input.repository, "sandboxStep.checkoutGit input.repository");
    const ref = nonEmptyString(input.ref, "sandboxStep.checkoutGit input.ref");
    const to = nonEmptyString(input.to, "sandboxStep.checkoutGit input.to");
    let sparse: { readonly include: readonly string[]; readonly exclude: readonly string[] } | undefined;
    if (input.sparse !== undefined) {
      assertRecord(input.sparse, "sandboxStep.checkoutGit input.sparse");
      assertOnlyKeys(input.sparse, new Set(["include", "exclude"]), "sandboxStep.checkoutGit input.sparse");
      sparse = Object.freeze({
        include: input.sparse.include === undefined
          ? Object.freeze([])
          : stringArray(input.sparse.include, "sandboxStep.checkoutGit input.sparse.include"),
        exclude: input.sparse.exclude === undefined
          ? Object.freeze([])
          : stringArray(input.sparse.exclude, "sandboxStep.checkoutGit input.sparse.exclude"),
      });
    }
    const projection = Object.freeze({
      kind: "checkoutGit" as const,
      repository,
      ref,
      to,
      ...(sparse === undefined ? {} : { sparse }),
    });
    return makeStep("checkoutGit", {
      identity: cloneJson(projection, "sandboxStep.checkoutGit identity"),
      plan: projection,
      execution: Object.freeze({
        kind: "checkoutGit" as const,
        input: Object.freeze({ repository, ref, to, ...(sparse === undefined ? {} : { sparse }) }),
      }),
    });
  },
});

export function isSandboxStep(value: unknown): value is SandboxStep {
  return value !== null && typeof value === "object" && SANDBOX_STEPS.has(value);
}

export function sandboxStepPlanOf(step: SandboxStep): SandboxStepPlan {
  const data = SANDBOX_STEP_DATA.get(step as object);
  if (!isSandboxStep(step) || data === undefined) {
    throw actionError("steps", "Sandbox steps must be created by sandboxStep", "steps");
  }
  return data.plan;
}

/** @internal Runtime interpreter consumes normalized private payloads; debug only receives SandboxStepPlan. */
export function sandboxStepExecutionOf(step: SandboxStep): SandboxStepExecution {
  const data = SANDBOX_STEP_DATA.get(step as object);
  if (!isSandboxStep(step) || data === undefined) {
    throw actionError("steps", "Sandbox steps must be created by sandboxStep", "steps");
  }
  return data.execution;
}

function validateAfterOptions(value: unknown, defaultId: string): Readonly<{ readonly id: string }> {
  if (value === undefined) return Object.freeze({ id: defaultId });
  assertRecord(value, "Sandbox after options");
  assertOnlyKeys(value, new Set(["id"]), "Sandbox after options");
  return Object.freeze({
    id: value.id === undefined ? defaultId : nonEmptyString(value.id, "Sandbox after options.id"),
  });
}

function makeAction(data: SandboxActionData): SandboxAction {
  const action = { id: data.metadata.id } as SandboxAction;
  Object.defineProperty(action, SANDBOX_ACTION, { value: true });
  SANDBOX_ACTIONS.add(action);
  SANDBOX_ACTION_DATA.set(action, data);
  return Object.freeze(action);
}

function makeAfterAction(data: SandboxActionData): SandboxAfterAction {
  const action = { id: data.metadata.id } as SandboxAfterAction;
  Object.defineProperty(action, SANDBOX_AFTER_ACTION, { value: true });
  SANDBOX_AFTER_ACTIONS.add(action);
  SANDBOX_AFTER_ACTION_DATA.set(action, data);
  return Object.freeze(action);
}

export function defineSandboxAction<A, I extends JsonValue>(
  definition: SandboxActionDefinition<A, I>,
): SandboxActionFamily<A> {
  assertRecord(definition, "defineSandboxAction definition");
  assertOnlyKeys(definition, new Set(["id", "input", "cache", "steps"]), "defineSandboxAction definition");
  const familyId = nonEmptyString(definition.id, "defineSandboxAction definition.id");
  if (!Schema.isSchema(definition.input)) {
    throw actionError("schema", "defineSandboxAction definition.input must be an Effect Schema", "input");
  }
  if (typeof definition.steps !== "function") {
    throw actionError("definition", "defineSandboxAction definition.steps must be a function", "steps");
  }
  if (definition.cache !== undefined) {
    assertRecord(definition.cache, "defineSandboxAction definition.cache");
    assertOnlyKeys(definition.cache, new Set(["state", "fingerprint"]), "defineSandboxAction definition.cache");
    if (definition.cache.state !== undefined) {
      normalizeSandboxActionState(
        definition.cache.state,
        "defineSandboxAction definition.cache.state",
      );
    }
    if (
      definition.cache.fingerprint !== undefined &&
      typeof definition.cache.fingerprint !== "function"
    ) {
      cloneJson(definition.cache.fingerprint, "defineSandboxAction definition.cache.fingerprint");
    }
  }

  const instantiate = (
    input: A,
    metadata: NormalizedSandboxBeforeMetadata,
    instanceCache?: SandboxActionCacheOptions,
  ): SandboxActionData => {
    if (definition.cache?.state !== undefined && instanceCache?.state !== undefined) {
      throw actionError(
        "cache-state",
        `Sandbox action ${JSON.stringify(familyId)} cache.state must be declared exactly once; an instance cannot repeat or override the definition state`,
        "cache.state",
      );
    }
    const state = normalizeSandboxActionState(
      instanceCache?.state ?? definition.cache?.state,
      `Sandbox action ${JSON.stringify(familyId)} cache.state`,
    );
    let validated: A;
    try {
      validated = Schema.decodeSync(Schema.toType(definition.input))(input);
    } catch (cause) {
      throw actionError("input", `Sandbox action ${JSON.stringify(familyId)} input failed Schema validation`, "input", cause);
    }
    let encoded: I;
    try {
      encoded = Schema.encodeSync(definition.input)(validated);
    } catch (cause) {
      throw actionError("schema", `Sandbox action ${JSON.stringify(familyId)} input could not be encoded synchronously`, "input", cause);
    }
    const canonicalInput = cloneJson(encoded, `Sandbox action ${JSON.stringify(familyId)} canonical input`);
    let steps: NonEmptySandboxSteps;
    try {
      steps = definition.steps(validated);
    } catch (cause) {
      throw actionError("steps", `Sandbox action ${JSON.stringify(familyId)} steps threw`, "steps", cause);
    }
    if (!Array.isArray(steps) || steps.length === 0 || steps.some((step) => !isSandboxStep(step))) {
      throw actionError(
        "steps",
        `Sandbox action ${JSON.stringify(familyId)} steps must synchronously return a non-empty tuple of sandboxStep values`,
        "steps",
      );
    }
    const stepData = steps.map((step) => SANDBOX_STEP_DATA.get(step as object)!);
    const plans = Object.freeze(stepData.map((entry) => entry.plan));
    const automaticIdentity: JsonValue = Object.freeze({
      family: familyId,
      state,
      input: canonicalInput,
      steps: stepData.map((entry) => entry.identity),
    });
    const absentFingerprint: JsonValue = Object.freeze({ _tag: "Absent" });
    let definitionSupplemental: JsonValue = absentFingerprint;
    const fingerprint = definition.cache?.fingerprint;
    if (fingerprint !== undefined) {
      try {
        definitionSupplemental = cloneJson(
          typeof fingerprint === "function" ? fingerprint(validated) : fingerprint,
          `Sandbox action ${JSON.stringify(familyId)} definition supplemental fingerprint`,
        );
      } catch (cause) {
        throw actionError(
          "cache-fingerprint",
          `Sandbox action ${JSON.stringify(familyId)} supplemental fingerprint failed`,
          "cache.fingerprint",
          cause,
        );
      }
    }
    let instanceSupplemental: JsonValue = absentFingerprint;
    if (instanceCache?.fingerprint !== undefined) {
      try {
        instanceSupplemental = cloneJson(
          instanceCache.fingerprint,
          `Sandbox action ${JSON.stringify(familyId)} instance supplemental fingerprint`,
        );
      } catch (cause) {
        throw actionError(
          "cache-fingerprint",
          `Sandbox action ${JSON.stringify(familyId)} instance supplemental fingerprint failed`,
          "cache.fingerprint",
          cause,
        );
      }
    }
    const supplementalValue: JsonValue = Object.freeze({
      definition: definitionSupplemental,
      instance: instanceSupplemental,
    });
    const automatic = `sha256:${digestOf(automaticIdentity)}`;
    const supplemental = `sha256:${digestOf(supplementalValue)}`;
    const combined = `sha256:${digestOf({ automatic, supplemental })}`;
    return Object.freeze({
      metadata,
      steps: Object.freeze([...steps]),
      plan: Object.freeze({
        id: metadata.id,
        family: familyId,
        state,
        input: canonicalInput,
        steps: plans,
        fingerprint: Object.freeze({ automatic, supplemental, combined }),
      }),
    });
  };

  const family = ((input: A, options?: SandboxActionInstanceOptions): SandboxAction => {
    const selected = options === undefined ? {} : options;
    assertRecord(selected, "Sandbox action instance options");
    assertOnlyKeys(
      selected,
      new Set(["id", "changeFrequency", "dependsOn", "requires", "provides", "cache"]),
      "Sandbox action instance options",
    );
    const cache = normalizeSandboxActionCache(selected.cache, "Sandbox action instance options.cache");
    return makeAction(instantiate(
      input,
      normalizeSandboxBeforeMetadata({
        ...selected,
        id: selected.id ?? familyId,
      }),
      cache,
    ));
  }) as SandboxActionFamily<A>;
  Object.defineProperty(family, "after", {
    value: (input: A, options?: SandboxAfterActionOptions): SandboxAfterAction => {
      const after = validateAfterOptions(options, familyId);
      const metadata: NormalizedSandboxBeforeMetadata = Object.freeze({
        id: after.id,
        changeFrequency: Object.freeze({ value: changeFrequency.normal, source: "defaulted", preset: "normal" }),
        dependsOn: Object.freeze([]),
        requires: Object.freeze([]),
        provides: Object.freeze([]),
      });
      return makeAfterAction(instantiate(input, metadata));
    },
    enumerable: true,
  });
  return Object.freeze(family);
}

export function isSandboxAction(value: unknown): value is SandboxAction {
  return value !== null && typeof value === "object" && SANDBOX_ACTIONS.has(value);
}

export function isSandboxAfterAction(value: unknown): value is SandboxAfterAction {
  return value !== null && typeof value === "object" && SANDBOX_AFTER_ACTIONS.has(value);
}

export function sandboxActionDataOf(action: SandboxAction): SandboxActionData {
  const data = SANDBOX_ACTION_DATA.get(action as object);
  if (!isSandboxAction(action) || data === undefined) {
    throw actionError("definition", "SandboxAction must be created by defineSandboxAction", "action");
  }
  return data;
}

export function sandboxAfterActionDataOf(action: SandboxAfterAction): SandboxActionData {
  const data = SANDBOX_AFTER_ACTION_DATA.get(action as object);
  if (!isSandboxAfterAction(action) || data === undefined) {
    throw actionError("definition", "SandboxAfterAction must be created by SandboxActionFamily.after", "action");
  }
  return data;
}

export interface WriteTextActionInput extends SandboxBeforeActionOptions {
  readonly path: string;
  readonly text: string;
}

export interface WriteTextAfterActionInput {
  readonly id: string;
  readonly path: string;
  readonly text: string;
}

export interface WriteBytesActionInput extends SandboxBeforeActionOptions {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface WriteBytesAfterActionInput {
  readonly id: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface UploadFileActionInput extends SandboxBeforeActionOptions {
  /** Declaration-time host content must be anchored explicitly to its definition module. */
  readonly source: URL;
  readonly to: string;
}

export interface UploadFileAfterActionInput {
  readonly id: string;
  /** Declaration-time host content must be anchored explicitly to its definition module. */
  readonly source: URL;
  readonly to: string;
}

export interface UploadDirectoryActionInput extends UploadFileActionInput {}
export interface UploadDirectoryAfterActionInput extends UploadFileAfterActionInput {}

export interface GitCheckoutActionInput extends SandboxBeforeActionOptions {
  readonly repository: string;
  /** V1 accepts only a complete immutable Git object id; moving refs require a future planning lookup seam. */
  readonly ref: string;
  readonly to: string;
  readonly sparse?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
}

export interface GitCheckoutAfterActionInput {
  readonly id: string;
  readonly repository: string;
  readonly ref: string;
  readonly to: string;
  readonly sparse?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
}

export interface WriteTextActionFactory {
  (input: WriteTextActionInput): SandboxAction;
  readonly after: (input: WriteTextAfterActionInput) => SandboxAfterAction;
}

export interface WriteBytesActionFactory {
  (input: WriteBytesActionInput): SandboxAction;
  readonly after: (input: WriteBytesAfterActionInput) => SandboxAfterAction;
}

export interface UploadFileActionFactory {
  (input: UploadFileActionInput): SandboxAction;
  readonly after: (input: UploadFileAfterActionInput) => SandboxAfterAction;
}

export interface UploadDirectoryActionFactory {
  (input: UploadDirectoryActionInput): SandboxAction;
  readonly after: (input: UploadDirectoryAfterActionInput) => SandboxAfterAction;
}

export interface GitCheckoutActionFactory {
  (input: GitCheckoutActionInput): SandboxAction;
  readonly after: (input: GitCheckoutAfterActionInput) => SandboxAfterAction;
}

const INLINE_BEFORE_KEYS = ["id", "changeFrequency", "dependsOn", "requires", "provides", "cache"] as const;

function inlineBeforeOptions(input: SandboxBeforeActionOptions): SandboxActionInstanceOptions {
  return {
    id: input.id,
    ...(input.changeFrequency === undefined ? {} : { changeFrequency: input.changeFrequency }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: input.dependsOn }),
    ...(input.requires === undefined ? {} : { requires: input.requires }),
    ...(input.provides === undefined ? {} : { provides: input.provides }),
    ...(input.cache === undefined ? {} : { cache: input.cache }),
  };
}

function assertInlineInput(
  input: unknown,
  payloadKeys: readonly string[],
  path: string,
  after: boolean,
): asserts input is globalThis.Record<string, unknown> {
  assertRecord(input, path);
  assertOnlyKeys(
    input,
    new Set(after ? ["id", ...payloadKeys] : [...INLINE_BEFORE_KEYS, ...payloadKeys]),
    path,
  );
  nonEmptyString(input.id, `${path}.id`);
}

function contentSource(source: URL, path: string): RegisteredSandboxContent {
  if (!(source instanceof URL)) {
    throw actionError(
      "input",
      `${path} must be a file URL anchored to the definition module, for example new URL(\"fixture/\", import.meta.url)`,
      path,
    );
  }
  return registerSandboxContent(source);
}

const writeTextFamily = defineSandboxAction({
  id: "niceeval.sandbox.write-text",
  input: Schema.Struct({ path: Schema.String, text: Schema.String }),
  steps: ({ path, text }) => [sandboxStep.putText({ path, text })] as const,
});

const writeBytesFamily = defineSandboxAction({
  id: "niceeval.sandbox.write-bytes",
  input: Schema.Struct({ path: Schema.String, bytesBase64: Schema.String }),
  steps: ({ path, bytesBase64 }) => [sandboxStep.putBytes({
    path,
    bytes: Uint8Array.from(Buffer.from(bytesBase64, "base64")),
  })] as const,
});

interface TransferActionPayload {
  readonly source: RegisteredSandboxContent;
  readonly to: string;
}

const transferInputSchema = Schema.Struct({
  source: Schema.Unknown,
  to: Schema.String,
}) as unknown as Schema.Codec<TransferActionPayload, JsonValue, never, never>;

const uploadFileFamily = defineSandboxAction({
  id: "niceeval.sandbox.upload-file",
  input: transferInputSchema,
  steps: ({ source, to }) => [sandboxStep.transferFile({ source, to })] as const,
});

const uploadDirectoryFamily = defineSandboxAction({
  id: "niceeval.sandbox.upload-directory",
  input: transferInputSchema,
  steps: ({ source, to }) => [sandboxStep.transferDirectory({ source, to })] as const,
});

interface GitCheckoutPayload {
  readonly repository: string;
  readonly commit: string;
  readonly to: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

const gitCheckoutInputSchema = Schema.Struct({
  repository: Schema.String,
  commit: Schema.String,
  to: Schema.String,
  include: Schema.Array(Schema.String),
  exclude: Schema.Array(Schema.String),
}) as unknown as Schema.Codec<GitCheckoutPayload, JsonValue, never, never>;

const gitCheckoutFamily = defineSandboxAction({
  id: "niceeval.sandbox.git-checkout",
  input: gitCheckoutInputSchema,
  steps: ({ repository, commit, to, include, exclude }) => [sandboxStep.checkoutGit({
    repository,
    ref: commit,
    to,
    ...(include.length === 0 && exclude.length === 0
      ? {}
      : { sparse: { include, exclude } }),
  })] as const,
});

function normalizeGitCheckout(input: GitCheckoutActionInput | GitCheckoutAfterActionInput): GitCheckoutPayload {
  let repository: URL;
  try {
    repository = new URL(input.repository);
  } catch (cause) {
    throw actionError("input", "gitCheckout input.repository must be a public HTTPS URL", "repository", cause);
  }
  if (
    repository.protocol !== "https:" ||
    repository.username !== "" ||
    repository.password !== "" ||
    repository.search !== "" ||
    repository.hash !== ""
  ) {
    throw actionError(
      "input",
      "gitCheckout input.repository must be a credential-free public HTTPS URL without query or fragment",
      "repository",
    );
  }
  const commit = nonEmptyString(input.ref, "gitCheckout input.ref").toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
    throw actionError(
      "input",
      "gitCheckout input.ref must be a complete 40- or 64-hex commit object id; moving refs are not cache-safe",
      "ref",
    );
  }
  let include: readonly string[] = Object.freeze([]);
  let exclude: readonly string[] = Object.freeze([]);
  if (input.sparse !== undefined) {
    assertRecord(input.sparse, "gitCheckout input.sparse");
    assertOnlyKeys(input.sparse, new Set(["include", "exclude"]), "gitCheckout input.sparse");
    include = input.sparse.include === undefined
      ? Object.freeze([])
      : stringArray(input.sparse.include, "gitCheckout input.sparse.include");
    exclude = input.sparse.exclude === undefined
      ? Object.freeze([])
      : stringArray(input.sparse.exclude, "gitCheckout input.sparse.exclude");
  }
  return Object.freeze({
    repository: repository.href,
    commit,
    to: nonEmptyString(input.to, "gitCheckout input.to"),
    include,
    exclude,
  });
}

const writeTextImpl = ((input: WriteTextActionInput): SandboxAction => {
  assertInlineInput(input, ["path", "text"], "writeText input", false);
  return writeTextFamily(
    { path: input.path, text: input.text },
    inlineBeforeOptions(input),
  );
}) as WriteTextActionFactory;
Object.defineProperty(writeTextImpl, "after", {
  value: (input: WriteTextAfterActionInput): SandboxAfterAction => {
    assertInlineInput(input, ["path", "text"], "writeText.after input", true);
    return writeTextFamily.after({ path: input.path, text: input.text }, { id: input.id });
  },
});
export const writeText = Object.freeze(writeTextImpl);

const writeBytesImpl = ((input: WriteBytesActionInput): SandboxAction => {
  assertInlineInput(input, ["path", "bytes"], "writeBytes input", false);
  if (!(input.bytes instanceof Uint8Array)) throw actionError("input", "writeBytes input.bytes must be Uint8Array", "bytes");
  return writeBytesFamily(
    { path: input.path, bytesBase64: Buffer.from(input.bytes).toString("base64") },
    inlineBeforeOptions(input),
  );
}) as WriteBytesActionFactory;
Object.defineProperty(writeBytesImpl, "after", {
  value: (input: WriteBytesAfterActionInput): SandboxAfterAction => {
    assertInlineInput(input, ["path", "bytes"], "writeBytes.after input", true);
    if (!(input.bytes instanceof Uint8Array)) throw actionError("input", "writeBytes.after input.bytes must be Uint8Array", "bytes");
    return writeBytesFamily.after(
      { path: input.path, bytesBase64: Buffer.from(input.bytes).toString("base64") },
      { id: input.id },
    );
  },
});
export const writeBytes = Object.freeze(writeBytesImpl);

const uploadFileImpl = ((input: UploadFileActionInput): SandboxAction => {
  assertInlineInput(input, ["source", "to"], "uploadFile input", false);
  return uploadFileFamily(
    { source: contentSource(input.source, "uploadFile input.source"), to: input.to },
    inlineBeforeOptions(input),
  );
}) as UploadFileActionFactory;
Object.defineProperty(uploadFileImpl, "after", {
  value: (input: UploadFileAfterActionInput): SandboxAfterAction => {
    assertInlineInput(input, ["source", "to"], "uploadFile.after input", true);
    return uploadFileFamily.after(
      { source: contentSource(input.source, "uploadFile.after input.source"), to: input.to },
      { id: input.id },
    );
  },
});
export const uploadFile = Object.freeze(uploadFileImpl);

const uploadDirectoryImpl = ((input: UploadDirectoryActionInput): SandboxAction => {
  assertInlineInput(input, ["source", "to"], "uploadDirectory input", false);
  return uploadDirectoryFamily(
    { source: contentSource(input.source, "uploadDirectory input.source"), to: input.to },
    inlineBeforeOptions(input),
  );
}) as UploadDirectoryActionFactory;
Object.defineProperty(uploadDirectoryImpl, "after", {
  value: (input: UploadDirectoryAfterActionInput): SandboxAfterAction => {
    assertInlineInput(input, ["source", "to"], "uploadDirectory.after input", true);
    return uploadDirectoryFamily.after(
      { source: contentSource(input.source, "uploadDirectory.after input.source"), to: input.to },
      { id: input.id },
    );
  },
});
export const uploadDirectory = Object.freeze(uploadDirectoryImpl);

const gitCheckoutImpl = ((input: GitCheckoutActionInput): SandboxAction => {
  assertInlineInput(input, ["repository", "ref", "to", "sparse"], "gitCheckout input", false);
  return gitCheckoutFamily(normalizeGitCheckout(input), inlineBeforeOptions(input));
}) as GitCheckoutActionFactory;
Object.defineProperty(gitCheckoutImpl, "after", {
  value: (input: GitCheckoutAfterActionInput): SandboxAfterAction => {
    assertInlineInput(input, ["repository", "ref", "to", "sparse"], "gitCheckout.after input", true);
    return gitCheckoutFamily.after(normalizeGitCheckout(input), { id: input.id });
  },
});
export const gitCheckout = Object.freeze(gitCheckoutImpl);
