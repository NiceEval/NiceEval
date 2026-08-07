// Structured per-stage receipts for one isolated repo run.
// Stages: install → injection → test → collect → cleanup.
// Command failures retain stdout/stderr/timeout; receipts never decide a
// product verdict from .niceeval contents.

export type StageName = "install" | "injection" | "test" | "collect" | "cleanup";

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
  const install = byStage.get("install");
  const injection = byStage.get("injection");
  const test = byStage.get("test");
  const collect = byStage.get("collect");
  const cleanup = byStage.get("cleanup");

  let category: Category;
  let detail: string;

  if (install && !install.ok) {
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
