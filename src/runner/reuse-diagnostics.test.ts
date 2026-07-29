// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别「Sandbox 复用」的复用污染诊断。
//
// 只指路不改判定,所以这里只断言「发不发、点名了谁」:某实例承接序号 ≥ 2 的 Attempt 集中失败
// 于同一阶段才发;首承接失败或失败不聚集时不发(不误报)。

import { describe, expect, it } from "vitest";
import { detectReuseContamination, reuseContaminationMessage } from "./reuse-diagnostics.ts";
import type { EvalResult, LifecyclePhase } from "./types.ts";

function attempt(opts: {
  id: string;
  verdict: EvalResult["verdict"];
  reuseSandbox: number;
  reuseOrdinal: number;
  phase?: LifecyclePhase;
  experimentId?: string;
  reused?: boolean;
}): EvalResult {
  return {
    id: opts.id,
    experimentId: opts.experimentId ?? "reuse-exp",
    agent: "fake",
    verdict: opts.verdict,
    attempt: 0,
    startedAt: new Date().toISOString(),
    durationMs: 1,
    assertions: [],
    ...(opts.phase !== undefined ? { error: { code: "unexpected-error", message: "boom", phase: opts.phase } } : {}),
    sandbox: {
      provider: "docker",
      sandboxId: `sbx-${opts.reuseSandbox}`,
      ...(opts.reused === false ? {} : { reused: true as const }),
      reuseSandbox: opts.reuseSandbox,
      reuseOrdinal: opts.reuseOrdinal,
    },
  } as EvalResult;
}

describe("detectReuseContamination", () => {
  it("首承接正常、后续承接集中 errored 在同一阶段时,点名实例、序号区间与阶段", () => {
    const notices = detectReuseContamination([
      attempt({ id: "a", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 1 }),
      attempt({ id: "b", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 2, phase: "eval.setup" }),
      attempt({ id: "c", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 4, phase: "eval.setup" }),
    ]);

    expect(notices).toEqual([
      { experimentId: "reuse-exp", reuseSandbox: 1, phase: "eval.setup", fromOrdinal: 2, toOrdinal: 4, count: 2 },
    ]);
    const message = reuseContaminationMessage(notices[0]!);
    expect(message).toContain("#1");
    expect(message).toContain("2-4");
    expect(message).toContain("eval.setup");
  });

  it("首承接自己就失败时不发:那种失败与上一条 Attempt 的残留无关", () => {
    expect(
      detectReuseContamination([
        attempt({ id: "a", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 1, phase: "eval.setup" }),
        attempt({ id: "b", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 2, phase: "eval.setup" }),
        attempt({ id: "c", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 3, phase: "eval.setup" }),
      ]),
    ).toEqual([]);
  });

  it("后续失败不聚集(散在不同阶段、或只有一条)时不发", () => {
    expect(
      detectReuseContamination([
        attempt({ id: "a", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 1 }),
        attempt({ id: "b", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 2, phase: "eval.setup" }),
        attempt({ id: "c", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 3, phase: "agent.setup" }),
        attempt({ id: "d", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 4 }),
      ]),
    ).toEqual([]);
  });

  it("同一实验的两台实例各自判定,互不串味", () => {
    const notices = detectReuseContamination([
      attempt({ id: "a", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 1 }),
      attempt({ id: "b", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 2, phase: "eval.setup" }),
      // 2 号实例首承接就失败:它的后续失败不算线索,不能被 1 号的证据带出来。
      attempt({ id: "c", verdict: "errored", reuseSandbox: 2, reuseOrdinal: 1, phase: "eval.setup" }),
      attempt({ id: "d", verdict: "errored", reuseSandbox: 2, reuseOrdinal: 2, phase: "eval.setup" }),
      attempt({ id: "e", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 3, phase: "eval.setup" }),
    ]);

    expect(notices.map((n) => n.reuseSandbox)).toEqual([1]);
  });

  it("断言失败(没有 error.phase)按判定发生地 eval.run 聚合", () => {
    const notices = detectReuseContamination([
      attempt({ id: "a", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 1 }),
      attempt({ id: "b", verdict: "failed", reuseSandbox: 1, reuseOrdinal: 2 }),
      attempt({ id: "c", verdict: "failed", reuseSandbox: 1, reuseOrdinal: 3 }),
    ]);

    expect(notices).toEqual([
      { experimentId: "reuse-exp", reuseSandbox: 1, phase: "eval.run", fromOrdinal: 2, toOrdinal: 3, count: 2 },
    ]);
  });

  it("没有声明复用的结果不参与判定(一次性沙箱的失败与复用无关)", () => {
    expect(
      detectReuseContamination([
        attempt({ id: "a", verdict: "passed", reuseSandbox: 1, reuseOrdinal: 1, reused: false }),
        attempt({ id: "b", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 2, reused: false, phase: "eval.setup" }),
        attempt({ id: "c", verdict: "errored", reuseSandbox: 1, reuseOrdinal: 3, reused: false, phase: "eval.setup" }),
      ]),
    ).toEqual([]);
  });
});
