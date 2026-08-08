// feature: docs/engineering/testing/e2e/README.md
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
interface ExpEvent {
  event: string;
  status?: string;
  completion?: string;
  experimentId?: string;
}

const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([binary]);
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

async function waitForHealth(port: number): Promise<void> {
  await pollUntil(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/health`)).status === 200 ? true : undefined;
      } catch {
        return undefined;
      }
    },
    { timeoutMs: 15_000, intervalMs: 100, label: "owned backend health" },
  );
}

test("SIGINT 返回 interrupted、执行 teardown、释放 owned backend，下一消费者仍可运行", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const infoPath = join(root, ".niceeval-lifecycle-backend.json");
    const owned = await withProcess(
      [binary, "exp", "interrupt", "--rerun", "all", "--json"],
      {
        cwd: root,
        processGroup: true,
        timeoutMs: 120_000,
        dispose: { signal: "SIGINT", graceMs: 5_000 },
      },
      async (controlled) => {
        const info = await pollUntil(() => backendInfo(infoPath), {
          timeoutMs: 15_000,
          intervalMs: 100,
          label: "owned backend receipt",
        });
        await waitForHealth(info.port);
        expect(controlled.signal("SIGINT")).toBe(true);

        const interrupted = await controlled.done;
        expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
        const events = interrupted.ndjson<ExpEvent>();
        expect(
          only(events, (event) => event.event === "result", interrupted.diagnostic()),
        ).toMatchObject({ event: "result", status: "interrupted", completion: "interrupted" });
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
          invocationPid: defined(controlled.pid, interrupted.diagnostic()),
          backendPid: info.pid,
          port: info.port,
        };
      },
    );

    expect(() => process.kill(owned.invocationPid, 0)).toThrow();
    expect(() => process.kill(owned.backendPid, 0)).toThrow();
    await expect(fetch(`http://127.0.0.1:${owned.port}/health`)).rejects.toThrow();

    const next = await niceeval.run(["exp", "probe", "--rerun", "all", "--json"], {
      cwd: root,
    });
    expect(next.exitCode, next.diagnostic()).toBe(0);
    expect(
      only(next.ndjson<ExpEvent>(), (event) => event.event === "result", next.diagnostic()),
    ).toMatchObject({ event: "result", status: "passed", completion: "complete" });
  });
});
