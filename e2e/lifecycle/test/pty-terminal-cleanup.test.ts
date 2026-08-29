// rerun: pnpm e2e test --repo lifecycle -- --run test/pty-terminal-cleanup.test.ts

import { startPty } from "@niceeval/testkit";
import { expect, test } from "vitest";

const node = process.execPath;

test("PTY startup failure after helper configuration closes its helper and launcher groups [necase_81M8VZCCTEZZ4VM5]", async () => {
  await expect(startPty(["/definitely-not-an-e2e-executable"], { graceMs: 100 })).rejects.toThrow(
    "pty helper",
  );
});

test("PTY helper bootstrap failure before candidate status rejects instead of hanging [necase_QTHFHP3YEDDKCHT1]", async () => {
  const start = startPty([node, "-e", "process.stdout.write('unreachable')"], {
    env: { NODE_OPTIONS: "--require=/definitely-not-a-pty-bootstrap-module" },
    timeoutMs: 300,
    graceMs: 100,
  });
  const settled = await Promise.race([
    start.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_500)),
  ]);
  expect(settled).toBe("rejected");
});

test("PTY launcher lookup failure closes the listening control server before removing its scratch directory [necase_NW8NGQ554NT11NKE]", async () => {
  await expect(
    startPty([node, "-e", "process.stdout.write('unreachable')"], { env: { PATH: "" }, graceMs: 100 }),
  ).rejects.toThrow("PTY launcher");
});

test("PTY sends hostile candidate argv only through the private control frame [necase_NW7PEK5XMEYQM6JX]", async () => {
  const hostile = ["two words", "*", "$(not-a-command)", "'single'\"double\"", "line\nbreak", "; echo escaped"];
  const pty = await startPty(
    [node, "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...hostile],
    { timeoutMs: 5_000 },
  );
  const receipt = await pty.wait();
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(JSON.parse(receipt.clean)).toEqual(hostile);
  expect(receipt.raw).toBe(receipt.clean);
});

test("PTY receipt preserves terminal bytes and candidate exit 201 without treating it as success [necase_C56X5T3NXQKYVJJ2]", async () => {
  const pty = await startPty(
    [node, "-e", "process.stdout.write('\\x1b[31mpty-ready\\r\\n'); setTimeout(() => process.exit(201), 120)"],
    { columns: 91, rows: 27, timeoutMs: 5_000 },
  );
  await expect(pty.waitForText("pty-ready", { timeoutMs: 2_000, whileRunning: true })).resolves.toContain("pty-ready");
  const receipt = await pty.wait();
  expect(receipt.exitCode, receipt.diagnostic()).toBe(201);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.columns).toBe(91);
  expect(receipt.rows).toBe(27);
  expect(receipt.raw).toContain(`${String.fromCharCode(27)}[31m`);
  expect(receipt.raw).toContain("\r\n");
  expect(receipt.clean).toBe("pty-ready\n");
});

test("PTY rejects a sentinel first checked after candidate exit when whileRunning is required [necase_36E9RFR3YASKN8PB]", async () => {
  const pty = await startPty([node, "-e", "process.stdout.write('late-sentinel\\n')"], { timeoutMs: 5_000 });
  await expect(pty.wait()).resolves.toMatchObject({ exitCode: 0 });
  await expect(pty.waitForText("late-sentinel", { timeoutMs: 1_000, whileRunning: true })).rejects.toThrow(
    "exited before",
  );
});

test("PTY timeout kills a TERM-ignoring candidate and its descendant, then proves all owned groups terminal [necase_VWGZRFWXF18HCYQE]", async () => {
  const pty = await startPty(
    [node, "-e", "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write('cleanup-ready\\n'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { timeoutMs: 250, graceMs: 200 },
  );
  await pty.waitForText("cleanup-ready", { timeoutMs: 2_000, whileRunning: true });
  const receipt = await pty.wait();
  expect(receipt.timedOut).toBe(true);
  expect(receipt.cleanup).toEqual({
    candidateGroup: expect.stringMatching(/gone|terminal/),
    helperGroup: expect.stringMatching(/gone|terminal/),
    launcherGroup: expect.stringMatching(/gone|terminal/),
  });
});
