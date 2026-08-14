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
  experimentId?: string;
  evalId?: string;
  verdict?: string;
}
type ReportScalar = null | boolean | number | string;
interface RunMembershipShow {
  readonly format: "niceeval.report-show/v1";
  readonly reportId: string;
  readonly sample: {
    readonly selection: { readonly policy: string; readonly runIds?: readonly string[] };
    readonly runCount: number;
    readonly slotCount: number;
    readonly denominator: number;
  };
  readonly pages: readonly {
    readonly state: string;
    readonly pageId: string;
    readonly document?: {
      readonly children: readonly {
        readonly type: string;
        readonly caption?: string;
        readonly columns?: readonly { readonly key: string }[];
        readonly rows?: readonly Readonly<Record<string, ReportScalar>>[];
      }[];
    };
  }[];
}
const membershipColumns = [
  "runId",
  "slotId",
  "slotState",
  "memberRelation",
  "sourceAttemptLocator",
  "membershipState",
  "membershipOutcome",
  "verdictState",
  "verdict",
] as const;

function runMembershipRows(
  shown: RunMembershipShow,
  diagnostic: string,
): readonly Readonly<Record<string, ReportScalar>>[] {
  const page = only(
    shown.pages,
    (candidate) => candidate.state === "rendered" && candidate.pageId === "run-membership",
    diagnostic,
  );
  return only(
    page.document?.children ?? [],
    (block) =>
      block.type === "table" &&
      block.caption === "Run membership" &&
      block.columns?.map((column) => column.key).join("\u0000") === membershipColumns.join("\u0000") &&
      block.rows !== undefined,
    diagnostic,
  ).rows!;
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

async function waitForSecondReuseAttempt(pid: number, cwd: string): Promise<void> {
  await pollUntil(
    async () => {
      const containers = await containersOwnedBy(pid, cwd);
      for (const container of containers) {
        const ready = await docker.run(
          ["exec", container, "test", "-f", "/tmp/niceeval-lifecycle-second-attempt-ready"],
          { cwd },
        );
        if (ready.exitCode === 0) return true;
      }
      return undefined;
    },
    { timeoutMs: 60_000, intervalMs: 250, label: "second attempt in reused Docker sandbox" },
  );
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
        await waitForSecondReuseAttempt(invocationPid, root);
        expect(controlled.signal("SIGINT")).toBe(true);

        const interrupted = await controlled.done;
        expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
        const events = interrupted.ndjson<ExpEvent>();
        // receipt 只承载 Invocation 级完成事实(见 docs/feature/experiments/cli.md「结束反馈与
        // receipt」)：completion。中断前完成的 attempt 由带身份的 eval 事件断言；不读 Record
        // 内部细节，也不在 receipt 上断言计数。
        const interruptedReceipt = interrupted.expReceipt();
        expect(interruptedReceipt, interrupted.diagnostic()).toMatchObject({
          completion: "interrupted",
        });
        expect(
          only(
            events,
            (event) => event.event === "eval" && event.experimentId === "interrupt",
            interrupted.diagnostic(),
          ),
        ).toMatchObject({ event: "eval", experimentId: "interrupt", evalId: "interrupt", verdict: "passed" });
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

        const interruptedRunId = only(
          interruptedReceipt.runIds,
          () => true,
          interrupted.diagnostic(),
        );
        const shown = await niceeval.run(
          ["show", "--run", interruptedRunId, "--json"],
          { cwd: root },
        );
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        const membership = shown.json<RunMembershipShow>();
        expect(membership).toMatchObject({
          format: "niceeval.report-show/v1",
          reportId: "run-membership-overview",
          sample: {
            selection: { policy: "explicit-runs", runIds: [interruptedRunId] },
            runCount: 1,
            slotCount: 2,
            denominator: 2,
          },
        });
        const rows = runMembershipRows(membership, shown.diagnostic());
        expect(rows).toHaveLength(2);
        expect(only(rows, (row) => row.slotState === "included", shown.diagnostic())).toMatchObject({
          runId: interruptedRunId,
          slotState: "included",
          memberRelation: "origin",
          membershipState: "available",
          membershipOutcome: "executed",
          verdictState: "available",
          verdict: "passed",
        });
        expect(only(rows, (row) => row.slotState === "not-recorded", shown.diagnostic())).toMatchObject({
          runId: interruptedRunId,
          slotState: "not-recorded",
          memberRelation: null,
          sourceAttemptLocator: null,
          membershipState: "available",
          membershipOutcome: "interrupted",
          verdictState: "not-read",
          verdict: null,
        });

        return {
          invocationPid,
          backendPid: info.pid,
          port: info.port,
        };
      },
    );

    expect(() => process.kill(owned.invocationPid, 0)).toThrow();
    expect(() => process.kill(owned.backendPid, 0)).toThrow();
    await expect(fetch(`http://127.0.0.1:${owned.port}/health`)).rejects.toThrow();
    await waitForOwnedContainersGone(owned.invocationPid, root);

    const next = await niceeval.run(["exp", "probe", "--rerun", "all", "--json"], {
      cwd: root,
    });
    expect(next.exitCode, next.diagnostic()).toBe(0);
    const nextEvents = next.ndjson<ExpEvent>();
    expect(next.expReceipt(), next.diagnostic()).toMatchObject({ completion: "completed" });
    expect(
      only(
        nextEvents,
        (event) => event.event === "eval" && event.experimentId === "probe",
        next.diagnostic(),
      ),
    ).toMatchObject({ event: "eval", experimentId: "probe", evalId: "probe", verdict: "passed" });
  });
});
