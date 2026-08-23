// Structured per-stage receipts for one isolated repo run.
// Stages: preflight → prepare → install → injection → browser → test → collect → cleanup.
// prepare covers the harness-side pre-flight guards (source cleanliness,
// declared-but-not-injected, undeclared-but-imported) that must fail before
// any test runs. Command failures retain stdout/stderr/timeout; receipts
// never decide a product verdict from .niceeval contents.

import type {
  CandidateIdentity,
  CapabilityCheck,
  Category,
  CommandCapture,
  RepoReceipt,
  SelectionReceipt,
  StageName,
  StageReceipt,
  TestkitReceipt,
} from "./contracts.ts";

/**
 * Receipt shape ownership is centralised in contracts.ts.  This module only
 * owns pure classification and capture folding; it deliberately has no JSON
 * schema version or durable-I/O knowledge.
 */
export type {
  CandidateIdentity as CandidateReceipt,
  CapabilityCheck,
  Category,
  CommandCapture,
  RepoReceipt,
  SelectionReceipt,
  StageName,
  StageReceipt,
  TestkitReceipt,
};

export function commandFailedCapture(capture: CommandCapture): boolean {
  return (
    capture.cancelled ||
    capture.timedOut ||
    capture.exitCode === null ||
    capture.exitCode !== 0 ||
    (capture.processGroupOwned && capture.groupCleanup.gone !== true)
  );
}

export function hasUnconfirmedOwnedGroup(capture: CommandCapture): boolean {
  return capture.processGroupOwned && capture.groupCleanup.gone !== true;
}

/** Keep full streams on failure; truncate successful captures for log size. */
export function retainCapture(capture: CommandCapture, ok: boolean): CommandCapture {
  if (!ok || commandFailedCapture(capture)) return capture;
  const max = 4_096;
  return {
    ...capture,
    stdout: capture.stdout.length > max ? `${capture.stdout.slice(0, max)}\n…[truncated]` : capture.stdout,
    stderr: capture.stderr.length > max ? `${capture.stderr.slice(0, max)}\n…[truncated]` : capture.stderr,
  };
}

function stageFailureDetail(stage: StageReceipt, fallback: string): string {
  return stage.detail ?? fallback;
}

/**
 * Classify a completed receipt (all stages that ran, including cleanup).
 *
 * - capability / browser preflight failure → configuration, before test
 * - prepare failure (source violation / declared-but-not-injected /
 *   undeclared-but-imported) → infra, before any install or test
 * - install / injection failure → infra
 * - test timeout / non-zero → regression
 * - test pass + collect or cleanup failure → infra (cannot pass)
 * - test already regression + later stage failure → keep regression, append detail
 */
export function classifyFromReceipt(receipt: Pick<RepoReceipt, "stages" | "detail">): {
  category: Category;
  detail: string;
} {
  const byStage = new Map(receipt.stages.map((s) => [s.stage, s] as const));
  const cancelledStage = receipt.stages.find(
    (stage) =>
      stage.cancelled === true ||
      stage.capture?.cancelled === true ||
      stage.checks?.some((check) => check.capture?.cancelled === true) === true,
  );
  const preflight = byStage.get("preflight");
  const prepare = byStage.get("prepare");
  const install = byStage.get("install");
  const injection = byStage.get("injection");
  const browser = byStage.get("browser");
  const tests = receipt.stages.filter((stage) => stage.stage === "test");
  const collect = byStage.get("collect");
  const cleanup = byStage.get("cleanup");

  let category: Category;
  let detail: string;

  if (cancelledStage !== undefined) {
    category = "cancelled";
    detail = stageFailureDetail(cancelledStage, "cancelled by root signal");
  } else if (preflight && !preflight.ok) {
    category = preflight.failureCategory ?? "configuration";
    detail = stageFailureDetail(preflight, "capability preflight failed");
  } else if (prepare && !prepare.ok) {
    category = "infra";
    detail = stageFailureDetail(prepare, "prepare failed");
  } else if (install && !install.ok) {
    category = "infra";
    detail = stageFailureDetail(install, "install failed");
  } else if (injection && !injection.ok) {
    category = "infra";
    detail = stageFailureDetail(injection, "injection verification failed");
  } else if (browser && !browser.ok) {
    category = browser.failureCategory ?? "configuration";
    detail = stageFailureDetail(browser, "browser preflight failed");
  } else if (tests.some((test) => test.capture?.timedOut)) {
    category = "regression";
    detail = stageFailureDetail(
      tests.find((test) => test.capture?.timedOut)!,
      "exceeded project.json E2E timeoutMinutes; owned process group terminated",
    );
  } else if (tests.some((test) => test.capture?.exitCode === null && !test.capture.timedOut)) {
    category = "infra";
    detail = stageFailureDetail(
      tests.find((test) => test.capture?.exitCode === null && !test.capture.timedOut)!,
      "command never produced an exit code",
    );
  } else if (
    tests.some(
      (test) =>
        test.capture !== undefined &&
        test.capture.exitCode === 0 &&
        !test.capture.timedOut &&
        hasUnconfirmedOwnedGroup(test.capture),
    )
  ) {
    const failed = tests.find(
      (test) =>
        test.capture !== undefined &&
        test.capture.exitCode === 0 &&
        !test.capture.timedOut &&
        hasUnconfirmedOwnedGroup(test.capture),
    )!;
    category = "infra";
    detail = stageFailureDetail(failed, "owned process-group cleanup could not be confirmed");
  } else if (tests.length > 0 && tests.every((test) => test.ok && test.capture?.exitCode === 0)) {
    category = "pass";
    detail = "clean pass";
  } else if (tests.some((test) => test.capture !== undefined)) {
    category = "regression";
    const failed = tests.find((test) => test.capture !== undefined && !test.ok)!;
    detail = stageFailureDetail(failed, `exit ${failed.capture?.exitCode}`);
  } else if (tests.some((test) => !test.ok)) {
    category = "regression";
    detail = stageFailureDetail(tests.find((test) => !test.ok)!, "test failed");
  } else {
    category = "infra";
    detail = receipt.detail || "no test stage ran";
  }

  const laterFailures: string[] = [];
  if (collect && !collect.ok) {
    laterFailures.push(stageFailureDetail(collect, "collect failed"));
  }
  if (cleanup && !cleanup.ok) {
    laterFailures.push(stageFailureDetail(cleanup, "cleanup failed"));
  }

  if (laterFailures.length === 0) {
    return { category, detail };
  }

  const attached = laterFailures.join("; ");
  if (category === "pass") {
    // A green test cannot pass when collect/cleanup failed.
    return { category: "infra", detail: attached };
  }
  // Regression, configuration, or prior infra stays primary; attach later failures without overwriting.
  return { category, detail: `${detail}; ${attached}` };
}
