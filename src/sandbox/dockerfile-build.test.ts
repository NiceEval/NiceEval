// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖「sandbox case 五类」与「BuildKey single-flight、失败向所有依赖项传播失败和预算」：
// 单 Dockerfile 的内容身份、provider locator 与 CaseKey 必须同源，不能把声明存在误当成已构建。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dockerSandbox, e2bSandbox } from "../define.ts";
import { dockerfileSandbox, planSandboxCase } from "./case.ts";
import {
  caseKeyForDockerfileBuild,
  collectDockerfileBuildFromPlan,
  dockerfileBuildProvider,
  routeBuildProviders,
} from "./dockerfile-build.ts";
import type { PlannedSandboxCase } from "./case.ts";
import { createRunTimingRecorder } from "../runner/timing.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-dockerfile-build-"));
  roots.push(root);
  await writeFile(
    join(root, "Dockerfile"),
    `FROM node@sha256:${"a".repeat(64)} AS base\nCOPY package.json /app/package.json\n`,
  );
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(join(root, "ignored.txt"), "first\n");
  await writeFile(join(root, ".dockerignore"), "ignored.txt\n");
  return root;
}

function readyPlan(provider: "docker" | "e2b", context: string, target?: string): PlannedSandboxCase {
  const planned = planSandboxCase({
    evalId: "evals/task",
    environment: "task-env",
    spec: provider === "docker"
      ? dockerSandbox({ environments: { "task-env": { build: { context, ...(target !== undefined ? { target } : {}) } } } })
      : e2bSandbox({ environments: { "task-env": { build: { context, ...(target !== undefined ? { target } : {}) } } } }),
  });
  if (planned.status !== "ready") throw new Error(`expected ready plan, got ${planned.status}`);
  return planned.plan;
}

describe("单 Dockerfile BuildKey", () => {
  it("忽略文件内容不改 key，target 与 provider 会改 key；CaseKey 与 BuildKey 同源", async () => {
    const root = await fixture();
    const dockerPlan = readyPlan("docker", root);
    const first = await collectDockerfileBuildFromPlan(dockerPlan, { dockerPlatform: "linux/amd64" });
    expect(first).toBeDefined();

    await writeFile(join(root, "ignored.txt"), "second\n");
    const ignoredChanged = await collectDockerfileBuildFromPlan(dockerPlan, { dockerPlatform: "linux/amd64" });
    expect(ignoredChanged?.buildKey).toBe(first?.buildKey);

    await writeFile(join(root, "package.json"), '{"name":"changed"}\n');
    const contextChanged = await collectDockerfileBuildFromPlan(dockerPlan, { dockerPlatform: "linux/amd64" });
    expect(contextChanged?.buildKey).not.toBe(first?.buildKey);

    const targeted = await collectDockerfileBuildFromPlan(readyPlan("docker", root, "base"), {
      dockerPlatform: "linux/amd64",
    });
    const e2b = await collectDockerfileBuildFromPlan(readyPlan("e2b", root));
    expect(targeted?.buildKey).not.toBe(first?.buildKey);
    expect(e2b?.buildKey).not.toBe(first?.buildKey);
    expect(first?.caseKey).toBe(caseKeyForDockerfileBuild(dockerPlan, first!.buildKey));
    expect(first?.carryEligible).toBe(true);
    expect(first?.work.inputs).toMatchObject({ kind: "dockerfile", platform: "linux/amd64" });
  });

  it("浮动 FROM 无法解析 digest 时可构建但禁止携带", async () => {
    const root = await fixture();
    await writeFile(join(root, "Dockerfile"), "FROM node:24-slim\nCOPY package.json /app/package.json\n");
    const collection = await collectDockerfileBuildFromPlan(readyPlan("docker", root), {
      dockerPlatform: "linux/amd64",
    });
    expect(collection?.carryEligible).toBe(false);
    expect(collection?.buildKey).toBeDefined();
  });

  it("多阶段 carry 检查覆盖目标 stage 依赖的全部外部 FROM", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "Dockerfile"),
      `FROM node@sha256:${"d".repeat(64)} AS base\nFROM ubuntu:latest AS release\n`,
    );
    const final = await collectDockerfileBuildFromPlan(readyPlan("docker", root), {
      dockerPlatform: "linux/amd64",
    });
    const base = await collectDockerfileBuildFromPlan(readyPlan("docker", root, "base"), {
      dockerPlatform: "linux/amd64",
    });
    expect(final?.carryEligible).toBe(false);
    expect(base?.carryEligible).toBe(true);
    expect(base?.buildKey).not.toBe(final?.buildKey);
  });

  it("folder-local dockerfileSandbox 直接进入 Docker/E2B 内置构建链", async () => {
    const root = await fixture();
    for (const spec of [dockerSandbox(), e2bSandbox()]) {
      const planned = planSandboxCase({
        evalId: "evals/task",
        defaultProfileId: "task",
        environment: dockerfileSandbox({ context: root }),
        spec,
      });
      if (planned.status !== "ready") throw new Error(`expected ready plan, got ${planned.status}`);
      const collection = await collectDockerfileBuildFromPlan(planned.plan, { dockerPlatform: "linux/amd64" });
      expect(collection?.work).toMatchObject({ provider: spec.provider, inputs: { kind: "dockerfile" } });
    }
  });

});

describe("Dockerfile build provider", () => {
  it("Docker cache miss 才 build，E2B cache hit 直接复用内容寻址 template", async () => {
    const root = await fixture();
    const docker = await collectDockerfileBuildFromPlan(readyPlan("docker", root), {
      dockerPlatform: "linux/amd64",
    });
    const e2b = await collectDockerfileBuildFromPlan(readyPlan("e2b", root));
    if (docker === undefined || e2b === undefined) throw new Error("expected two build collections");

    const runDockerBuild = vi.fn(async () => {});
    const buildE2BTemplate = vi.fn(async () => {});
    const provider = dockerfileBuildProvider([docker, e2b], {
      dockerImageExists: async () => false,
      runDockerBuild,
      e2bTemplateExists: async () => true,
      buildE2BTemplate,
    });
    const signal = new AbortController().signal;
    const e2bLocator = await provider.lookup(e2b.work, signal);
    expect(e2bLocator).toMatch(/^niceeval-build-/);
    expect(buildE2BTemplate).not.toHaveBeenCalled();

    expect(await provider.lookup(docker.work, signal)).toBeUndefined();
    const timing = createRunTimingRecorder();
    const parent = timing.child({ key: "sandbox.build", label: "fixture", startOffsetMs: 0, durationMs: 0 });
    const dockerLocator = await provider.build(docker.work, { signal, timing, parent });
    expect(dockerLocator).toMatch(/^niceeval-build:/);
    expect(runDockerBuild).toHaveBeenCalledOnce();
  });

  it("按 BuildKey 路由，不把同 provider 的 Compose 与 Dockerfile work 混给同一 builder", async () => {
    const root = await fixture();
    const collection = await collectDockerfileBuildFromPlan(readyPlan("docker", root), {
      dockerPlatform: "linux/amd64",
    });
    if (collection === undefined) throw new Error("expected build collection");
    const dockerfile = dockerfileBuildProvider([collection], {
      dockerImageExists: async () => true,
    });
    const other = {
      lookup: vi.fn(async () => "compose-locator"),
      build: vi.fn(async () => "compose-locator"),
    };
    const composeWork = { buildKey: "compose-key", provider: "docker", inputs: {}, label: "compose" };
    const routed = routeBuildProviders(
      new Map([
        [collection.buildKey, dockerfile],
        [composeWork.buildKey, other],
      ]),
    );
    expect(await routed.lookup(composeWork, new AbortController().signal)).toBe("compose-locator");
    expect(other.lookup).toHaveBeenCalledOnce();
  });
});
