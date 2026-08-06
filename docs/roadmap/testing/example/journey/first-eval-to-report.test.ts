import { pathToFileURL } from "node:url";
import { chromium, expect as expectPage } from "@playwright/test";
import { expect, test } from "vitest";
import { parseJson, parseNdjson, runProcess } from "../support/process.ts";

interface PlanDocument {
  format: "niceeval.exp-plan";
  matrix: Array<{ evalId: string }>;
}

interface RunEvent {
  event: string;
  status?: string;
}

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: {
    sections: Array<{
      evalId: string;
      attempts: Array<{ locator: string; verdict: string }>;
    }>;
  };
}

test("新项目能预览并运行评测、定位失败 Attempt、再交付静态报告", async () => {
  const init = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "init",
  ]);
  expect(init.exitCode, `[init]\n${init.diagnostic()}`).toBe(0);

  const planned = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--dry", "--json",
  ]);
  expect(planned.exitCode, `[plan]\n${planned.diagnostic()}`).toBe(0);
  const plan = parseJson<PlanDocument>(planned.stdout, planned.diagnostic());
  expect(plan.matrix.map((row) => row.evalId).sort()).toEqual([
    "onboarding/fails",
    "onboarding/passes",
  ]);

  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, `[run]\n${run.diagnostic()}`).not.toBe(0);
  const events = parseNdjson<RunEvent>(run.stdout, run.diagnostic());
  expect(events.at(-1)).toMatchObject({ event: "result", status: "failed" });

  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "onboarding/fails", "--history", "--json",
  ]);
  expect(history.exitCode, `[history]\n${history.diagnostic()}`).toBe(0);
  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const section = historyDocument.data.sections.find((item) => item.evalId === "onboarding/fails");
  expect(section?.attempts).toHaveLength(1);
  expect(section?.attempts[0]?.verdict).toBe("failed");
  const locator = section!.attempts[0]!.locator;

  const detail = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--execution", "--json",
  ]);
  expect(detail.exitCode, `[detail]\n${detail.diagnostic()}`).toBe(0);
  expect(JSON.stringify(parseJson(detail.stdout, detail.diagnostic()))).toContain(locator);

  const exported = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "view", "--out", "artifacts/site", "--no-open",
  ]);
  expect(exported.exitCode, `[export]\n${exported.diagnostic()}`).toBe(0);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(`${process.cwd()}/artifacts/site/index.html`).href);

    const failedEval = page.getByRole("link", { name: "onboarding/fails" });
    await expectPage(failedEval).toBeVisible();
    await failedEval.click();
    await expectPage(page.getByText(locator, { exact: true })).toBeVisible();
  } finally {
    await browser.close();
  }
});
