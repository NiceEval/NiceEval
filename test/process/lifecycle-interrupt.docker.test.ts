// 跨进程保证：进程终止与信号——SIGINT 后 Docker Sandbox 主实例及伴随资源在进程退出前被回收，后续 Invocation 仍可运行
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";

beforeAll(async () => {
  // Both properties use the same immutable base. Populate the runner cache once.
  const local = await execa("docker", ["image", "inspect", NODE_IMAGE], { reject: false });
  if (local.exitCode !== 0) await execa("docker", ["pull", NODE_IMAGE]);
}, 120_000);

const agent = (name: string, body: string) => `
import { writeFile } from "node:fs/promises";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export default defineSandboxAgent({
  name: ${JSON.stringify(name)},
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: ${JSON.stringify(name)}, version: "24.19.0", revision: "1" },
    probe: shell('test "$(node --version)" = "v24.19.0"'),
  },
  send: async (_input, ctx) => {
    ${body}
    return { status: "completed", events: [] };
  },
});
`;

const experiment = (agentFile: string) => `
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import agent from "../${agentFile}";

export default defineExperiment({
  adapter: agent,
  sandbox: dockerSandbox({
    source: { type: "image", image: ${JSON.stringify(NODE_IMAGE)} },
    user: "node",
    resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
  }),
  evals: ["probe"],
  attempts: 1,
});
`;

async function ownedContainers(pid: number): Promise<string[]> {
  const listed = await execa("docker", ["ps", "-aq", "--filter", `label=niceeval.pid=${pid}`]);
  return listed.stdout.split("\n").filter(Boolean);
}

async function untilTrue(label: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(100)) {
    if (await check()) return;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("interrupting a Docker Attempt", () => {
  let cwd: string | undefined;
  const start = (workdir: string, hold: boolean) =>
    execa(process.execPath, [...process.execArgv, cli, "exp", "interrupt", "--rerun", "all", "--json"], {
      cwd: workdir,
      detached: true,
      reject: false,
      env: { NO_COLOR: "1", NICEEVAL_HOME: join(workdir, "user"), NICEEVAL_TEST_HOLD: hold ? "1" : "0" },
      timeout: 120_000,
    });
  let child: ReturnType<typeof start> | undefined;

  beforeAll(async () => {
    const workdir = await mkdtemp(join(tmpdir(), "niceeval-lifecycle-docker-"));
    cwd = workdir;
    const ready = join(workdir, "attempt-running");
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(workdir, dir))));
    await Promise.all([
      writeFile(
        join(workdir, "niceeval.config.ts"),
        'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 120_000 });\n',
      ),
      writeFile(
        join(workdir, "agent.ts"),
        agent(
          "lifecycle-docker-interrupt",
          `await ctx.sandbox.runShellOrThrow("true", { signal: ctx.signal });
    if (process.env.NICEEVAL_TEST_HOLD !== "1") return { status: "completed", events: [] };
    await writeFile(${JSON.stringify(ready)}, "running");
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("the Attempt was interrupted");`,
        ),
      ),
      writeFile(
        join(workdir, "evals", "probe.eval.ts"),
        'import { defineEval } from "niceeval";\nexport default defineEval({ async test(t) { await t.send("probe"); } });\n',
      ),
      writeFile(join(workdir, "experiments", "interrupt.ts"), experiment("agent.ts")),
    ]);

    child = start(workdir, true);
    await Promise.race([
      untilTrue(
        "the Attempt to hold its container",
        () =>
          access(ready).then(
            () => true,
            () => false,
          ),
        120_000,
      ),
      child.then(({ stderr, stdout }) => {
        throw new Error(stderr || stdout);
      }),
    ]);
  }, 130_000);

  afterAll(async () => {
    if (
      child?.pid !== undefined &&
      child.nodeChildProcess.exitCode === null &&
      child.nodeChildProcess.signalCode === null
    ) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      await child;
    }
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  let interrupted: ReturnType<typeof childResult> | undefined;

  async function childResult() {
    const pid = child!.pid!;
    const containersBefore = await ownedContainers(pid);
    process.kill(-pid, "SIGINT");
    const result = await child!;
    return { containersBefore, ...result, pid };
  }

  const interruptOnce = () => (interrupted ??= childResult());

  // @feature docs/feature/sandbox/README.md#resource-group-cleanup
  test("SIGINT removes a running Attempt's containers before the CLI exits", async () => {
    const interrupted = await interruptOnce();
    expect(interrupted.containersBefore).not.toEqual([]);
    expect(interrupted.exitCode, interrupted.stderr).toBe(130);
    const receipt = interrupted.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; receipt?: { completion: string } })
      .find((document) => document.type === "receipt");
    expect(receipt?.receipt?.completion).toBe("interrupted");
    expect(await ownedContainers(interrupted.pid)).toEqual([]);
  }, 60_000);

  describe("after an interrupted Invocation", () => {
    beforeAll(async () => {
      await interruptOnce();
    }, 60_000);

    // @feature docs/feature/sandbox/README.md#resource-group-cleanup
    test("the next Invocation runs and exits without leaving containers", async () => {
      const next = start(cwd!, false);
      const { exitCode, stderr } = await next;
      expect(exitCode, stderr).toBe(0);
      expect(await ownedContainers(next.pid!)).toEqual([]);
    }, 60_000);
  });
});

describe("Docker background commands", () => {
  let cwd: string | undefined;
  const launch = (workdir: string) =>
    execa(process.execPath, [...process.execArgv, cli, "exp", "background", "--rerun", "all", "--json"], {
      cwd: workdir,
      reject: false,
      timeout: 55_000,
      env: { NO_COLOR: "1", NICEEVAL_HOME: join(workdir, "user") },
    });
  let child: ReturnType<typeof launch>;
  let startPath: string;

  beforeAll(async () => {
    const workdir = await mkdtemp(join(tmpdir(), "niceeval-background-docker-"));
    cwd = workdir;
    const readyPath = join(workdir, "attempt-ready");
    startPath = join(workdir, "start-commands");
    await Promise.all(["evals", "experiments"].map((directory) => mkdir(join(workdir, directory))));
    await Promise.all([
      writeFile(join(cwd, "agent.ts"), agent("background-docker", "")),
      writeFile(join(cwd, "experiments", "background.ts"), experiment("agent.ts")),
      writeFile(
        join(cwd, "niceeval.config.ts"),
        'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 50_000 });\n',
      ),
      writeFile(join(cwd, "evals", "probe.eval.ts"), `
import assert from "node:assert/strict";
import { watch } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    const start = Promise.withResolvers<void>();
    const watcher = watch(${JSON.stringify(workdir)}, (_event, file) => {
      if (file === "start-commands") {
        void access(${JSON.stringify(startPath)}).then(start.resolve, start.reject);
      }
    });
    try {
      await writeFile(${JSON.stringify(readyPath)}, "");
      await start.promise;
    } finally {
      watcher.close();
    }
    const marker = () => Promise.withResolvers<void>();
    const one = marker();
    const two = marker();
    const first = await t.sandbox.startShell("printf ready; exec sleep 120", { onStdout: () => one.resolve() });
    const second = await t.sandbox.startCommand("bash", ["-c", "printf ready; exec sleep 120"], { onStdout: () => two.resolve() });
    await Promise.all([one.promise, two.promise]);
    const foreground = await t.sandbox.runCommandOrThrow("printf", ["foreground"]);
    assert.equal(foreground.stdout, "foreground");
    assert.equal(first.settled, false);
    assert.equal(second.settled, false);
  },
});
`),
    ]);
    child = launch(workdir);
    await Promise.race([
      untilTrue("the Docker Attempt to reach its test", () => access(readyPath).then(() => true, () => false), 45_000),
      child.then((result) => {
        throw new Error(result.stderr || result.stdout);
      }),
    ]);
  }, 50_000);

  afterAll(async () => {
    if (child !== undefined) {
      child.kill("SIGTERM");
      await child;
    }
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/sandbox/library/operations.md#后台命令
  test("Attempt exit retires a Docker container that still has concurrent background commands", async () => {
    await writeFile(startPath, "");
    const completed = await child;
    expect(completed.exitCode, String(completed.stderr || completed.stdout)).toBe(0);
    expect(await ownedContainers(child.pid!)).toEqual([]);
  }, 15_000);
});
