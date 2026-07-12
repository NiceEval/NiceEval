// 回归覆盖:src/results/open.ts 把 sources.json 从「全量 SourceArtifact[]」改成两层去重存储
// (attempt 级引用 `{path, sha256}[]` + 快照根 `sources/<sha256>.json` 内容仓库,见 memory/
// attempt-locator-and-source-dedup.md)之后,view 的两条 artifact 出口(server.ts 的
// serveArtifact、index.ts 的 copyFetchedArtifacts)曾各自继续把落盘的引用格式原样吐给浏览器
// (readFile 直传 / copyFile 直拷),而不是走 AttemptHandle.sources() 解引用。浏览器端
// isCodeSource 守卫要求 `content: string` 字段,引用格式没有,代码视图因此静默判空——
// 即便 sources 明明被捕获了(memory/static-site-export-drops-sources.md 记录的是同一症状的
// 更早一次事故,根因不同:那次是文件压根没导出,这次是导出了但格式不对)。
//
// 两个测试都特意让两个 attempt 共享字节相同的 eval 源码,确保真的走了去重路径(sha256 引用 +
// 共享 blob),而不是巧合地测到「本来就没有第二层」的场景。

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createResultsWriter } from "../results/index.ts";
import { loadViewScan } from "./data.ts";
import { buildView } from "./index.ts";
import { startViewServer, type ViewServer } from "./server.ts";
import { artifactUrl } from "./app/lib/artifact-url.ts";

const SHARED_CONTENT = "export default { test() {} };\n";
const SHARED_PATH = "evals/shared.eval.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-artifact-serving-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * 写一份真实快照:两个 attempt(q1/q2)共享字节相同的 eval 源码触发去重仓库,
 * 外加一个 attempt(q3)带 events.json(用于确认 events/trace 这类 artifact 不受影响)。
 * 走真实 writer(createResultsWriter),不手写落盘格式——这正是 sources 去重两层存储
 * 唯一的生产写入路径。
 */
async function seedDedupedSnapshot(root: string): Promise<{ snapDir: string }> {
  const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
  const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
  await snap.writeAttempt(
    { id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
    { sources: [{ path: SHARED_PATH, content: SHARED_CONTENT }] },
  );
  await snap.writeAttempt(
    { id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
    { sources: [{ path: SHARED_PATH, content: SHARED_CONTENT }] },
  );
  await snap.writeAttempt(
    { id: "q3", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
    { events: [{ type: "message", role: "user", text: "hi" }] },
  );
  await writer.finish();

  // 前提断言:去重真的生效了(否则这份 fixture 没有覆盖到引用/仓库两层结构,回归测试会
  // 在「碰巧没有第二层」的场景下通过,失去意义)。
  const storeFiles = await readdir(join(snap.dir, "sources"));
  expect(storeFiles).toHaveLength(1);
  const q1Ref = JSON.parse(await readFile(join(snap.dir, "q1", "a0", "sources.json"), "utf-8"));
  expect(q1Ref).toEqual([{ path: SHARED_PATH, sha256: expect.any(String) }]);
  expect(q1Ref[0]).not.toHaveProperty("content"); // 落盘就是引用,不含内容——下面断言浏览器出口必须解引用

  return { snapDir: snap.dir };
}

describe("server.ts · serveArtifact 对 sources.json 解引用", () => {
  let server: ViewServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("HTTP /artifact/<base>/sources.json 返回解引用后的 {path,content}[],不是落盘的 {path,sha256}[] 引用", async () => {
    const root = await makeRoot();
    await seedDedupedSnapshot(root);

    const scan = await loadViewScan(root);
    const byId = new Map(scan.viewData.snapshots.flatMap((s) => s.results.map((r) => [r.id, r])));
    const q1 = byId.get("q1")!;
    const q2 = byId.get("q2")!;
    expect(q1.hasSources).toBe(true);
    expect(q2.hasSources).toBe(true);

    server = await startViewServer({ input: root });

    for (const result of [q1, q2]) {
      const url = new URL(artifactUrl(`${result.artifactBase}/sources.json`), server.url);
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([{ path: SHARED_PATH, content: SHARED_CONTENT }]);
      expect(body[0]).not.toHaveProperty("sha256");
    }
  });

  it("events.json 仍走原文件直传,不受 sources 解引用改动影响", async () => {
    const root = await makeRoot();
    await seedDedupedSnapshot(root);
    const scan = await loadViewScan(root);
    const q3 = scan.viewData.snapshots.flatMap((s) => s.results).find((r) => r.id === "q3")!;
    expect(q3.hasEvents).toBe(true);

    server = await startViewServer({ input: root });
    const url = new URL(artifactUrl(`${q3.artifactBase}/events.json`), server.url);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ type: "message", role: "user", text: "hi" }]);
  });
});

describe("index.ts · copyFetchedArtifacts(--out 静态导出)对 sources.json 解引用", () => {
  it("导出目录里的 sources.json 是解引用后的 {path,content}[],不是落盘引用;events.json 仍原字节复制", async () => {
    const root = await makeRoot();
    await seedDedupedSnapshot(root);

    const out = join(root, "site");
    await buildView({ input: root, out });

    const scan = await loadViewScan(root);
    const byId = new Map(scan.viewData.snapshots.flatMap((s) => s.results.map((r) => [r.id, r])));
    for (const id of ["q1", "q2"]) {
      const base = byId.get(id)!.artifactBase!;
      const exported = JSON.parse(await readFile(join(out, "artifact", base, "sources.json"), "utf-8"));
      expect(exported).toEqual([{ path: SHARED_PATH, content: SHARED_CONTENT }]);
      expect(exported[0]).not.toHaveProperty("sha256");
    }

    const q3Base = byId.get("q3")!.artifactBase!;
    const exportedEvents = JSON.parse(await readFile(join(out, "artifact", q3Base, "events.json"), "utf-8"));
    expect(exportedEvents).toEqual([{ type: "message", role: "user", text: "hi" }]);
  });
});
