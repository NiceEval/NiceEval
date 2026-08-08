// owner: docs/engineering/testing/e2e/cli.md#cli-failure-error-results
// rerun: pnpm e2e --repo cli -- --run test/failure-error-results.test.ts

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpEvent {
  event: string;
  status?: string;
  evalId?: string;
  failed?: number;
  errored?: number;
  completion?: string;
  junit?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-failure-error-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("failed 与 errored 在 NDJSON、JUnit 和退出码上保持可区分", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    mkdirSync(join(root, "junit"), { recursive: true });

    const failed = await niceeval.run(
      ["exp", "deliberate-fail", "--rerun", "all", "--json", "--junit", "junit/failed.xml"],
      { cwd: root },
    );
    expect(failed.exitCode, failed.diagnostic()).toBe(1);
    expect(failed.stderr).toBe("");
    expect(failed.stdout).not.toMatch(/[\x1b\x08]/);
    const failedEvents = failed.ndjson<ExpEvent>();
    expect(failedEvents).toContainEqual(expect.objectContaining({
      event: "failure",
      evalId: "deliberate-fail/broken",
    }));
    expect(failedEvents.some((event) => event.event === "error")).toBe(false);
    expect(failedEvents.at(-1)).toMatchObject({
      event: "result",
      status: "failed",
      failed: 1,
      errored: 0,
      completion: "complete",
      junit: "junit/failed.xml",
    });
    const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
    expect(failedJunit).toContain("<failure");
    expect(failedJunit).not.toContain("<error");

    const errored = await niceeval.run(
      ["exp", "deliberate-error", "--rerun", "all", "--json", "--junit", "junit/errored.xml"],
      { cwd: root },
    );
    expect(errored.exitCode, errored.diagnostic()).toBe(1);
    expect(errored.stderr).toBe("");
    expect(errored.stdout).not.toMatch(/[\x1b\x08]/);
    const erroredEvents = errored.ndjson<ExpEvent>();
    expect(erroredEvents).toContainEqual(expect.objectContaining({
      event: "error",
      evalId: "deliberate-error/crash",
    }));
    expect(erroredEvents.some((event) => event.event === "failure")).toBe(false);
    expect(erroredEvents.at(-1)).toMatchObject({
      event: "result",
      status: "failed",
      failed: 0,
      errored: 1,
      completion: "complete",
      junit: "junit/errored.xml",
    });
    const erroredJunit = readFileSync(join(root, "junit", "errored.xml"), "utf8");
    expect(erroredJunit).toContain("<error");
    expect(erroredJunit).not.toContain("<failure");
  });
});
