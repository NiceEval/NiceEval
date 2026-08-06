// cases: docs/engineering/testing/unit/experiments-runner.md
// exp rename 的 CLI 纯解析与格式化(覆盖规范「实验改名与结果重绑」):位置参数校验、误用
// flag 拦截、plan / rejected / done 三种文档的人读与 JSON 投影、资格错误到 rejected 文档的
// 投影,以及 blocked / rejected 整批零写入的退出码。单元层不起 CLI 进程——真实命令的 argv、
// stdout/stderr、退出码经进程由 E2E 验收,这里只测可抽出的纯函数。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfiguredLocale } from "./i18n/index.ts";
import { ExperimentRenameError } from "./runner/rename-experiment.ts";
import type { ExperimentRenamePlan, ExperimentRenameRejected, RenamedExperiment } from "./runner/rename-experiment.ts";
import {
  experimentRenameExitCode,
  experimentRenameRejectedFromError,
  firstExperimentRenameUnsupportedFlag,
  parseExperimentRenamePositionals,
  renderExperimentRenameDoneHuman,
  renderExperimentRenameJson,
  renderExperimentRenamePlanHuman,
  renderExperimentRenameRejectedHuman,
  type Flags,
} from "./cli.ts";

function makeFlags(over: Partial<Flags> = {}): Flags {
  return {
    agent: undefined,
    model: undefined,
    attempts: undefined,
    maxConcurrency: undefined,
    maxBuildConcurrency: undefined,
    timeout: undefined,
    earlyExit: undefined,
    dry: false,
    force: false,
    rerun: undefined,
    strict: false,
    budget: undefined,
    tag: undefined,
    junit: undefined,
    json: false,
    open: undefined,
    out: undefined,
    port: undefined,
    host: undefined,
    help: false,
    version: false,
    source: undefined,
    execution: false,
    diff: false,
    diffPath: undefined,
    grep: undefined,
    expand: undefined,
    timing: undefined,
    keepSandbox: undefined,
    all: false,
    window: undefined,
    sandboxPath: undefined,
    leaveRunning: false,
    history: false,
    usage: false,
    stats: false,
    experiment: undefined,
    record: undefined,
    run: undefined,
    report: undefined,
    page: undefined,
    theme: undefined,
    orphans: false,
    teardown: false,
    ...over,
  };
}

const readyPlan: ExperimentRenamePlan = {
  status: "plan",
  oldId: "codex",
  newId: "codex-5.6-luna",
  migrations: [
    { evalId: "memory/a", sourceLocator: "@1A2B", targetExperimentId: "codex-5.6-luna", fingerprint: "f1" },
    { evalId: "memory/b", sourceLocator: "@3C4D", targetExperimentId: "codex-5.6-luna", fingerprint: "f1" },
  ],
  excluded: [
    { evalId: "memory/c", reason: "codex-5.6-luna no longer selects this eval" },
  ],
};

const blockedPlan: ExperimentRenamePlan = {
  status: "plan",
  oldId: "codex",
  newId: "codex-5.6-luna",
  migrations: [],
  excluded: [],
  blocked: {
    reason: "source-unreadable",
    detail: "run metadata is malformed",
  },
};

const rejected: ExperimentRenameRejected = {
  status: "rejected",
  oldId: "codex",
  newId: "codex-5.6-luna",
  reason: "target-has-results",
  conflictingEvals: ["memory/a", "memory/b"],
};

const doneDoc: RenamedExperiment = {
  status: "done",
  oldId: "codex",
  newId: "codex-5.6-luna",
  snapshotPath: ".niceeval/codex-5.6-luna/01J5R0H3K8",
  migrated: [
    {
      evalId: "memory/a",
      sourceLocator: "@1A2B",
      locator: "@9Z8Y",
      fingerprint: "f1",
      verdict: "passed",
      renamedFrom: {
        experimentId: "codex",
        locator: "@1A2B",
        fingerprint: "f1",
        at: "2026-08-06T00:00:00.000Z",
      },
    },
  ],
};

describe("exp rename 位置参数解析", () => {
  it("恰好两个参数:旧 id 与 新 id", () => {
    expect(parseExperimentRenamePositionals(["codex", "codex-5.6-luna"])).toEqual({
      ok: true,
      oldId: "codex",
      newId: "codex-5.6-luna",
    });
  });

  it("0 / 1 / 3 个参数都按用法错误", () => {
    expect(parseExperimentRenamePositionals([])).toEqual({ ok: false, kind: "usage" });
    expect(parseExperimentRenamePositionals(["codex"])).toEqual({ ok: false, kind: "usage" });
    expect(parseExperimentRenamePositionals(["codex", "a", "b"])).toEqual({ ok: false, kind: "usage" });
  });
});

describe("exp rename 误用 flag 拦截", () => {
  it("--dry / --json 是唯一允许的 flag", () => {
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ dry: true, json: true }))).toBeUndefined();
    expect(firstExperimentRenameUnsupportedFlag(makeFlags())).toBeUndefined();
  });

  it("运行/查看类 flag 全部拒绝,返回第一个误用项", () => {
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ record: "publish" }))).toBe("--record");
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ force: true }))).toBe("--force");
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ rerun: "all" }))).toBe("--rerun");
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ teardown: true }))).toBe("--teardown");
  });

  it("负向 flag(no-open / no-early-exit)即使值为 false 也是显式使用,按误用拒绝", () => {
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ earlyExit: false }))).toBe("--early-exit/--no-early-exit");
    expect(firstExperimentRenameUnsupportedFlag(makeFlags({ open: false }))).toBe("--open/--no-open");
  });
});

describe("exp rename 人读面", () => {
  beforeEach(() => {
    setConfiguredLocale("en");
  });
  afterEach(() => {
    setConfiguredLocale(undefined);
  });

  it("--dry 预览逐条列出迁移与排除", () => {
    const text = renderExperimentRenamePlanHuman(readyPlan);
    expect(text).toContain("exp rename preview: codex -> codex-5.6-luna");
    expect(text).toContain("2 terminal results will migrate");
    expect(text).toContain("memory/a  @1A2B -> codex-5.6-luna");
    expect(text).toContain("memory/b  @3C4D -> codex-5.6-luna");
    expect(text).toContain("1 excluded");
    expect(text).toContain("memory/c  codex-5.6-luna no longer selects this eval");
  });

  it("blocked 预览给出 reason 与底层读取详情", () => {
    const text = renderExperimentRenamePlanHuman(blockedPlan);
    expect(text).toContain("blocked (nothing will be written): source-unreadable");
    expect(text).toContain("run metadata is malformed");
  });

  it("拒绝的人读面给出 reason 专属文案与冲突 eval", () => {
    const text = renderExperimentRenameRejectedHuman(rejected);
    expect(text).toContain("codex-5.6-luna already has terminal results");
    expect(text).toContain("conflicting evals: memory/a, memory/b");
  });

  it("成功输出点名 snapshot 路径与逐条新 locator", () => {
    const text = renderExperimentRenameDoneHuman(doneDoc);
    expect(text).toContain("exp rename done: rebound 1 terminal results from codex to codex-5.6-luna.");
    expect(text).toContain("new snapshot: .niceeval/codex-5.6-luna/01J5R0H3K8");
    expect(text).toContain("memory/a  @1A2B -> @9Z8Y");
  });
});

describe("exp rename 机器面(--json 单文档)", () => {
  it("plan 文档形状稳定且不混入人读文本", () => {
    const doc = JSON.parse(renderExperimentRenameJson(readyPlan)) as Record<string, unknown>;
    expect(doc.format).toBe("niceeval.experimentRename");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.status).toBe("plan");
    expect(doc.oldId).toBe("codex");
    expect(doc.newId).toBe("codex-5.6-luna");
    expect(renderExperimentRenameJson(readyPlan)).not.toContain("preview");
  });

  it("rejected 文档使用稳定 reason,不混入人读 error 文本", () => {
    const json = renderExperimentRenameJson(rejected);
    const doc = JSON.parse(json) as { status: string; reason: string; conflictingEvals: string[] };
    expect(doc.status).toBe("rejected");
    expect(doc.reason).toBe("target-has-results");
    expect(doc.conflictingEvals).toEqual(["memory/a", "memory/b"]);
    expect(json).not.toContain("error:");
  });

  it("done 文档保留逐条 renamedFrom 审计字段", () => {
    const doc = JSON.parse(renderExperimentRenameJson(doneDoc)) as {
      status: string;
      snapshotPath: string;
      migrated: Array<{ renamedFrom: { experimentId: string; locator: string; fingerprint: string; at: string } }>;
    };
    expect(doc.status).toBe("done");
    expect(doc.snapshotPath).toBe(".niceeval/codex-5.6-luna/01J5R0H3K8");
    expect(doc.migrated[0].renamedFrom).toEqual({
      experimentId: "codex",
      locator: "@1A2B",
      fingerprint: "f1",
      at: "2026-08-06T00:00:00.000Z",
    });
  });
});

describe("资格错误到 rejected 文档的投影", () => {
  it("从 ExperimentRenameError 取稳定 reason 与 blocked 明细", () => {
    const error = new ExperimentRenameError("source-unreadable", "Cannot rename experiment.", blockedPlan);
    const projected = experimentRenameRejectedFromError(error);
    expect(projected).toEqual({
      status: "rejected",
      oldId: "codex",
      newId: "codex-5.6-luna",
      reason: "source-unreadable",
      detail: "run metadata is malformed",
    });
  });

  it("不带 plan 的错误也投影成可读 rejected 文档", () => {
    const error = new ExperimentRenameError("target-not-found", "Cannot rename experiment.");
    const projected = experimentRenameRejectedFromError(error);
    expect(projected.status).toBe("rejected");
    expect(projected.reason).toBe("target-not-found");
    expect(projected.oldId).toBe("");
    expect(projected.detail).toBeUndefined();
  });
});

describe("exp rename 退出码", () => {
  it("可迁移预览与成功执行为 0", () => {
    expect(experimentRenameExitCode(readyPlan)).toBe(0);
    expect(experimentRenameExitCode(doneDoc)).toBe(0);
  });

  it("blocked 预览与 rejected 都按整批零写入失败退出", () => {
    expect(experimentRenameExitCode(blockedPlan)).toBe(1);
    expect(experimentRenameExitCode(rejected)).toBe(1);
  });
});
