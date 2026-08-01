// SandboxLayer 的准备命令声明与稳定身份。
// 这里只描述作者面与供后续 linker/runner 消费的纯数据，不负责调度或生命周期执行。

import type { DiagnosticInput, JsonValue } from "../shared/types.ts";
import type { CommandResult } from "./types.ts";
import { isRegisteredSandboxContent, type RegisteredSandboxContent } from "./content.ts";

export type MaybePromise<T> = T | Promise<T>;

export interface SandboxCommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly root?: boolean;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

/** Layer callback 可用的完整命令选项；stable helper 只接受其中可序列化的子集。 */
export interface SandboxCommandRunOptions extends SandboxCommandOptions {
  readonly stream?: boolean;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}

export interface SuccessfulCommandResult extends CommandResult {
  readonly exitCode: 0;
}

/**
 * prepare callback 取得的窄 Sandbox 视图。它没有 stop、宿主传输或 Provider-native SDK。
 * 当前文件只固定声明面；实际 wrapper 与 provider 适配由 operations 迁移接入。
 */
export interface SandboxCommandTarget {
  readonly workdir: string;
  runCommand(
    command: string,
    args?: readonly string[],
    options?: SandboxCommandRunOptions,
  ): Promise<CommandResult>;
  runShell(script: string, options?: SandboxCommandRunOptions): Promise<CommandResult>;
  runCommandOrThrow(
    command: string,
    args?: readonly string[],
    options?: SandboxCommandRunOptions,
  ): Promise<SuccessfulCommandResult>;
  runShellOrThrow(
    script: string,
    options?: SandboxCommandRunOptions,
  ): Promise<SuccessfulCommandResult>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  pathExists(path: string): Promise<boolean>;
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
  readonly phase: "prepare";
  readonly owner:
    | { readonly kind: "eval"; readonly id: string }
    | { readonly kind: "experiment"; readonly id: string };
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

const STABLE_SANDBOX_COMMAND: unique symbol = Symbol.for("niceeval.sandbox.command.stable");
const SANDBOX_COMMAND_IDENTITY: unique symbol = Symbol.for("niceeval.sandbox.command.identity");

export interface StableSandboxCommand extends SandboxCommand {
  readonly [STABLE_SANDBOX_COMMAND]: true;
}

export type SandboxCommandDeclaration =
  | {
      readonly kind: "stable";
      readonly command: StableSandboxCommand;
      readonly identity: SandboxCommandIdentity;
    }
  | { readonly kind: "opaque"; readonly command: SandboxCommand };

const STABLE_COMMAND_KEYS = new Set(["cwd", "env", "root", "timeoutMs", "stdin"]);

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
    root?: boolean;
    timeoutMs?: number;
    stdin?: string;
  } = {};

  if (value.cwd !== undefined) normalized.cwd = nonEmptyString(value.cwd, `${path}.cwd`);
  if (value.root !== undefined) {
    if (typeof value.root !== "boolean") throw new TypeError(`${path}.root must be a boolean`);
    normalized.root = value.root;
  }
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
  if (typeof run !== "function") throw new TypeError("defineSandboxCommand run must be a function");
  const normalized = normalizeIdentity(identity);
  const stable = (async (sandbox: SandboxCommandTarget, context: SandboxCommandContext): Promise<void> => {
    await run(sandbox, context);
  }) as StableSandboxCommand;
  Object.defineProperties(stable, {
    [STABLE_SANDBOX_COMMAND]: { value: true },
    [SANDBOX_COMMAND_IDENTITY]: { value: normalized },
  });
  return Object.freeze(stable);
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
  return defineSandboxCommand(
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
  );
}

export function shell(script: string, options?: SandboxCommandOptions): StableSandboxCommand {
  if (typeof script !== "string") throw new TypeError("shell script must be a string");
  const normalizedOptions = normalizeCommandOptions(options, "shell options");
  return defineSandboxCommand(
    {
      id: "niceeval.sandbox.shell",
      revision: "1",
      inputs: { script, options: normalizedOptions as SandboxCommandIdentityValue },
    },
    async (sandbox) => {
      await sandbox.runShellOrThrow(script, normalizedOptions);
    },
  );
}

export function sandboxCommandDeclarationOf(command: SandboxCommand): SandboxCommandDeclaration {
  if (typeof command !== "function") throw new TypeError("SandboxLayer.prepare requires a command function");
  const candidate = command as Partial<StableSandboxCommand> & {
    readonly [SANDBOX_COMMAND_IDENTITY]?: SandboxCommandIdentity;
  };
  if (candidate[STABLE_SANDBOX_COMMAND] === true && candidate[SANDBOX_COMMAND_IDENTITY] !== undefined) {
    return Object.freeze({
      kind: "stable" as const,
      command: command as StableSandboxCommand,
      identity: candidate[SANDBOX_COMMAND_IDENTITY],
    });
  }
  return Object.freeze({ kind: "opaque" as const, command });
}

export function sandboxCommandIdentityOf(command: SandboxCommand): SandboxCommandIdentity | undefined {
  const declaration = sandboxCommandDeclarationOf(command);
  return declaration.kind === "stable" ? declaration.identity : undefined;
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
