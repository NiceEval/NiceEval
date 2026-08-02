// cases: docs/engineering/testing/unit/experiments-runner.md
// Json/JUnit 的同目录 temp → write → rename 原子替换契约(见 docs/feature/experiments/cli.md
// 「输出流和落盘节奏」):成功后不留 temp;写入失败保留旧目标文件、不留半成品、不留 temp。
//
// `node:fs/promises` 的具名导出在这个 Vitest 环境下是不可配置的 ESM 绑定(`vi.spyOn` 直接
// 报 "Module namespace is not configurable")——只能靠 `vi.mock` 在模块解析层整体替换,
// 其余全部转发给真实实现(`importOriginal`),只在 `failureState` 显式设置时让 rename/
// writeFile 失败一次(用后即清,不影响后续调用或其它测试)。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile as realWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Json, JUnit } from "./json.ts";
import type { InvocationSummary } from "../../types.ts";
import { completeEvidenceCoverage } from "../../scoring/coverage.ts";

const failureState = vi.hoisted(() => ({
  renameError: undefined as Error | undefined,
  writeFileError: undefined as Error | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (failureState.renameError) {
        const e = failureState.renameError;
        failureState.renameError = undefined;
        throw e;
      }
      return actual.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (failureState.writeFileError) {
        const e = failureState.writeFileError;
        failureState.writeFileError = undefined;
        throw e;
      }
      return actual.writeFile(...args);
    },
  };
});

function summary(overrides: Partial<InvocationSummary> = {}): InvocationSummary {
  return {
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:01:00.000Z",
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    durationMs: 1000,
    results: [],
    ...overrides,
  };
}

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-json-atomic-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  failureState.renameError = undefined;
  failureState.writeFileError = undefined;
});

/** 目录里是否残留 `.tmp` 临时文件(atomicWriteFile 用 `.niceeval-<uuid>.tmp` 命名)。 */
async function tmpFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
}

describe("Json · 原子替换", () => {
  it("成功写入合法 JSON,写完不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.json");

    await Json(path).onInvocationComplete!(summary({ passed: 3 }));

    const parsed = JSON.parse(await readFile(path, "utf-8"));
    expect(parsed.passed).toBe(3);
    expect(await tmpFilesIn(root)).toEqual([]);
  });

  it("rename 失败时保留旧目标文件原内容,不留截断 JSON,不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.json");
    await realWriteFile(path, '{"old":"content"}', "utf-8"); // 上一轮已经成功写过一份

    failureState.renameError = new Error("simulated rename failure");
    await expect(Json(path).onInvocationComplete!(summary({ passed: 99 }))).rejects.toThrow("simulated rename failure");

    // 旧内容原封不动——没有被替换成半成品,也没有被新内容(passed: 99)覆盖。
    expect(await readFile(path, "utf-8")).toBe('{"old":"content"}');
    expect(await tmpFilesIn(root)).toEqual([]);
  });

  it("写临时文件本身失败时不产生新目标文件,也不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.json"); // 目标此前不存在

    failureState.writeFileError = new Error("simulated write failure");
    await expect(Json(path).onInvocationComplete!(summary())).rejects.toThrow("simulated write failure");

    expect(await readdir(root)).toEqual([]); // 没有凭空出现半成品目标文件
  });

  it("rename 目标是一个已存在目录时必然失败(POSIX 语义,不依赖权限/是否 root)——旧目录原样保留,不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path); // 占用目标路径的不是文件而是目录——rename 一个文件覆盖已存在目录恒失败

    await expect(Json(path).onInvocationComplete!(summary())).rejects.toThrow();

    const entries = await readdir(root);
    expect(entries).toEqual(["out.json"]); // 目录还在,没有被替换、也没有多出 temp 文件残留
  });
});

describe("JUnit · 原子替换", () => {
  it("成功写入合法 XML,写完不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.xml");

    await JUnit(path).onInvocationComplete!(
      summary({
        results: [
          {
            id: "a/1",
            agent: "codex",
            verdict: "passed",
            attempt: 0,
            durationMs: 10,
            assertions: [],
            evidenceCoverage: completeEvidenceCoverage,
          },
        ],
      }),
    );

    const xml = await readFile(path, "utf-8");
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<testsuite");
    expect(await tmpFilesIn(root)).toEqual([]);
  });

  it("rename 失败时保留旧目标文件原内容,不留截断 XML,不留 temp 文件", async () => {
    const root = await makeRoot();
    const path = join(root, "out.xml");
    await realWriteFile(path, "<old/>", "utf-8");

    failureState.renameError = new Error("simulated rename failure");
    await expect(JUnit(path).onInvocationComplete!(summary())).rejects.toThrow("simulated rename failure");

    expect(await readFile(path, "utf-8")).toBe("<old/>");
    expect(await tmpFilesIn(root)).toEqual([]);
  });
});
