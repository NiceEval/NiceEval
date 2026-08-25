// SandboxLayer 的准备命令声明与稳定身份。
// 这里只描述作者面与供后续 linker/runner 消费的纯数据，不负责调度或生命周期执行。

import { Schema } from "effect";
import type { DiagnosticInput, JsonValue } from "../shared/types.ts";
import type { SandboxOperations } from "./types.ts";
import { digestBytes, digestOf } from "./identity.ts";
import {
  defineSandboxAction,
  normalizeSandboxBeforeMetadata,
  sandboxStep,
  type NormalizedSandboxBeforeMetadata,
  type SandboxAction,
  type SandboxActionInstanceOptions,
  type SandboxActionRef,
  type SandboxAfterAction,
  type SandboxBeforeActionOptions,
  type SandboxCapability,
} from "./action.ts";
import { isRegisteredSandboxContent, type RegisteredSandboxContent } from "./content.ts";

export type MaybePromise<T> = T | Promise<T>;

export interface SandboxCommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface SandboxExecOptions extends SandboxCommandOptions {}

export interface CommandActionOptions extends SandboxExecOptions, SandboxBeforeActionOptions {}

export interface CommandAfterActionOptions extends SandboxExecOptions {
  readonly id: string;
}

export interface ShellActionInput extends SandboxExecOptions, SandboxBeforeActionOptions {
  readonly command: string;
  readonly inputs?: readonly RegisteredSandboxContent[];
}

export interface ShellAfterActionInput extends SandboxExecOptions {
  readonly id: string;
  readonly command: string;
  readonly inputs?: readonly RegisteredSandboxContent[];
}

export interface CommandActionFactory {
  (
    executable: string,
    args: readonly string[],
    options: CommandActionOptions,
  ): SandboxAction;
  (
    executable: string,
    args?: readonly string[],
    options?: SandboxCommandOptions,
  ): StableSandboxCommand;
  readonly after: (
    executable: string,
    args: readonly string[],
    options: CommandAfterActionOptions,
  ) => SandboxAfterAction;
}

export interface ShellActionFactory {
  (input: ShellActionInput): SandboxAction;
  (script: string, options?: SandboxCommandOptions): StableSandboxCommand;
  readonly after: (input: ShellAfterActionInput) => SandboxAfterAction;
}

/**
 * prepare callback 取得的窄 Sandbox 视图。它没有 stop、宿主传输或 Provider-native SDK。
 */
export interface SandboxCommandTarget extends SandboxOperations {
  /** 当前 callback 可见的主物理 Sandbox 的 Provider-native ID。 */
  readonly sandboxId: string;
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: RegisteredSandboxContent, targetPath: string): Promise<void>;
}

export interface AttemptRef {
  readonly id: string;
  readonly index: number;
}

export type SandboxProgress = (update: {
  readonly message: string;
  readonly current?: number;
  readonly total?: number;
}) => void;

export type SandboxDiagnosticSink = (input: DiagnosticInput) => void;

export type SandboxCleanupCommand = (
  sandbox: SandboxCommandTarget,
  context: Omit<SandboxCommandContext, "onCleanup">,
) => MaybePromise<void>;

export interface SandboxCommandContext {
  readonly phase: "before" | "agent.post-setup" | "agent.pre-teardown";
  /** 当前 Attempt 的 Eval Group；未分组 Eval 省略。 */
  readonly evalGroup?: {
    readonly id: string;
    readonly definitionHash: string;
  };
  readonly owner:
    | { readonly kind: "eval"; readonly id: string }
    | { readonly kind: "eval-group"; readonly id: string }
    | { readonly kind: "experiment"; readonly id: string }
    | { readonly kind: "agent"; readonly id: string };
  readonly attempt: AttemptRef;
  readonly signal: AbortSignal;
  readonly progress: SandboxProgress;
  readonly diagnostic: SandboxDiagnosticSink;
  onCleanup(command: SandboxCleanupCommand): void;
}

export interface SandboxCommand {
  (
    sandbox: SandboxCommandTarget,
    context: SandboxCommandContext,
  ): MaybePromise<void>;
}

export type SandboxCommandIdentityValue =
  | null
  | boolean
  | number
  | string
  | RegisteredSandboxContent
  | readonly SandboxCommandIdentityValue[]
  | { readonly [key: string]: SandboxCommandIdentityValue };

export interface SandboxCommandIdentity {
  readonly id: string;
  readonly revision: string;
  readonly inputs: SandboxCommandIdentityValue;
}

export interface SandboxCommandDefinition extends SandboxCommandIdentity {
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
  readonly requires?: readonly SandboxCapability[];
  readonly provides?: readonly SandboxCapability[];
}

const STABLE_SANDBOX_COMMAND: unique symbol = Symbol("niceeval.sandbox.command.stable");
const STABLE_SANDBOX_COMMANDS = new WeakSet<object>();
const SANDBOX_COMMAND_IDENTITIES = new WeakMap<object, SandboxCommandIdentity>();
const SANDBOX_COMMAND_METADATA = new WeakMap<object, SandboxCommandMetadata>();
const SANDBOX_COMMAND_PLANS = new WeakMap<object, SandboxCommandPlanNode>();

export interface SandboxCommandMetadata {
  readonly scheduling: NormalizedSandboxBeforeMetadata;
  /** Public defineSandboxCommand ids are occurrence ids; built-in factories need linker-scoped ids. */
  readonly explicitId: boolean;
}

export interface StableSandboxCommand extends SandboxCommand {
  readonly [STABLE_SANDBOX_COMMAND]: true;
}

/**
 * `niceeval debug` 能证明的声明式命令。这里只保存执行闭包已经消费的同一份规范化数据；
 * 普通 `defineSandboxCommand(identity, run)` 不会因为 identity 看起来像内建 id 就获得计划。
 */
export type SandboxCommandPlanRedaction =
  | "env-values"
  | "header-values"
  | "stdin"
  | "sensitive-values"
  | "command";

export type SandboxCommandPlanCommand =
  | {
      readonly kind: "argv";
      readonly executable: string;
      readonly args: readonly string[];
      readonly cwd?: string;
      readonly user?: string;
      readonly timeoutMs?: number;
      readonly envKeys?: readonly string[];
    }
  | {
      readonly kind: "shell";
      readonly script: string;
      readonly cwd?: string;
      readonly user?: string;
      readonly timeoutMs?: number;
      readonly envKeys?: readonly string[];
    };

export interface SandboxCommandPlanCondition {
  readonly code: string;
  readonly summary: string;
}

interface SandboxCommandPlanNodeBase {
  readonly label?: string;
  readonly condition?: SandboxCommandPlanCondition;
}

export type SandboxCommandPlanNode =
  | (SandboxCommandPlanNodeBase & {
      readonly truth: "exact";
      readonly command: SandboxCommandPlanCommand;
      readonly redactions?: readonly SandboxCommandPlanRedaction[];
    })
  | (SandboxCommandPlanNodeBase & {
      readonly truth: "conditional";
      readonly children: readonly SandboxCommandPlanNode[];
    })
  | (SandboxCommandPlanNodeBase & {
      readonly truth: "opaque";
      readonly reason: { readonly code: string; readonly summary: string };
    })
  | (SandboxCommandPlanNodeBase & {
      readonly truth: "known-no-command";
      readonly reason?: { readonly code: string; readonly summary: string };
    });

export type SandboxCommandDeclaration =
  | {
      readonly kind: "stable";
      readonly command: StableSandboxCommand;
      readonly identity: SandboxCommandIdentity;
      readonly metadata: SandboxCommandMetadata;
    }
  | { readonly kind: "opaque"; readonly command: SandboxCommand };

const STABLE_COMMAND_KEYS = new Set(["cwd", "env", "user", "timeoutMs", "stdin"]);

function assertRecord(value: unknown, path: string): asserts value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertOnlyKeys(value: globalThis.Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function normalizeCommandOptions(value: unknown, path: string): Readonly<SandboxCommandOptions> {
  if (value === undefined) return Object.freeze({});
  assertRecord(value, path);
  assertOnlyKeys(value, STABLE_COMMAND_KEYS, path);

  const normalized: {
    cwd?: string;
    env?: Readonly<globalThis.Record<string, string>>;
    user?: string;
    timeoutMs?: number;
    stdin?: string;
  } = {};

  if (value.cwd !== undefined) normalized.cwd = nonEmptyString(value.cwd, `${path}.cwd`);
  if (value.user !== undefined) normalized.user = nonEmptyString(value.user, `${path}.user`);
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0) {
      throw new TypeError(`${path}.timeoutMs must be a positive finite number`);
    }
    normalized.timeoutMs = value.timeoutMs;
  }
  if (value.stdin !== undefined) {
    if (typeof value.stdin !== "string") throw new TypeError(`${path}.stdin must be a string`);
    normalized.stdin = value.stdin;
  }
  if (value.env !== undefined) {
    assertRecord(value.env, `${path}.env`);
    const env = Object.create(null) as globalThis.Record<string, string>;
    for (const [key, child] of Object.entries(value.env)) {
      if (typeof child !== "string") throw new TypeError(`${path}.env.${key} must be a string`);
      env[key] = child;
    }
    normalized.env = Object.freeze(env);
  }

  return Object.freeze(normalized);
}

function cloneIdentityValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): SandboxCommandIdentityValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must not contain a non-finite number`);
    return value;
  }
  if (isRegisteredSandboxContent(value)) return value;
  if (typeof value !== "object") {
    throw new TypeError(`${path} must be pure identity data (no functions, undefined, symbols, or bigint)`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((child, index) => cloneIdentityValue(child, `${path}[${index}]`, ancestors)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain objects, arrays, scalars, or registered content`);
    }
    const result = Object.create(null) as globalThis.Record<string, SandboxCommandIdentityValue>;
    for (const [key, child] of Object.entries(value as globalThis.Record<string, unknown>)) {
      result[key] = cloneIdentityValue(child, `${path}.${key}`, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function normalizeIdentity(value: unknown, allowScheduling: boolean): Readonly<SandboxCommandIdentity> {
  assertRecord(value, "defineSandboxCommand identity");
  assertOnlyKeys(
    value,
    allowScheduling
      ? new Set(["id", "revision", "inputs", "changeFrequency", "dependsOn", "requires", "provides"])
      : new Set(["id", "revision", "inputs"]),
    "defineSandboxCommand identity",
  );
  return Object.freeze({
    id: nonEmptyString(value.id, "defineSandboxCommand identity.id"),
    revision: nonEmptyString(value.revision, "defineSandboxCommand identity.revision"),
    inputs: cloneIdentityValue(value.inputs, "defineSandboxCommand identity.inputs", new WeakSet()),
  });
}

function normalizeCommandMetadata(value: SandboxCommandDefinition): NormalizedSandboxBeforeMetadata {
  return normalizeSandboxBeforeMetadata({
    id: value.id,
    ...(value.changeFrequency === undefined ? {} : { changeFrequency: value.changeFrequency }),
    ...(value.dependsOn === undefined ? {} : { dependsOn: value.dependsOn }),
    ...(value.requires === undefined ? {} : { requires: value.requires }),
    ...(value.provides === undefined ? {} : { provides: value.provides }),
  }, "defineSandboxCommand identity");
}

export function defineSandboxCommand(
  identity: SandboxCommandDefinition,
  run: SandboxCommand,
): StableSandboxCommand {
  return defineStableSandboxCommand(identity, run, true);
}

/** @internal 内建命令用它把执行与预览绑定到同一个 factory 产物；不从公开 identity 反推。 */
export function definePlannedSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
  plan: SandboxCommandPlanNode,
): StableSandboxCommand {
  return defineStableSandboxCommand(identity, run, false, freezePlanNode(plan));
}

function defineStableSandboxCommand(
  identity: SandboxCommandDefinition,
  run: SandboxCommand,
  explicitId: boolean,
  plan?: SandboxCommandPlanNode,
): StableSandboxCommand {
  if (typeof run !== "function") throw new TypeError("defineSandboxCommand run must be a function");
  const normalized = normalizeIdentity(identity, explicitId);
  const metadata = normalizeCommandMetadata(identity);
  const stable = (async (sandbox: SandboxCommandTarget, context: SandboxCommandContext): Promise<void> => {
    await run(sandbox, context);
  }) as StableSandboxCommand;
  Object.defineProperties(stable, {
    [STABLE_SANDBOX_COMMAND]: { value: true },
  });
  STABLE_SANDBOX_COMMANDS.add(stable);
  SANDBOX_COMMAND_IDENTITIES.set(stable, normalized);
  SANDBOX_COMMAND_METADATA.set(stable, Object.freeze({ scheduling: metadata, explicitId }));
  if (plan !== undefined) SANDBOX_COMMAND_PLANS.set(stable, plan);
  return Object.freeze(stable);
}

function freezePlanNode(node: SandboxCommandPlanNode): SandboxCommandPlanNode {
  const condition = node.condition === undefined ? {} : { condition: Object.freeze({ ...node.condition }) };
  const label = node.label === undefined ? {} : { label: node.label };
  if (node.truth === "exact") {
    const command = node.command.kind === "argv"
      ? Object.freeze({
          ...node.command,
          args: Object.freeze([...node.command.args]),
          ...(node.command.envKeys === undefined ? {} : { envKeys: Object.freeze([...node.command.envKeys]) }),
        })
      : Object.freeze({
          ...node.command,
          ...(node.command.envKeys === undefined ? {} : { envKeys: Object.freeze([...node.command.envKeys]) }),
        });
    return Object.freeze({
      truth: "exact" as const,
      ...label,
      ...condition,
      command,
      ...(node.redactions === undefined ? {} : { redactions: Object.freeze([...node.redactions]) }),
    });
  }
  if (node.truth === "conditional") {
    return Object.freeze({
      truth: "conditional" as const,
      ...label,
      ...condition,
      children: Object.freeze(node.children.map(freezePlanNode)),
    });
  }
  if (node.truth === "opaque") {
    return Object.freeze({
      truth: "opaque" as const,
      ...label,
      ...condition,
      reason: Object.freeze({ ...node.reason }),
    });
  }
  return Object.freeze({
    truth: "known-no-command" as const,
    ...label,
    ...condition,
    ...(node.reason === undefined ? {} : { reason: Object.freeze({ ...node.reason }) }),
  });
}

function planOptions(options: Readonly<SandboxCommandOptions>): {
  readonly cwd?: string;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly envKeys?: readonly string[];
  readonly redactions?: readonly SandboxCommandPlanRedaction[];
} {
  const envKeys = options.env === undefined ? undefined : Object.freeze(Object.keys(options.env));
  const redactions: SandboxCommandPlanRedaction[] = [];
  if (envKeys !== undefined && envKeys.length > 0) redactions.push("env-values");
  if (options.stdin !== undefined) redactions.push("stdin");
  return Object.freeze({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.user === undefined ? {} : { user: options.user }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(envKeys === undefined || envKeys.length === 0 ? {} : { envKeys }),
    ...(redactions.length === 0 ? {} : { redactions: Object.freeze(redactions) }),
  });
}

interface ExecActionPayload {
  readonly executable: string;
  readonly argsJson: string;
  readonly cwd: string;
  readonly hasCwd: boolean;
  readonly envJson: string;
  readonly user: string;
  readonly hasUser: boolean;
  readonly timeoutMs: number;
  readonly hasTimeout: boolean;
  readonly stdin: string;
  readonly hasStdin: boolean;
  readonly declaredInputsJson: string;
}

const execActionPayloadSchema = Schema.Struct({
  executable: Schema.String,
  argsJson: Schema.String,
  cwd: Schema.String,
  hasCwd: Schema.Boolean,
  envJson: Schema.String,
  user: Schema.String,
  hasUser: Schema.Boolean,
  timeoutMs: Schema.Number,
  hasTimeout: Schema.Boolean,
  stdin: Schema.String,
  hasStdin: Schema.Boolean,
  declaredInputsJson: Schema.String,
});

const execActionCanonicalInputSchema = Schema.Struct({
  executable: Schema.String,
  argsJson: Schema.String,
  cwd: Schema.String,
  hasCwd: Schema.Boolean,
  envKeysJson: Schema.String,
  envDigest: Schema.String,
  hasEnv: Schema.Boolean,
  user: Schema.String,
  hasUser: Schema.Boolean,
  timeoutMs: Schema.Number,
  hasTimeout: Schema.Boolean,
  stdinDigest: Schema.String,
  stdinBytes: Schema.Number,
  hasStdin: Schema.Boolean,
  declaredInputsJson: Schema.String,
});

/**
 * The action's Type side retains the bytes needed by the runtime while its Encoded side is the
 * public/debug projection used by defineSandboxAction. Automatic identity still includes the
 * private step payload, so redacting this projection cannot create a false cache hit.
 */
const execActionInputSchema = Schema.transform(
  execActionCanonicalInputSchema,
  execActionPayloadSchema,
  {
    decode: (input) => ({
      executable: input.executable,
      argsJson: input.argsJson,
      cwd: input.cwd,
      hasCwd: input.hasCwd,
      envJson: "",
      user: input.user,
      hasUser: input.hasUser,
      timeoutMs: input.timeoutMs,
      hasTimeout: input.hasTimeout,
      stdin: "",
      hasStdin: input.hasStdin,
      declaredInputsJson: input.declaredInputsJson,
    }),
    encode: (_input, payload) => {
      const env = payload.envJson === ""
        ? undefined
        : JSON.parse(payload.envJson) as globalThis.Record<string, string>;
      return {
        executable: payload.executable,
        argsJson: payload.argsJson,
        cwd: payload.cwd,
        hasCwd: payload.hasCwd,
        envKeysJson: JSON.stringify(env === undefined ? [] : Object.keys(env)),
        envDigest: env === undefined ? "" : `sha256:${digestOf(env)}`,
        hasEnv: env !== undefined,
        user: payload.user,
        hasUser: payload.hasUser,
        timeoutMs: payload.timeoutMs,
        hasTimeout: payload.hasTimeout,
        stdinDigest: payload.hasStdin ? `sha256:${digestBytes(payload.stdin)}` : "",
        stdinBytes: payload.hasStdin ? Buffer.byteLength(payload.stdin) : 0,
        hasStdin: payload.hasStdin,
        declaredInputsJson: payload.declaredInputsJson,
      };
    },
  },
);

function execOptionsFromPayload(input: ExecActionPayload): SandboxCommandOptions {
  return Object.freeze({
    ...(input.hasCwd ? { cwd: input.cwd } : {}),
    ...(input.envJson === "" ? {} : { env: JSON.parse(input.envJson) as globalThis.Record<string, string> }),
    ...(input.hasUser ? { user: input.user } : {}),
    ...(input.hasTimeout ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.hasStdin ? { stdin: input.stdin } : {}),
  });
}

const commandActionFamily = defineSandboxAction({
  id: "niceeval.sandbox.command",
  input: execActionInputSchema,
  steps: (input) => [sandboxStep.exec({
    executable: input.executable,
    args: JSON.parse(input.argsJson) as string[],
    ...execOptionsFromPayload(input),
  })] as const,
});

const shellActionFamily = defineSandboxAction({
  id: "niceeval.sandbox.shell",
  input: execActionInputSchema,
  steps: (input) => [sandboxStep.exec({
    executable: "/bin/sh",
    args: ["-lc", input.executable],
    ...execOptionsFromPayload(input),
  })] as const,
});

const INLINE_SCHEDULING_KEYS = ["id", "changeFrequency", "dependsOn", "requires", "provides", "cache"] as const;
const INLINE_EXEC_KEYS = ["cwd", "env", "user", "timeoutMs", "stdin"] as const;

function pickExecOptions(value: globalThis.Record<string, unknown>): SandboxCommandOptions {
  return {
    ...(value.cwd === undefined ? {} : { cwd: value.cwd as string }),
    ...(value.env === undefined ? {} : { env: value.env as Readonly<globalThis.Record<string, string>> }),
    ...(value.user === undefined ? {} : { user: value.user as string }),
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }),
    ...(value.stdin === undefined ? {} : { stdin: value.stdin as string }),
  };
}

function normalizeInlineOptions(
  value: unknown,
  path: string,
  payloadKeys: readonly string[],
  after: boolean,
): {
  readonly id: string;
  readonly exec: Readonly<SandboxCommandOptions>;
  readonly scheduling?: SandboxActionInstanceOptions;
} {
  assertRecord(value, path);
  assertOnlyKeys(
    value,
    new Set(after
      ? ["id", ...INLINE_EXEC_KEYS, ...payloadKeys]
      : [...INLINE_SCHEDULING_KEYS, ...INLINE_EXEC_KEYS, ...payloadKeys]),
    path,
  );
  const id = nonEmptyString(value.id, `${path}.id`);
  const exec = normalizeCommandOptions(pickExecOptions(value), `${path} execution options`);
  if (after) return Object.freeze({ id, exec });
  normalizeSandboxBeforeMetadata({
    id,
    ...(value.changeFrequency === undefined ? {} : { changeFrequency: value.changeFrequency }),
    ...(value.dependsOn === undefined ? {} : { dependsOn: value.dependsOn }),
    ...(value.requires === undefined ? {} : { requires: value.requires }),
    ...(value.provides === undefined ? {} : { provides: value.provides }),
    ...(value.cache === undefined ? {} : { cache: value.cache }),
  }, path);
  const scheduling: SandboxActionInstanceOptions = Object.freeze({
    id,
    ...(value.changeFrequency === undefined ? {} : { changeFrequency: value.changeFrequency as number }),
    ...(value.dependsOn === undefined ? {} : { dependsOn: value.dependsOn as readonly SandboxActionRef[] }),
    ...(value.requires === undefined ? {} : { requires: value.requires as readonly SandboxCapability[] }),
    ...(value.provides === undefined ? {} : { provides: value.provides as readonly SandboxCapability[] }),
    ...(value.cache === undefined
      ? {}
      : { cache: value.cache as SandboxActionInstanceOptions["cache"] }),
  });
  return Object.freeze({ id, exec, scheduling });
}

function execPayload(
  executable: string,
  args: readonly string[],
  options: Readonly<SandboxCommandOptions>,
  declaredInputs: readonly RegisteredSandboxContent[] = [],
): ExecActionPayload {
  const env = options.env === undefined
    ? ""
    : JSON.stringify(Object.fromEntries(Object.entries(options.env).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0)));
  return Object.freeze({
    executable,
    argsJson: JSON.stringify(args),
    cwd: options.cwd ?? "",
    hasCwd: options.cwd !== undefined,
    envJson: env,
    user: options.user ?? "",
    hasUser: options.user !== undefined,
    timeoutMs: options.timeoutMs ?? 0,
    hasTimeout: options.timeoutMs !== undefined,
    stdin: options.stdin ?? "",
    hasStdin: options.stdin !== undefined,
    declaredInputsJson: JSON.stringify(declaredInputs.map((content) => ({
      kind: content.kind,
      digest: content.digest,
    })).sort((left, right) => left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0)),
  });
}

function declaredShellInputs(value: unknown, path: string): readonly RegisteredSandboxContent[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((entry) => !isRegisteredSandboxContent(entry))) {
    throw new TypeError(`${path} must contain registerSandboxContent() handles`);
  }
  return Object.freeze([...value]);
}

function legacyCommand(
  executable: string,
  args: readonly string[] = [],
  options?: SandboxCommandOptions,
): StableSandboxCommand {
  const normalizedExecutable = nonEmptyString(executable, "command executable");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("command args must be an array of strings");
  }
  const normalizedArgs = Object.freeze([...args]);
  const normalizedOptions = normalizeCommandOptions(options, "command options");
  const preview = planOptions(normalizedOptions);
  return definePlannedSandboxCommand(
    {
      id: "niceeval.sandbox.command",
      revision: "1",
      inputs: {
        executable: normalizedExecutable,
        args: normalizedArgs,
        options: normalizedOptions as SandboxCommandIdentityValue,
      },
    },
    async (sandbox) => {
      await sandbox.runCommandOrThrow(normalizedExecutable, normalizedArgs, normalizedOptions);
    },
    {
      truth: "exact",
      command: {
        kind: "argv",
        executable: normalizedExecutable,
        args: normalizedArgs,
        ...(preview.cwd === undefined ? {} : { cwd: preview.cwd }),
        ...(preview.user === undefined ? {} : { user: preview.user }),
        ...(preview.timeoutMs === undefined ? {} : { timeoutMs: preview.timeoutMs }),
        ...(preview.envKeys === undefined ? {} : { envKeys: preview.envKeys }),
      },
      ...(preview.redactions === undefined ? {} : { redactions: preview.redactions }),
    },
  );
}

function legacyShell(script: string, options?: SandboxCommandOptions): StableSandboxCommand {
  if (typeof script !== "string") throw new TypeError("shell script must be a string");
  const normalizedOptions = normalizeCommandOptions(options, "shell options");
  const preview = planOptions(normalizedOptions);
  return definePlannedSandboxCommand(
    {
      id: "niceeval.sandbox.shell",
      revision: "1",
      inputs: { script, options: normalizedOptions as SandboxCommandIdentityValue },
    },
    async (sandbox) => {
      await sandbox.runShellOrThrow(script, normalizedOptions);
    },
    {
      truth: "exact",
      command: {
        kind: "shell",
        script,
        ...(preview.cwd === undefined ? {} : { cwd: preview.cwd }),
        ...(preview.user === undefined ? {} : { user: preview.user }),
        ...(preview.timeoutMs === undefined ? {} : { timeoutMs: preview.timeoutMs }),
        ...(preview.envKeys === undefined ? {} : { envKeys: preview.envKeys }),
      },
      ...(preview.redactions === undefined ? {} : { redactions: preview.redactions }),
    },
  );
}

const commandImpl = (function (
  executable: string,
  args: readonly string[] = [],
  options?: SandboxCommandOptions | CommandActionOptions,
): StableSandboxCommand | SandboxAction {
  if (
    options !== undefined &&
    typeof options === "object" &&
    Object.prototype.hasOwnProperty.call(options, "id")
  ) {
    const normalizedExecutable = nonEmptyString(executable, "command executable");
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new TypeError("command args must be an array of strings");
    }
    const normalized = normalizeInlineOptions(options, "command options", [], false);
    return commandActionFamily(
      execPayload(normalizedExecutable, Object.freeze([...args]), normalized.exec),
      normalized.scheduling,
    );
  }
  return legacyCommand(executable, args, options);
}) as CommandActionFactory;
Object.defineProperty(commandImpl, "after", {
  value: (
    executable: string,
    args: readonly string[],
    options: CommandAfterActionOptions,
  ): SandboxAfterAction => {
    const normalizedExecutable = nonEmptyString(executable, "command.after executable");
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new TypeError("command.after args must be an array of strings");
    }
    const normalized = normalizeInlineOptions(options, "command.after options", [], true);
    return commandActionFamily.after(
      execPayload(normalizedExecutable, Object.freeze([...args]), normalized.exec),
      { id: normalized.id },
    );
  },
});
export const command = Object.freeze(commandImpl);

const shellImpl = (function (
  input: string | ShellActionInput,
  legacyOptions?: SandboxCommandOptions,
): StableSandboxCommand | SandboxAction {
  if (typeof input === "string") return legacyShell(input, legacyOptions);
  const normalized = normalizeInlineOptions(input, "shell input", ["command", "inputs"], false);
  const script = nonEmptyString(input.command, "shell input.command");
  const inputs = declaredShellInputs(input.inputs, "shell input.inputs");
  return shellActionFamily(execPayload(script, [], normalized.exec, inputs), normalized.scheduling);
}) as ShellActionFactory;
Object.defineProperty(shellImpl, "after", {
  value: (input: ShellAfterActionInput): SandboxAfterAction => {
    const normalized = normalizeInlineOptions(input, "shell.after input", ["command", "inputs"], true);
    const script = nonEmptyString(input.command, "shell.after input.command");
    const inputs = declaredShellInputs(input.inputs, "shell.after input.inputs");
    return shellActionFamily.after(
      execPayload(script, [], normalized.exec, inputs),
      { id: normalized.id },
    );
  },
});
export const shell = Object.freeze(shellImpl);

export function sandboxCommandDeclarationOf(command: SandboxCommand): SandboxCommandDeclaration {
  if (typeof command !== "function") throw new TypeError("SandboxLayer.before requires an Action or command function");
  const identity = SANDBOX_COMMAND_IDENTITIES.get(command as object);
  if (STABLE_SANDBOX_COMMANDS.has(command as object) && identity !== undefined) {
    const metadata = SANDBOX_COMMAND_METADATA.get(command as object);
    if (metadata === undefined) throw new TypeError("Stable Sandbox command metadata is missing");
    return Object.freeze({
      kind: "stable" as const,
      command: command as StableSandboxCommand,
      identity,
      metadata,
    });
  }
  return Object.freeze({ kind: "opaque" as const, command });
}

export function sandboxCommandMetadataOf(command: SandboxCommand): SandboxCommandMetadata | undefined {
  return SANDBOX_COMMAND_METADATA.get(command as object);
}

/** @internal Layer dispatches by the private factory brand, never by function shape or identity fields. */
export function isStableSandboxCommand(value: unknown): value is StableSandboxCommand {
  return typeof value === "function" && STABLE_SANDBOX_COMMANDS.has(value as object);
}

export function sandboxCommandIdentityOf(command: SandboxCommand): SandboxCommandIdentity | undefined {
  const declaration = sandboxCommandDeclarationOf(command);
  return declaration.kind === "stable" ? declaration.identity : undefined;
}

/** @internal 只读 factory 私有品牌；未知 stable command 仍是 opaque，绝不按 identity 猜。 */
export function sandboxCommandPlanOf(command: SandboxCommand): SandboxCommandPlanNode | undefined {
  return SANDBOX_COMMAND_PLANS.get(command as object);
}

/** Link/fingerprint 层可把 identity 投影成普通 JSON；content handle 只暴露 kind + digest。 */
export function sandboxCommandIdentityJson(value: SandboxCommandIdentityValue): JsonValue {
  if (isRegisteredSandboxContent(value)) return { kind: value.kind, digest: value.digest };
  if (Array.isArray(value)) return value.map((child) => sandboxCommandIdentityJson(child));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sandboxCommandIdentityJson(child)]),
    );
  }
  return value;
}
