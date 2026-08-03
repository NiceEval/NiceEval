// cases: docs/engineering/testing/unit/sandbox.md

import { createNpmCliInstaller } from "../agents/npm-staged.ts";
import type { AgentInstaller, AgentIdentity } from "../agents/types.ts";
import { createRunTimingRecorder } from "../runner/timing.ts";
import { describe, expect, it } from "vitest";
import {
  DockerfileAgentImageCoordinator,
  isDockerfileAgentCacheSafeInstaller,
  type DockerfileAgentCacheRequest,
} from "./dockerfile-agent-cache.ts";

const identity: AgentIdentity = { agent: "cache-agent", version: "1.2.3", revision: "r1" };
const signal = new AbortController().signal;

function cacheSafeRequest(taskLocator = "niceeval-build:task", platform = "linux/amd64"): DockerfileAgentCacheRequest {
  const { ensure, installer } = createNpmCliInstaller({
    identity,
    packageName: "cache-agent-package",
    bin: "cache-agent",
    prepare: async () => {
      throw new Error("prepare must not run while deriving the cache key");
    },
  });
  return { taskLocator, platform, ensure, installer };
}

function unsupportedRequest(): DockerfileAgentCacheRequest {
  const request = cacheSafeRequest();
  const installer: Extract<AgentInstaller, { readonly installMode: "staged" }> = {
    identity,
    installMode: "staged",
    prepareArtifact: async () => {
      throw new Error("unsupported installer must use the old path");
    },
    install: async () => {},
  };
  return { ...request, installer };
}

function coordinator(script: {
  inspect?: (locator: string) => Promise<boolean>;
}) {
  const builds: {
    readonly taskLocator: string;
    readonly derivedLocator: string;
    readonly derivedKey: string;
    readonly platform: string;
    readonly ensureIdentity: AgentIdentity;
    readonly installerIdentity: AgentIdentity;
    readonly installMode: "staged";
  }[] = [];
  const instance = new DockerfileAgentImageCoordinator({
    imageExists: async (locator) => script.inspect?.(locator) ?? false,
  });
  return { instance, builds };
}

describe("Dockerfile staged Agent derived image cache", () => {
  it("builds once on the first request and does not pass prepare or secrets to the builder", async () => {
    const { instance, builds } = coordinator({});
    const result = await instance.resolve(cacheSafeRequest(), signal, async (input) => {
      builds.push(input);
    });

    expect(result.status).toBe("built");
    expect(builds).toHaveLength(1);
    expect(Object.keys(builds[0] ?? {})).toEqual([
      "taskLocator",
      "derivedLocator",
      "derivedKey",
      "platform",
      "ensureIdentity",
      "installerIdentity",
      "installMode",
    ]);
    expect(isDockerfileAgentCacheSafeInstaller(cacheSafeRequest().installer)).toBe(true);
  });

  it("uses an inspect hit across coordinator calls without rebuilding", async () => {
    let inspected = 0;
    const { instance, builds } = coordinator({
      inspect: async () => {
        inspected += 1;
        return true;
      },
    });
    const result = await instance.resolve(cacheSafeRequest(), signal, async () => {});

    expect(result.status).toBe("hit");
    expect(inspected).toBe(1);
    expect(builds).toHaveLength(0);
  });

  it("isolates task and platform identities", async () => {
    const { instance, builds } = coordinator({});
    const first = await instance.resolve(cacheSafeRequest("niceeval-build:a", "linux/amd64"), signal, async (input) => {
      builds.push(input);
    });
    const second = await instance.resolve(cacheSafeRequest("niceeval-build:b", "linux/arm64"), signal, async (input) => {
      builds.push(input);
    });

    expect(first.status).toBe("built");
    expect(second.status).toBe("built");
    expect(first).not.toEqual(second);
    expect(builds).toHaveLength(2);
  });

  it("falls back to the task locator for non-cache-safe staged installers", async () => {
    let inspected = 0;
    const { instance, builds } = coordinator({
      inspect: async () => {
        inspected += 1;
        return false;
      },
    });
    const request = unsupportedRequest();
    const result = await instance.resolve(request, signal, async () => {
      throw new Error("unsupported builder must not run");
    });

    expect(result).toEqual({ status: "unsupported", locator: request.taskLocator });
    expect(inspected).toBe(0);
    expect(builds).toHaveLength(0);
  });

  it("single-flights concurrent requests with the same derived key", async () => {
    let release!: () => void;
    const building = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { instance, builds } = coordinator({});
    const build = async (input: (typeof builds)[number]) => {
      builds.push(input);
      await building;
    };
    const first = instance.resolve(cacheSafeRequest(), signal, build);
    const second = instance.resolve(cacheSafeRequest(), signal, build);

    release();
    const results = await Promise.all([first, second]);
    expect(builds).toHaveLength(1);
    expect(results[0]).toEqual(results[1]);
  });

  it("records lookup and build as Run timing activities", async () => {
    const timing = createRunTimingRecorder(() => 0);
    const { instance } = coordinator({});
    await instance.resolve(cacheSafeRequest(), signal, async () => {} , timing);

    expect(timing.finalize()?.map((activity) => activity.key)).toEqual([
      "sandbox.build.lookup",
      "sandbox.build.agent",
    ]);
  });
});
