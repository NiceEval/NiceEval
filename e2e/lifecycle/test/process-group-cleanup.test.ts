// owner: docs/engineering/testing/e2e/README.md#process-group-cleanup
// rerun: pnpm e2e --repo lifecycle -- --run test/process-group-cleanup.test.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, pollUntil, startProcess, waitForOutput } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ProcessTreeReceipt {
  readonly mode: string;
  readonly leader: number;
  readonly descendant?: number;
  readonly escaped?: number;
  readonly controller?: number;
  readonly zombie?: number;
  readonly group?: number;
}

const fixture = join(process.cwd(), "fixtures", "process-tree.py");

function parseReceipt(output: string): ProcessTreeReceipt {
  const line = output.split("\n").find((candidate) => candidate.startsWith("NICEEVAL_PROCESS_TREE "));
  if (line === undefined) throw new Error(`process-tree receipt missing from ${JSON.stringify(output)}`);
  const value = JSON.parse(line.slice("NICEEVAL_PROCESS_TREE ".length)) as Partial<ProcessTreeReceipt>;
  if (typeof value.mode !== "string" || !Number.isInteger(value.leader)) {
    throw new Error(`process-tree receipt is malformed: ${line}`);
  }
  return value as ProcessTreeReceipt;
}

async function openTree(mode: string) {
  const handle = startProcess(["python3", fixture, mode], {
    processGroup: true,
    graceMs: 150,
    timeoutMs: 10_000,
  });
  const output = await waitForOutput(handle, "stdout", /NICEEVAL_PROCESS_TREE \{[^\n]+\}/, {
    timeoutMs: 3_000,
    label: `${mode} fixture readiness`,
  });
  return { handle, receipt: parseReceipt(output) };
}

async function processState(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.split(") ", 2)[1]?.split(" ", 1)[0];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function expectNotLive(pid: number): Promise<void> {
  await pollUntil(
    async () => {
      const state = await processState(pid);
      return state === undefined || state === "Z" || state === "X" ? true : undefined;
    },
    { timeoutMs: 2_000, intervalMs: 25, label: `process ${pid} to stop running` },
  );
}

function killIfAlive(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

test.skipIf(process.platform !== "linux")(
  "processGroup cleanup kills a live descendant that survives TERM",
  async () => {
    const { handle, receipt } = await openTree("live-descendant");
    const descendant = defined(receipt.descendant, "live-descendant receipt omitted descendant pid");

    await handle.dispose();
    const result = await handle.done;

    expect(result.signal, result.diagnostic()).toBe("SIGTERM");
    await expectNotLive(receipt.leader);
    await expectNotLive(descendant);
  },
);

test.skipIf(process.platform !== "linux")(
  "processGroup cleanup accepts a group containing only a real zombie",
  async () => {
    const { handle, receipt } = await openTree("zombie-only");
    const controller = defined(receipt.controller, "zombie-only receipt omitted controller pid");
    const zombie = defined(receipt.zombie, "zombie-only receipt omitted zombie pid");
    try {
      expect(await processState(zombie)).toBe("Z");
      const startedAt = Date.now();
      await handle.dispose();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      await handle.done;
    } finally {
      killIfAlive(controller);
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "processGroup cleanup closes inherited pipes after a descendant escapes the group",
  async () => {
    const { handle, receipt } = await openTree("escaped-pipe");
    const escaped = defined(receipt.escaped, "escaped-pipe receipt omitted escaped pid");
    const safetyCleanup = setTimeout(() => killIfAlive(escaped), 1_500);
    try {
      const startedAt = Date.now();
      await handle.dispose();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      await handle.done;
    } finally {
      clearTimeout(safetyCleanup);
      killIfAlive(escaped);
    }
  },
);
