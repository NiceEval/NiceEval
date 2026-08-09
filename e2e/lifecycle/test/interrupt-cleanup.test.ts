// owner: docs/engineering/testing/e2e/README.md#lifecycle
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  command,
  defined,
  only,
  pollUntil,
  withProcess,
  withProjectCopy,
} from "@niceeval/testkit";
import { expect, test } from "vitest";

interface BackendInfo { pid: number; port: number }
interface ProcessReceipt { diagnostic(): string }
interface ExpEvent {
  event: string;
  status?: string;
  completion?: string;
  experimentId?: string;
  passed?: number;
}
interface HistoryAttempt {
  attempt: number;
  verdict: string;
  sandbox?: {
    provider: string;
    sandboxId: string;
    reused?: true;
    reuseSandbox?: number;
    reuseOrdinal?: number;
  };
}
interface ShowHistoryDocument {
  format: "niceeval.show";
  schemaVersion: number;
  view: "history";
  data: {
    sections: Array<{
      experimentId: string;
      evalId: string;
      attempts: HistoryAttempt[];
    }>;
  };
}

const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([binary]);
const docker = command(["docker"]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-lifecycle-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function backendInfo(path: string): Promise<BackendInfo | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as BackendInfo;
    return typeof value.pid === "number" && typeof value.port === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function whileRunning<T>(
  action: Promise<T>,
  exited: Promise<ProcessReceipt>,
  label: string,
): Promise<T> {
  return await Promise.race([
    action,
    exited.then((receipt) => {
      throw new Error(`niceeval exited before ${label}\n${receipt.diagnostic()}`);
    }),
  ]);
}

async function waitForHealth(port: number, exited: Promise<ProcessReceipt>): Promise<void> {
  await whileRunning(
    pollUntil(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/health`)).status === 200 ? true : undefined;
        } catch {
          return undefined;
        }
      },
      { timeoutMs: 15_000, intervalMs: 100, label: "owned backend health" },
    ),
    exited,
    "the owned backend became healthy",
  );
}

function outputLines(stdout: string): string[] {
  return stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

async function containersOwnedBy(pid: number, cwd: string): Promise<string[]> {
  const listed = await docker.run(
    ["ps", "-aq", "--filter", `label=niceeval.pid=${pid}`],
    { cwd },
  );
  if (listed.exitCode !== 0) throw new Error(listed.diagnostic());
  return outputLines(listed.stdout);
}

async function waitForOwnedContainersGone(pid: number, cwd: string): Promise<void> {
  await pollUntil(
    async () => (await containersOwnedBy(pid, cwd)).length === 0 ? true : undefined,
    { timeoutMs: 15_000, intervalMs: 100, label: `Docker sandboxes owned by invocation ${pid} to be removed` },
  );
}

async function waitForContainerGone(container: string, cwd: string): Promise<void> {
  await pollUntil(
    async () => {
      const inspected = await docker.run(["inspect", container], { cwd });
      return inspected.exitCode !== 0 ? true : undefined;
    },
    { timeoutMs: 15_000, intervalMs: 100, label: `Docker sandbox ${container} to be removed` },
  );
}

async function waitForSecondReuseAttempt(pid: number, cwd: string): Promise<string> {
  return await pollUntil(
    async () => {
      const containers = await containersOwnedBy(pid, cwd);
      if (containers.length > 1) {
        throw new Error(`expected one reused Docker sandbox for invocation ${pid}, found ${containers.join(", ")}`);
      }
      const container = containers[0];
      if (container === undefined) return undefined;
      const ready = await docker.run(
        ["exec", container, "test", "-f", "/tmp/niceeval-lifecycle-second-attempt-ready"],
        { cwd },
      );
      return ready.exitCode === 0 ? container : undefined;
    },
    { timeoutMs: 60_000, intervalMs: 250, label: "second attempt in reused Docker sandbox" },
  );
}

async function historyAttempt(root: string, experimentId: string, evalId: string): Promise<HistoryAttempt> {
  const shown = await niceeval.run(["show", evalId, "--history", "--json"], { cwd: root });
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  const document = shown.json<ShowHistoryDocument>();
  expect(document).toMatchObject({ format: "niceeval.show", schemaVersion: 1, view: "history" });
  const section = only(
    document.data.sections,
    (candidate) => candidate.experimentId === experimentId && candidate.evalId === evalId,
    shown.diagnostic(),
  );
  return only(section.attempts, () => true, shown.diagnostic());
}

test("SIGINT 中断复用 Docker Sandbox、执行 teardown、释放 owned 资源，下一消费者仍可运行", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const infoPath = join(root, ".niceeval-lifecycle-backend.json");
    const owned = await withProcess(
      [binary, "exp", "interrupt", "--rerun", "all", "--json"],
      {
        cwd: root,
        processGroup: true,
        timeoutMs: 120_000,
        graceMs: 5_000,
      },
      async (controlled) => {
        const info = await whileRunning(
          pollUntil(() => backendInfo(infoPath), {
            timeoutMs: 15_000,
            intervalMs: 100,
            label: "owned backend receipt",
          }),
          controlled.done,
          "the owned backend receipt was written",
        );
        await waitForHealth(info.port, controlled.done);
        const invocationPid = defined(controlled.pid, "niceeval invocation did not expose a pid");
        const sandboxId = await waitForSecondReuseAttempt(invocationPid, root);
        expect(controlled.signal("SIGINT")).toBe(true);

        const interrupted = await controlled.done;
        expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
        const events = interrupted.ndjson<ExpEvent>();
        expect(
          only(events, (event) => event.event === "result", interrupted.diagnostic()),
        ).toMatchObject({ event: "result", status: "interrupted", completion: "interrupted", passed: 1 });
        expect(
          only(
            events,
            (event) =>
              event.event === "experiment_teardown" &&
              event.experimentId === "interrupt" &&
              event.status === "done",
            interrupted.diagnostic(),
          ),
        ).toMatchObject({ status: "done" });

        return {
          invocationPid,
          backendPid: info.pid,
          port: info.port,
          sandboxId,
        };
      },
    );

    expect(() => process.kill(owned.invocationPid, 0)).toThrow();
    expect(() => process.kill(owned.backendPid, 0)).toThrow();
    await expect(fetch(`http://127.0.0.1:${owned.port}/health`)).rejects.toThrow();
    await waitForOwnedContainersGone(owned.invocationPid, root);

    const completedBeforeInterrupt = await historyAttempt(root, "interrupt", "interrupt");
    expect(completedBeforeInterrupt).toMatchObject({
      attempt: 0,
      verdict: "passed",
      sandbox: {
        provider: "docker",
        sandboxId: owned.sandboxId.slice(0, 12),
        reused: true,
        reuseSandbox: 1,
        reuseOrdinal: 1,
      },
    });

    const next = await niceeval.run(["exp", "probe", "--rerun", "all", "--json"], {
      cwd: root,
    });
    expect(next.exitCode, next.diagnostic()).toBe(0);
    expect(
      only(next.ndjson<ExpEvent>(), (event) => event.event === "result", next.diagnostic()),
    ).toMatchObject({ event: "result", status: "passed", completion: "complete" });

    const nextAttempt = await historyAttempt(root, "probe", "probe");
    expect(nextAttempt).toMatchObject({
      attempt: 0,
      verdict: "passed",
      sandbox: { provider: "docker" },
    });
    expect(nextAttempt.sandbox?.sandboxId).not.toBe(owned.sandboxId.slice(0, 12));
    await waitForContainerGone(defined(nextAttempt.sandbox?.sandboxId), root);
  });
});
