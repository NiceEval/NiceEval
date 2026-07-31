// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别「Sandbox 复用」的能力归属与派发前确认。
//
// 能力只能由 Provider 自己实现:池探测实例上的 `ensureLifetime`,探不到就在第一条 Attempt
// 派发前硬失败(见 docs/feature/sandbox/reuse.md「派发前确认」)。这里用 defineSandbox 自定义
// provider 造两种实例——带能力的与不带能力的——因为「带不带」正是被测的那一格;通用记账层
// 一旦回来,不带能力的那条会静默变绿。

import { describe, expect, it } from "vitest";
import { ReusableSandboxPool } from "./sandbox-pool.ts";
import { defineSandbox } from "../define.ts";
import type { CommandResult, Sandbox, SandboxHookContext, SandboxOption } from "../types.ts";

/** 内存沙箱:shell 恒成功(git ledger 锚点/重置都走它),记下收到的命令。 */
function fakeSandbox(id: string, commands: string[]): Sandbox {
  const box: Partial<Sandbox> = {
    workdir: "/workspace",
    sandboxId: id,
    otlpHost: null,
    async runShell(script: string): Promise<CommandResult> {
      commands.push(script);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runCommand(): Promise<CommandResult> {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile() {
      return "";
    },
    async fileExists() {
      return false;
    },
    async writeFiles() {},
    async uploadFiles() {},
    async uploadFile() {},
    async uploadDirectory() {},
    async downloadDirectory() {},
    async downloadFile() {
      return Buffer.from("");
    },
    async stop() {},
  };
  return box as Sandbox;
}

const hookContext: SandboxHookContext = {
  signal: new AbortController().signal,
  progress: () => {},
  diagnostic: () => {},
  fact: () => {},
};

const feedback = { progress: () => {}, diagnostic: () => {} };

function poolFor(spec: SandboxOption, capacity = 1): ReusableSandboxPool {
  return new ReusableSandboxPool(spec, capacity, feedback, hookContext);
}

describe("ReusableSandboxPool · 复用寿命能力只能来自 Provider", () => {
  it("provider 没实现 ensureLifetime 时,第一条 Attempt 派发前就硬失败(没有通用记账兜底)", async () => {
    const commands: string[] = [];
    let stopped = 0;
    const spec = defineSandbox({
      name: "no-lifetime",
      create: async () => {
        const sandbox = fakeSandbox("sbx-no-lifetime", commands);
        return Object.assign(sandbox, {
          stop: async () => {
            stopped += 1;
          },
        });
      },
    });

    await expect(poolFor(spec).acquire(60_000)).rejects.toThrow(/ensureLifetime/);
    // 硬失败不留计费实例;也没走到建锚点这一步。
    expect(stopped).toBe(1);
    expect(commands).toEqual([]);
  });

  it("provider 实现了 ensureLifetime 并确认得下来时,正常借出并按请求的寿命窗口提问", async () => {
    const commands: string[] = [];
    const asked: number[] = [];
    const spec = defineSandbox({
      name: "with-lifetime",
      create: async () =>
        Object.assign(fakeSandbox("sbx-ok", commands), {
          ensureLifetime: async (minRemainingMs: number) => {
            asked.push(minRemainingMs);
            return { ready: true as const, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
          },
        }),
    });

    const pool = poolFor(spec);
    const first = await pool.acquire(60_000);
    expect(first.reuseSandbox).toBe(1);
    expect(first.reuseOrdinal).toBe(1);
    await first.release(true);
    const second = await pool.acquire(60_000);
    expect(second.reuseSandbox).toBe(1); // 同一实例
    expect(second.reuseOrdinal).toBe(2); // 承接序号递增
    await second.release(true);
    await pool.stop();

    // 每次派发前都按 attempt deadline + 收尾预留确认;新实例在 SandboxSpec setup 前后各确认一次。
    expect(asked).toEqual([90_000, 90_000, 90_000]);
  });

  it("provider 报寿命不足时淘汰旧实例、换一台承接(编号不复用,序号从 1 重新起)", async () => {
    const commands: string[] = [];
    let created = 0;
    const stopped: string[] = [];
    const spec = defineSandbox({
      name: "expiring",
      create: async () => {
        created += 1;
        const id = `sbx-${created}`;
        const sandbox = fakeSandbox(id, commands);
        // 第一台在第二次派发前确认时报不够(创建时的两次确认仍通过),第二台一直够。
        let asks = 0;
        return Object.assign(sandbox, {
          stop: async () => {
            stopped.push(id);
          },
          ensureLifetime: async () => {
            asks += 1;
            // 前两次(创建时 setup 前后)通过,第二条 Attempt 派发前报不够。
            return created === 1 && asks > 2
              ? { ready: false as const, reason: "expiring provider leaves 5s" }
              : { ready: true as const };
          },
        });
      },
    });

    const pool = poolFor(spec);
    const first = await pool.acquire(60_000);
    expect(first.reuseSandbox).toBe(1);
    await first.release(true);

    const second = await pool.acquire(60_000);
    expect(second.reuseSandbox).toBe(2);
    expect(second.reuseOrdinal).toBe(1);
    expect(stopped).toEqual(["sbx-1"]);
    await second.release(true);
    await pool.stop();
    expect(stopped).toEqual(["sbx-1", "sbx-2"]);
  });

  it("每次借出都把承接者自己的 attempt deadline 递给实例(不递就落回 provider SDK 的默认上限)", async () => {
    const commands: string[] = [];
    const deadlines: Array<number | undefined> = [];
    const spec = defineSandbox({
      name: "deadline-aware",
      create: async () =>
        Object.assign(fakeSandbox("sbx-deadline", commands), {
          ensureLifetime: async () => ({ ready: true as const }),
          setCommandDeadline: (deadlineAt?: number) => {
            deadlines.push(deadlineAt);
          },
        }),
    });

    const pool = poolFor(spec);
    const before = Date.now();
    const first = await pool.acquire(60_000);
    await first.release(true);
    const second = await pool.acquire(60_000);
    await second.release(true);
    await pool.stop();

    // 两次借出各设一次线;都落在「现在 + attempt deadline + 收尾预留」的窗口里。
    expect(deadlines).toHaveLength(2);
    for (const at of deadlines) {
      expect(at).toBeGreaterThanOrEqual(before + 90_000);
      expect(at).toBeLessThanOrEqual(Date.now() + 90_000);
    }
  });

  it("四层都没声明上限时不发明一条线:借出时递 undefined", async () => {
    const commands: string[] = [];
    const deadlines: Array<number | undefined> = [];
    const spec = defineSandbox({
      name: "no-deadline",
      create: async () =>
        Object.assign(fakeSandbox("sbx-no-deadline", commands), {
          ensureLifetime: async () => ({ ready: true as const }),
          setCommandDeadline: (deadlineAt?: number) => {
            deadlines.push(deadlineAt);
          },
        }),
    });

    const pool = poolFor(spec);
    await (await pool.acquire(undefined)).release(true);
    await pool.stop();
    expect(deadlines).toEqual([undefined]);
  });

  it("新建实例当场就确认不下来寿命时,报错带 provider 给的理由,不反复重建同样的替代实例", async () => {
    const commands: string[] = [];
    let created = 0;
    const spec = defineSandbox({
      name: "too-short",
      create: async () => {
        created += 1;
        return Object.assign(fakeSandbox(`sbx-${created}`, commands), {
          ensureLifetime: async () => ({ ready: false as const, reason: "plan caps the sandbox at 60s" }),
        });
      },
    });

    await expect(poolFor(spec).acquire(60_000)).rejects.toThrow(/plan caps the sandbox at 60s/);
    expect(created).toBe(1);
  });
});
