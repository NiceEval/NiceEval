// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import {
  AGENT_DOCKERFILE_CACHE_SAFE,
  type DockerfileAgentCacheSafeInstaller,
} from "../agents/cache-marker.ts";
import type {
  AgentArtifactPlatform,
  AgentEnsure,
  AgentInstaller,
} from "../agents/types.ts";
import { defineSandboxCommand } from "./commands.ts";
import { registerSandboxContent } from "./content.ts";
import { SandboxCommandExitError } from "./operations.ts";
import {
  buildDockerfileAgentImageWithServices,
  dockerCommitReference,
  type DockerfileAgentImageProvisionServices,
} from "./runtime.ts";
import type {
  CommandResult,
  SandboxOperations,
  SuccessfulCommandResult,
} from "./types.ts";

const targetPlatform: AgentArtifactPlatform = {
  _tag: "Linux",
  os: "linux",
  arch: "x64",
  libc: "gnu",
};

const successful = (): SuccessfulCommandResult => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
});

const failed = (): CommandResult => ({
  stdout: "",
  stderr: "missing",
  exitCode: 1,
});

describe("Dockerfile agent runtime materializer", () => {
  it("runs ensure and recheck in a temporary sandbox, commits repo/tag, then cleans it up", async () => {
    let installed = false;
    let probeCount = 0;
    const events: Array<string> = [];

    const operations = {
      workdir: "/workdir",
      runCommand: async () => successful(),
      runShell: async (script: string) => {
        if (script !== "probe") return successful();
        probeCount += 1;
        return installed ? successful() : failed();
      },
      runCommandOrThrow: async () => successful(),
      runShellOrThrow: async () => successful(),
      readText: async () => "",
      writeText: async () => {},
      readBytes: async () => new Uint8Array(),
      writeBytes: async () => {},
      pathExists: async () => false,
    } satisfies SandboxOperations;

    const ensure: AgentEnsure = {
      identity: {
        agent: "fake-agent",
        version: "1.2.3",
        revision: "fake-revision",
      },
      probe: defineSandboxCommand(
        { id: "fake-agent.probe", revision: "1", inputs: {} },
        async (sandbox) => {
          const result = await sandbox.runShell("probe");
          if (result.exitCode !== 0) {
            throw new SandboxCommandExitError(result);
          }
        },
      ),
    };

    const installer: Extract<AgentInstaller, { installMode: "staged" }> &
      DockerfileAgentCacheSafeInstaller = {
        installMode: "staged",
        identity: {
          agent: "fake-agent",
          version: "1.2.3",
          revision: "fake-revision",
        },
        prepareArtifact: async () => ({
          platform: targetPlatform,
          content: registerSandboxContent(
            new URL("../../package.json", import.meta.url),
          ),
          targetPath: "/tmp/fake-agent.tgz",
          install: { kind: "npm-tarball" },
        }),
        install: async () => {
          installed = true;
        },
        [AGENT_DOCKERFILE_CACHE_SAFE]: true,
      };

    const services: DockerfileAgentImageProvisionServices = {
      create: async (taskLocator) => {
        events.push(`create:${taskLocator}`);
        return {
          operations,
          sandboxId: "temporary-sandbox",
          stop: async () => {
            events.push("stop");
          },
        };
      },
      commit: async (sandboxId, locator) => {
        events.push(`commit:${sandboxId}:${locator}`);
      },
    };

    await buildDockerfileAgentImageWithServices(
      {
        taskLocator: "niceeval-build:task-digest",
        derivedLocator: "niceeval-agent:derived-key",
        derivedKey: "derived-key",
        platform: "linux|x64",
        ensureIdentity: ensure.identity,
        installerIdentity: installer.identity,
        installMode: "staged",
      },
      {
        taskLocator: "niceeval-build:task-digest",
        platform: "linux/amd64",
        ensure,
        installer,
      },
      targetPlatform,
      new AbortController().signal,
      services,
    );

    expect(probeCount).toBe(2);
    expect(events).toEqual([
      "create:niceeval-build:task-digest",
      "commit:temporary-sandbox:niceeval-agent:derived-key",
      "stop",
    ]);
  });

  it("splits Dockerode image locators into repo and tag", () => {
    expect(dockerCommitReference("niceeval-agent:abcdef")).toEqual({
      repo: "niceeval-agent",
      tag: "abcdef",
    });
    expect(dockerCommitReference("registry.example/niceeval-agent:abcdef")).toEqual({
      repo: "registry.example/niceeval-agent",
      tag: "abcdef",
    });
    expect(dockerCommitReference("niceeval-agent")).toEqual({
      repo: "niceeval-agent",
    });
  });
});
