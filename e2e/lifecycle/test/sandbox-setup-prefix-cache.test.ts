// rerun: pnpm e2e test --repo lifecycle -- --run test/sandbox-setup-prefix-cache.test.ts

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProcessReceipt, QuerySuccessDocumentFor } from "@niceeval/testkit";
import { command, only, pollUntil, withProcess, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectAttempt } from "./inspection.ts";

interface SetupPrefixEvidence {
  readonly baseVersion: string;
  readonly runtimeMode: string;
  readonly canonicalToken: string;
  readonly buildToken: string;
  readonly fixtureToken: string;
  readonly middleToken: string;
  readonly middleVersion: string;
  readonly envToken: string;
  readonly publicEnv: string;
  readonly fixture: string;
  readonly demand: string;
  readonly sandboxId: string;
}

interface IncusJournalRecord {
  readonly event: string;
  readonly detail: {
    readonly branch?: string;
    readonly method?: string;
    readonly path?: string;
    readonly project?: string;
    readonly argv?: readonly string[];
  };
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const docker = command(["docker"]);
const binary = resolve("node_modules/.bin/niceeval");
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-setup-prefix-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function decodeEvidence(trace: QuerySuccessDocumentFor<"attempt.trace">["trace"]): SetupPrefixEvidence {
  const messages = trace.conversation.items.flatMap((item) => item.kind === "message" ? [item] : []);
  const evidenceMessages = messages.filter((item) => item.text.includes("setup-prefix-evidence:"));
  expect(evidenceMessages, "public Inspection trace must expose exactly one Agent evidence message").toHaveLength(1);
  expect(evidenceMessages[0]!.textTruncated, "public Agent evidence must fit the stable trace projection").toBe(false);
  const encoded = new Set(
    [...evidenceMessages[0]!.text.matchAll(/setup-prefix-evidence:([A-Za-z0-9_-]+)/gu)].map((match) => match[1]!),
  );
  expect(encoded.size, "public Inspection trace must expose exactly one Agent evidence payload").toBe(1);
  const value = JSON.parse(Buffer.from([...encoded][0]!, "base64url").toString("utf8")) as Partial<SetupPrefixEvidence>;
  for (const key of [
    "baseVersion",
    "runtimeMode",
    "canonicalToken",
    "buildToken",
    "fixtureToken",
    "middleToken",
    "middleVersion",
    "envToken",
    "publicEnv",
    "fixture",
    "demand",
    "sandboxId",
  ] as const) {
    expect(value[key], `${key} must be a non-empty public evidence string`).toEqual(expect.any(String));
    expect(value[key]!.length, `${key} must be non-empty`).toBeGreaterThan(0);
  }
  return value as SetupPrefixEvidence;
}

async function waitForSandboxGone(sandboxId: string, cwd: string): Promise<void> {
  await pollUntil(
    async () => {
      const inspected = await docker.run(["inspect", sandboxId], { cwd });
      return inspected.exitCode !== 0 ? true : undefined;
    },
    { timeoutMs: 15_000, intervalMs: 100, label: `private SetupPrefix clone ${sandboxId} to be removed` },
  );
}

async function containersForInvocation(pid: number, cwd: string): Promise<readonly string[]> {
  const result = await docker.run([
    "ps", "-a", "--filter", `label=niceeval.pid=${pid}`, "--format", "{{.ID}}",
  ], { cwd });
  expect(result.exitCode, result.diagnostic()).toBe(0);
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

type SetupPrefixResumeLayer = 1 | 2 | 3;

const layerTokenPaths = [
  ".setup-prefix/fixture-token",
  ".setup-prefix/middle-token",
  ".setup-prefix/env-token",
] as const;

async function waitForResumeGate(
  pid: number,
  root: string,
  afterLayer: SetupPrefixResumeLayer,
): Promise<string> {
  const gate = `.setup-prefix/resume-after-${afterLayer}`;
  return pollUntil(
    async () => {
      for (const id of await containersForInvocation(pid, root)) {
        const reached = await docker.run([
          "exec",
          id,
          "sh",
          "-lc",
          `test -f ${gate}/entered && test -p ${gate}/release.fifo`,
        ], { cwd: root });
        if (reached.exitCode === 0) return id;
      }
      return undefined;
    },
    { timeoutMs: 180_000, intervalMs: 25, label: `Docker setup-prefix gate after layer ${afterLayer}` },
  );
}

async function readPublishedLayerTokens(
  containerId: string,
  root: string,
  completedLayers: SetupPrefixResumeLayer,
): Promise<readonly string[]> {
  const paths = layerTokenPaths.slice(0, completedLayers);
  const result = await docker.run([
    "exec",
    containerId,
    "sh",
    "-lc",
    paths.map((path) => `cat ${path}; printf '\\n'`).join("; "),
  ], { cwd: root });
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const tokens = result.stdout.trim().split(/\r?\n/u);
  expect(tokens, result.diagnostic()).toHaveLength(completedLayers);
  for (const token of tokens) expect(token).toMatch(/^[0-9a-f-]{36}$/u);
  return tokens;
}

async function releaseResumeGate(
  containerId: string,
  root: string,
  afterLayer: SetupPrefixResumeLayer,
): Promise<void> {
  const gate = `.setup-prefix/resume-after-${afterLayer}`;
  const released = await docker.run([
    "exec",
    containerId,
    "sh",
    "-lc",
    `printf 'release\\n' > ${gate}/release.fifo`,
  ], { cwd: root, timeoutMs: 15_000 });
  expect(released.exitCode, released.diagnostic()).toBe(0);
}

function evidenceLayerTokens(evidence: SetupPrefixEvidence): readonly string[] {
  return [evidence.fixtureToken, evidence.middleToken, evidence.envToken];
}

async function readIncusJournal(path: string): Promise<readonly IncusJournalRecord[]> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as IncusJournalRecord);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return [];
    throw cause;
  }
}

function incusExecCount(records: readonly IncusJournalRecord[], marker: string): number {
  return records.filter((record) => record.event === "exec" && record.detail.argv?.join(" ").includes(marker)).length;
}

interface InvokeOptions {
  readonly image?: string;
  readonly baseVersion?: string;
  readonly mode?:
    | "default"
    | "dynamic-tools"
    | "external-tmpfs"
    | "contention"
    | "capture-cancellation"
    | "layer-resume"
    | "canonical-json";
  readonly canonicalVariant?: "alpha" | "beta";
  readonly middleVersion?: "alpha" | "beta";
  readonly cancelAfter?: SetupPrefixResumeLayer;
  readonly niceevalHome?: string;
}

function invocationEnvironment(
  root: string,
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: InvokeOptions,
): NodeJS.ProcessEnv {
  const mode = options.mode ?? "default";
  return {
    NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV: publicEnv,
    NICEEVAL_E2E_SETUP_PREFIX_MODE: mode,
    ...(options.image === undefined ? {} : { NICEEVAL_E2E_SETUP_PREFIX_IMAGE: options.image }),
    ...(options.canonicalVariant === undefined
      ? {}
      : { NICEEVAL_E2E_SETUP_PREFIX_CANONICAL_VARIANT: options.canonicalVariant }),
    ...(options.middleVersion === undefined
      ? {}
      : { NICEEVAL_E2E_SETUP_PREFIX_MIDDLE_VERSION: options.middleVersion }),
    ...(options.cancelAfter === undefined
      ? {}
      : { NICEEVAL_E2E_SETUP_PREFIX_CANCEL_AFTER: String(options.cancelAfter) }),
    NICEEVAL_HOME: options.niceevalHome ?? join(root, ".niceeval-user"),
  };
}

async function invoke(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: InvokeOptions = {},
): Promise<SetupPrefixEvidence> {
  return (await invokeDetailed(root, demand, publicEnv, options)).evidence;
}

async function invokeDetailed(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: InvokeOptions = {},
): Promise<{
  readonly evidence: SetupPrefixEvidence;
  readonly diagnostic: string;
}> {
  const invocationEnv = invocationEnvironment(root, publicEnv, options);
  const run = await niceeval.run(["exp", "setup-prefix-cache", "--rerun", "all", "--json"], {
    cwd: root,
    env: invocationEnv,
    timeoutMs: 360_000,
  });
  return inspectCompletedInvocation(root, demand, publicEnv, options, invocationEnv, run);
}

async function inspectCompletedInvocation(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: InvokeOptions,
  invocationEnv: NodeJS.ProcessEnv,
  run: ProcessReceipt,
): Promise<{
  readonly evidence: SetupPrefixEvidence;
  readonly diagnostic: string;
}> {
  const mode = options.mode ?? "default";
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
  const evaluation = only(
    run.expEvalEvents(),
    (event) => event.evalId === "setup-prefix-cache",
    run.diagnostic(),
  );
  expect(evaluation, run.diagnostic()).toMatchObject({
    experimentId: "setup-prefix-cache",
    verdict: "passed",
    attempts: 1,
    passed: 1,
  });

  const inspected = await inspectAttempt(
    niceeval, root, evaluation.locator, "attempt.trace", { cwd: root, env: invocationEnv },
  );
  expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
  const traceDocument = inspected.receipt.attemptTrace();
  expect(traceDocument).toMatchObject({
    protocol: "niceeval.query/v1",
    operation: "attempt.trace",
    behaviorVersion: expect.any(String),
    trace: { format: "niceeval.inspection.trace/v1" },
  });
  const evidence = decodeEvidence(traceDocument.trace);
  expect(evidence).toMatchObject({
    demand,
    publicEnv,
    fixture: "stable setup-prefix fixture\n",
    baseVersion: options.baseVersion ?? "default",
    runtimeMode: mode,
    canonicalToken: mode === "canonical-json" ? expect.any(String) : "not-requested",
    middleVersion: options.middleVersion ?? "alpha",
  });
  await waitForSandboxGone(evidence.sandboxId, root);
  return { evidence, diagnostic: run.diagnostic() };
}

async function interruptAfterPublishedLayer(
  root: string,
  afterLayer: SetupPrefixResumeLayer,
  options: InvokeOptions,
): Promise<{ readonly tokens: readonly string[]; readonly diagnostic: string }> {
  const invocationEnv = invocationEnvironment(root, "PUBLIC_MODE=alpha\n", options);
  const interrupted = await withProcess(
    [binary, "exp", "setup-prefix-cache", "--rerun", "all", "--json"],
    {
      cwd: root,
      env: invocationEnv,
      processGroup: true,
      timeoutMs: 360_000,
      graceMs: 10_000,
    },
    async (controlled) => {
      const pid = controlled.pid;
      expect(pid, "NiceEval invocation must expose its provider ownership pid").toEqual(expect.any(Number));
      const containerId = await waitForResumeGate(pid!, root, afterLayer);
      const tokens = await readPublishedLayerTokens(containerId, root, afterLayer);
      expect(controlled.signal("SIGINT")).toBe(true);
      const receipt = await controlled.done;
      expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
      expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
      return { pid: pid!, tokens, diagnostic: receipt.diagnostic() };
    },
  );
  await pollUntil(
    async () => (await containersForInvocation(interrupted.pid, root)).length === 0 ? true : undefined,
    { timeoutMs: 15_000, intervalMs: 100, label: `cancelled layer-${afterLayer} staging cleanup` },
  );
  return { tokens: interrupted.tokens, diagnostic: interrupted.diagnostic };
}

async function retryAndReleaseLayerGate(
  root: string,
  afterLayer: SetupPrefixResumeLayer,
  options: InvokeOptions,
): Promise<{ readonly evidence: SetupPrefixEvidence; readonly diagnostic: string }> {
  const invocationEnv = invocationEnvironment(root, "PUBLIC_MODE=alpha\n", options);
  const receipt = await withProcess(
    [binary, "exp", "setup-prefix-cache", "--rerun", "all", "--json"],
    {
      cwd: root,
      env: invocationEnv,
      processGroup: true,
      timeoutMs: 360_000,
      graceMs: 10_000,
    },
    async (controlled) => {
      const pid = controlled.pid;
      expect(pid, "NiceEval retry must expose its provider ownership pid").toEqual(expect.any(Number));
      const containerId = await waitForResumeGate(pid!, root, afterLayer);
      await releaseResumeGate(containerId, root, afterLayer);
      return controlled.done;
    },
  );
  return inspectCompletedInvocation(
    root,
    "v1",
    "PUBLIC_MODE=alpha\n",
    options,
    invocationEnv,
    receipt,
  );
}

// Every case owns a private project copy, NiceEval home, image identity, and
// process-labelled containers. Keep the real Docker coverage while allowing
// Vitest to overlap these otherwise independent provider journeys.
test.concurrent("独立 Invocation 只重新执行变化的 Sandbox setup 后缀，并为每个 Attempt 提供私有 writable clone [necase_Q373EF5FD0JC84RE]", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-owner-home-", async (niceevalHome) =>
    withProjectCopy(projectCopy, async ({ root }) => {
      // A unique context byte makes the first invocation a true cold BuildKey even
      // when a reliability repetition reuses the same host Docker daemon.
      await writeFile(
        join(root, "fixtures/setup-prefix/image/build-seed.txt"),
        `${randomUUID()}\n`,
        "utf8",
      );

      const coldRun = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", { niceevalHome });
      const cold = coldRun.evidence;

      const evalPath = join(root, "evals/setup-prefix-cache.eval.ts");
      const originalEval = await readFile(evalPath, "utf8");
      const changedEval = originalEval.replace('const DEMAND = "v1";', 'const DEMAND = "v2";');
      expect(changedEval, "the private project copy must change the Eval result demand").not.toBe(originalEval);
      await writeFile(evalPath, changedEval, "utf8");

      const changedDemandRun = await invokeDetailed(root, "v2", "PUBLIC_MODE=alpha\n", { niceevalHome });
      const changedDemand = changedDemandRun.evidence;
      const demandDiagnostic = `${coldRun.diagnostic}\n${changedDemandRun.diagnostic}`;
      expect(changedDemand.buildToken, demandDiagnostic).toBe(cold.buildToken);
      expect(changedDemand.fixtureToken, demandDiagnostic).toBe(cold.fixtureToken);
      expect(changedDemand.middleToken, demandDiagnostic).toBe(cold.middleToken);
      expect(changedDemand.envToken, demandDiagnostic).toBe(cold.envToken);

      const changedMiddle = await invokeDetailed(root, "v2", "PUBLIC_MODE=alpha\n", {
        middleVersion: "beta",
        niceevalHome,
      });
      expect(changedMiddle.evidence.buildToken).toBe(cold.buildToken);
      expect(changedMiddle.evidence.fixtureToken).toBe(cold.fixtureToken);
      expect(changedMiddle.evidence.middleToken).not.toBe(changedDemand.middleToken);
      expect(changedMiddle.evidence.envToken).not.toBe(changedDemand.envToken);

      const changedEnv = await invokeDetailed(root, "v2", "PUBLIC_MODE=beta\n", {
        middleVersion: "beta",
        niceevalHome,
      });
      expect(changedEnv.evidence.buildToken).toBe(cold.buildToken);
      expect(changedEnv.evidence.fixtureToken).toBe(cold.fixtureToken);
      expect(changedEnv.evidence.middleToken).toBe(changedMiddle.evidence.middleToken);
      expect(changedEnv.evidence.envToken).not.toBe(changedMiddle.evidence.envToken);

      expect(new Set([
        cold.sandboxId,
        changedDemand.sandboxId,
        changedMiddle.evidence.sandboxId,
        changedEnv.evidence.sandboxId,
      ]).size).toBe(4);
    }),
  );
});

test.concurrent("浮动 Docker tag 改指后从新的 exact Base 建立准备前缀 [necase_NP8YWAQ4VY9K0JBT]", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const image = `niceeval-e2e/setup-prefix-floating:${randomUUID()}`;
    const context = join(root, "fixtures/setup-prefix/image");
    try {
      const firstBuild = await docker.run([
        "build", "--build-arg", "SETUP_BASE_VERSION=v1", "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(firstBuild.exitCode, firstBuild.diagnostic()).toBe(0);
      const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { image, baseVersion: "v1" });

      const secondBuild = await docker.run([
        "build", "--build-arg", "SETUP_BASE_VERSION=v2", "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(secondBuild.exitCode, secondBuild.diagnostic()).toBe(0);
      const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { image, baseVersion: "v2" });

      expect(second.buildToken).not.toBe(first.buildToken);
      expect(second.fixtureToken).not.toBe(first.fixtureToken);
      expect(second.sandboxId).not.toBe(first.sandboxId);
    } finally {
      await docker.run(["image", "rm", image], { cwd: root });
    }
  });
});

test.concurrent("危险名称 Action metadata 在 alpha 与 beta 间不碰撞且返回 alpha 时命中原前缀 [necase_K83ZAVQY1Y6RHBQ3]", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-canonical-json-home-", async (niceevalHome) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      await writeFile(join(root, "fixtures/setup-prefix/image/build-seed.txt"), `${randomUUID()}\n`, "utf8");
      const alpha = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        niceevalHome,
      });
      const beta = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "beta",
        niceevalHome,
      });
      expect(beta.evidence.canonicalToken).not.toBe(alpha.evidence.canonicalToken);

      const alphaAgain = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        niceevalHome,
      });
      expect(alphaAgain.evidence.canonicalToken).toBe(alpha.evidence.canonicalToken);
    });
  });
});

test.concurrent("动态安装 runner tools 的实例永久 Unsupported 并真实重放 before [necase_765V96B5XGCBPF7E]", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const image = `niceeval-e2e/setup-prefix-dynamic-tools:${randomUUID()}`;
    const context = join(root, "fixtures/setup-prefix/image");
    try {
      const built = await docker.run([
        "build", "--file", join(context, "Dockerfile.dynamic-tools"), "--tag", image, context,
      ], { cwd: root, timeoutMs: 180_000 });
      expect(built.exitCode, built.diagnostic()).toBe(0);
      const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
        image,
        baseVersion: "dynamic-tools",
        mode: "dynamic-tools",
      });
      const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
        image,
        baseVersion: "dynamic-tools",
        mode: "dynamic-tools",
      });
      expect(second.buildToken).toBe(first.buildToken);
      expect(second.fixtureToken).not.toBe(first.fixtureToken);
      expect(second.envToken).not.toBe(first.envToken);
      expect(second.sandboxId).not.toBe(first.sandboxId);
    } finally {
      await docker.run(["image", "rm", image], { cwd: root });
    }
  });
});

test.concurrent("tmpfs 外置 mutable state 为 Unsupported 且每次都真实重放 [necase_WYAE33VD61WANSQC]", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    await writeFile(join(root, "fixtures/setup-prefix/image/build-seed.txt"), `${randomUUID()}\n`, "utf8");
    const first = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { mode: "external-tmpfs" });
    const second = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", { mode: "external-tmpfs" });
    expect(second.buildToken).toBe(first.buildToken);
    expect(second.fixtureToken).not.toBe(first.fixtureToken);
    expect(second.envToken).not.toBe(first.envToken);
    expect(second.sandboxId).not.toBe(first.sandboxId);
  });
});

test.concurrent("两个 Invocation 竞争同一前缀时 loser 保留私有 staging 并禁用后续 publication [necase_JMXWB89TE96V2RHP]", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-contention-home-", async (niceevalHome) => {
    await withProjectCopy(projectCopy, async ({ root: firstRoot }) => {
      await withProjectCopy(projectCopy, async ({ root: secondRoot }) => {
        const image = `niceeval-e2e/setup-prefix-contention:${randomUUID()}`;
        const context = join(firstRoot, "fixtures/setup-prefix/image");
        try {
          const built = await docker.run(["build", "--tag", image, context], {
            cwd: firstRoot,
            timeoutMs: 360_000,
          });
          expect(built.exitCode, built.diagnostic()).toBe(0);
          const [first, second] = await Promise.all([
            invokeDetailed(firstRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              niceevalHome,
            }),
            invokeDetailed(secondRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              niceevalHome,
            }),
          ]);
          expect(first.evidence.fixtureToken).not.toBe(second.evidence.fixtureToken);
          const competingDiagnostics = [first.diagnostic, second.diagnostic];
          expect(
            competingDiagnostics.some((value) =>
              value.includes("setup-prefix cache=replay reason=contended")),
            competingDiagnostics.join("\n\n--- competing invocation ---\n\n"),
          ).toBe(true);

          const follower = await invokeDetailed(firstRoot, "v1", "PUBLIC_MODE=alpha\n", {
            image,
            mode: "contention",
            niceevalHome,
          });
          expect([first.evidence.fixtureToken, second.evidence.fixtureToken])
            .toContain(follower.evidence.fixtureToken);
          expect([first.evidence.envToken, second.evidence.envToken])
            .toContain(follower.evidence.envToken);
        } finally {
          await docker.run(["image", "rm", image], { cwd: firstRoot });
        }
      });
    });
  });
});

test.concurrent("SIGINT 在真实 Docker capture 中取消后不得 publish、adopt 或 rebase [necase_A4AVTMGQ3KWT237Z]", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-cancellation-home-", async (niceevalHome) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      const image = `niceeval-e2e/setup-prefix-cancellation:${randomUUID()}`;
      const context = join(root, "fixtures/setup-prefix/image");
      try {
        const built = await docker.run(["build", "--tag", image, context], { cwd: root, timeoutMs: 180_000 });
        expect(built.exitCode, built.diagnostic()).toBe(0);
        const interrupted = await withProcess(
          [binary, "exp", "setup-prefix-cache", "--rerun", "all", "--json"],
          {
            cwd: root,
            env: {
              NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV: "PUBLIC_MODE=alpha\n",
              NICEEVAL_E2E_SETUP_PREFIX_IMAGE: image,
              NICEEVAL_E2E_SETUP_PREFIX_MODE: "capture-cancellation",
              NICEEVAL_HOME: niceevalHome,
            },
            processGroup: true,
            timeoutMs: 360_000,
            graceMs: 10_000,
          },
          async (controlled) => {
            const pid = controlled.pid;
            expect(pid, "NiceEval invocation must expose its provider ownership pid").toEqual(expect.any(Number));
            await pollUntil(
              async () => {
                const ids = await containersForInvocation(pid!, root);
                for (const id of ids) {
                  const status = await docker.run(["inspect", "--format", "{{.State.Status}}", id], { cwd: root });
                  if (status.exitCode === 0 && status.stdout.trim() === "exited") return id;
                }
                return undefined;
              },
              { timeoutMs: 60_000, intervalMs: 25, label: "outer Docker container stopped for setup-prefix capture" },
            );
            expect(controlled.signal("SIGINT")).toBe(true);
            const receipt = await controlled.done;
            expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
            expect(receipt.expReceipt(), receipt.diagnostic()).toMatchObject({ completion: "interrupted" });
            return { receipt, pid: pid! };
          },
        );
        expect(interrupted.receipt.exitCode).toBe(130);
        await pollUntil(
          async () => (await containersForInvocation(interrupted.pid, root)).length === 0 ? true : undefined,
          { timeoutMs: 15_000, intervalMs: 100, label: "cancelled setup-prefix staging and clone cleanup" },
        );

        const retry = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
          image,
          mode: "capture-cancellation",
          niceevalHome,
        });
        expect(retry.evidence.runtimeMode).toBe("capture-cancellation");
      } finally {
        await docker.run(["image", "rm", image], { cwd: root });
      }
    });
  });
});

test.concurrent("SIGINT 在任一已发布 Docker setup 层后取消，重试从该层继续 [necase_S9N8JKAHW3Z8GBEM]", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-resume-home-", async (niceevalHome) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      const image = `niceeval-e2e/setup-prefix-resume:${randomUUID()}`;
      const context = join(root, "fixtures/setup-prefix/image");
      try {
        const built = await docker.run(["build", "--tag", image, context], { cwd: root, timeoutMs: 180_000 });
        expect(built.exitCode, built.diagnostic()).toBe(0);

        for (const afterLayer of [1, 2, 3] as const) {
          const options: InvokeOptions = {
            image,
            mode: "layer-resume",
            cancelAfter: afterLayer,
            niceevalHome,
          };
          const interrupted = await interruptAfterPublishedLayer(root, afterLayer, options);
          const retry = await retryAndReleaseLayerGate(root, afterLayer, options);
          expect(
            evidenceLayerTokens(retry.evidence).slice(0, afterLayer),
            `retry after layer ${afterLayer} must restore every already-published token\n` +
              `${interrupted.diagnostic}\n\n--- retry ---\n${retry.diagnostic}`,
          ).toEqual(interrupted.tokens);
        }
      } finally {
        await docker.run(["image", "rm", image], { cwd: root });
      }
    });
  });
}, 600_000);

test.concurrent("共享准备前缀只发布一次，并在全局派发屏障前并行准备独立后缀 [necase_APN2MNBEXSN1G18T]", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    await withTempDir("niceeval-e2e-incus-prefix-dag-", async (runtimeRoot) => {
      const binDir = join(runtimeRoot, "bin");
      const descriptor = join(runtimeRoot, "incus-provider.json");
      const state = join(runtimeRoot, "incus-state.json");
      const journalPath = join(runtimeRoot, "incus-journal.ndjson");
      const gateRoot = join(runtimeRoot, "gates");
      const fakeIncus = resolve("fixtures/fake-incus.mjs");
      const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      await mkdir(binDir, { recursive: true });
      await mkdir(gateRoot, { recursive: true });
      const wrapper = join(binDir, "incus");
      await writeFile(wrapper, `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(fakeIncus).href)});\n`, "utf8");
      await chmod(wrapper, 0o755);
      await writeFile(descriptor, `${JSON.stringify({
        schemaVersion: "niceeval.incus-provider/v2",
        domains: [{
          name: "development",
          status: "configured",
          executionDomainId: "e2e-incus-prefix-dag",
          project: "niceeval-eval-dev",
          storagePool: "niceeval-sandbox-dev",
          network: "niceeval-dev",
          storage: "development-dir",
          quota: "unattested",
          maxInstances: 8,
          artifactProject: "niceeval-artifacts-dev",
          artifactMaxInstances: 8,
          dockerDataBytes: 1024 ** 3,
          workdir: "/home/sandbox/workspace",
          user: "node",
          hostGateway: "10.0.0.1",
          trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${digest}`],
        }],
      })}\n`, "utf8");
      await writeFile(join(root, "experiments/incus-prefix-dag.ts"), `
import { defineExperiment } from "niceeval";
import { actionRef, incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";
const sandbox = incusSandbox({
  image: "niceeval/docker-execution-v1@sha256:${digest}",
  project: "niceeval-eval-dev",
  storagePool: "niceeval-sandbox-dev",
  acceptDevelopmentDomain: true,
  resources: { dockerDataBytes: ${1024 ** 3} },
}).before(shell({ id: "prefix-one", command: "true # niceeval-e2e-prefix-one", changeFrequency: 10 }))
  .before(shell({ id: "prefix-two", command: "true # niceeval-e2e-prefix-two", changeFrequency: 20, dependsOn: [actionRef("prefix-one")] }));
export default defineExperiment({
  agent: quickAgent,
  sandbox,
  evals: ["prefix-branch-three", "prefix-branch-four"],
  attempts: 1,
});
`, "utf8");
      await writeFile(join(root, "evals/prefix-branch-three.eval.ts"), `
import { defineEval } from "niceeval";
import { actionRef, sandboxLayer, shell } from "niceeval/sandbox";
export default defineEval({
  sandbox: sandboxLayer().before(shell({ id: "prefix-three", command: "true # niceeval-e2e-prefix-branch-three", changeFrequency: 30, dependsOn: [actionRef("prefix-two")] })),
  async test(t) { await (await t.send("three")).succeeded().orStop(); },
});
`, "utf8");
      await writeFile(join(root, "evals/prefix-branch-four.eval.ts"), `
import { defineEval } from "niceeval";
import { actionRef, sandboxLayer, shell } from "niceeval/sandbox";
export default defineEval({
  sandbox: sandboxLayer().before(shell({ id: "prefix-four", command: "true # niceeval-e2e-prefix-branch-four", changeFrequency: 40, dependsOn: [actionRef("prefix-two")] })),
  async test(t) { await (await t.send("four")).succeeded().orStop(); },
});
`, "utf8");

      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        NICEEVAL_HOME: join(runtimeRoot, "user"),
        XDG_STATE_HOME: join(runtimeRoot, "xdg-state"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
        NICEEVAL_E2E_FAKE_INCUS_STATE: state,
        NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journalPath,
        NICEEVAL_E2E_FAKE_INCUS_GATE_ROOT: gateRoot,
      };
      const receipt = await withProcess(
        [binary, "exp", "incus-prefix-dag", "--rerun", "all", "--max-concurrency", "2", "--json"],
        { cwd: root, env: baseEnv, processGroup: true, timeoutMs: 180_000, graceMs: 10_000 },
        async (controlled) => {
          try {
            const atBothBranches = await pollUntil(async () => {
              const records = await readIncusJournal(journalPath);
              const branches = new Set(records.filter((record) => record.event === "prefix-gate-reached")
                .map((record) => record.detail.branch));
              return branches.has("three") && branches.has("four") ? records : undefined;
            }, { timeoutMs: 30_000, intervalMs: 25, label: "both independent Incus SetupPrefix branches to reach their gates" });

            expect(incusExecCount(atBothBranches, "niceeval-e2e-prefix-one")).toBe(1);
            expect(incusExecCount(atBothBranches, "niceeval-e2e-prefix-two")).toBe(1);
            expect(incusExecCount(atBothBranches, "node --version"), "Attempt dispatch must wait for every final prefix").toBe(0);
            const commonPublishes = atBothBranches.filter((record) => record.event === "query" &&
              record.detail.method === "POST" && record.detail.path === "/1.0/instances" &&
              record.detail.project === "niceeval-artifacts-dev");
            expect(commonPublishes, "both shared ancestors must be committed before either child gate").toHaveLength(2);
            const releasedPrepareVms = atBothBranches.filter((record) => record.event === "query" &&
              record.detail.method === "DELETE" && record.detail.project === "niceeval-eval-dev");
            expect(releasedPrepareVms.length, "shared prefix prepare VMs must be released before child preparation").toBeGreaterThanOrEqual(2);
          } finally {
            await Promise.all([
              writeFile(join(gateRoot, "release-three"), "release\n", "utf8"),
              writeFile(join(gateRoot, "release-four"), "release\n", "utf8"),
            ]);
          }
          return controlled.done;
        },
      );
      expect(receipt.exitCode, "the fake provider deliberately fails agent.ensure after pre-dispatch preparation").not.toBe(0);
    });
  });
}, 240_000);
