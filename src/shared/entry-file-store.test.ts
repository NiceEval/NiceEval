// cases: docs/engineering/testing/unit/experiments-runner.md
// 「用例锁与并发 Invocation」的共享原语半部——runner/teardown-registry.ts 与
// sandbox/keep-registry.ts 各自的既有单测已经在验收"零行为变化"的迁移;这里只覆盖
// entry-file-store.ts 自身语义无关的原语契约:写读往返、坏文件跳过、认领互斥、缺目录不抛错。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimEntryFile,
  hashEntryId,
  readAllEntryFiles,
  readEntryFile,
  slugHashEntryId,
  writeEntryFile,
} from "./entry-file-store.ts";

interface TestEntry {
  hello?: string;
  n?: number;
  ok?: boolean;
  v?: number;
  a?: number;
}

function decodeTestEntry(value: unknown): TestEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entry = value as globalThis.Record<string, unknown>;
  if (
    (entry.hello !== undefined && typeof entry.hello !== "string") ||
    (entry.n !== undefined && typeof entry.n !== "number") ||
    (entry.ok !== undefined && typeof entry.ok !== "boolean") ||
    (entry.v !== undefined && typeof entry.v !== "number") ||
    (entry.a !== undefined && typeof entry.a !== "number")
  ) return undefined;
  return entry;
}

let dirs: string[] = [];
async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-entry-file-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe("hashEntryId / slugHashEntryId: 稳定、无碰撞", () => {
  it("同样的 parts 反复调用得到同一个 id(稳定,可跨调用往返)", () => {
    expect(hashEntryId(["a", "1"])).toBe(hashEntryId(["a", "1"]));
  });

  it("不同 parts 得到不同 id(无碰撞)", () => {
    expect(hashEntryId(["a", "1"])).not.toBe(hashEntryId(["a", "2"]));
    expect(hashEntryId(["a", "1"])).not.toBe(hashEntryId(["b", "1"]));
  });

  it("slugHashEntryId 带上可读 slug 前缀,且对同样输入稳定", () => {
    const id = slugHashEntryId("exp/a-case one", ["exp/a", "case one"]);
    expect(id.startsWith("exp-a-case-one-")).toBe(true);
    expect(id).toBe(slugHashEntryId("exp/a-case one", ["exp/a", "case one"]));
  });

  it("slugHashEntryId 对不同 hashParts 产出不同 id,即使 slugSource 相同", () => {
    const a = slugHashEntryId("same-slug", ["x", "1"]);
    const b = slugHashEntryId("same-slug", ["x", "2"]);
    expect(a).not.toBe(b);
  });
});

describe("writeEntryFile / readEntryFile: 写读往返", () => {
  it("写入后按 id 读回,内容与写入时相等", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "abc123", { hello: "world", n: 1 });
    const read = await readEntryFile(dir, "abc123", decodeTestEntry);
    expect(read).toEqual({ hello: "world", n: 1 });
  });

  it("写盘边界拒绝会丢失语义的非 JSON 值，且不会先创建文件", async () => {
    const dir = await makeDir();
    await expect(writeEntryFile(dir, "date", { createdAt: new Date("2026-01-01") })).rejects.toThrow(/plain JSON tree/);
    await expect(writeEntryFile(dir, "function", { run: () => 1 })).rejects.toThrow(/plain JSON tree/);
    await expect(writeEntryFile(dir, "nan", { value: Number.NaN })).rejects.toThrow(/plain JSON tree/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("写盘边界拒绝循环引用", async () => {
    const dir = await makeDir();
    const cycle: globalThis.Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(writeEntryFile(dir, "cycle", cycle)).rejects.toThrow(/acyclic/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("写入不残留 .tmp 临时文件", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "abc123", { a: 1 });
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files).toEqual(["abc123.json"]);
  });

  it("读不存在的 id 返回 undefined,不抛错", async () => {
    const dir = await makeDir();
    expect(await readEntryFile(dir, "nothing", decodeTestEntry)).toBeUndefined();
  });

  it("读损坏 JSON 返回 undefined,不抛错", async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.json"), "{not json", "utf-8");
    expect(await readEntryFile(dir, "bad", decodeTestEntry)).toBeUndefined();
  });

  it("读不存在的目录返回 undefined,不抛错", async () => {
    const missing = join((await makeDir()), "does-not-exist");
    expect(await readEntryFile(missing, "any", decodeTestEntry)).toBeUndefined();
  });

  it("再次写入同一个 id 会覆盖旧内容", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "abc123", { v: 1 });
    await writeEntryFile(dir, "abc123", { v: 2 });
    expect(await readEntryFile(dir, "abc123", decodeTestEntry)).toEqual({ v: 2 });
  });

  it("decoder 拒绝字段形状不对的有效 JSON,不把它断言成调用方类型", async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "wrong-shape.json"), JSON.stringify({ hello: 42 }), "utf-8");
    expect(await readEntryFile(dir, "wrong-shape", decodeTestEntry)).toBeUndefined();
  });
});

describe("readAllEntryFiles: 全目录扫描", () => {
  it("跳过损坏条目与点文件(dotfiles),不拖垮整次扫描", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "good-1", { ok: true });
    await writeEntryFile(dir, "good-2", { ok: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "corrupt.json"), "{not json", "utf-8");
    await writeFile(join(dir, ".hidden-tmp.json"), JSON.stringify({ ok: true }), "utf-8");
    await writeFile(join(dir, "not-json.txt"), "irrelevant", "utf-8");

    const all = await readAllEntryFiles(dir, decodeTestEntry);
    expect(all.map((e) => e.id).sort()).toEqual(["good-1", "good-2"]);
  });

  it("目录不存在时返回空集合,不抛错", async () => {
    const missing = join((await makeDir()), "does-not-exist");
    expect(await readAllEntryFiles(missing, decodeTestEntry)).toEqual([]);
  });

  it("空目录返回空集合", async () => {
    const dir = await makeDir();
    expect(await readAllEntryFiles(dir, decodeTestEntry)).toEqual([]);
  });
});

describe("claimEntryFile: rename-墓碑认领互斥", () => {
  it("认领存在的 entry 返回 true,并把文件从目录移除", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "claim-me", { a: 1 });
    expect(await claimEntryFile(dir, "claim-me")).toBe(true);
    expect(await readEntryFile(dir, "claim-me", decodeTestEntry)).toBeUndefined();
    // 墓碑文件本身也应该被清理干净,不残留
    const files = await readdir(dir);
    expect(files).toEqual([]);
  });

  it("认领不存在的 entry 返回 false,不抛错", async () => {
    const dir = await makeDir();
    expect(await claimEntryFile(dir, "nothing-here")).toBe(false);
  });

  it("两个并发调用者竞争同一个 id:只有一方拿到 true", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "contested", { a: 1 });
    const results = await Promise.all([claimEntryFile(dir, "contested"), claimEntryFile(dir, "contested")]);
    expect(results.sort()).toEqual([false, true]);
  });

  it("认领后目录里没有残留的 .claimed 墓碑文件", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "claim-me", { a: 1 });
    await claimEntryFile(dir, "claim-me");
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".claimed"))).toBe(false);
  });
});
