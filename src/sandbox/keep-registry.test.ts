// cases: docs/engineering/testing/unit/sandbox.md
// 留存注册表的单测:逐条目文件、原子写、发现规则、更新与删除(见 docs/feature/sandbox/architecture.md)。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireKeptLease,
  findNiceevalRoot,
  keptEntryId,
  readKeptLease,
  releaseKeptLease,
  readKeptEntries,
  removeKeptEntry,
  updateKeptEntry,
  writeKeptEntry,
  type KeptSandboxEntry,
} from "./keep-registry.ts";

let roots: string[] = [];
async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-keep-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

function entry(over: Partial<KeptSandboxEntry> = {}): KeptSandboxEntry {
  return {
    sandboxId: "a3f9c2d1",
    provider: "docker",
    evalId: "onboarding/tool-first",
    attempt: 1,
    experimentId: "local/tool-first",
    locator: "@1x7f3q9k",
    verdict: "errored",
    keptAt: "2026-07-14T15:02:00.000Z",
    workdir: "/workspace",
    state: "alive",
    ...over,
  };
}

describe("kept-sandbox registry", () => {
  it("逐条目文件:写入 → 读回 → 更新 state → 删除并同步目录", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    await writeKeptEntry(niceeval, entry());
    const id = keptEntryId("docker", "a3f9c2d1");

    const { entries } = await readKeptEntries(niceeval);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(id);
    expect(entries[0]!.entry.locator).toBe("@1x7f3q9k");
    expect(entries[0]!.entry.state).toBe("alive");

    expect(await updateKeptEntry(niceeval, id, { state: "dormant" })).toBe(true);
    expect((await readKeptEntries(niceeval)).entries[0]!.entry.state).toBe("dormant");

    await removeKeptEntry(niceeval, id);
    expect((await readKeptEntries(niceeval)).entries).toHaveLength(0);
    // 临时文件不残留
    expect((await readdir(join(niceeval, "sandboxes"))).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("不同 provider+sandboxId 各自成条目,互不覆盖", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    await writeKeptEntry(niceeval, entry());
    await writeKeptEntry(niceeval, entry({ sandboxId: "b81e07aa", verdict: "failed" }));
    const { entries } = await readKeptEntries(niceeval);
    expect(entries).toHaveLength(2);
  });

  it("完整 decoder 拒绝未知 verdict/state，保留文件名供 list 诊断并禁止更新", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    const id = keptEntryId("docker", "invalid-entry");
    await mkdir(join(niceeval, "sandboxes"), { recursive: true });
    await writeFile(join(niceeval, "sandboxes", `${id}.json`), JSON.stringify({ ...entry({ sandboxId: "invalid-entry" }), verdict: "flaky", state: "gone" }), "utf-8");

    expect(await readKeptEntries(niceeval)).toEqual({ entries: [], malformed: [`${id}.json`] });
    expect(await updateKeptEntry(niceeval, id, { state: "alive" })).toBe(false);
  });

  it("注册表发现:从子目录向上找最近的 .niceeval;找不到返回 undefined", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    await mkdir(join(niceeval, "sandboxes"), { recursive: true });
    const deep = join(root, "a", "b", "c");
    await mkdir(deep, { recursive: true });
    expect(await findNiceevalRoot(deep)).toBe(niceeval);
    const outside = await makeRoot();
    expect(await findNiceevalRoot(outside)).toBeUndefined();
  });

  it("lease 用 wx 原子占坑：并发只有一方成功，过期接管后旧持有者不能删除新 lease", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    const id = keptEntryId("docker", "lease-sandbox");
    const first = { holder: "first@host", op: "enter", acquiredAt: new Date().toISOString(), ttlMs: 60_000 };
    const [a, b] = await Promise.all([acquireKeptLease(niceeval, id, first), acquireKeptLease(niceeval, id, first)]);
    expect([a, b].filter((result) => result.acquired)).toHaveLength(1);
    const winner = a.acquired ? a : b as Extract<typeof b, { acquired: true }>;

    const expiredId = keptEntryId("docker", "expired-lease-sandbox");
    const expired = await acquireKeptLease(niceeval, expiredId, {
      holder: "expired@host", op: "enter", acquiredAt: "2000-01-01T00:00:00.000Z", ttlMs: 1,
    });
    if (!expired.acquired) throw new Error("fixture failed to acquire the initial expired lease");
    const next = await acquireKeptLease(niceeval, expiredId, {
      holder: "second@host",
      op: "enter",
      acquiredAt: new Date().toISOString(),
      ttlMs: 60_000,
    });
    expect(next.acquired).toBe(true);
    await releaseKeptLease(niceeval, expiredId, expired.token);
    expect((await readKeptLease(niceeval, expiredId))?.holder).toBe("second@host");
    await releaseKeptLease(niceeval, id, winner.token);
  });

  it("lease decoder 拒绝无效 TTL，并在新操作中回收该坏占坑", async () => {
    const root = await makeRoot();
    const niceeval = join(root, ".niceeval");
    const id = keptEntryId("docker", "invalid-lease");
    await mkdir(join(niceeval, "sandboxes"), { recursive: true });
    await writeFile(
      join(niceeval, "sandboxes", `${id}.lease`),
      JSON.stringify({ holder: "old@host", op: "enter", acquiredAt: "2026-07-21T10:00:00.000Z", ttlMs: -1, token: "old" }),
      "utf-8",
    );

    expect(await readKeptLease(niceeval, id)).toBeUndefined();
    await expect(acquireKeptLease(niceeval, id, { holder: "new@host", op: "enter", acquiredAt: new Date().toISOString(), ttlMs: 60_000 })).resolves.toMatchObject({ acquired: true });
  });
});
