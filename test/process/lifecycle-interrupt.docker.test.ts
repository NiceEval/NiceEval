// 跨进程保证：进程终止与信号——SIGINT 后 Docker Sandbox 主实例及伴随资源在进程退出前被回收，后续 Invocation 仍可运行
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";
import { expect, test } from "vitest";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";

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

// @feature docs/feature/sandbox/README.md#resource-group-cleanup
test("SIGINT during an Attempt removes the process's Docker containers and the next Invocation runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "niceeval-lifecycle-docker-"));
  const ready = join(cwd, "attempt-running");
  try {
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(
        join(cwd, "niceeval.config.ts"),
        'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 120_000 });\n',
      ),
      writeFile(
        join(cwd, "agent-hang.ts"),
        agent(
          "lifecycle-docker-hang",
          `await ctx.sandbox.runShellOrThrow("true", { signal: ctx.signal });
    await writeFile(${JSON.stringify(ready)}, "running");
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("the Attempt was interrupted");`,
        ),
      ),
      writeFile(
        join(cwd, "agent-quick.ts"),
        agent("lifecycle-docker-quick", 'await ctx.sandbox.runShellOrThrow("true", { signal: ctx.signal });'),
      ),
      writeFile(
        join(cwd, "evals", "probe.eval.ts"),
        'import { defineEval } from "niceeval";\nexport default defineEval({ async test(t) { await t.send("probe"); } });\n',
      ),
      writeFile(join(cwd, "experiments", "hang.ts"), experiment("agent-hang.ts")),
      writeFile(join(cwd, "experiments", "quick.ts"), experiment("agent-quick.ts")),
    ]);

    const child = execa(process.execPath, [...process.execArgv, cli, "exp", "hang", "--rerun", "all", "--json"], {
      cwd,
      detached: true,
      reject: false,
      env: { NO_COLOR: "1" },
      extendEnv: true,
    });
    const pid = child.pid!;
    try {
      await untilTrue("the Attempt to hold its container", () => access(ready).then(() => true, () => false), 120_000);
      expect(await ownedContainers(pid)).not.toEqual([]);
      process.kill(-pid, "SIGINT");
      const interrupted = await child;
      expect(interrupted.exitCode, interrupted.stderr).toBe(130);
      const receipt = interrupted.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string; receipt?: { completion: string } })
        .find((document) => document.type === "receipt");
      expect(receipt?.receipt?.completion).toBe("interrupted");
    } finally {
      child.kill("SIGKILL");
    }
    await untilTrue("owned containers to be removed", async () => (await ownedContainers(pid)).length === 0, 15_000);

    const nextChild = execa(process.execPath, [...process.execArgv, cli, "exp", "quick", "--rerun", "all", "--json"], {
      cwd,
      reject: false,
      env: { NO_COLOR: "1" },
      extendEnv: true,
    });
    const nextPid = nextChild.pid!;
    const next = await nextChild;
    expect(next.exitCode, next.stderr).toBe(0);
    await untilTrue("the next Invocation's containers to be removed", async () => (await ownedContainers(nextPid)).length === 0, 15_000);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 240_000);
