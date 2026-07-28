// cases: docs/engineering/testing/unit/reports.md
//
// 覆盖类别:「--json 投影」。本文件只证明 envelope 字段与跨视图不变量:format/schemaVersion/view/scope 回显;同 fixture
// 下 text 面与 --json 面选出同一批实体、共有派生字段同值(由同一次组件 resolve 产物构造保证,
// 不是两套手写投影分别实现再比对);JSON 是 text 的数据超集(允许保留 text 省略的字段,不能
// 反向要求字段集合相等);字段名复用落盘类型、不重命名;timing 的 JSON 面恒为完整树,不受
// --timing=summary/full 影响;与 --report、--expand、重复证据 flag 的互斥用法错误;stdout 只有
// 单个 JSON 文档。逐视图 `data` 的完整字段形状(deltaTableData/stabilityMatrixData/
// usageTableData/attempt-detail 各 *Data)不在本文件重复断言,单源在各自组件的测试里。

import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRecord } from "../record/index.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";
import { runShow, type ShowFlags } from "./index.ts";
import type { ShowJson } from "./json.ts";
import { setConfiguredLocale } from "../i18n/index.ts";

// ───────────────────────── fixture 工具(同 show.test.ts 的最小子集,自成一份不跨文件耦合) ─────────────────────────

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-show-json-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

beforeAll(() => {
  setConfiguredLocale("en");
});
afterAll(() => {
  setConfiguredLocale(undefined);
});

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "startedAt" | "usage" | "phases">>;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

function cleanDirName(id: string): string {
  return id.replace(/[^\w.@-]/g, "_");
}

interface SnapshotOpts {
  experimentId: string;
  agent?: string;
  startedAt: string;
}

async function writeSnapshot(root: string, snapDirName: string, opts: SnapshotOpts, results: AttemptFixture[]): Promise<void> {
  const dir = join(root, cleanDirName(opts.experimentId), snapDirName);
  await mkdir(dir, { recursive: true });
  const meta = {
    format: RECORD_FORMAT,
    schemaVersion: RECORD_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    runId: `${snapDirName}-0000-4000-8000-000000000000`,
    experimentId: opts.experimentId,
    agent: opts.agent ?? "bub",
    startedAt: opts.startedAt,
    configHash: "fixture-config",
    completedAt: opts.startedAt,
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
}

interface Captured {
  out: string;
  err: string;
  code: number;
}

async function show(root: string, patterns: string[], flags: ShowFlags = {}): Promise<Captured> {
  let out = "";
  let err = "";
  const code = await runShow(root, patterns, { record: root, ...flags }, {
    out: (s) => (out += s),
    err: (s) => (err += s),
    width: 100,
    now: Date.parse("2026-07-09T10:01:00.000Z"),
  });
  return { out, err, code };
}

async function showJson(root: string, patterns: string[], flags: ShowFlags = {}): Promise<{ doc: ShowJson; err: string; code: number }> {
  const { out, err, code } = await show(root, patterns, { ...flags, json: true });
  expect(code, `expected --json call to succeed; stderr: ${err}`).toBe(0);
  return { doc: JSON.parse(out) as ShowJson, err, code };
}

// ───────────────────────── envelope 形状 ─────────────────────────

describe("--json envelope 形状", () => {
  async function seedTwoExperimentsRoot(): Promise<string> {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev-e2b/codex", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", { estimatedCostUSD: 0.05, usage: { inputTokens: 100, outputTokens: 20 } }),
      res("weather/queens", "failed"),
    ]);
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev-e2b/claude", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    return root;
  }

  it("leaderboard:format/schemaVersion/view/scope 回显", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, []);
    expect(doc.format).toBe("niceeval.show");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.view).toBe("leaderboard");
    expect(doc.scope.resultsRoot).toBe(root);
    expect(doc.scope.fresh).toBe(false);
    expect(doc.scope.experiments.sort()).toEqual(["dev-e2b/claude", "dev-e2b/codex"]);
    expect(doc.scope.evalPrefix).toBeUndefined();
  });

  it("compare:view 与 scope.experiments 顺序即条件顺序,首个是基准", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, [], { experiment: ["dev-e2b/codex", "dev-e2b/claude"] });
    expect(doc.view).toBe("compare");
    expect(doc.scope.experiments).toEqual(["dev-e2b/codex", "dev-e2b/claude"]);
  });

  it("eval id 前缀回显进 scope.evalPrefix", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, ["weather/brooklyn"]);
    expect(doc.scope.evalPrefix).toBe("weather/brooklyn");
  });

  it("--fresh 回显进 scope.fresh", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, [], { fresh: true });
    expect(doc.scope.fresh).toBe(true);
  });

  it("usage:view 为 usage,scope.experiments 反映 --exp 收窄", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, [], { experiment: ["dev-e2b/codex"], usage: true });
    expect(doc.view).toBe("usage");
    expect(doc.scope.experiments).toEqual(["dev-e2b/codex"]);
  });

  it("stats:view 为 stats", async () => {
    const root = await seedTwoExperimentsRoot();
    const { doc } = await showJson(root, [], { stats: true });
    expect(doc.view).toBe("stats");
  });

  it("@<locator> 默认首页:view 为 attempt", async () => {
    const root = await seedTwoExperimentsRoot();
    const results = await openRecord(root);
    const locator = results.experiments.find((e) => e.id === "dev-e2b/codex")!.latestRun.evals[0]!.attempts[0]!.locator!;
    const { doc } = await showJson(root, [locator]);
    expect(doc.view).toBe("attempt");
    expect(doc.scope.experiments).toEqual(["dev-e2b/codex"]);
  });
});

// ───────────────────────── text 面与 --json 面同一批实体、共有字段同值 ─────────────────────────

describe("--json 与 text 面同值(同一次组件 resolve 产物)", () => {
  it("--usage:text 面的成本/token 数字与 --json 该行的落盘字段同值", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", { estimatedCostUSD: 0.05, usage: { inputTokens: 100, outputTokens: 20 } }),
      res("weather/queens", "failed"),
    ]);
    const text = await show(root, [], { experiment: ["dev/e2b"], usage: true });
    const { doc } = await showJson(root, [], { experiment: ["dev/e2b"], usage: true });
    expect(text.code).toBe(0);
    const rows = doc.data as { locator: string; evalId: string; estimatedCostUSD?: number; usage?: { outputTokens: number } }[];
    const brooklyn = rows.find((r) => r.evalId === "weather/brooklyn")!;
    // 同一个 fixture:text 面渲染出的成本数字与 --json 该 attempt 的落盘字段一致——两面消费的是
    // 同一次 usageRowsOf() 产物(show/index.ts 的 usageRowsOf),不是各自重新聚合的两份数字。
    expect(text.out).toContain("$0.05");
    expect(brooklyn.estimatedCostUSD).toBe(0.05);
    expect(brooklyn.usage?.outputTokens).toBe(20);
    // 两面选出同一批实体:text 面两行都出现,json 面两行都出现,locator 集合相同。
    const jsonLocators = rows.map((r) => r.locator).sort();
    const textLocators = [...text.out.matchAll(/@[0-9a-z]+/g)].map((m) => m[0]).sort();
    expect(jsonLocators).toEqual(textLocators);
  });

  it("--json 是 text 的数据超集:text 面的缺失占位 — 在 JSON 里是整字段省略,不是 0", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/queens", "failed"),
    ]);
    const text = await show(root, [], { experiment: ["dev/e2b"], usage: true });
    const { doc } = await showJson(root, [], { experiment: ["dev/e2b"], usage: true });
    const row = (doc.data as globalThis.Record<string, unknown>[])[0]!;
    const queensLine = text.out.split("\n").find((l) => l.includes("weather/queens"))!;
    expect(queensLine.trim().endsWith("—")).toBe(true);
    expect("usage" in row).toBe(false);
    expect("estimatedCostUSD" in row).toBe(false);
    expect("turns" in row).toBe(false);
  });

  it("字段名复用落盘类型,不重命名(UsageTableData 的身份字段原样出现)", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { doc } = await showJson(root, [], { experiment: ["dev/e2b"], usage: true });
    const row = (doc.data as globalThis.Record<string, unknown>[])[0]!;
    expect(Object.keys(row).sort()).toEqual(["attempt", "evalId", "experimentId", "locator", "verdict"].sort());
  });
});

// ───────────────────────── timing:JSON 恒为完整树 ─────────────────────────

describe("--timing 的 --json 面恒为完整树", () => {
  it("--timing(summary) 与 --timing=full 的 --json data 逐字节相同——不受 text 预算影响", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", {
        phases: [
          { name: "sandbox.queue", durationMs: 10 },
          { name: "sandbox.create", durationMs: 200 },
          { name: "agent.setup", durationMs: 300 },
        ],
      }),
    ]);
    const locator = (await openRecord(root)).experiments[0]!.latestRun.evals[0]!.attempts[0]!.locator!;
    const summaryDoc = await showJson(root, [locator], { timing: true });
    const fullDoc = await showJson(root, [locator], { timing: "full" });
    expect(summaryDoc.doc.data).toEqual(fullDoc.doc.data);
    expect(summaryDoc.doc.data).not.toBeNull();
  });
});

// ───────────────────────── history:AttemptJson 全字段投影(不进组件模型) ─────────────────────────

describe("--history 的 --json 面:直接投影 AttemptJson,不是 text 面的单行摘要", () => {
  it("分节按 experimentId + evalId,每条 attempt 携带完整落盘字段 + 归属身份", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed", { assertions: [], durationMs: 1234 }),
    ]);
    const { doc } = await showJson(root, [], { history: true });
    const sections = doc.data as { experimentId: string; evalId: string; attempts: globalThis.Record<string, unknown>[] }[];
    expect(sections).toHaveLength(1);
    expect(sections[0]!.experimentId).toBe("dev/e2b");
    expect(sections[0]!.evalId).toBe("weather/brooklyn");
    const attempt = sections[0]!.attempts[0]!;
    // AttemptJson = 落盘 AttemptRecord 全字段 + 归属身份;durationMs/assertions 这类落盘字段
    // 原样出现(text 面的 attemptHistory 反而把它们折成单行摘要,不包含这些字段)。
    expect(attempt.durationMs).toBe(1234);
    expect(attempt.assertions).toEqual([]);
    expect(attempt.experimentId).toBe("dev/e2b");
    expect(attempt.snapshotStartedAt).toBe("2026-07-08T10:00:00.000Z");
  });
});

// ───────────────────────── 用法冲突 ─────────────────────────

describe("--json 的用法冲突", () => {
  it("与 --report 互斥", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { err, code } = await show(root, [], { json: true, report: "reports/x.tsx" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("fix:");
    expect(err).toContain("--json cannot combine with --report");
  });

  it("与 --expand 互斥", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { err, code } = await show(root, [], { json: true, execution: true, expand: "t1.c1" });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("--json cannot combine with --expand");
  });

  it("同时点多个证据 flag 时按用法错误退出:JSON 的 view 是单一枚举值,没有合并形状", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { err, code } = await show(root, [], { json: true, source: true, execution: true });
    expect(code).toBe(1);
    expect(err).toContain("error:");
    expect(err).toContain("--json requires exactly one of");
  });
});

// ───────────────────────── stdout 单文档 ─────────────────────────

describe("--json 的 stdout 形状", () => {
  it("stdout 只有一个 JSON 文档:单行 + 末尾换行,不是 NDJSON", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-08T10-00-00-000Z", { experimentId: "dev/e2b", startedAt: "2026-07-08T10:00:00.000Z" }, [
      res("weather/brooklyn", "passed"),
    ]);
    const { out, code } = await show(root, [], { json: true });
    expect(code).toBe(0);
    const newlineCount = (out.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
    expect(out.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
