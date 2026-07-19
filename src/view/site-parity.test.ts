// cases: docs/engineering/unit-tests/reports/cases.md
// 「show/view 宿主等价与选择」分区——
// 本地 server 与 --out 消费同一份站点产物:同一路径两宿主逐字节一致;server 不提供产物清单
// 之外的路径。server 打开首页触发产物整份重建(盘上新数据无需重启),artifact 未命中重建一次。
// 契约:docs/feature/reports/view.md 开篇「同一条站点管线」。

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createResultsWriter } from "../results/index.ts";
import { buildView } from "./index.ts";
import { planSite } from "./site.ts";
import { startViewServer, type ViewServer } from "./server.ts";

const roots: string[] = [];
async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** 真实 writer 落一份含 events / trace / diff / 去重 sources 的快照(不手写落盘格式)。 */
async function seedSnapshot(root: string, experimentId: string, evalId: string): Promise<void> {
  const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
  const snap = await writer.snapshot({ experimentId, agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
  await snap.writeAttempt(
    { id: evalId, verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
    {
      sources: [{ path: "evals/a.eval.ts", content: "export default 1;\n" }],
      events: [
        { type: "message", role: "user", text: "hi", loc: { file: "evals/a.eval.ts", line: 3 } },
        { type: "message", role: "assistant", text: "hello there" },
      ],
      trace: [{ name: "turn", kind: "turn" } as never],
      diff: [{ window: "s1/t1", changes: { "a.txt": { status: "added", after: "1" } } }] as never,
    },
  );
  await writer.finish();
}

describe("站点管线奇偶:server 与 --out 是同一份产物", () => {
  let server: ViewServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("导出目录的每个文件与 server 对同路径的响应逐字节一致;server 不提供清单之外的路径", async () => {
    const root = await makeDir("niceeval-parity-root-");
    await seedSnapshot(root, "exp", "q1");

    const out = await makeDir("niceeval-parity-out-");
    await buildView({ input: root, out });
    server = await startViewServer({ input: root });

    // 清单驱动遍历:计划里的每一个路径,写盘字节 ≡ 服务字节。
    const plan = await planSite(root);
    expect(plan.files.size).toBeGreaterThanOrEqual(5); // index.html + sources/events/trace/diff
    for (const file of plan.files.values()) {
      const written = await readFile(join(out, file.path), "utf-8");
      const res = await fetch(new URL(file.path === "index.html" ? "/" : `/${file.path}`, server.url));
      expect(res.status, file.path).toBe(200);
      expect(await res.text(), file.path).toBe(written);
    }

    // 产物清单之外的路径不存在旁路取数:即便文件真实在结果根里(o11y.json),也不服务。
    const base = [...plan.files.keys()].find((p) => p.endsWith("/events.json"))!.replace(/\/events\.json$/, "");
    for (const path of [`${base}/o11y.json`, `${base}/result.json`, "artifact/../package.json", "no-such-file"]) {
      const res = await fetch(new URL(`/${path}`, server.url));
      expect(res.status, path).toBe(404);
    }
  });

  it("首页请求触发整份重建:server 启动后新落盘的快照,刷新即可见、其证据无需重启可 fetch", async () => {
    const root = await makeDir("niceeval-parity-fresh-");
    await seedSnapshot(root, "exp-a", "q1");
    server = await startViewServer({ input: root });

    const before = await (await fetch(server.url)).text();
    expect(before).toContain("exp-a");
    expect(before).not.toContain("exp-b");

    await seedSnapshot(root, "exp-b", "q2");

    // 刷新首页:整份产物重建,新实验进入 viewData。
    const after = await (await fetch(server.url)).text();
    expect(after).toContain("exp-b");

    // 新快照的证据文件不重启 server 就能取到(artifact 未命中时管线重建一次再查)。
    const plan = await planSite(root);
    const eventsPath = [...plan.files.keys()].find((p) => p.includes("exp-b") && p.endsWith("/events.json"))!;
    const res = await fetch(new URL(`/${eventsPath}`, server.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { type: "message", role: "user", text: "hi", loc: { file: "evals/a.eval.ts", line: 3 } },
      { type: "message", role: "assistant", text: "hello there" },
    ]);
  });

  it("legacy /artifact?p= query 形式仍服务同一份产物", async () => {
    const root = await makeDir("niceeval-parity-legacy-");
    await seedSnapshot(root, "exp", "q1");
    server = await startViewServer({ input: root });

    const plan = await planSite(root);
    const eventsPath = [...plan.files.keys()].find((p) => p.endsWith("/events.json"))!;
    const rel = eventsPath.replace(/^artifact\//, "");
    const res = await fetch(new URL(`/artifact?p=${encodeURIComponent(rel)}`, server.url));
    expect(res.status).toBe(200);
    const direct = await (await fetch(new URL(`/${eventsPath}`, server.url))).text();
    expect(await res.text()).toBe(direct);
  });

  it("本地宿主的 attempt 详情路由越过 --exp 收窄,对完整结果根解析(cases.md 第 198/220 行,与 show @<locator> 同一套「各自结果根语义寻址」)", async () => {
    const root = await makeDir("niceeval-parity-unnarrowed-");
    await seedSnapshot(root, "exp-a", "q1");
    await seedSnapshot(root, "exp-b", "q2");
    server = await startViewServer({ input: root, scan: { experiment: "exp-a" } });

    const full = await planSite(root); // 不收窄,拿到两个实验各自的 attempt 路径
    const attemptPaths = [...full.files.keys()].filter((p) => p.startsWith("attempt/"));
    expect(attemptPaths).toHaveLength(2);

    // 收窄后的 plan 只剩 exp-a 的那份(row 205 已覆盖导出侧的同一断言;这里确认 plan 本身也收窄)。
    const narrowed = await planSite(root, { experiment: "exp-a" });
    const narrowedPaths = new Set(narrowed.files.keys());
    const outsideScopePath = attemptPaths.find((p) => !narrowedPaths.has(p))!;
    expect(outsideScopePath).toBeTruthy();

    // 但本地 server 仍能直接打开它:路由越过收窄,对完整结果根解析。
    const res = await fetch(new URL(`/${outsideScopePath}`, server.url));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("q2"); // exp-b 的证据内容真的解析出来了,不是空白/占位
  });
});
