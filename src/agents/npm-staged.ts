// 内置 Node coding Agent 的 staged provisioner:
// 宿主 npm pack → digest 校验进 cache → 主 Sandbox 文件 API 上传 → 本地 tarball 安装。
// 不借题面网络;安装目录在 workdir 外的用户前缀(`~/.local`)。

import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { t } from "../i18n/index.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { Sandbox } from "../sandbox/types.ts";
import {
  defaultArtifactCacheDir,
  defineAgentProvisioner,
  hostArtifactPlatform,
  platformKey,
  sha256Hex,
} from "./provisioner.ts";
import type {
  AgentArtifactPlatform,
  AgentCheckResult,
  AgentIdentity,
  AgentProvisioner,
  AgentStagedArtifact,
} from "./types.ts";

/** 沙箱内 Agent 自有安装前缀(workdir 外);题间 reset 不删。 */
export const AGENT_USER_PREFIX = "$HOME/.local";
const SANDBOX_TARBALL_DIR = "$HOME/.niceeval-agent-payload";

export interface NpmCliProvisionerOptions {
  identity: AgentIdentity;
  /** npm 包名,如 `@openai/codex`。 */
  packageName: string;
  /** PATH 上的命令名,如 `codex`。 */
  bin: string;
  /** 从 `--version` 输出解析精确版本;默认取最后一个 `\d+\.\d+\.\d+…` 片段。 */
  parseVersion?(stdout: string): string | undefined;
  /** 宿主制品 cache 根;省略用 ~/.cache/niceeval/agent-artifacts。 */
  cacheDir?: string;
  /** 覆盖 prepare(测试注入 / 离线预置)。 */
  prepare?(platform: AgentArtifactPlatform): Promise<AgentStagedArtifact>;
}

function defaultParseVersion(stdout: string): string | undefined {
  const matches = stdout.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g);
  return matches?.at(-1);
}

async function runHost(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function npmPackToCache(opts: {
  packageName: string;
  version: string;
  cacheDir: string;
  platform: AgentArtifactPlatform;
  identity: AgentIdentity;
}): Promise<AgentStagedArtifact> {
  const dest = join(
    opts.cacheDir,
    opts.identity.agent,
    `${opts.identity.version}-r${opts.identity.revision}`,
    platformKey(opts.platform),
  );
  await mkdir(dest, { recursive: true });
  const pack = await runHost("npm", ["pack", `${opts.packageName}@${opts.version}`, "--pack-destination", dest], dest);
  if (pack.exitCode !== 0) {
    throw new Error(
      t("agent.ensure.npmPackFailed", {
        packageName: opts.packageName,
        version: opts.version,
        tail: (pack.stdout + pack.stderr).trim().split("\n").slice(-12).join("\n"),
      }),
    );
  }
  const files = (await readdir(dest)).filter((name) => name.endsWith(".tgz"));
  if (files.length === 0) {
    throw new Error(
      t("agent.ensure.npmPackEmpty", { packageName: opts.packageName, version: opts.version, dest }),
    );
  }
  // npm pack 打印文件名;多文件时取最新 mtime 不必要——同目录通常一个 tgz。
  const localPath = join(dest, files[files.length - 1]!);
  const bytes = await readFile(localPath);
  return {
    digest: sha256Hex(bytes),
    platform: opts.platform,
    localPath,
    sandboxPath: `${SANDBOX_TARBALL_DIR}/${opts.identity.agent}.tgz`,
  };
}

async function checkNpmCli(
  sandbox: Sandbox,
  opts: { bin: string; expectedVersion: string; parseVersion: (stdout: string) => string | undefined },
): Promise<AgentCheckResult> {
  // 运行用户身份断言:先看用户前缀,再看 PATH。不以 root 跑出假绿。
  const bin = opts.bin;
  const versionCmd = [
    `BIN=""`,
    `if [ -x "$HOME/.local/bin/${bin}" ]; then BIN="$HOME/.local/bin/${bin}"`,
    `elif command -v ${shellQuote(bin)} >/dev/null 2>&1; then BIN="$(command -v ${shellQuote(bin)})"`,
    `fi`,
    `if [ -z "$BIN" ]; then exit 127; fi`,
    `"$BIN" --version`,
  ].join("; ");
  const res = await sandbox.runShell(versionCmd);
  if (res.exitCode !== 0) {
    return {
      ok: false,
      detail: t("agent.ensure.missingBin", { bin, tail: (res.stdout + res.stderr).trim().slice(0, 200) }),
    };
  }
  const actualVersion = opts.parseVersion(res.stdout.trim());
  if (actualVersion === undefined) {
    return {
      ok: false,
      detail: t("agent.ensure.versionUnparseable", { bin, stdout: res.stdout.trim().slice(0, 200) }),
    };
  }
  if (actualVersion !== opts.expectedVersion) {
    return {
      ok: false,
      actualVersion,
      detail: t("agent.ensure.versionMismatch", {
        bin,
        expected: opts.expectedVersion,
        actual: actualVersion,
      }),
    };
  }
  return { ok: true, actualVersion };
}

async function installFromStaged(
  sandbox: Sandbox,
  artifact: AgentStagedArtifact,
  identity: AgentIdentity,
  bin: string,
): Promise<void> {
  const bytes = await readFile(artifact.localPath);
  const digest = sha256Hex(bytes);
  if (digest !== artifact.digest) {
    throw new Error(
      t("agent.ensure.digestMismatch", {
        agent: identity.agent,
        expected: artifact.digest,
        actual: digest,
      }),
    );
  }
  const remoteTemplate = artifact.sandboxPath ?? `${SANDBOX_TARBALL_DIR}/${identity.agent}.tgz`;
  const tarball = await expandSandboxHomePath(sandbox, remoteTemplate);
  const prefix = await expandSandboxHomePath(sandbox, AGENT_USER_PREFIX);
  await sandbox.runShell(`mkdir -p ${shellQuote(dirnameOf(tarball))} ${shellQuote(prefix)}`);
  await sandbox.uploadFile(tarball, bytes);

  const install = await sandbox.runShell(
    `npm install -g --prefix ${shellQuote(prefix)} ${shellQuote(tarball)}`,
  );
  if (install.exitCode !== 0) {
    throw new Error(
      t("agent.ensure.npmInstallFailed", {
        agent: identity.agent,
        tail: (install.stdout + install.stderr).trim().split("\n").slice(-12).join("\n"),
      }),
    );
  }

  // bash -c 不读 profile;把用户前缀 bin 链到常见 PATH 目录,让后续 setup/send 的裸命令名仍可用。
  // 写不进就不强求——check 已能解析 $HOME/.local/bin;send 侧用 agentBin() 兜底。
  await sandbox.runShell(
    [
      `SRC=${shellQuote(`${prefix}/bin/${bin}`)}`,
      `if [ -x "$SRC" ]; then`,
      `  for d in /usr/local/bin /usr/bin; do`,
      `    if [ -w "$d" ]; then ln -sfn "$SRC" "$d/${bin}" && break; fi`,
      `  done`,
      `fi`,
    ].join("\n"),
  );
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "." : path.slice(0, idx);
}

async function expandSandboxHomePath(sandbox: Sandbox, pathWithHome: string): Promise<string> {
  if (!pathWithHome.includes("$HOME") && !pathWithHome.startsWith("~")) {
    return pathWithHome;
  }
  const home = (await sandbox.runShell("printf '%s' \"$HOME\"")).stdout.trim();
  if (!home) {
    throw new Error(t("agent.ensure.homeDetectFailed"));
  }
  return pathWithHome.replace(/\$HOME/g, home).replace(/^~\//, `${home}/`).replace(/^~$/, home);
}

/**
 * 内置 Node CLI Agent 的默认 staged provisioner。
 * 官方 / 自建预装命中同一条 check;缺失或错版本走宿主 pack + 文件 API 安装。
 */
export function createNpmCliProvisioner(opts: NpmCliProvisionerOptions): AgentProvisioner {
  const parseVersion = opts.parseVersion ?? defaultParseVersion;
  const cacheDir = opts.cacheDir ?? defaultArtifactCacheDir();

  return defineAgentProvisioner({
    identity: opts.identity,
    mode: "staged",
    check: (sandbox) =>
      checkNpmCli(sandbox, {
        bin: opts.bin,
        expectedVersion: opts.identity.version,
        parseVersion,
      }),
    prepare:
      opts.prepare ??
      ((platform) =>
        npmPackToCache({
          packageName: opts.packageName,
          version: opts.identity.version,
          cacheDir,
          platform,
          identity: opts.identity,
        })),
    install: async (sandbox, artifact) => {
      if (!artifact) {
        throw new Error(t("agent.ensure.stagedMissingArtifact", { agent: opts.identity.agent }));
      }
      await installFromStaged(sandbox, artifact, opts.identity, opts.bin);
    },
  });
}

/**
 * 沙箱 shell 里解析 Agent CLI:优先用户前缀安装,否则 PATH。
 * 预装命中与 staged 后装共用,避免 bash -c 读不到 profile 时找不到命令。
 */
export function agentBin(bin: string): string {
  return `$(if [ -x "$HOME/.local/bin/${bin}" ]; then echo "$HOME/.local/bin/${bin}"; else command -v ${shellQuote(bin)}; fi)`;
}

/** 解析 Agent CLI 的绝对路径,供 `runCommand` 使用(不经 shell)。 */
export async function resolveAgentBin(sandbox: Sandbox, bin: string): Promise<string> {
  const res = await sandbox.runShell(
    `if [ -x "$HOME/.local/bin/${bin}" ]; then printf '%s' "$HOME/.local/bin/${bin}"; else command -v ${shellQuote(bin)}; fi`,
  );
  const path = res.stdout.trim();
  if (res.exitCode !== 0 || !path) {
    throw new Error(t("agent.ensure.missingBin", { bin, tail: (res.stdout + res.stderr).trim().slice(0, 200) }));
  }
  return path;
}

/** 给测试 / 诊断用的宿主默认 platform。 */
export { hostArtifactPlatform };
