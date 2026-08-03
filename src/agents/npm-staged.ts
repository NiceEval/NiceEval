// 内置 Node coding Agent 的 staged installer:
// 宿主 npm pack → digest 校验进 cache → 主 Sandbox 文件 API 上传 → 本地 tarball 安装。
// 不借题面网络;安装目录在 workdir 外的用户前缀(`~/.local`)。

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { t } from "../i18n/index.ts";
import { shellQuote } from "../sandbox/shell.ts";
import type { Sandbox } from "../sandbox/types.ts";
import {
  defaultArtifactCacheDir,
  platformKey,
} from "./provisioner.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { registerSandboxContent } from "../sandbox/content.ts";
import { SandboxCommandExitError } from "../sandbox/operations.ts";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";
import { AGENT_DOCKERFILE_CACHE_SAFE } from "./cache-marker.ts";
import type {
  AgentArtifactPlatform,
  AgentEnsure,
  AgentIdentity,
  AgentInstaller,
  AgentStagedArtifact,
} from "./types.ts";
import type { DockerfileAgentCacheSafeInstaller } from "./cache-marker.ts";

/** 沙箱内 Agent 自有安装前缀(workdir 外);题间 reset 不删。 */
export const AGENT_USER_PREFIX = "$HOME/.local";
const SANDBOX_TARBALL_DIR = "$HOME/.niceeval-agent-payload";

export interface NpmCliInstallerOptions {
  identity: AgentIdentity;
  /** npm 包名,如 `@openai/codex`。 */
  packageName: string;
  /** PATH 上的命令名,如 `codex`。 */
  bin: string;
  /**
   * 该 Agent 是否为目标平台发布**自带运行时的原生包**(如 `@openai/codex` 的
   * `@openai/codex@<ver>-linux-arm64`)。返回值给出 npm spec 与包内 CLI 相对路径;
   * 返回 undefined 表示这个平台只有依赖 node 的 npm 包。
   *
   * 有原生包就优先用它:安装只是解压 + 链接,沙箱里不需要 node / npm。
   */
  platformPackage?(platform: AgentArtifactPlatform): { spec: string; binPath: string } | undefined;
  /** 从 `--version` 输出解析精确版本;默认取最后一个 `\d+\.\d+\.\d+…` 片段。 */
  parseVersion?(stdout: string): string | undefined;
  /** 宿主制品 cache 根;省略用 ~/.cache/niceeval/agent-artifacts。 */
  cacheDir?: string;
  /** 覆盖 prepare(测试注入 / 离线预置)。 */
  prepare?(platform: AgentArtifactPlatform): Promise<AgentStagedArtifact>;
  /** Human-only transient labels; omitted labels are not synthesized by the Runner. */
  progress?: {
    readonly checking?: string;
    readonly installing?: string;
    readonly ready?: string;
  };
}

interface AgentProbeResult {
  readonly ok: boolean;
  readonly actualVersion?: string;
  readonly detail?: string;
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
  /** 覆盖 pack 的 spec(原生平台包);省略时用 `<packageName>@<version>`。 */
  spec?: string;
  install: AgentStagedArtifact["install"];
}): Promise<AgentStagedArtifact> {
  const dest = join(
    opts.cacheDir,
    opts.identity.agent,
    `${opts.identity.version}-r${opts.identity.revision}`,
    platformKey(opts.platform),
  );
  await mkdir(dest, { recursive: true });
  const spec = opts.spec ?? `${opts.packageName}@${opts.version}`;
  const pack = await runHost("npm", ["pack", spec, "--pack-destination", dest], dest);
  if (pack.exitCode !== 0) {
    throw new Error(
      t("agent.ensure.npmPackFailed", {
        packageName: opts.packageName,
        version: opts.version,
        tail: (pack.stdout + pack.stderr).trim().split("\n").slice(-12).join("\n"),
      }),
    );
  }
  const packedName = pack.stdout.trim().split("\n").at(-1)?.trim();
  const files = await readdir(dest);
  if (
    packedName === undefined ||
    !/^[^/\\]+\.tgz$/.test(packedName) ||
    !files.includes(packedName)
  ) {
    throw new Error(
      t("agent.ensure.npmPackEmpty", { packageName: opts.packageName, version: opts.version, dest }),
    );
  }
  const localPath = join(dest, packedName);
  const content = registerSandboxContent(pathToFileURL(localPath));
  return {
    platform: opts.platform,
    content,
    targetPath: `${SANDBOX_TARBALL_DIR}/${opts.identity.agent}.tgz`,
    install: opts.install,
  };
}

async function checkNpmCli(
  sandbox: SandboxCommandTarget,
  opts: { bin: string; expectedVersion: string; parseVersion: (stdout: string) => string | undefined },
): Promise<AgentProbeResult> {
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

/** 自带运行时的原生包:解压 + 链接,沙箱里不需要 node / npm。 */
async function installSelfContained(
  sandbox: SandboxCommandTarget,
  opts: { tarball: string; prefix: string; agent: string; bin: string; binPath: string },
): Promise<void> {
  const libDir = `${opts.prefix}/lib/${opts.agent}`;
  const extract = await sandbox.runShell(
    [
      "set -eu",
      `rm -rf ${shellQuote(libDir)}`,
      `mkdir -p ${shellQuote(libDir)} ${shellQuote(`${opts.prefix}/bin`)}`,
      // npm 包统一是 `package/` 单层根;--strip-components=1 把它剥掉。
      `tar -xzf ${shellQuote(opts.tarball)} -C ${shellQuote(libDir)} --strip-components=1`,
      `chmod +x ${shellQuote(`${libDir}/${opts.binPath}`)}`,
      `ln -sfn ${shellQuote(`${libDir}/${opts.binPath}`)} ${shellQuote(`${opts.prefix}/bin/${opts.bin}`)}`,
      `rm -f ${shellQuote(opts.tarball)}`,
    ].join("\n"),
  );
  if (extract.exitCode !== 0) {
    throw new Error(
      t("agent.ensure.selfContainedInstallFailed", {
        agent: opts.agent,
        tail: (extract.stdout + extract.stderr).trim().split("\n").slice(-12).join("\n"),
      }),
    );
  }
}

async function installFromStaged(
  sandbox: SandboxCommandTarget,
  artifact: AgentStagedArtifact,
  identity: AgentIdentity,
  bin: string,
): Promise<void> {
  const tarball = await expandSandboxHomePath(sandbox, artifact.targetPath);
  const prefix = await expandSandboxHomePath(sandbox, AGENT_USER_PREFIX);
  await sandbox.runShell(`mkdir -p ${shellQuote(dirnameOf(tarball))} ${shellQuote(prefix)}`);
  await sandbox.putContent(artifact.content, tarball);

  if (artifact.install.kind === "self-contained") {
    await installSelfContained(sandbox, {
      tarball,
      prefix,
      agent: identity.agent,
      bin,
      binPath: artifact.install.binPath,
    });
  } else {
    const hasNpm = await sandbox.runShell("command -v npm >/dev/null 2>&1");
    if (hasNpm.exitCode !== 0) {
      // 任务镜像是题给的,不能假设它带 Node 工具链;点名缺什么,不猜一个近似命令继续跑。
      throw new Error(t("agent.ensure.npmMissingInSandbox", { agent: identity.agent }));
    }
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

async function expandSandboxHomePath(sandbox: SandboxCommandTarget, pathWithHome: string): Promise<string> {
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
 * 内置 Node CLI Agent 的默认 staged ensure + installer 对。
 * 官方 / 自建预装命中同一条 check;缺失或错版本走宿主 pack + 文件 API 安装。
 */
export function createNpmCliInstaller(opts: NpmCliInstallerOptions): {
  readonly ensure: AgentEnsure;
  readonly installer: Extract<AgentInstaller, { installMode: "staged" }>;
} {
  const parseVersion = opts.parseVersion ?? defaultParseVersion;
  const cacheDir = opts.cacheDir ?? defaultArtifactCacheDir();
  const probe = defineSandboxCommand(
    {
      id: `niceeval.agent.probe.${opts.identity.agent}`,
      revision: opts.identity.revision,
      inputs: { agent: opts.identity.agent, version: opts.identity.version, bin: opts.bin },
    },
    async (sandbox) => {
      const result = await checkNpmCli(sandbox, {
        bin: opts.bin,
        expectedVersion: opts.identity.version,
        parseVersion,
      });
      if (!result.ok) {
        throw new SandboxCommandExitError({
          stdout: result.actualVersion ?? "",
          stderr: result.detail ?? `missing ${opts.bin}`,
          exitCode: 1,
          command: `${opts.bin} --version`,
        });
      }
    },
  );
  const installer: Extract<AgentInstaller, { installMode: "staged" }> & DockerfileAgentCacheSafeInstaller = {
    [AGENT_DOCKERFILE_CACHE_SAFE]: true,
    identity: opts.identity,
    installMode: "staged",
    ...(opts.progress?.installing !== undefined
      ? { progress: { installing: opts.progress.installing } }
      : {}),
    prepareArtifact: ({ targetPlatform }) =>
      opts.prepare !== undefined ? opts.prepare(targetPlatform) : (() => {
        // 目标平台有自带运行时的原生包就取它:装的时候只要 tar,不要 node / npm。
        const native = opts.platformPackage?.(targetPlatform);
        return npmPackToCache({
          packageName: opts.packageName,
          version: opts.identity.version,
          cacheDir,
          platform: targetPlatform,
          identity: opts.identity,
          ...(native !== undefined ? { spec: native.spec } : {}),
          install: native !== undefined
            ? { kind: "self-contained" as const, binPath: native.binPath }
            : { kind: "npm-tarball" as const },
        });
      })(),
    install: (sandbox, context) => installFromStaged(sandbox, context.artifact, opts.identity, opts.bin),
  };
  return {
    ensure: {
      identity: opts.identity,
      probe,
      ...(opts.progress?.checking !== undefined || opts.progress?.ready !== undefined
        ? {
            progress: {
              ...(opts.progress?.checking !== undefined ? { checking: opts.progress.checking } : {}),
              ...(opts.progress?.ready !== undefined ? { ready: opts.progress.ready } : {}),
            },
          }
        : {}),
    },
    installer,
  };
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
