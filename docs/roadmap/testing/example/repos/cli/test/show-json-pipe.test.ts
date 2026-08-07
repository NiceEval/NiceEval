import { resolve } from "node:path";
import { command, defined, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/show-json-pipe.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/show-json-pipe.test.ts
// feature: docs/feature/reports/show/json.md
// regression: memory/show-json-pipe-truncated-at-128k.md

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: Array<{ evalId: string; attempts: Array<{ locator: string }> }> };
}

interface AttemptDocument {
  format: "niceeval.show";
  view: "attempt";
  data: {
    assertions: {
      attention: Array<{ expected?: string; received?: string }>;
      passedGroups: Array<{ items: Array<{ expected?: string; received?: string }> }>;
    } | null;
  };
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-pipe-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("show --json 经真实 pipe 仍包含签入 fixture 的尾部 sentinel", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    // Prepare：真实 Experiment 生成一份超过旧截断阈值的失败 Attempt。
    const seeded = await niceeval.run(["exp", "large-show", "--rerun", "all", "--json"], { cwd: root });
    expect(seeded.exitCode, seeded.diagnostic()).toBe(1);

    // Observe identity：locator 只能从公开 history 取得，测试不读取结果目录。
    const history = await niceeval.run(["show", "large-output/payload", "--history", "--json"], { cwd: root });
    expect(history.exitCode, history.diagnostic()).toBe(0);
    const section = only(
      history.json<HistoryDocument>().data.sections,
      (item) => item.evalId === "large-output/payload",
      () => history.diagnostic(),
    );
    const locator = defined(section.attempts.at(-1)?.locator, () => history.diagnostic());
    expect(locator).toMatch(/^@/);

    // Invoke：用用户得到的 locator 执行真实 installed CLI，并保留 producer 自身的流与退出状态。
    const shown = await niceeval.run(["show", locator, "--json"], { cwd: root });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(Buffer.byteLength(shown.stdout)).toBeGreaterThan(128 * 1024);

    // Outcome：严格 parse 后检查尾部 fixture 的独立 sentinel；不是只断言“输出看起来像 JSON”。
    const document = shown.json<AttemptDocument>();
    const assertions = defined(document.data.assertions, () => shown.diagnostic());
    const rows = [
      ...assertions.attention,
      ...assertions.passedGroups.flatMap((group) => group.items),
    ];
    expect(rows).toContainEqual({ expected: '"tail-sentinel"', received: '"actual-4999"' });
  });
});
