// 官方 prepare 命令:把常见的「检查→必要时执行→复检」收敛为稳定 SandboxCommand。
//
// 这里不认识 Layer、Provider 或复用调度。checkout/installTool 都只是普通 stable command:
// runner 仍按 owner 的 prepare 顺序执行它们。契约单源:
// docs/feature/sandbox/prepare-commands.md

import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  defineSandboxCommand,
  definePlannedSandboxCommand,
  sandboxCommandPlanOf,
  sandboxCommandIdentityOf,
  type SandboxCommandContext,
  type SandboxCommandIdentity,
  type SandboxCommandIdentityValue,
  type SandboxCommandPlanNode,
  type SandboxCommandTarget,
  type StableSandboxCommand,
} from "./commands.ts";
import { SandboxCommandExitError } from "./operations.ts";
import type { CommandResult } from "./types.ts";

export interface CheckoutOptions {
  /** Git remote;HTTP(S) URL 中的 userinfo / query / fragment 一律拒绝，凭据只走 Git 原生机制。 */
  readonly repo: string;
  /** commit SHA 或 tag 等 Git revision；运行时解析出的 commit SHA 会作为事实记录。 */
  readonly ref: string;
  /** 相对 workdir 的目标目录；省略或 `.` 就是 workdir 根。 */
  readonly into?: string;
}

export interface InstallToolOptions {
  /** 人可读、也进入 identity 的工具名；不从命令文本猜测。 */
  readonly tool: string;
  /** 作者声明的纯数据版本 / 来源 identity。 */
  readonly identity: SandboxCommandIdentityValue;
  /** 零退出表示命中；非零退出表示未命中。 */
  readonly probe: StableSandboxCommand;
  /** 只在 probe 未命中时执行。 */
  readonly install: StableSandboxCommand;
}

const CHECKOUT_CACHE_ROOT = "/tmp/niceeval-checkout-cache";
const CHECKOUT_FACT_PREFIX = "sandbox.checkout";

function assertPlainRecord(value: unknown, path: string): asserts value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`);
  }
}

function assertOnlyKeys(
  value: globalThis.Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(`${path} must not contain control characters`);
  }
  return value;
}

function normalizeRepo(value: unknown): string {
  const repo = nonEmptyString(value, "checkout options.repo");
  try {
    const url = new URL(repo);
    if (url.password || (url.protocol === "http:" || url.protocol === "https:") && url.username) {
      throw new TypeError(
        "checkout options.repo must not embed credentials; configure Git credentials in the host or Sandbox instead",
      );
    }
    if (url.search || url.hash) {
      throw new TypeError("checkout options.repo must not include a query or fragment");
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("checkout options.repo")) throw error;
    // SCP-style remotes (`git@host:owner/repo.git`) and local paths are valid Git remotes,
    // but are intentionally not URL-parsed.
  }
  return repo;
}

function normalizeInto(value: unknown): string {
  if (value === undefined) return ".";
  const into = nonEmptyString(value, "checkout options.into");
  if (posix.isAbsolute(into)) {
    throw new TypeError("checkout options.into must be relative to the Sandbox workdir");
  }
  const normalized = posix.normalize(into);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new TypeError("checkout options.into must not escape the Sandbox workdir");
  }
  return normalized;
}

function normalizeCheckoutOptions(value: unknown): Readonly<{ repo: string; ref: string; into: string }> {
  assertPlainRecord(value, "checkout options");
  assertOnlyKeys(value, new Set(["repo", "ref", "into"]), "checkout options");
  return Object.freeze({
    repo: normalizeRepo(value.repo),
    ref: nonEmptyString(value.ref, "checkout options.ref"),
    into: normalizeInto(value.into),
  });
}

function normalizeInstallToolOptions(value: unknown): Readonly<{
  tool: string;
  identity: SandboxCommandIdentityValue;
  probe: StableSandboxCommand;
  install: StableSandboxCommand;
  probeIdentity: SandboxCommandIdentity;
  installIdentity: SandboxCommandIdentity;
}> {
  assertPlainRecord(value, "installTool options");
  assertOnlyKeys(value, new Set(["tool", "identity", "probe", "install"]), "installTool options");
  const probe = value.probe;
  const install = value.install;
  const probeIdentity = typeof probe === "function"
    ? sandboxCommandIdentityOf(probe as StableSandboxCommand)
    : undefined;
  const installIdentity = typeof install === "function"
    ? sandboxCommandIdentityOf(install as StableSandboxCommand)
    : undefined;
  if (!probeIdentity) {
    throw new TypeError("installTool options.probe must be a StableSandboxCommand from command(), shell(), or defineSandboxCommand()");
  }
  if (!installIdentity) {
    throw new TypeError("installTool options.install must be a StableSandboxCommand from command(), shell(), or defineSandboxCommand()");
  }

  // defineSandboxCommand owns the recursive JSON-content validation and frozen snapshot. Keeping
  // this raw value here prevents a second, subtly different identity grammar at this public edge.
  return Object.freeze({
    tool: nonEmptyString(value.tool, "installTool options.tool"),
    identity: value.identity as SandboxCommandIdentityValue,
    probe: probe as StableSandboxCommand,
    install: install as StableSandboxCommand,
    probeIdentity,
    installIdentity,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identityValue(identity: SandboxCommandIdentity): SandboxCommandIdentityValue {
  return {
    id: identity.id,
    revision: identity.revision,
    inputs: identity.inputs,
  };
}

function checkoutCachePath(repo: string, ref: string): string {
  return `${CHECKOUT_CACHE_ROOT}/${sha256(JSON.stringify([repo, ref]))}`;
}

function checkoutFactKey(repo: string, ref: string): string {
  return `${CHECKOUT_FACT_PREFIX}.${sha256(JSON.stringify([repo, ref])).slice(0, 16)}.commit`;
}

function targetPath(workdir: string, into: string): string {
  const normalizedWorkdir = posix.resolve(workdir);
  const target = posix.resolve(normalizedWorkdir, into);
  const isWithinWorkdir = normalizedWorkdir === "/"
    ? target.startsWith("/")
    : target === normalizedWorkdir || target.startsWith(`${normalizedWorkdir}/`);
  if (!isWithinWorkdir) {
    throw new Error("checkout resolved outside of the Sandbox workdir");
  }
  return target;
}

function validCommitSha(value: string): string | undefined {
  const candidate = value.trim().split(/\s+/, 1)[0] ?? "";
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(candidate) ? candidate.toLowerCase() : undefined;
}

async function commandResult(
  sandbox: SandboxCommandTarget,
  args: readonly string[],
): Promise<CommandResult> {
  return sandbox.runCommand("git", args);
}

async function resolvedCommit(
  sandbox: SandboxCommandTarget,
  mirror: string,
  ref: string,
): Promise<string | undefined> {
  const result = await commandResult(sandbox, [
    `--git-dir=${mirror}`,
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  return result.exitCode === 0 ? validCommitSha(result.stdout) : undefined;
}

async function mirrorMatches(
  sandbox: SandboxCommandTarget,
  mirror: string,
  repo: string,
  ref: string,
): Promise<string | undefined> {
  const bare = await commandResult(sandbox, [`--git-dir=${mirror}`, "rev-parse", "--is-bare-repository"]);
  if (bare.exitCode !== 0 || bare.stdout.trim() !== "true") return undefined;
  const remote = await commandResult(sandbox, [`--git-dir=${mirror}`, "remote", "get-url", "origin"]);
  if (remote.exitCode !== 0 || remote.stdout.trim() !== repo) return undefined;
  return resolvedCommit(sandbox, mirror, ref);
}

async function recreateMirror(
  sandbox: SandboxCommandTarget,
  mirror: string,
  repo: string,
  ref: string,
): Promise<string> {
  // The target is a SHA-256-derived child of this private cache root. A damaged mirror is not a
  // user checkout, so replacing it is the documented cache-miss recovery rather than an extra
  // error class.
  await sandbox.runCommandOrThrow("rm", ["-rf", mirror]);
  await sandbox.runCommandOrThrow("mkdir", ["-p", CHECKOUT_CACHE_ROOT]);
  await sandbox.runCommandOrThrow("git", ["clone", "--mirror", "--quiet", repo, mirror]);
  const commit = await resolvedCommit(sandbox, mirror, ref);
  if (!commit) {
    const failed = await commandResult(sandbox, [`--git-dir=${mirror}`, "rev-parse", "--verify", `${ref}^{commit}`]);
    throw new SandboxCommandExitError(failed);
  }
  return commit;
}

async function materializeCheckout(
  sandbox: SandboxCommandTarget,
  mirror: string,
  destination: string,
  commit: string,
): Promise<void> {
  await sandbox.runCommandOrThrow("mkdir", ["-p", destination]);
  await sandbox.runCommandOrThrow("git", ["-C", destination, "init", "--quiet"]);
  // A prior attempt can have left this worktree at another revision. Removing only our private
  // remote and cleaning the checkout makes the declared commit the complete visible start state.
  await sandbox.runCommand("git", ["-C", destination, "remote", "remove", "niceeval-mirror"]);
  await sandbox.runCommandOrThrow("git", ["-C", destination, "remote", "add", "niceeval-mirror", mirror]);
  await sandbox.runCommandOrThrow("git", ["-C", destination, "clean", "-ffdqx"]);
  await sandbox.runCommandOrThrow("git", ["-C", destination, "fetch", "--quiet", "--no-tags", "niceeval-mirror", commit]);
  await sandbox.runCommandOrThrow("git", ["-C", destination, "checkout", "--quiet", "--force", "--detach", commit]);
}

/**
 * 把 `(repo, ref)` 变成 Sandbox 私有 bare mirror，再从其中 materialize 到 workdir。
 * 同一 Sandbox 的相同命令会先本地验证 mirror 与 ref，只有首条或缓存损坏才触发网络 clone。
 */
export function checkout(options: CheckoutOptions): StableSandboxCommand {
  const normalized = normalizeCheckoutOptions(options);
  const cachePath = checkoutCachePath(normalized.repo, normalized.ref);
  return defineSandboxCommand(
    {
      id: "niceeval.sandbox.checkout",
      revision: "1",
      inputs: normalized,
    },
    async (sandbox, context) => {
      context.progress({ message: `Preparing checkout ${normalized.ref}` });
      const cachedCommit = await mirrorMatches(sandbox, cachePath, normalized.repo, normalized.ref);
      const commit = cachedCommit ?? await recreateMirror(sandbox, cachePath, normalized.repo, normalized.ref);
      await materializeCheckout(sandbox, cachePath, targetPath(sandbox.workdir, normalized.into), commit);
      context.facts(checkoutFactKey(normalized.repo, normalized.ref), commit);
    },
  );
}

async function probeTool(
  probe: StableSandboxCommand,
  sandbox: SandboxCommandTarget,
  context: SandboxCommandContext,
): Promise<"hit" | "miss"> {
  try {
    await probe(sandbox, context);
    return "hit";
  } catch (error: unknown) {
    // `command()` / `shell()` and a checked custom command turn exactly a nonzero exit into this
    // typed error. Transport / cancellation / callback failures stay failures and never trigger
    // an install attempt.
    if (error instanceof SandboxCommandExitError) return "miss";
    throw error;
  }
}

class InstallToolRecheckError extends Error {
  readonly code = "install-tool-recheck-missed" as const;

  constructor(tool: string) {
    super(`installTool(${JSON.stringify(tool)}) finished install but its probe still did not pass`);
    this.name = "InstallToolRecheckError";
  }
}

/**
 * 稳定的 probe → install → recheck 封装。probe 的普通非零退出是 miss，而所有其它错误保留
 * 原样；install/recheck 的失败因此自然归当前 `sandbox.prepare.<owner>` 生命周期节点。
 */
export function installTool(options: InstallToolOptions): StableSandboxCommand {
  const normalized = normalizeInstallToolOptions(options);
  const probePlan: SandboxCommandPlanNode = sandboxCommandPlanOf(normalized.probe) ?? {
    truth: "opaque",
    reason: {
      code: "custom-stable-command",
      summary: "custom probe callback; commands are only known when it runs",
    },
  };
  const installPlan: SandboxCommandPlanNode = sandboxCommandPlanOf(normalized.install) ?? {
    truth: "opaque",
    reason: {
      code: "custom-stable-command",
      summary: "custom installer callback; commands are only known when it runs",
    },
  };
  const probeMiss = Object.freeze({
    code: "probe-miss",
    summary: `${normalized.tool} probe exits non-zero`,
  });
  return definePlannedSandboxCommand(
    {
      id: "niceeval.sandbox.install-tool",
      revision: "1",
      inputs: {
        tool: normalized.tool,
        identity: normalized.identity,
        probe: identityValue(normalized.probeIdentity),
        install: identityValue(normalized.installIdentity),
      },
    },
    async (sandbox, context) => {
      context.progress({ message: `Checking ${normalized.tool}` });
      if (await probeTool(normalized.probe, sandbox, context) === "hit") return;

      context.progress({ message: `Installing ${normalized.tool}` });
      await normalized.install(sandbox, context);

      context.progress({ message: `Verifying ${normalized.tool}` });
      if (await probeTool(normalized.probe, sandbox, context) === "miss") {
        throw new InstallToolRecheckError(normalized.tool);
      }
    },
    {
      truth: "conditional",
      label: `installTool(${JSON.stringify(normalized.tool)})`,
      children: [
        { ...probePlan, label: "probe" },
        { ...installPlan, label: "install", condition: probeMiss },
        { ...probePlan, label: "recheck", condition: probeMiss },
      ],
    },
  );
}
