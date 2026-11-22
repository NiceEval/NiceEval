// 跨进程保证：进程终止与信号——Docker 库存能区分真实存活的镜像租约持有者与崩溃后残留的租约
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, watch, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { decodeDockerCacheInventoryDocument, decodeDockerCacheGcPreviewDocument } =
  require("niceeval/sandbox") as typeof import("../../packages/niceeval/src/sandbox/index.ts");
const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const image = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const [marker] = fc.sample(fc.nat(), { seed: 260_604, numRuns: 1 });

beforeAll(async () => {
  const local = await execa("docker", ["image", "inspect", image], { reject: false });
  if (local.exitCode !== 0) await execa("docker", ["pull", image], { timeout: 120_000 });
}, 125_000);

async function writeProject(cwd: string, label: string) {
  await Promise.all(["evals", "experiments", "image"].map((directory) => mkdir(join(cwd, directory))));
  await Promise.all([
    writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
    writeFile(join(cwd, "image/Dockerfile"), `FROM ${image}\nLABEL niceeval.test-case="${label}"\n`),
    writeFile(
      join(cwd, "niceeval.config.ts"),
      'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 60_000 });\n',
    ),
    writeFile(
      join(cwd, "evals/probe.eval.ts"),
      `import { writeFile } from "node:fs/promises";
import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    if (process.env.NICEEVAL_TEST_HOLD === "1") {
      await writeFile(new URL("../attempt-ready", import.meta.url), "");
      await t.sandbox.runCommandOrThrow("sleep", ["120"]);
    }
  },
});`,
    ),
    writeFile(
      join(cwd, "experiments/inventory.ts"),
      `import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const name = "inventory-fixture";
export default defineExperiment({
  adapter: defineSandboxAgent({
    name,
    evidenceCoverage: completeEvidenceCoverage,
    install: { identity: { agent: name, version: "1", revision: "1" }, probe: shell("true") },
    send: async () => ({ status: "completed", events: [] }),
  }),
  sandbox: dockerSandbox({ source: { type: "dockerfile", context: new URL("../image/", import.meta.url) } }),
  evals: ["probe"],
});`,
    ),
  ]);
}

async function waitUntilReady(cwd: string, signal: AbortSignal) {
  for await (const { filename } of watch(cwd, { signal })) {
    if (filename === "attempt-ready") return;
  }
  throw new Error("Docker Attempt did not acquire its image");
}

async function dockerResources(args: string[], filter: string) {
  const { stdout } = await execa("docker", [...args, "--filter", filter]);
  return stdout.split("\n").filter(Boolean);
}

const run = ["exp", "inventory", "--rerun=all"];

async function prepareProject(cwd: string, label: string) {
  let sentinel: string | undefined;
  const env = { NICEEVAL_HOME: join(cwd, "user"), NICEEVAL_TEST_HOLD: "0", NO_COLOR: "1" };
  const niceeval = (args: string[]) =>
    execa(process.execPath, [...process.execArgv, cli, ...args], { cwd, env, timeout: 60_000 });
  const start = () =>
    execa(process.execPath, [...process.execArgv, cli, ...run], {
      cwd,
      detached: true,
      env: { ...env, NICEEVAL_TEST_HOLD: "1" },
      reject: false,
      timeout: 60_000,
    });
  const inventory = async (domainId?: string) => {
    const args = ["docker", "cache", "inventory", "--json"];
    if (domainId !== undefined) args.push("--domain", domainId);
    return decodeDockerCacheInventoryDocument(JSON.parse((await niceeval(args)).stdout));
  };
  const onlyBuild = async (domainId: string) => {
    const { entries } = await inventory(domainId);
    expect(entries).toHaveLength(1);
    const entry = entries?.[0];
    if (entry?.kind !== "task-build") throw new Error(`Expected task-build inventory entry: ${JSON.stringify(entries)}`);
    return entry;
  };
  const dispose = async () => {
    try {
      const images = await dockerResources(["image", "ls", "-q"], `label=niceeval.test-case=${label}`);
      for (const id of new Set(images)) {
        for (const container of await dockerResources(["ps", "-aq"], `ancestor=${id}`)) {
          await execa("docker", ["rm", "-f", "-v", container], { reject: false });
        }
        await execa("docker", ["image", "rm", "-f", id], { reject: false });
      }
      if (sentinel !== undefined) await execa("docker", ["volume", "rm", sentinel], { reject: false });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  };
  try {
    await writeProject(cwd, label);
    await niceeval(run);
    const domains = (await inventory()).domains.filter((domain) => domain.state === "verified-managed");
    expect(domains).toHaveLength(1);
    const { domainId } = domains[0]!;
    const preview = await niceeval(["docker", "cache", "gc", "--domain", domainId, "--json"]);
    const { plan } = decodeDockerCacheGcPreviewDocument(JSON.parse(preview.stdout));
    sentinel = `niceeval-cache-${createHash("sha256").update(plan.ownerId).digest("hex").slice(0, 16)}`;
    return { cwd, start, build: () => onlyBuild(domainId), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

describe("Docker build inventory traces the lease holder's lifetime", () => {
  let project: Awaited<ReturnType<typeof prepareProject>> | undefined;
  let cold: Awaited<ReturnType<NonNullable<typeof project>["build"]>>;
  let child: ReturnType<NonNullable<typeof project>["start"]> | undefined;
  const controller = new AbortController();

  beforeAll(async () => {
    const cwd = await mkdtemp(join(tmpdir(), "niceeval-docker-build-inventory-"));
    project = await prepareProject(cwd, `inventory-${marker}-${randomUUID()}`);
    cold = await project.build();

    const ready = waitUntilReady(project.cwd, controller.signal);
    child = project.start();
    await Promise.race([
      ready,
      child.then(({ stdout, stderr }) => {
        throw new Error(`CLI exited before holding the Docker image: ${[stderr, stdout].filter(Boolean).join("\n")}`);
      }),
    ]);
  }, 120_000);

  function killHolder() {
    const state = child?.nodeChildProcess;
    if (child?.pid !== undefined && state?.exitCode === null && state.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }

  afterAll(async () => {
    controller.abort();
    try {
      killHolder();
      await child;
    } finally {
      await project?.dispose();
    }
  });

  // @feature docs/feature/sandbox/README.md#docker-build-inventory
  test("a built image without holders is reusable", () => {
    expect(cold).toMatchObject({ state: "cold-reusable", leaseCount: 0, liveLeaseCount: 0, unverifiedLeaseCount: 0 });
  });

  // @feature docs/feature/sandbox/README.md#docker-build-inventory
  test("a verified live holder makes the image active", async () => {
    expect(await project!.build()).toMatchObject({
      identity: cold.identity,
      state: "active-leased",
      leaseCount: 1,
      liveLeaseCount: 1,
      unverifiedLeaseCount: 0,
    });
  }, 30_000);

  // @feature docs/feature/sandbox/README.md#docker-build-inventory
  test("a killed holder leaves its lease unverified and protected", async () => {
    killHolder();
    expect((await child!).signal).toBe("SIGKILL");
    expect(await project!.build()).toMatchObject({
      identity: cold.identity,
      state: "unverified",
      leaseCount: 1,
      liveLeaseCount: 0,
      unverifiedLeaseCount: 1,
    });
  }, 30_000);
});
