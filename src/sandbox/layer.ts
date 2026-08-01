// SandboxLayer 作者声明面：私有 kind 品牌、不可变 prepare 链与 template factory 纯数据。
// Link、Provider planning、fingerprint 和 Attempt 生命周期由后续接线消费本模块的内部 state。

import {
  sandboxCommandDeclarationOf,
  type SandboxCommand,
  type SandboxCommandDeclaration,
} from "./commands.ts";

export type SandboxLayerKind = "template-bearing" | "command-only";

const SANDBOX_LAYER: unique symbol = Symbol.for("niceeval.sandbox.layer");
const SANDBOX_LAYER_STATE: unique symbol = Symbol.for("niceeval.sandbox.layer.state");

export interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly [SANDBOX_LAYER]: Kind;
  prepare(command: SandboxCommand): SandboxLayer<Kind>;
}

export interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly executionUser?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
}

export interface DockerfileSandboxOptions {
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
}

export interface DockerImageSandboxOptions {
  readonly image: string;
}

export interface E2BSandboxOptions {
  readonly template: string;
  readonly lifetimeMs?: number;
}

export interface VercelSandboxOptions {
  readonly snapshotId: string;
  readonly lifetimeMs?: number;
}

export interface LocalSandboxOptions {
  readonly dir?: string;
}

export type SandboxLocation =
  | { readonly kind: "path"; readonly value: string }
  | { readonly kind: "url"; readonly value: string };

/** 纯数据 template contribution；只供 linker/provider planner 内部消费。 */
export type SandboxTemplateDeclaration =
  | {
      readonly provider: "docker";
      readonly kind: "compose";
      readonly file: SandboxLocation;
      readonly workspaceService: string;
      readonly build?: "on-demand" | "prebuilt";
      readonly executionUser?: string;
      readonly env?: Readonly<globalThis.Record<string, string>>;
    }
  | {
      readonly provider: "docker";
      readonly kind: "dockerfile";
      readonly context: SandboxLocation;
      readonly dockerfile?: string;
      readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
    }
  | { readonly provider: "docker"; readonly kind: "image"; readonly image: string }
  | {
      readonly provider: "e2b";
      readonly kind: "template";
      readonly template: string;
      readonly lifetimeMs?: number;
    }
  | {
      readonly provider: "vercel";
      readonly kind: "snapshot";
      readonly snapshotId: string;
      readonly lifetimeMs?: number;
    }
  | { readonly provider: "local"; readonly kind: "directory"; readonly dir?: string };

export interface SandboxLayerState<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly kind: Kind;
  readonly template: Kind extends "template-bearing" ? SandboxTemplateDeclaration : undefined;
  readonly commands: readonly SandboxCommandDeclaration[];
}

type SandboxLayerRuntime<Kind extends SandboxLayerKind> = SandboxLayer<Kind> & {
  readonly [SANDBOX_LAYER_STATE]: SandboxLayerState<Kind>;
};

function assertRecord(value: unknown, path: string): asserts value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertOnlyKeys(value: globalThis.Record<string, unknown>, allowed: readonly string[], path: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function location(value: unknown, path: string): SandboxLocation {
  if (value instanceof URL) return Object.freeze({ kind: "url" as const, value: value.href });
  return Object.freeze({ kind: "path" as const, value: nonEmptyString(value, path) });
}

function optionalPositiveMs(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return value;
}

function stringRecord(value: unknown, path: string): Readonly<globalThis.Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, path);
  const result: globalThis.Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "") throw new TypeError(`${path} keys must be non-empty strings`);
    if (typeof child !== "string") throw new TypeError(`${path}.${key} must be a string`);
    result[key] = child;
  }
  return Object.freeze(result);
}

function createLayer<Kind extends SandboxLayerKind>(
  kind: Kind,
  template: Kind extends "template-bearing" ? SandboxTemplateDeclaration : undefined,
  commands: readonly SandboxCommandDeclaration[] = [],
): SandboxLayer<Kind> {
  const frozenCommands = Object.freeze([...commands]);
  const state = Object.freeze({ kind, template, commands: frozenCommands }) as SandboxLayerState<Kind>;
  const layer = {
    prepare(command: SandboxCommand): SandboxLayer<Kind> {
      const declaration = sandboxCommandDeclarationOf(command);
      return createLayer(kind, template, [...frozenCommands, declaration]);
    },
  } as SandboxLayerRuntime<Kind>;
  Object.defineProperties(layer, {
    [SANDBOX_LAYER]: { value: kind },
    [SANDBOX_LAYER_STATE]: { value: state },
  });
  return Object.freeze(layer);
}

export function sandboxLayer(): SandboxLayer<"command-only"> {
  return createLayer("command-only", undefined);
}

export function dockerComposeSandbox(
  options: DockerComposeSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "dockerComposeSandbox options");
  assertOnlyKeys(
    options,
    ["file", "workspaceService", "build", "executionUser", "env"],
    "dockerComposeSandbox options",
  );
  if (options.build !== undefined && options.build !== "on-demand" && options.build !== "prebuilt") {
    throw new TypeError('dockerComposeSandbox options.build must be "on-demand" or "prebuilt"');
  }
  const env = stringRecord(options.env, "dockerComposeSandbox options.env");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "docker",
    kind: "compose",
    file: location(options.file, "dockerComposeSandbox options.file"),
    workspaceService: nonEmptyString(
      options.workspaceService,
      "dockerComposeSandbox options.workspaceService",
    ),
    ...(options.build !== undefined ? { build: options.build } : {}),
    ...(options.executionUser !== undefined
      ? { executionUser: nonEmptyString(options.executionUser, "dockerComposeSandbox options.executionUser") }
      : {}),
    ...(env !== undefined ? { env } : {}),
  });
  return createLayer("template-bearing", template);
}

export function dockerfileSandbox(
  options: DockerfileSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "dockerfileSandbox options");
  assertOnlyKeys(options, ["context", "dockerfile", "buildArgs"], "dockerfileSandbox options");
  const buildArgs = stringRecord(options.buildArgs, "dockerfileSandbox options.buildArgs");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "docker",
    kind: "dockerfile",
    context: location(options.context, "dockerfileSandbox options.context"),
    ...(options.dockerfile !== undefined
      ? { dockerfile: nonEmptyString(options.dockerfile, "dockerfileSandbox options.dockerfile") }
      : {}),
    ...(buildArgs !== undefined ? { buildArgs } : {}),
  });
  return createLayer("template-bearing", template);
}

export function dockerImageSandbox(
  options: DockerImageSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "dockerImageSandbox options");
  assertOnlyKeys(options, ["image"], "dockerImageSandbox options");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "docker",
    kind: "image",
    image: nonEmptyString(options.image, "dockerImageSandbox options.image"),
  });
  return createLayer("template-bearing", template);
}

export function e2bSandbox(options: E2BSandboxOptions): SandboxLayer<"template-bearing"> {
  assertRecord(options, "e2bSandbox options");
  assertOnlyKeys(options, ["template", "lifetimeMs"], "e2bSandbox options");
  const lifetimeMs = optionalPositiveMs(options.lifetimeMs, "e2bSandbox options.lifetimeMs");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "e2b",
    kind: "template",
    template: nonEmptyString(options.template, "e2bSandbox options.template"),
    ...(lifetimeMs !== undefined ? { lifetimeMs } : {}),
  });
  return createLayer("template-bearing", template);
}

export function vercelSandbox(options: VercelSandboxOptions): SandboxLayer<"template-bearing"> {
  assertRecord(options, "vercelSandbox options");
  assertOnlyKeys(options, ["snapshotId", "lifetimeMs"], "vercelSandbox options");
  const lifetimeMs = optionalPositiveMs(options.lifetimeMs, "vercelSandbox options.lifetimeMs");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "vercel",
    kind: "snapshot",
    snapshotId: nonEmptyString(options.snapshotId, "vercelSandbox options.snapshotId"),
    ...(lifetimeMs !== undefined ? { lifetimeMs } : {}),
  });
  return createLayer("template-bearing", template);
}

export function localSandbox(options: LocalSandboxOptions = {}): SandboxLayer<"template-bearing"> {
  assertRecord(options, "localSandbox options");
  assertOnlyKeys(options, ["dir"], "localSandbox options");
  const template: SandboxTemplateDeclaration = Object.freeze({
    provider: "local",
    kind: "directory",
    ...(options.dir !== undefined
      ? { dir: nonEmptyString(options.dir, "localSandbox options.dir") }
      : {}),
  });
  return createLayer("template-bearing", template);
}

export function isSandboxLayer(value: unknown): value is SandboxLayer {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<SandboxLayerRuntime<SandboxLayerKind>>;
  const kind = candidate[SANDBOX_LAYER];
  const state = candidate[SANDBOX_LAYER_STATE];
  return (
    (kind === "command-only" || kind === "template-bearing") &&
    state?.kind === kind &&
    Array.isArray(state.commands) &&
    typeof candidate.prepare === "function" &&
    (kind === "command-only" ? state.template === undefined : state.template !== undefined)
  );
}

/** 仅供 linker/fingerprint/runner 使用，不从 niceeval/sandbox 公开。 */
export function sandboxLayerStateOf<Kind extends SandboxLayerKind>(
  layer: SandboxLayer<Kind>,
): SandboxLayerState<Kind> {
  if (!isSandboxLayer(layer)) throw new TypeError("sandbox must be a SandboxLayer factory product");
  return (layer as SandboxLayerRuntime<Kind>)[SANDBOX_LAYER_STATE];
}
