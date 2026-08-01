// cases: docs/engineering/testing/unit/experiments-runner.md

import { describe, expect, it } from "vitest";
import { resolveJudge } from "./judge-config.ts";

describe("resolveJudge", () => {
  it("按 Experiment → Eval → Config 逐字段解析，而不是整体覆盖", () => {
    expect(
      resolveJudge(
        { model: "experiment-model", timeoutMs: 90_000 },
        { model: "eval-model", baseUrl: "https://eval.example/v1" },
        { model: "config-model", baseUrl: "https://config.example/v1", apiKeyEnv: "JUDGE_KEY", timeoutMs: 180_000 },
      ),
    ).toEqual({
      model: "experiment-model",
      baseUrl: "https://eval.example/v1",
      apiKeyEnv: "JUDGE_KEY",
      timeoutMs: 90_000,
    });
  });

  it("允许 Experiment 只覆盖调用预算，model 从 Eval 补齐", () => {
    expect(resolveJudge({ timeoutMs: 300_000 }, { model: "eval-model" }, undefined)).toEqual({
      model: "eval-model",
      timeoutMs: 300_000,
    });
  });

  it("三层都省略时保持未配置，不伪造默认 model", () => {
    expect(resolveJudge(undefined, undefined, undefined)).toBeUndefined();
  });
});
