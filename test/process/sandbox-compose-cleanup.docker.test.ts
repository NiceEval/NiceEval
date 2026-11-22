// 跨进程保证：进程终止与信号——SIGINT 后真实 CLI 退出前结算 Compose 实例、网络和卷
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, watch, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decodeExpTerminalEvent } from "niceeval/experiment/host";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const image = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const volumeKinds = ["owned", "anonymous", "external"] as const;
const otherOrders = fc
  .shuffledSubarray([...volumeKinds], { minLength: 3, maxLength: 3 })
  .filter((order) => order.some((kind, index) => kind !== volumeKinds[index]));
const mountOrders = [volumeKinds, ...fc.sample(otherOrders, { seed: 260_602, numRuns: 1 })];
const cleanupExamples = [
  ...mountOrders.map((mountOrder) => ({ mountOrder, dependency: false })),
  // Three dependency levels exhaust cleanup and its retry if each gets its own stop grace.
  { mountOrder: volumeKinds, dependency: true },
];

beforeAll(async () => {
  const local = await execa("docker", ["image", "inspect", image], { reject: false });
  if (local.exitCode !== 0) await execa("docker", ["pull", image], { timeout: 120_000 });
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

async function composeProjectName(container: string) {
  const { stdout } = await execa("docker", [
    "inspect",
    "-f",
    '{{ index .Config.Labels "com.docker.compose.project" }}',
    container,
  ]);
  return stdout;
}

describe.for(cleanupExamples)(
  "Compose resources mounted in order $mountOrder, dependency $dependency",
  ({ mountOrder, dependency }) => {
    const id = `niceeval-compose-${randomUUID()}`;
    const externalVolume = `${id}-external`;
    const filter = `label=niceeval.test-case=${id}`;
    const mounts = { owned: "owned:/owned", anonymous: "/anonymous", external: "external:/external" };
    const watchController = new AbortController();
    let cwd: string;
    let composeFile: string;
    let child: ReturnType<typeof startAttempt> | undefined;
    let projectName: string | undefined;
    let anonymousVolume: string | undefined;

    function startAttempt(workdir: string) {
      return execa(process.execPath, [...process.execArgv, cli, "exp", "compose", "--rerun=all", "--json"], {
        cwd: workdir,
        detached: true,
        env: { NICEEVAL_HOME: join(workdir, "user"), NO_COLOR: "1" },
        reject: false,
        timeout: 60_000,
      });
    }

    beforeAll(async () => {
      cwd = await mkdtemp(join(tmpdir(), "niceeval-compose-cleanup-"));
      composeFile = join(cwd, "compose.yaml");
      await execa("docker", ["volume", "create", externalVolume]);
      await Promise.all(["evals", "experiments"].map((directory) => mkdir(join(cwd, directory))));
      const compose = `services:
  client:
    image: ${image}
    command: ["sleep", "120"]
${dependency ? "    depends_on: [dependency]\n" : ""}
    working_dir: /workspace
    labels:
      niceeval.test-case: ${id}
    volumes:
${mountOrder.map((kind) => `      - ${mounts[kind]}`).join("\n")}
${dependency ? `  dependency:\n    image: ${image}\n    command: ["sleep", "120"]\n    depends_on: [leaf]\n  leaf:\n    image: ${image}\n    command: ["sleep", "120"]\n` : ""}
volumes:
  owned: {}
  external:
    external: true
    name: ${externalVolume}
`;
      await Promise.all([
        writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
        writeFile(composeFile, compose),
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

      const ready = waitUntilReady(cwd, watchController.signal);
      child = startAttempt(cwd);
      await Promise.race([
        ready,
        child.then(({ stdout, stderr }) => {
          throw new Error(`CLI exited before the Attempt was ready: ${[stderr, stdout].filter(Boolean).join("\n")}`);
        }),
      ]);

      const containers = await dockerList(["ps", "-aq"], filter);
      expect(containers).toHaveLength(1);
      const container = containers[0]!;
      projectName = await composeProjectName(container);
      const { stdout: mountNames } = await execa("docker", [
        "inspect",
        "-f",
        "{{range .Mounts}}{{println .Destination .Name}}{{end}}",
        container,
      ]);
      const volumes = new Map(
        mountNames
          .trim()
          .split("\n")
          .map((line) => {
            const [destination, name] = line.split(" ");
            return [destination, name];
          }),
      );
      anonymousVolume = volumes.get("/anonymous");
      expect(volumes.get("/external")).toBe(externalVolume);
      expect(anonymousVolume).toMatch(/^[a-f0-9]{64}$/u);
      expect(volumes.get("/owned")).toBe(`${projectName}_owned`);
      const projectFilter = `label=com.docker.compose.project=${projectName}`;
      expect(await dockerList(["network", "ls", "--format", "{{.Name}}"], projectFilter)).toEqual([
        `${projectName}_default`,
      ]);
    }, 75_000);

    afterAll(async () => {
      watchController.abort();
      try {
        const state = child?.nodeChildProcess;
        if (child?.pid !== undefined && state?.exitCode === null && state.signalCode === null) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        await child;
      } finally {
        try {
          // Look up the project by its unique test label if preparation failed before inspection.
          if (projectName === undefined) {
            const [container] = await dockerList(["ps", "-aq"], filter);
            if (container !== undefined) projectName = await composeProjectName(container);
          }
          if (projectName !== undefined) {
            await execa(
              "docker",
              ["compose", "-p", projectName, "-f", composeFile, "down", "--volumes", "--remove-orphans"],
              { reject: false },
            );
          }
          await execa("docker", ["volume", "rm", externalVolume, ...(anonymousVolume ? [anonymousVolume] : [])], {
            reject: false,
          });
        } finally {
          if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
        }
      }
    }, 30_000);

    // @feature docs/feature/sandbox/README.md#resource-group-cleanup
    test("SIGINT removes the group and preserves the external volume", async () => {
      const projectFilter = `label=com.docker.compose.project=${projectName}`;
      process.kill(-child!.pid!, "SIGINT");
      const result = await child!;
      expect(result.exitCode, result.stderr).toBe(130);
      const receipt = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find((document) => document.type === "receipt");
      expect(decodeExpTerminalEvent(receipt).receipt.completion).toBe("interrupted");

      const [containers, networks, volumes, anonymous, external] = await Promise.all([
        dockerList(["ps", "-aq"], projectFilter),
        dockerList(["network", "ls", "-q"], projectFilter),
        dockerList(["volume", "ls", "-q"], projectFilter),
        execa("docker", ["volume", "inspect", anonymousVolume!], { reject: false }),
        execa("docker", ["volume", "inspect", externalVolume, "-f", "{{.Name}}"]),
      ]);
      expect({ containers, networks, volumes }).toEqual({ containers: [], networks: [], volumes: [] });
      expect(anonymous.exitCode).toBe(1);
      expect(external.stdout).toBe(externalVolume);
    }, 30_000);
  },
);
