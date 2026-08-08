// Structured per-stage receipts for one isolated repo run.
// Stages: prepare → install → injection → test → collect → cleanup.
// prepare covers the harness-side pre-flight guards (source cleanliness,
// declared-but-not-injected, undeclared-but-imported) that must fail before
// any test runs. Command failures retain stdout/stderr/timeout; receipts
// never decide a product verdict from .niceeval contents.

export type StageName = "prepare" | "install" | "injection" | "test" | "collect" | "cleanup";

export type Category = "pass" | "regression" | "infra";

export interface CommandCapture {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface StageReceipt {
  stage: StageName;
  ok: boolean;
  /** Human-readable detail; never parsed for product verdict. */
  detail?: string;
  command?: readonly string[];
  capture?: CommandCapture;
  /** Paths written under the external artifact root (collect only). */
  collected?: readonly string[];
  /** Filesystem path cleaned or targeted (cleanup only). */
  path?: string;
}

export interface RepoReceipt {
  repoId: string;
  /** Absolute durable directory under independent artifactRoot. */
  artifactDir: string;
  /** Absolute path of this receipt JSON on disk. */
  receiptPath: string;
  stages: StageReceipt[];
  exitCode: number | null;
  category: Category;
  detail: string;
  /** The candidate tarball identity retained for this run, when materialized. */
  candidate: CandidateReceipt;
  /** Present when the checkout-local Testkit directory was injected. */
  testkit?: TestkitReceipt;
}

/** Candidate identity; digest/SRI are authoritative, never its file name. */
export interface CandidateReceipt {
  sha256: string;
  integrity: string;
  /** Content-addressed path relative to artifactRoot; absent if persistence failed. */
  artifactPath?: string;
  /** Command that replays this repo with the retained candidate bytes. */
  reproduce: string;
  /** True only while the durable candidate tarball remains available. */
  exactReplay: boolean;
}

/** Checkout-local Testkit diagnostics; it is deliberately not replayable. */
export interface TestkitReceipt {
  /** Package version, diagnostic only. */
  version: string;
  /** Checkout-relative build source. */
  sourcePath: "packages/testkit";
  /** Copy-relative installed path recorded before cleanup. */
  resolvedPath: string;
}

export function commandFailedCapture(capture: CommandCapture): boolean {
  return capture.timedOut || capture.exitCode === null || capture.exitCode !== 0;
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
  const prepare = byStage.get("prepare");
  const install = byStage.get("install");
  const injection = byStage.get("injection");
  const test = byStage.get("test");
  const collect = byStage.get("collect");
  const cleanup = byStage.get("cleanup");

  let category: Category;
  let detail: string;

  if (prepare && !prepare.ok) {
    category = "infra";
    detail = stageFailureDetail(prepare, "prepare failed");
  } else if (install && !install.ok) {
    category = "infra";
    detail = stageFailureDetail(install, "install failed");
  } else if (injection && !injection.ok) {
    category = "infra";
    detail = stageFailureDetail(injection, "injection verification failed");
  } else if (test?.capture?.timedOut) {
    category = "regression";
    detail = stageFailureDetail(test, "exceeded e2e.json timeoutMinutes; process killed");
  } else if (test && test.capture && test.capture.exitCode === null && !test.capture.timedOut) {
    category = "infra";
    detail = stageFailureDetail(test, "command never produced an exit code");
  } else if (test && test.ok && test.capture?.exitCode === 0) {
    category = "pass";
    detail = "clean pass";
  } else if (test && test.capture) {
    category = "regression";
    detail = stageFailureDetail(test, `exit ${test.capture.exitCode}`);
  } else if (test && !test.ok) {
    category = "regression";
    detail = stageFailureDetail(test, "test failed");
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
  // Regression (or prior infra) stays primary; attach later failures without overwriting.
  return { category, detail: `${detail}; ${attached}` };
}
