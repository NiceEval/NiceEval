import { hash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { registerSandboxContent } from "../sandbox/content.ts";
import { SandboxCommandExitError } from "../sandbox/operations.ts";
import { shellQuote } from "../sandbox/shell.ts";
import { agentBin } from "./npm-staged.ts";
import { defaultArtifactCacheDir, platformKey } from "./provisioner.ts";
import type { AgentArtifactContext, AgentInstall, AgentInstaller, AgentStagedArtifact } from "./types.ts";

const PLATFORM = "linux-x64-gnu";
const ARCHIVE = "agy_cli_linux_x64.tar.gz";
const ASSETS = new Map([["1.5.15", "8d9913298602049ef29e9669f35252b6b79571979ce1bd0fb27753c7bac84114"]]);
export const ANTIGRAVITY_VERSION_ENV = { AGY_CLI_DISABLE_AUTO_UPDATE: "true" } as const;

async function cachedArchive(version: string, sha256: string, signal: AbortSignal): Promise<string> {
  const cache = join(defaultArtifactCacheDir(), "agy", sha256);
  const destination = join(cache, ARCHIVE);
  const cached = await readFile(destination, { signal }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (cached !== undefined && hash("sha256", cached) === sha256) return destination;

  const url = `https://github.com/google-antigravity/antigravity-cli/releases/download/${version}/${ARCHIVE}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Antigravity CLI ${version} download failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (hash("sha256", bytes) !== sha256) {
    throw new Error(`Antigravity CLI ${version} release asset failed SHA-256 verification.`);
  }
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, "download-"));
  try {
    const pending = join(temporary, ARCHIVE);
    await writeFile(pending, bytes, { signal });
    await rename(pending, destination);
  } finally {
    await rm(temporary, { recursive: true });
  }
  return destination;
}

async function prepareArtifact(
  version: string,
  { targetPlatform, signal }: AgentArtifactContext,
): Promise<AgentStagedArtifact> {
  if (platformKey(targetPlatform) !== PLATFORM) {
    throw new Error("The Antigravity CLI installer requires Linux x86_64 with glibc 2.28 or newer.");
  }
  const sha256 = ASSETS.get(version);
  if (sha256 === undefined) {
    throw new Error(
      `No verified Antigravity CLI ${version} release asset is pinned. Preinstall that exact version on PATH or use 1.5.15.`,
    );
  }
  const archive = await cachedArchive(version, sha256, signal);
  return {
    platform: targetPlatform,
    content: registerSandboxContent(pathToFileURL(archive)),
    targetPath: `$HOME/.niceeval-agent-payload/${ARCHIVE}`,
    install: { kind: "self-contained", binPath: "antigravity" },
  };
}

// @concord-code
// @concord-implements docs/feature/adapters/library/sdk/agy/README.md
export function antigravityInstall(version: string): { install: AgentInstall; installer: AgentInstaller } {
  const identity = { agent: "agy", version, revision: "1" };
  const probe = defineSandboxCommand(
    { id: "niceeval.agent.probe.agy", revision: identity.revision, inputs: identity },
    async (sandbox, { signal }) => {
      const result = await sandbox.runShell(`binary="${agentBin("agy")}"; test -n "$binary" && "$binary" --version`, {
        env: ANTIGRAVITY_VERSION_ENV,
        signal,
      });
      if (result.exitCode === 0 && result.stdout.trim() === version) return;
      throw new SandboxCommandExitError({
        ...result,
        exitCode: result.exitCode || 1,
        command: "agy --version",
        stderr: `Expected Antigravity CLI version ${version}. ${result.stderr}`.trim(),
      });
    },
  );
  const installer: AgentInstaller = {
    identity,
    installMode: "staged",
    platforms: [PLATFORM],
    prepareArtifact: (context) => prepareArtifact(version, context),
    async install(sandbox, { artifact, signal }) {
      const sha256 = ASSETS.get(version);
      if (sha256 === undefined) throw new Error(`No verified Antigravity CLI ${version} release asset is pinned.`);
      const prepared = await sandbox.runShellOrThrow(
        [
          "set -eu",
          'test -n "$HOME"',
          'libc=$(getconf GNU_LIBC_VERSION 2>/dev/null) || libc=""',
          'if ! printf "%s\\n" "$libc" | awk \'$1 == "glibc" { split($2,v,"."); ok = v[1] > 2 || (v[1] == 2 && v[2] >= 28) } END { exit !ok }\'; then',
          '  printf "%s\\n" "Antigravity CLI requires glibc 2.28 or newer." >&2',
          "  exit 1",
          "fi",
          'mkdir -p "$HOME/.local/bin" "$HOME/.niceeval-agent-payload"',
          'mktemp -d "$HOME/.niceeval-agent-payload/agy.XXXXXXXX"',
        ].join("\n"),
        { signal },
      );
      const directory = prepared.stdout.trim();
      const archive = `${directory}/${ARCHIVE}`;
      const stagedBin = `${directory}/antigravity`;
      try {
        await sandbox.putContent(artifact.content, archive);
        await sandbox.runShellOrThrow(
          [
            "set -eu",
            `printf '%s  %s\\n' ${shellQuote(sha256)} ${shellQuote(archive)} | sha256sum -c`,
            `tar -xzf ${shellQuote(archive)} -C ${shellQuote(directory)} antigravity`,
            `chmod 0755 ${shellQuote(stagedBin)}`,
            `mv -f ${shellQuote(stagedBin)} "$HOME/.local/bin/agy"`,
          ].join("\n"),
          { signal },
        );
      } finally {
        await sandbox.runCommand("rm", ["-rf", "--", directory]);
      }
    },
  };
  return { install: { identity, probe }, installer };
}
