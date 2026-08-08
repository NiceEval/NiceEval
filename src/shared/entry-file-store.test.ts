// owner: docs/engineering/testing/unit/experiments-runner.md#entry-file-原子认领
// cases: docs/engineering/testing/unit/experiments-runner.md
// 真实 E2E 无法稳定安排两个消费者竞争同一原子认领；这里只保留这个并发 seam。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimEntryFile, writeEntryFile } from "./entry-file-store.ts";

let dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-entry-file-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("claimEntryFile: rename-墓碑认领互斥", () => {
  it("两个并发调用者竞争同一个 id:只有一方拿到 true", async () => {
    const dir = await makeDir();
    await writeEntryFile(dir, "contested", { value: 1 });

    const results = await Promise.all([claimEntryFile(dir, "contested"), claimEntryFile(dir, "contested")]);

    expect(results.sort()).toEqual([false, true]);
  });
});
