import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/cli/README.md
test.concurrent("实验人读计划将标签与重复的待运行原因写成摘要", async ({ expect }) => {
  await cliE2E.case("experiment-human-plan", async ({ commands: { niceeval }, paths }) => {
    await writeFile(
      join(paths.projectRoot, "experiments", "human-plan.ts"),
      'import { defineExperiment } from "niceeval";\nimport { deterministicAgent } from "../agents/deterministic.ts";\nexport default defineExperiment({ adapter: deterministicAgent("human-plan"), evals: ["greet"], labels: { cohort: "baseline", size: "3" } });\n',
    );
    const catalog = await niceeval.run(["exp", "list", "human-plan"]);
    expect(catalog.exitCode, catalog.diagnostic()).toBe(0);
    expect.soft(catalog.stdout, catalog.diagnostic()).toContain("labels: cohort=baseline, size=3");
    expect.soft(catalog.stdout).not.toContain('{"cohort"');
    const dry = await niceeval.run(["exp", "human-plan", "greet", "--attempts", "4", "--dry"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    expect.soft(dry.stdout, dry.diagnostic()).toContain("Not run yet ×4");
    expect.soft(dry.stdout).not.toMatch(/\bgap\b|no-result|lifecycle occurrences|Record attempts/u);
  });
});

// @feature docs/feature/experiments/cli/README.md
test.concurrent("实验结束聚合重复结果且下一步最多三行", async ({ expect }) => {
  await cliE2E.case("experiment-human-summary", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, "experiments", "human-summary"));
    await mkdir(join(paths.projectRoot, "evals", "human-summary"));
    for (let index = 0; index < 6; index++) {
      await writeFile(
        join(paths.projectRoot, "evals", "human-summary", `${index}.eval.ts`),
        'export { default } from "../greet/hello.eval.ts";\n',
      );
      await writeFile(
        join(paths.projectRoot, "experiments", "human-summary", `${index}.ts`),
        'import { defineExperiment } from "niceeval";\nimport { deterministicAgent } from "../../agents/deterministic.ts";\nexport default defineExperiment({ adapter: deterministicAgent("human-summary"), evals: ["human-summary/"] });\n',
      );
    }
    const result = await niceeval.run(["exp", "--experiment", "human-summary/", "human-summary/", "--rerun", "all"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const results = result.stdout.slice(result.stdout.lastIndexOf("RESULTS"), result.stdout.lastIndexOf("NEXT"));
    expect.soft(results, result.diagnostic()).toContain("+1 more experiments — see NEXT");
    expect.soft(results.match(/\+1 more evals — see NEXT/gu) ?? []).toHaveLength(5);
    const next = result.stdout.slice(result.stdout.lastIndexOf("NEXT")).split("\n").slice(1).filter(Boolean);
    expect.soft(next, result.diagnostic()).toHaveLength(3);
    expect.soft(next.join("\n")).toMatch(/\+\d+ more.*niceeval run list --invocation/u);
    const sessions = await niceeval.run(["invocation", "list", "--all"]);
    expect(sessions.exitCode, sessions.diagnostic()).toBe(0);
    const sessionId = /s_[0-9a-f-]+/u.exec(sessions.stdout)?.[0];
    expect(sessionId, sessions.diagnostic()).toBeTruthy();
    const shown = await niceeval.run(["invocation", "show", sessionId!]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect.soft(shown.stdout).not.toMatch(/\{\s*"/u);
  });
});

// @feature docs/feature/experiments/cli/README.md
test.concurrent("非交互运行只汇总一次无法暂停的清理说明", async ({ expect }) => {
  await cliE2E.case("experiment-human-pause", async ({ commands: { niceeval } }) => {
    const result = await niceeval.run([
      "exp",
      "deliberate-fail",
      "--attempts",
      "4",
      "--pause-on-failure",
      "--rerun",
      "all",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stdout, result.diagnostic()).toContain("FAILED");
    expect.soft(result.stdout.match(/Pause on failure needs/gu) ?? [], result.diagnostic()).toHaveLength(1);
    expect.soft(result.stdout).toContain("4 attempts cleaned up without pausing");
  });
});

// @feature docs/feature/experiments/cli/README.md
test.concurrent("debug 用可复制命令和普通短语解释准备计划", async ({ expect }) => {
  await cliE2E.case("experiment-human-debug", async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["debug", "sandbox-action-debug", "sandbox-action-debug/plan"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect
      .soft(result.stdout, result.diagnostic())
      .not.toMatch(
        /argv \[|environment keys: \[|not-probed|attempt-captured|ready-lowest-change-frequency|opaque-ancestor/u,
      );
    expect.soft(result.stdout).toContain("cache lookup: not checked");
    expect.soft(result.stdout).toContain("RUNTIME ONLY");
    expect.soft(result.stdout).toContain("environment keys: NICEEVAL_DEBUG_PRIVATE_TOKEN");
  });
});
