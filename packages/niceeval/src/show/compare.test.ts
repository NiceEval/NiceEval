import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { CliInvocationFacts, CliOutput } from "../cli/application.ts";
import { NodeCliArgumentsLive } from "../cli/node-application.ts";
import { ProjectConfiguration } from "../cli/project-configuration.ts";
import { comparisonGateExitCode, showCliCommand } from "./contribution.ts";
import { comparisonTransition, renderComparison, type ComparisonAttempt } from "./render.ts";
import type { AttemptView } from "./model.ts";
import type { InspectionSuccessDocumentFor } from "../inspection/index.ts";

async function invoke(argv: string[]) {
  const cwd = await mkdtemp(join(tmpdir(), "niceeval-show-compare-"));
  let stdout = "";
  let stderr = "";
  try {
    const code = await Effect.runPromise(showCliCommand.run(argv).pipe(
      Effect.provide(NodeCliArgumentsLive),
      Effect.provideService(CliInvocationFacts, { facts: Effect.succeed({
        cwd, argv, hostname: "test", pid: process.pid, platform: process.platform,
        stdout: { isTTY: false }, stderr: { isTTY: false },
      }) }),
      Effect.provideService(CliOutput, {
        writeStdout: (text) => Effect.sync(() => { stdout += text; }),
        writeStderr: (text) => Effect.sync(() => { stderr += text; }),
        writeStdoutSync: (text) => { stdout += text; },
        writeStderrSync: (text) => { stderr += text; },
      }),
      Effect.provideService(ProjectConfiguration, { prepare: () => Effect.void, load: () => Effect.die("Comparison must not evaluate the current project"), rebuild: () => Effect.die("Unexpected rebuild") }),
    ));
    return { code, stdout, stderr };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// @feature docs/feature/inspection/README.md
test.concurrent("comparison validates selectors before reading fixed history", async () => {
  for (const [argv, diagnostic] of [
    [["--compare"], "requires at least one"],
    [["--left", "baseline"], "require --compare"],
    [["--compare", "--mode", "other"], "--mode must be"],
    [["--compare", "--max-regressions", "NaN"], "non-negative safe integer"],
    [["--compare", "--left", "baseline", "--right", "candidate", "--mode", "side-by-side", "--max-regressions", "0"], "requires paired or exact"],
  ] as const) {
    const result = await invoke([...argv]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stdout).toBe("");
  }
  const missing = await invoke(["--compare", "--left", "baseline", "--left", "other", "--right", "candidate"]);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain("selection-run-missing");
});

// @use-case docs/feature/experiments/use-case/machine-output-ci-gate.md
test.concurrent("comparison distinguishes regressions and applies an inclusive allowance", () => {
  const attempt = (verdict: AttemptView["verdict"]) => ({ verdict }) satisfies Pick<AttemptView, "verdict">;
  expect(comparisonTransition(attempt("passed"), attempt("failed"))).toBe("regressed");
  expect(comparisonTransition(attempt("failed"), attempt("passed"))).toBe("improved");
  expect(comparisonTransition(attempt("passed"), attempt("errored"))).toBe("incomparable");
  expect(comparisonGateExitCode(1, 0)).toBe(1);
  expect(comparisonGateExitCode(1, 1)).toBe(0);
  expect(comparisonGateExitCode(1, undefined)).toBe(0);
});

// @feature docs/feature/inspection/README.md
test.concurrent("comparison renders paired quality and exact decimal cost deltas", () => {
  const member = (locator: string) => ({ key: "key", runId: locator, plannedAttemptId: "slot", evalId: "task", attemptOrdinal: 0, locator });
  const left = member("@LEFT");
  const right = member("@RIGHT");
  const comparison: InspectionSuccessDocumentFor<"runs.compare">["comparison"] = {
    mode: "paired", left: { runs: [], members: [left] }, right: { runs: [], members: [right] },
    exactMemberSet: true, pairs: [{ key: "key", left, right }],
  };
  const attempt = (verdict: AttemptView["verdict"], earned: number, cost: string) => ({
    verdict, score: { state: "complete", earned, possible: 1 },
    totalCosts: { state: "complete", values: [{ currency: "USD", value: cost, source: "reported" }], missingSources: [] },
  }) satisfies ComparisonAttempt;
  const attempts = new Map([[left.locator, attempt("passed", 1, "0.10")], [right.locator, attempt("failed", 0, "0.30")]]);
  const rendered = renderComparison(comparison, attempts);
  expect(rendered).toContain("regressed");
  expect(rendered).toContain("-1");
  expect(rendered).toContain("USD +0.20");
  expect(rendered).toContain("Regressed");
  const sideBySide = renderComparison({ ...comparison, mode: "side-by-side", pairs: [] }, attempts);
  expect(sideBySide).toContain("Baseline");
  expect(sideBySide).toContain("Candidate");
  expect(sideBySide).toContain("not evaluated");
});
