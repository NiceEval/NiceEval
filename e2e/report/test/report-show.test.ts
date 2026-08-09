// owner: docs/engineering/testing/e2e/report.md#公开读取面
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

interface ShowDocument {
  format: string;
  schemaVersion: number;
  view: string;
  sample: { experiments: string[] };
  data: unknown;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("show --json 读回本轮完整运行的三态 sample", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      await mkdir(join(root, "junit"), { recursive: true });
      const run = await niceeval.run(
        ["exp", "main", "--rerun", "all", "--json", "--junit", "junit/main.xml"],
        { cwd: root },
      );
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.stderr).toBe("");

      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({
        event: "result",
        status: "failed",
        passed: 1,
        failed: 1,
        errored: 1,
        completion: "complete",
      });

      const failed = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
        run.diagnostic(),
      );
      const junit = await readFile(join(root, "junit", "main.xml"), "utf8");
      expect(junit).toContain("<failure");
      expect(junit).toContain("<error");

      const overview = await niceeval.run(["show", "--record", ".niceeval"], { cwd: root });
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain("tool-call");
      expect(overview.stdout).toContain("deliberate-fail");
      expect(overview.stdout).toContain("deliberate-error");

      const shown = await niceeval.run(["show", "--record", ".niceeval", "--json"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        sample: { experiments: ["main"] },
      });
      const data = JSON.stringify(document.data);
      expect(data).toContain("tool-call");
      expect(data).toContain("deliberate-fail");
      expect(data).toContain("deliberate-error");

      const attempt = await niceeval.run(
        ["show", failed.locator!, "--record", ".niceeval", "--json"],
        { cwd: root },
      );
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const attemptDocument = attempt.json<ShowDocument>();
      expect(attemptDocument).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "attempt",
      });
      expect(JSON.stringify(attemptDocument.data)).toContain('"verdict":"failed"');

      const custom = await niceeval.run(
        [
          "show",
          "--record",
          ".niceeval",
          "--report",
          "./reports/site.tsx",
          "--page",
          "overview",
        ],
        { cwd: root },
      );
      expect(custom.exitCode, custom.diagnostic()).toBe(0);
      expect(custom.stdout).toContain("tool-call");
    },
    reportArtifactStaging("show", ["junit"]),
  );
});
