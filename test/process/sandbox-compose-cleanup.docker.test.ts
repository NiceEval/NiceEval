// 跨进程保证：进程终止与信号——SIGINT 后真实 CLI 退出前结算 Compose 实例、网络和卷
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, watch, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { decodeExpTerminalEvent } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const image = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const volumeKinds = ["owned", "anonymous", "external"] as const;
const otherOrders = fc
  .shuffledSubarray([...volumeKinds], { minLength: 3, maxLength: 3 })
  .filter((order) => order.some((kind, index) => kind !== volumeKinds[index]));
const mountOrders = [volumeKinds, ...fc.sample(otherOrders, { seed: 260_602, numRuns: 1 })];

beforeAll(async () => {
  await execa("docker", ["pull", image], { timeout: 120_000 });
}, 125_000);

async function waitUntilReady(cwd: string, signal: AbortSignal) {
  for await (const { filename } of watch(cwd, { signal })) {
    if (filename === "attempt-ready") return;
  }
  throw new Error("Compose Attempt never became ready");
}

async function dockerList(args: string[], filter: string) {
  const { stdout } = await execa("docker", [...args, "--filter", filter]);
  return stdout.split("\n").filter(Boolean);
}

const adapter = `
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export default defineSandboxAgent({
  name: "compose-cleanup",
  evidenceCoverage: completeEvidenceCoverage,
  install: {
    identity: { agent: "compose-cleanup", version: "1", revision: "1" },
    probe: shell("true"),
  },
  send: async () => ({ status: "completed", events: [] }),
});
`;

const evaluation = `
import { writeFile } from "node:fs/promises";
import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    await t.sandbox.runCommandOrThrow("true");
    await writeFile(new URL("../attempt-ready", import.meta.url), "");
    await t.sandbox.runCommandOrThrow("sleep", ["120"]);
  },
});
`;

// @feature docs/feature/sandbox/README.md#resource-group-cleanup
test.each(mountOrders.map((mountOrder) => ({ mountOrder })))(
  "stopping an Attempt removes Compose group resources and preserves its external volume ($mountOrder)",
  async ({ mountOrder }) => {
    const cwd = await mkdtemp(join(tmpdir(), "niceeval-compose-cleanup-"));
    const id = `niceeval-compose-${randomUUID()}`;
    const externalVolume = `${id}-external`;
    const filter = `label=niceeval.test-case=${id}`;
    const composeFile = join(cwd, "compose.yaml");
    const mounts = { owned: "owned:/owned", anonymous: "/anonymous", external: "external:/external" };
    let projectName: string | undefined;
    let anonymousVolume: string | undefined;
    try {
      await execa("docker", ["volume", "create", externalVolume]);
      await Promise.all(["evals", "experiments"].map((directory) => mkdir(join(cwd, directory))));
      const compose = {
        services: {
          client: {
            image,
            command: ["sleep", "120"],
            labels: { "niceeval.test-case": id },
            volumes: mountOrder.map((kind) => mounts[kind]),
          },
        },
        volumes: {
          owned: {},
          external: { external: true, name: externalVolume },
        },
      };
      await Promise.all([
        writeFile(composeFile, JSON.stringify(compose)),
        writeFile(join(cwd, "evals/probe.eval.ts"), evaluation),
        writeFile(join(cwd, "agent.ts"), adapter),
        writeFile(
          join(cwd, "niceeval.config.ts"),
          'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 60_000 });\n',
        ),
        writeFile(
          join(cwd, "experiments/compose.ts"),
          `import { defineExperiment } from "niceeval";
import { dockerComposeSandbox } from "niceeval/sandbox";
import adapter from "../agent.ts";
export default defineExperiment({
  adapter,
  sandbox: dockerComposeSandbox({ file: new URL("../compose.yaml", import.meta.url), workspaceService: "client" }),
  evals: ["probe"],
});`,
        ),
      ]);

      const watchController = new AbortController();
      const ready = waitUntilReady(cwd, watchController.signal);
      const child = execa(process.execPath, [...process.execArgv, cli, "exp", "compose", "--rerun=all", "--json"], {
        cwd,
        detached: true,
        env: { NICEEVAL_HOME: join(cwd, "user"), NO_COLOR: "1" },
        reject: false,
        timeout: 60_000,
      });
      try {
        await Promise.race([
          ready,
          child.then(({ stdout, stderr }) => {
            throw new Error(`CLI exited before the Attempt was ready: ${stderr || stdout}`);
          }),
        ]);
        const containers = await dockerList(["ps", "-aq"], filter);
        expect(containers).toHaveLength(1);
        projectName = (
          await execa("docker", ["inspect", "-f", '{{ index .Config.Labels "com.docker.compose.project" }}', containers[0]!])
        ).stdout;
        const projectFilter = `label=com.docker.compose.project=${projectName}`;
        expect(await dockerList(["network", "ls", "--format", "{{.Name}}"], projectFilter)).toEqual([
          `${projectName}_default`,
        ]);
        const { stdout: mountNames } = await execa("docker", [
          "inspect", "-f", "{{range .Mounts}}{{println .Destination .Name}}{{end}}", containers[0]!,
        ]);
        const volumes = new Map(
          mountNames.trim().split("\n").map((line) => {
            const [destination, name] = line.split(" ");
            return [destination, name];
          }),
        );
        anonymousVolume = volumes.get("/anonymous");
        const ownedVolume = volumes.get("/owned");
        expect(volumes.get("/external")).toBe(externalVolume);
        expect(anonymousVolume).toMatch(/^[a-f0-9]{64}$/u);
        expect(ownedVolume).toBe(`${projectName}_owned`);

        process.kill(-child.pid!, "SIGINT");
        const result = await child;
        expect(result.exitCode, result.stderr).toBe(130);
        const receipt = result.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .find((document) => document.type === "receipt");
        expect(decodeExpTerminalEvent(receipt).receipt.completion).toBe("interrupted");
        expect(await dockerList(["ps", "-aq"], projectFilter)).toEqual([]);
        expect(await dockerList(["network", "ls", "-q"], projectFilter)).toEqual([]);
        expect(await dockerList(["volume", "ls", "-q"], projectFilter)).toEqual([]);
        await expect(execa("docker", ["volume", "inspect", anonymousVolume!], { reject: false })).resolves.toMatchObject({
          exitCode: 1,
        });
        await expect(execa("docker", ["volume", "inspect", externalVolume, "-f", "{{.Name}}"])).resolves.toMatchObject({
          stdout: externalVolume,
        });
      } finally {
        watchController.abort();
        const processState = child.nodeChildProcess;
        if (child.pid !== undefined && processState.exitCode === null && processState.signalCode === null) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        await child;
      }
    } finally {
      // Recover the Compose name from our own label if the test failed before inspecting the ready container.
      if (projectName === undefined) {
        const [container] = await dockerList(["ps", "-aq"], filter);
        if (container !== undefined) {
          projectName = (
            await execa("docker", ["inspect", "-f", '{{ index .Config.Labels "com.docker.compose.project" }}', container])
          ).stdout;
        }
      }
      try {
        if (projectName !== undefined) {
          await execa("docker", ["compose", "-p", projectName, "-f", composeFile, "down", "--volumes", "--remove-orphans"], {
            reject: false,
          });
        }
        await execa("docker", ["volume", "rm", externalVolume, ...(anonymousVolume ? [anonymousVolume] : [])], {
          reject: false,
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  },
  75_000,
);
