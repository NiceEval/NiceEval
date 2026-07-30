// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - BuildKey single-flight、失败扇出和预算
import { describe, expect, it } from "vitest";
import { createRunTimingRecorder, runOrigin } from "../runner/timing.ts";
import {
  SANDBOX_BUILD_ACTIVITY,
  buildFailureOrigin,
  prepareSandboxBuilds,
  type SandboxBuildProvider,
  type SandboxBuildWork,
} from "./build-coordinator.ts";

function work(buildKey: string, label?: string): SandboxBuildWork {
  return {
    buildKey,
    provider: "docker",
    inputs: { dockerfile: "Dockerfile", context: buildKey },
    ...(label !== undefined ? { label } : {}),
  };
}

function scriptedProvider(script: {
  lookup?: (key: string) => Promise<string | undefined> | string | undefined;
  build?: (key: string) => Promise<string>;
}): SandboxBuildProvider & { builds: string[]; lookups: string[] } {
  const builds: string[] = [];
  const lookups: string[] = [];
  return {
    builds,
    lookups,
    async lookup(w) {
      lookups.push(w.buildKey);
      return await script.lookup?.(w.buildKey);
    },
    async build(w, ctx) {
      builds.push(w.buildKey);
      ctx.timing.childOf(ctx.parent, {
        key: "provider.build.execute",
        label: "execute",
        startOffsetMs: ctx.timing.offsetNow(),
        durationMs: 1,
      });
      if (script.build) return script.build(w.buildKey);
      return `sha256:${w.buildKey}`;
    },
  };
}

function signalAwareProvider(): SandboxBuildProvider & { cancels: string[]; builds: number } {
  return {
    cancels: [] as string[],
    builds: 0,
    async lookup() {
      return undefined;
    },
    async build(w, ctx) {
      this.builds += 1;
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (ctx.signal.aborted) {
          onAbort();
          return;
        }
        ctx.signal.addEventListener("abort", onAbort, { once: true });
      });
      return `sha256:${w.buildKey}`;
    },
    async cancel(w) {
      this.cancels.push(w.buildKey);
    },
  };
}

describe("BuildKey single-flight、失败扇出和预算", () => {
  it("同 BuildKey 只跑一次 lookup/build;等待者不重复上传", async () => {
    const provider = scriptedProvider({
      lookup: () => undefined,
      build: async (key) => {
        await new Promise((r) => setTimeout(r, 20));
        return `sha256:${key}`;
      },
    });
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("bk-a"), work("bk-a"), work("bk-a")], {
      timing,
      provider,
      maxConcurrency: 4,
    });
    expect(provider.lookups).toEqual(["bk-a"]);
    expect(provider.builds).toEqual(["bk-a"]);
    expect(prep.locators.get("bk-a")).toBe("sha256:bk-a");
    expect(prep.records).toHaveLength(1);
    expect(prep.records[0]?.status).toBe("built");
  });

  it("cache hit 留下查询 activity 与 status:hit;完全携带的 key 不进 works 则无 provenance", async () => {
    const provider = scriptedProvider({
      lookup: (key) => (key === "cached" ? "sha256:cached" : undefined),
    });
    const timing = createRunTimingRecorder(() => 100);
    const prep = await prepareSandboxBuilds([work("cached")], { timing, provider });
    expect(provider.builds).toEqual([]);
    expect(prep.records[0]).toMatchObject({ buildKey: "cached", status: "hit", locator: "sha256:cached" });
    expect(timing.finalize()?.[0]?.key).toBe(SANDBOX_BUILD_ACTIVITY);

    const empty = await prepareSandboxBuilds([], {
      timing: createRunTimingRecorder(),
      provider: scriptedProvider({}),
    });
    expect(empty.records).toEqual([]);
    expect(empty.locators.size).toBe(0);
  });

  it("确定性失败只执行一次;依赖者共用同一 Run timing origin", async () => {
    const provider = scriptedProvider({
      lookup: () => undefined,
      build: async () => {
        throw new Error("dockerfile syntax error");
      },
    });
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("bad"), work("bad")], { timing, provider });
    expect(provider.builds).toEqual(["bad"]);
    const failure = prep.failures.get("bad");
    expect(failure?.status).toBe("failed");
    expect(failure?.timingNodeId).toBe(prep.records[0]?.timingNodeId);
    expect(prep.records[0]?.status).toBe("failed");
    expect(timing.finalize()?.[0]?.failed).toBe(true);

    const origin = buildFailureOrigin(failure!);
    expect(runOrigin(origin.timingNodeId)).toEqual({ scope: "run", timingNodeId: failure!.timingNodeId });
    expect(origin.code).toBe("sandbox-build-failed");
  });

  it("不依赖失败 key 的构建照常成功", async () => {
    const provider = scriptedProvider({
      lookup: () => undefined,
      build: async (key) => {
        if (key === "bad") throw new Error("boom");
        return `sha256:${key}`;
      },
    });
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("bad"), work("good")], {
      timing,
      provider,
      maxConcurrency: 2,
    });
    expect(prep.failures.has("bad")).toBe(true);
    expect(prep.locators.get("good")).toBe("sha256:good");
    expect(prep.failures.has("good")).toBe(false);
  });

  it("独立并发上限:同时 in-flight 的 BuildKey 不超过 maxConcurrency", async () => {
    let inflight = 0;
    let peak = 0;
    const provider = scriptedProvider({
      lookup: () => undefined,
      build: async (key) => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 30));
        inflight -= 1;
        return `sha256:${key}`;
      },
    });
    const timing = createRunTimingRecorder(() => 0);
    await prepareSandboxBuilds([work("a"), work("b"), work("c"), work("d")], {
      timing,
      provider,
      maxConcurrency: 2,
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(provider.builds).toHaveLength(4);
  });

  it("逐 key timeout → cancelled + cancel()", async () => {
    const provider = signalAwareProvider();
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("slow")], {
      timing,
      provider,
      buildTimeoutMs: 30,
    });
    expect(prep.records[0]?.status).toBe("cancelled");
    expect(prep.failures.get("slow")?.error.code).toBe("sandbox-build-timeout");
    expect(provider.cancels).toEqual(["slow"]);
  });

  it("Invocation abort 停止构建并 cancelled", async () => {
    const ac = new AbortController();
    const provider = signalAwareProvider();
    // 在 lookup 阶段就 abort,模拟 Ctrl+C 打断准备。
    const wrapping: SandboxBuildProvider = {
      async lookup(w, signal) {
        ac.abort();
        if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return undefined;
      },
      build: provider.build.bind(provider),
      cancel: provider.cancel?.bind(provider),
    };
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("x")], {
      timing,
      provider: wrapping,
      signal: ac.signal,
    });
    expect(prep.records[0]?.status).toBe("cancelled");
    expect(prep.failures.get("x")?.error.code).toBe("sandbox-build-cancelled");
  });

  it("全局准备上限触发 cancelled", async () => {
    const provider = signalAwareProvider();
    const timing = createRunTimingRecorder(() => 0);
    const prep = await prepareSandboxBuilds([work("budget")], {
      timing,
      provider,
      prepareBudgetMs: 30,
    });
    expect(prep.records[0]?.status).toBe("cancelled");
    expect(prep.failures.get("budget")?.error.code).toBe("sandbox-build-timeout");
  });

  it("共享构建时间只在 Run timings 出现;records 不复制 durationMs", async () => {
    let t = 0;
    const timing = createRunTimingRecorder(() => t);
    const provider = scriptedProvider({
      lookup: () => undefined,
      build: async (key) => {
        t += 600_000;
        return `sha256:${key}`;
      },
    });
    const prep = await prepareSandboxBuilds([work("cold")], { timing, provider });
    const roots = timing.finalize();
    expect(roots?.[0]?.durationMs).toBe(600_000);
    expect(prep.records[0] && "durationMs" in prep.records[0]).toBe(false);
    expect(prep.records[0]?.timingNodeId).toBe(roots?.[0]?.id);
  });
});
