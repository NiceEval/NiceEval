// Structured per-stage receipts for one isolated repo run.
// Stages: preflight → prepare → install → injection → browser → test → collect → cleanup.
// prepare covers the harness-side pre-flight guards (source cleanliness,
// declared-but-not-injected, undeclared-but-imported) that must fail before
// any test runs. Command failures retain stdout/stderr/timeout; receipts
// never decide a product verdict from .niceeval contents.

import type { OwnedProcessGroupCleanup } from "./owned-process.ts";

export type StageName =
  | "preflight"
  | "prepare"
  | "install"
  | "injection"
  | "browser"
  | "test"
  | "collect"
  | "cleanup";

export type Category = "pass" | "regression" | "infra" | "configuration" | "cancelled";

export interface CommandCapture {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** True when root cancellation stopped this owned command group. */
  cancelled: boolean;
  stdout: string;
  stderr: string;
  /** Spawn failure, if the command could not start. */
  error?: string;
  /** Whether the runner created an owned detached POSIX process group. */
  processGroupOwned: boolean;
  /** Post-close evidence that an owned detached group no longer exists. */
  groupCleanup: OwnedProcessGroupCleanup;
}

export interface CapabilityCheck {
  kind: "platform" | "runtime" | "docker" | "browser" | "secret" | "externalNetwork";
  /** Requirement name only; secret values are never placed in a receipt. */
  subject: string;
  ok: boolean;
  /** A declared requirement may be recorded without a synthetic probe. */
  verification?: "checked" | "declared-unverified";
  /** An ownership-cleanup failure is runner infrastructure, not a missing capability. */
  failureCategory?: "configuration" | "infra";
  detail: string;
  command?: readonly string[];
  capture?: CommandCapture;
}

export interface StageReceipt {
  stage: StageName;
  ok: boolean;
  /** This stage was stopped by root SIGINT/SIGTERM rather than failed normally. */
  cancelled?: boolean;
  /** Lets preflight distinguish unavailable capabilities from runner cleanup infra. */
  failureCategory?: "configuration" | "infra";
  /** Human-readable detail; never parsed for product verdict. */
  detail?: string;
  command?: readonly string[];
  capture?: CommandCapture;
  /** 1-based test invocation when a takeover run deliberately reuses one copy. */
  attempt?: number;
  /**
   * Opaque invocation namespace given to the child command that owns this
   * stage. In particular, every native test command gets a fresh value even
   * when a takeover deliberately reuses the same installed copy.
   */
  invocationId?: string;
  /** Structured environment/capability facts for preflight and browser stages. */
  checks?: readonly CapabilityCheck[];
  /** Paths written under the external artifact root (collect only). */
  collected?: readonly string[];
  /** Filesystem path cleaned or targeted (cleanup only). */
  path?: string;
}

export interface RepoReceipt {
  repoId: string;
  /** Fresh opaque IDs injected into setup and every test command for this repo run. */
  invocationIds: readonly string[];
  /** Number of deliberate test invocations made in this one isolated copy. */
  testInvocations: number;
  /** Present for a takeover receipt that intentionally names its isolated copy. */
  copyId?: string;
  /** Durable receipt scope, such as takeover/fresh-1. */
  runLabel?: string;
  /** Fixed source snapshot digest shared by all takeover observations. */
  sourceSnapshotDigest?: string;
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
  /** Present when the checkout-sourced Testkit snapshot was injected. */
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
  /** Immutable invocation-local snapshot identity verified before and after use. */
  digest: string;
}

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
      "exceeded e2e.json timeoutMinutes; owned process group terminated",
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
