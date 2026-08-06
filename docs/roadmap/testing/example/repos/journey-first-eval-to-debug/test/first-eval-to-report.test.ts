import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parseJson, parseNdjson, runProcess } from "./support/process.ts";
import { only } from "./support/assert.ts";
import { tempDir } from "./support/project.ts";

// 场景 Repo：e2e/journey-first-eval-to-debug。
// NiceEval 根目录：pnpm e2e --repo journey-first-eval-to-debug
// 已安装候选包的隔离 Repo 根：pnpm test

interface ListDocument {
  format: "niceeval.experiments";
  schemaVersion: number;
  experiments: Array<{
    experimentId: string;
    description?: string;
    agent?: string;
    selectedEvalIds: string[];
  }>;
}

interface PlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  total: number;
  reused: number;
  matrix: Array<{ experimentId: string; evalId: string; reused: boolean }>;
}

interface RunEvent {
  event: string;
  status?: string;
  verdict?: string;
  evalId?: string;
  passed?: number;
  failed?: number;
  completion?: string;
}

interface HistorySection {
  experimentId: string;
  evalId: string;
  attempts: Array<{ locator: string; verdict: string }>;
}

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: HistorySection[] };
}

interface ExecutionDocument {
  format: "niceeval.show";
  view: "execution";
  data: { locator: string };
}

function historySection(result: Awaited<ReturnType<typeof runProcess>>, evalId: string): HistorySection {
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const document = parseJson<HistoryDocument>(result.stdout, result.diagnostic());
  expect(document.format).toBe("niceeval.show");
  expect(document.view).toBe("history");
  return only(
    document.data.sections,
    (item) => item.evalId === evalId,
    result.diagnostic(),
  );
}

// 跨域用户目标闭合：init → list → dry → exp → history → locator → execution →
// view --out → 浏览器。每个接缝立即检查（e2e/README.md「Journey」），
// 通过 eval 的完成由 result 计数与历史读回双重证明。
test("新项目能列出并运行评测、定位失败 Attempt、证明通过评测完成、再交付静态报告", async ({ page }) => {
  rmSync("niceeval.config.ts", { force: true });
  rmSync(".niceeval", { recursive: true, force: true });

  // init：生成 niceeval.config.ts，让下一条命令能装载配置。
  const init = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "init",
  ]);
  expect(init.exitCode, `[init]\n${init.diagnostic()}`).toBe(0);

  // list：init 之后立即能列出实验与它实际选中的 eval。
  const listed = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "list", "--json",
  ]);
  expect(listed.exitCode, `[list]\n${listed.diagnostic()}`).toBe(0);
  const listDocument = parseJson<ListDocument>(listed.stdout, listed.diagnostic());
  expect(listDocument.format).toBe("niceeval.experiments");
  expect(listDocument.schemaVersion).toBe(1);
  const listedExperiment = only(
    listDocument.experiments,
    (item) => item.experimentId === "onboarding",
    listed.diagnostic(),
  );
  expect([...listedExperiment.selectedEvalIds].sort()).toEqual([
    "onboarding/fails",
    "onboarding/passes",
  ]);

  // dry：全新项目没有任何历史，plan 预测两条 eval 全部要跑。
  const planned = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--dry", "--json",
  ]);
  expect(planned.exitCode, `[dry]\n${planned.diagnostic()}`).toBe(0);
  const plan = parseJson<PlanDocument>(planned.stdout, planned.diagnostic());
  expect(plan.format).toBe("niceeval.exp-plan");
  expect(plan.schemaVersion).toBe(3);
  expect(plan.matrix.map((row) => row.evalId).sort()).toEqual([
    "onboarding/fails",
    "onboarding/passes",
  ]);
  expect(plan.matrix.every((row) => row.reused === false)).toBe(true);
  expect(plan.reused).toBe(0);

  // exp：通过一条、失败一条；result 计数精确证明 passing eval 完成了。
  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, `[run]\n${run.diagnostic()}`).toBe(1);
  const events = parseNdjson<RunEvent>(run.stdout, run.diagnostic());
  const passesEvent = only(
    events,
    (item) => item.event === "eval" && item.evalId === "onboarding/passes",
    run.diagnostic(),
  );
  expect(passesEvent.verdict).toBe("passed");
  const result = only(events, (item) => item.event === "result", run.diagnostic());
  expect(result).toMatchObject({
    event: "result",
    status: "failed",
    passed: 1,
    failed: 1,
    completion: "complete",
  });

  // history：失败 attempt 的 locator 从公开历史取得；通过 eval 的历史身份同样可读。
  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "onboarding/fails", "--history", "--json",
  ]);
  const failedSection = historySection(history, "onboarding/fails");
  expect(failedSection.experimentId).toBe("onboarding");
  const attempt = only(failedSection.attempts, () => true, history.diagnostic());
  expect(attempt.verdict).toBe("failed");
  const locator = attempt.locator;

  const passedHistory = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "onboarding/passes", "--history", "--json",
  ]);
  const passedSection = historySection(passedHistory, "onboarding/passes");
  const passedAttempt = only(passedSection.attempts, () => true, passedHistory.diagnostic());
  expect(passedAttempt.verdict).toBe("passed");

  // locator + execution：上一步从历史拿到的身份被下一条公开命令消费。
  const detail = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--execution", "--json",
  ]);
  expect(detail.exitCode, `[detail]\n${detail.diagnostic()}`).toBe(0);
  const execution = parseJson<ExecutionDocument>(detail.stdout, detail.diagnostic());
  expect(execution.view).toBe("execution");
  expect(execution.data.locator).toBe(locator);

  // view --out：静态导出站交付，浏览器里能定位到同一个失败 Attempt。
  const project = tempDir("niceeval-example-journey-");
  try {
    const exported = await runProcess([
      "pnpm", "--silent", "exec", "niceeval",
      "view", "--out", join(project.root, "site"), "--no-open",
    ]);
    expect(exported.exitCode, `[export]\n${exported.diagnostic()}`).toBe(0);

    const indexUrl = pathToFileURL(join(project.root, "site", "index.html")).href;
    await page.goto(indexUrl);

    const failedEval = page.getByRole("link", { name: "onboarding/fails" });
    await expect(failedEval).toBeVisible();
    const href = await failedEval.getAttribute("href");
    expect(href).toBeTruthy();

    const targetUrl = new URL(href as string, indexUrl).href;
    await failedEval.click();
    expect(page.url()).toBe(targetUrl);
    await expect(page.getByText(locator, { exact: true })).toBeVisible();
  } finally {
    project.cleanup();
  }
});
