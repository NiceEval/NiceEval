// @ts-expect-error scripts/ 不在 tsconfig 的 include 里,这个 .mjs 没有声明文件
import { tierProblems } from "../../scripts/sync-tiers.mjs";
import { describe, expect, it } from "vitest";

// 仓库守护:examples/zh 的 origin → tier1 → tier2 → tier3 各层是同一个应用的不同接入深度,
// 靠 examples/zh/.tier-sync.json 记的 baseTree 保持"下游 = 上游 + 本层增量"。上游改了而
// 没跑 pnpm tiers:sync,下游就停在旧版本上——文档里"应用侧零改动"的对照页从此展示的是
// 两个不同版本的 diff,而它是这些页面的核心卖点。verbatim 那条更严:tier1 里被复制的文件
// 改一个字节,卖点就不成立,且没有任何运行时会报错。
// 契约与三个坑见 docs/engineering/example-tier-sync/README.md 与
// memory/tier-sync-merge-tree-pitfalls.md。
describe("examples/zh 的 tier 链与上游同步", () => {
  it("每条 pair 都不落后、无未解决冲突标记、verbatim 契约完好", () => {
    // 全程只读 git 对象库(rev-parse / grep / diff),不碰工作树。
    const problems = tierProblems() as string[];
    expect(problems.join("\n"), "跑 pnpm tiers:sync 同步后重新提交").toEqual("");
  });
});
