// SandboxLayer 的准备命令声明与稳定身份。
// 这里只描述作者面与供后续 linker/runner 消费的纯数据，不负责调度或生命周期执行。

import type { DiagnosticInput, JsonValue } from "../shared/types.ts";
import type { SandboxOperations } from "./types.ts";
import { isRegisteredSandboxContent, type RegisteredSandboxContent } from "./content.ts";

export type MaybePromise<T> = T | Promise<T>;

export interface SandboxCommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

/**
 * prepare callback 取得的窄 Sandbox 视图。它没有 stop、宿主传输或 Provider-native SDK。
 */
export interface SandboxCommandTarget extends SandboxOperations {
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
export type SandboxFactsWriter = (key: string, value: string | number | boolean) => void;

export type SandboxCleanupCommand = (
  sandbox: SandboxCommandTarget,
  context: Omit<SandboxCommandContext, "onCleanup">,
) => MaybePromise<void>;

export interface SandboxCommandContext {
  readonly phase: "prepare" | "agent.post-setup" | "agent.pre-teardown";
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
  readonly facts: SandboxFactsWriter;
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

const STABLE_SANDBOX_COMMAND: unique symbol = Symbol("niceeval.sandbox.command.stable");
const STABLE_SANDBOX_COMMANDS = new WeakSet<object>();
const SANDBOX_COMMAND_IDENTITIES = new WeakMap<object, SandboxCommandIdentity>();
const SANDBOX_COMMAND_PLANS = new WeakMap<object, SandboxCommandPlanNode>();

export interface StableSandboxCommand extends SandboxCommand {
  readonly [STABLE_SANDBOX_COMMAND]: true;
}

/**
 * `--dry --commands` 能证明的声明式命令。这里只保存执行闭包已经消费的同一份规范化数据；
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
    const env: globalThis.Record<string, string> = {};
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
    const result: globalThis.Record<string, SandboxCommandIdentityValue> = {};
    for (const [key, child] of Object.entries(value as globalThis.Record<string, unknown>)) {
      result[key] = cloneIdentityValue(child, `${path}.${key}`, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function normalizeIdentity(value: unknown): Readonly<SandboxCommandIdentity> {
  assertRecord(value, "defineSandboxCommand identity");
  assertOnlyKeys(value, new Set(["id", "revision", "inputs"]), "defineSandboxCommand identity");
  return Object.freeze({
    id: nonEmptyString(value.id, "defineSandboxCommand identity.id"),
    revision: nonEmptyString(value.revision, "defineSandboxCommand identity.revision"),
    inputs: cloneIdentityValue(value.inputs, "defineSandboxCommand identity.inputs", new WeakSet()),
  });
}

export function defineSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
): StableSandboxCommand {
  return defineStableSandboxCommand(identity, run);
}

/** @internal 内建命令用它把执行与预览绑定到同一个 factory 产物；不从公开 identity 反推。 */
export function definePlannedSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
  plan: SandboxCommandPlanNode,
): StableSandboxCommand {
  return defineStableSandboxCommand(identity, run, freezePlanNode(plan));
}

function defineStableSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
  plan?: SandboxCommandPlanNode,
): StableSandboxCommand {
  if (typeof run !== "function") throw new TypeError("defineSandboxCommand run must be a function");
  const normalized = normalizeIdentity(identity);
  const stable = (async (sandbox: SandboxCommandTarget, context: SandboxCommandContext): Promise<void> => {
    await run(sandbox, context);
  }) as StableSandboxCommand;
  Object.defineProperties(stable, {
    [STABLE_SANDBOX_COMMAND]: { value: true },
  });
  STABLE_SANDBOX_COMMANDS.add(stable);
  SANDBOX_COMMAND_IDENTITIES.set(stable, normalized);
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

export function command(
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

export function shell(script: string, options?: SandboxCommandOptions): StableSandboxCommand {
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

export function sandboxCommandDeclarationOf(command: SandboxCommand): SandboxCommandDeclaration {
  if (typeof command !== "function") throw new TypeError("SandboxLayer.prepare requires a command function");
  const identity = SANDBOX_COMMAND_IDENTITIES.get(command as object);
  if (STABLE_SANDBOX_COMMANDS.has(command as object) && identity !== undefined) {
    return Object.freeze({
      kind: "stable" as const,
      command: command as StableSandboxCommand,
      identity,
    });
  }
  return Object.freeze({ kind: "opaque" as const, command });
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
