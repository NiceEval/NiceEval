// owner: docs/engineering/testing/e2e/README.md#sandbox-setup-prefix-cache
// rerun: pnpm e2e test --repo lifecycle -- --run test/sandbox-setup-prefix-cache.test.ts

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { command, only, pollUntil, withProcess, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface SetupPrefixEvidence {
  readonly baseVersion: string;
  readonly runtimeMode: string;
  readonly innerDocker: string;
  readonly canonicalToken: string;
  readonly buildToken: string;
  readonly fixtureToken: string;
  readonly envToken: string;
  readonly publicEnv: string;
  readonly fixture: string;
  readonly demand: string;
  readonly sandboxId: string;
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const docker = command(["docker"]);
const binary = resolve("node_modules/.bin/niceeval");
const nodeImage = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const dindImage = "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c";
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-setup-prefix-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function decodeEvidence(stdout: string): SetupPrefixEvidence {
  const encoded = new Set(
    [...stdout.matchAll(/setup-prefix-evidence:([A-Za-z0-9_-]+)/gu)].map((match) => match[1]!),
  );
  expect(encoded.size, "public execution view must expose exactly one Agent evidence payload").toBe(1);
  const value = JSON.parse(Buffer.from([...encoded][0]!, "base64url").toString("utf8")) as Partial<SetupPrefixEvidence>;
  for (const key of [
    "baseVersion",
    "runtimeMode",
    "innerDocker",
    "canonicalToken",
    "buildToken",
    "fixtureToken",
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

async function invoke(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: {
    readonly image?: string;
    readonly baseVersion?: string;
    readonly mode?: "default" | "dynamic-tools" | "external-tmpfs" | "contention" | "capture-cancellation" | "canonical-json" | "raw-dind";
    readonly canonicalVariant?: "alpha" | "beta";
    readonly stateRoot?: string;
  } = {},
): Promise<SetupPrefixEvidence> {
  return (await invokeDetailed(root, demand, publicEnv, options)).evidence;
}

async function invokeDetailed(
  root: string,
  demand: "v1" | "v2",
  publicEnv: "PUBLIC_MODE=alpha\n" | "PUBLIC_MODE=beta\n",
  options: {
    readonly image?: string;
    readonly baseVersion?: string;
    readonly mode?: "default" | "dynamic-tools" | "external-tmpfs" | "contention" | "capture-cancellation" | "canonical-json" | "raw-dind";
    readonly canonicalVariant?: "alpha" | "beta";
    readonly stateRoot?: string;
  } = {},
): Promise<{
  readonly evidence: SetupPrefixEvidence;
  readonly diagnostic: string;
  readonly execution: string;
}> {
  const mode = options.mode ?? "default";
  const invocationEnv = {
    NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV: publicEnv,
    NICEEVAL_E2E_SETUP_PREFIX_MODE: mode,
    ...(options.image === undefined ? {} : { NICEEVAL_E2E_SETUP_PREFIX_IMAGE: options.image }),
    ...(options.canonicalVariant === undefined
      ? {}
      : { NICEEVAL_E2E_SETUP_PREFIX_CANONICAL_VARIANT: options.canonicalVariant }),
    ...(options.stateRoot === undefined ? {} : { XDG_STATE_HOME: options.stateRoot }),
  };
  const run = await niceeval.run(["exp", "setup-prefix-cache", "--rerun", "all", "--json"], {
    cwd: root,
    env: invocationEnv,
    timeoutMs: 180_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
  const evaluation = only(
    run.ndjson<ExpEvent>(),
    (event): event is ExpEvalEvent => event.event === "eval" && event.evalId === "setup-prefix-cache",
    run.diagnostic(),
  );
  expect(evaluation, run.diagnostic()).toMatchObject({
    experimentId: "setup-prefix-cache",
    verdict: "passed",
    attempts: 1,
    passed: 1,
  });

  const execution = await niceeval.run(["show", evaluation.locator, "--execution", "--json"], {
    cwd: root,
    env: invocationEnv,
  });
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  const evidence = decodeEvidence(execution.stdout);
  expect(evidence).toMatchObject({
    demand,
    publicEnv,
    fixture: "stable setup-prefix fixture\n",
    baseVersion: options.baseVersion ?? "default",
    runtimeMode: mode,
    innerDocker: mode === "raw-dind"
      ? "volume:niceeval-setup-prefix-inner-state"
      : "not-requested",
    canonicalToken: mode === "canonical-json" ? expect.any(String) : "not-requested",
  });
  await waitForSandboxGone(evidence.sandboxId, root);
  return { evidence, diagnostic: run.diagnostic(), execution: execution.stdout };
}

async function exportImageRootfs(image: string, destination: string): Promise<void> {
  const created = await docker.run(["create", image]);
  expect(created.exitCode, created.diagnostic()).toBe(0);
  const containerId = created.stdout.trim();
  try {
    const exported = await docker.run(["export", "--output", destination, containerId], { timeoutMs: 60_000 });
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
  } finally {
    const removed = await docker.run(["rm", "--force", containerId]);
    expect(removed.exitCode, removed.diagnostic()).toBe(0);
  }
}

test("独立 Invocation 只重新执行变化的 Sandbox setup 后缀，并为每个 Attempt 提供私有 writable clone", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-owner-state-", async (stateRoot) =>
    withProjectCopy(projectCopy, async ({ root }) => {
      // A unique context byte makes the first invocation a true cold BuildKey even
      // when a reliability repetition reuses the same host Docker daemon.
      await writeFile(
        join(root, "fixtures/setup-prefix/image/build-seed.txt"),
        `${randomUUID()}\n`,
        "utf8",
      );

      const coldRun = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", { stateRoot });
      const cold = coldRun.evidence;

      const evalPath = join(root, "evals/setup-prefix-cache.eval.ts");
      const originalEval = await readFile(evalPath, "utf8");
      const changedEval = originalEval.replace('const DEMAND = "v1";', 'const DEMAND = "v2";');
      expect(changedEval, "the private project copy must change the Eval result demand").not.toBe(originalEval);
      await writeFile(evalPath, changedEval, "utf8");

      const changedDemandRun = await invokeDetailed(root, "v2", "PUBLIC_MODE=alpha\n", { stateRoot });
      const changedDemand = changedDemandRun.evidence;
      const demandDiagnostic = `${coldRun.diagnostic}\n${changedDemandRun.diagnostic}`;
      expect(changedDemand.buildToken, demandDiagnostic).toBe(cold.buildToken);
      expect(changedDemand.fixtureToken, demandDiagnostic).toBe(cold.fixtureToken);
      expect(changedDemand.envToken, demandDiagnostic).toBe(cold.envToken);
      expect(changedDemandRun.execution).not.toContain(".setup-prefix/env-token");

      const changedEnv = await invokeDetailed(root, "v2", "PUBLIC_MODE=beta\n", { stateRoot });
      expect(changedEnv.evidence.buildToken).toBe(cold.buildToken);
      expect(changedEnv.evidence.fixtureToken).toBe(cold.fixtureToken);
      expect(changedEnv.evidence.envToken).not.toBe(changedDemand.envToken);
      expect(changedEnv.execution).toContain('"phase":"sandbox.prepare"');
      expect(changedEnv.execution).toContain(".setup-prefix/env-token");

      expect(new Set([cold.sandboxId, changedDemand.sandboxId, changedEnv.evidence.sandboxId]).size).toBe(3);
    }),
  );
});

test("浮动 Docker tag 改指后从新的 exact Base 建立准备前缀", async () => {
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

test("危险名称 Action metadata 在 alpha 与 beta 间不碰撞且返回 alpha 时命中原前缀", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-canonical-json-state-", async (stateRoot) => {
    await withProjectCopy(projectCopy, async ({ root }) => {
      await writeFile(join(root, "fixtures/setup-prefix/image/build-seed.txt"), `${randomUUID()}\n`, "utf8");
      const alpha = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        stateRoot,
      });
      const beta = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "beta",
        stateRoot,
      });
      expect(beta.evidence.canonicalToken).not.toBe(alpha.evidence.canonicalToken);
      expect(beta.execution).toContain(".setup-prefix/canonical-token");

      const alphaAgain = await invokeDetailed(root, "v1", "PUBLIC_MODE=alpha\n", {
        mode: "canonical-json",
        canonicalVariant: "alpha",
        stateRoot,
      });
      expect(alphaAgain.evidence.canonicalToken).toBe(alpha.evidence.canonicalToken);
      expect(alphaAgain.execution).not.toContain(".setup-prefix/canonical-token");
    });
  });
});

test("动态安装 runner tools 的实例永久 Unsupported 并真实重放 before", async () => {
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

test("tmpfs 外置 mutable state 为 Unsupported 且每次都真实重放", async () => {
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

test("两个 Invocation 竞争同一前缀时 loser 保留私有 staging 并禁用后续 publication", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-contention-state-", async (stateRoot) => {
    await withProjectCopy(projectCopy, async ({ root: firstRoot }) => {
      await withProjectCopy(projectCopy, async ({ root: secondRoot }) => {
        const image = `niceeval-e2e/setup-prefix-contention:${randomUUID()}`;
        const context = join(firstRoot, "fixtures/setup-prefix/image");
        try {
          const built = await docker.run(["build", "--tag", image, context], {
            cwd: firstRoot,
            timeoutMs: 180_000,
          });
          expect(built.exitCode, built.diagnostic()).toBe(0);
          const [first, second] = await Promise.all([
            invokeDetailed(firstRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              stateRoot,
            }),
            invokeDetailed(secondRoot, "v1", "PUBLIC_MODE=alpha\n", {
              image,
              mode: "contention",
              stateRoot,
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
            stateRoot,
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

test("raw DinD 在 graceful quiesce 后完整恢复 inner state 且每个 Attempt 使用私有 clone", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const context = join(root, "fixtures/setup-prefix/dind");
    await exportImageRootfs(nodeImage, join(context, "node-rootfs.tar"));
    await exportImageRootfs(dindImage, join(context, "docker-rootfs.tar"));

    const cold = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
      baseVersion: "raw-dind",
      mode: "raw-dind",
    });
    const restored = await invoke(root, "v1", "PUBLIC_MODE=alpha\n", {
      baseVersion: "raw-dind",
      mode: "raw-dind",
    });
    expect(restored.buildToken).toBe(cold.buildToken);
    expect(restored.fixtureToken).toBe(cold.fixtureToken);
    expect(restored.envToken).toBe(cold.envToken);
    expect(restored.innerDocker).toBe("volume:niceeval-setup-prefix-inner-state");
    expect(restored.sandboxId).not.toBe(cold.sandboxId);
  });
});

test("SIGINT 在真实 Docker capture 中取消后不得 publish、adopt 或 rebase", async () => {
  await withTempDir("niceeval-e2e-setup-prefix-cancellation-state-", async (stateRoot) => {
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
              XDG_STATE_HOME: stateRoot,
            },
            processGroup: true,
            timeoutMs: 180_000,
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
          stateRoot,
        });
        expect(retry.execution).toContain(".setup-prefix/capture-payload.bin");
      } finally {
        await docker.run(["image", "rm", image], { cwd: root });
      }
    });
  });
});
