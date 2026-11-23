// 跨进程保证：运行环境——独立子进程测量 160 MiB 流式接管的存活内存、并发锁等待与便携式 Record CLI 读取
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, readFile, realpath, rm, watch, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { decodeInspectionDocument } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
describe("real process CLI and streaming attachment memory boundary", () => {
  let cwd: string;
  let recordDir: string;
  let portableRecord: string;
  let block: Buffer;
  let expectedSha: string;

  beforeAll(async () => {
    const baseTmp = await realpath(tmpdir());
    [cwd, recordDir] = await Promise.all([
      mkdtemp(join(baseTmp, "niceeval-inspection-proc-")),
      mkdtemp(join(baseTmp, "niceeval-inspection-rec-")),
    ]);

    await Promise.all([
      ...["evals", "experiments", "adapters"].map((dir) => mkdir(join(cwd, dir))),
      ...["evals", "experiments"].map((dir) => mkdir(join(recordDir, dir))),
    ]);

    block = Buffer.alloc(64 * 1024, 0x61);
    block[block.length - 1] = 10;
    const hash = createHash("sha256");
    const journalPath = join(cwd, "journal.ndjson");
    const file = await open(journalPath, "w");
    try {
      for (let index = 0; index < 2560; index += 1) {
        await file.write(block);
        hash.update(block);
      }
    } finally {
      await file.close();
    }
    expectedSha = hash.digest("hex");

    await Promise.all([
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "niceeval.config.ts"), "export default {};\n"),
      writeFile(
        join(cwd, "adapters", "stream-280.ts"),
        `
        import { defineAdapter } from "niceeval";
        import { createReadStream } from "node:fs";
        import { rename, writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        const projectFile = (name: string) => resolve(import.meta.dirname, "..", name);
        export const streamAdapter = defineAdapter({
          name: "stream-280",
          behaviorRevision: "1",
          create(ctx) {
            return {
              async archive() {
                const liveBytes = async () => {
                  // Last-resort GC finishes ArrayBuffer sweeping before we sample.
                  await globalThis.gc({ type: "major", execution: "async", flavor: "last-resort" });
                  const { heapUsed, arrayBuffers } = process.memoryUsage();
                  return heapUsed + arrayBuffers;
                };
                const baseline = await liveBytes();
                let peak = baseline;
                const receipt = await ctx.attach({
                  name: "journal.ndjson",
                  mediaType: "application/x-ndjson",
                  body: {
                    async *stream(signal) {
                      let bytesSinceSample = 0;
                      for await (const chunk of createReadStream(projectFile("journal.ndjson"), { signal, highWaterMark: 1024 * 1024 })) {
                        yield chunk;
                        bytesSinceSample += chunk.byteLength;
                        if (bytesSinceSample >= 16 * 1024 * 1024) {
                          peak = Math.max(peak, await liveBytes());
                          bytesSinceSample = 0;
                        }
                      }
                    },
                  },
                });
                peak = Math.max(peak, await liveBytes());
                await writeFile(projectFile("journal.ndjson"), "rewritten");
                await writeFile(projectFile("receipt.tmp"), [receipt.artifactId, receipt.sha256, receipt.byteLength, peak - baseline].join("\\n"));
                await rename(projectFile("receipt.tmp"), projectFile("receipt.txt"));
                return receipt.byteLength;
              },
            };
          },
        });
      `,
      ),
      writeFile(
        join(cwd, "evals", "stream-280.eval.ts"),
        `import { equals } from "niceeval/expect"; import { streamAdapter } from "../adapters/stream-280.ts";
         export default streamAdapter.defineEval({ timeoutMs: 60_000, async test(t) { t.check(await t.archive(), equals(160 * 1024 * 1024)); } });`,
      ),
      writeFile(
        join(cwd, "experiments", "stream-280.ts"),
        `import { defineExperiment } from "niceeval"; import { streamAdapter } from "../adapters/stream-280.ts";
         export default defineExperiment({ adapter: streamAdapter, evals: ["stream-280"] });`,
      ),
      writeFile(join(recordDir, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(recordDir, "niceeval.config.ts"), "export default {};\n"),
      writeFile(
        join(recordDir, "adapter.ts"),
        `import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
         export const agent = defineAgent({ name: "rec-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });`,
      ),
      writeFile(
        join(recordDir, "evals", "pass.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(true, equals(true)); } });`,
      ),
      writeFile(
        join(recordDir, "evals", "fail.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(false, equals(true)); } });`,
      ),
      writeFile(
        join(recordDir, "experiments", "group-a.ts"),
        `import { defineExperiment } from "niceeval"; import { agent } from "../adapter.ts";
         export default defineExperiment({ adapter: agent, evals: ["pass", "fail"] });`,
      ),
    ]);

    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: recordDir,
        experimentSelector: "group-a",
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all" },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Could not plan group-a: ${JSON.stringify(planned)}`);
    await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
    portableRecord = join(recordDir, "recorded.sqlite");
    await copyFile(join(recordDir, ".niceeval", "record.sqlite"), portableRecord);
  }, 90_000);

  const runArchive = () =>
    execa(process.execPath, [...process.execArgv, "--expose-gc", cli, "exp", "stream-280", "--rerun", "all", "--json"], {
      cwd,
      reject: false,
      timeout: 60_000,
    });
  let archiveRun: ReturnType<typeof runArchive> | undefined;
  const startArchive = () => (archiveRun ??= runArchive());

  afterAll(async () => {
    try {
      if (archiveRun !== undefined) {
        const { exitCode, stderr } = await archiveRun;
        expect(exitCode, stderr).toBe(0);
      }
    } finally {
      await Promise.all(
        [cwd, recordDir]
          .filter((dir) => dir !== undefined)
          .map((dir) => rm(dir, { recursive: true, force: true })),
      );
    }
  }, 65_000);

  async function readArchiveReceipt() {
    const receipt = join(cwd, "receipt.txt");
    const abort = new AbortController();
    const waitForReceipt = async () => {
      for await (const { filename } of watch(cwd, { signal: abort.signal })) {
        if (filename === "receipt.txt") return readFile(receipt, "utf8");
      }
      throw new Error("Stopped watching before the archive receipt was published");
    };
    try {
      // The fixture publishes the receipt after attach returns, before Invocation finalization.
      return await Promise.race([
        waitForReceipt(),
        startArchive().then(({ exitCode, stderr }) => {
          expect(exitCode, stderr).toBe(0);
          return readFile(receipt, "utf8");
        }),
      ]);
    } finally {
      abort.abort();
    }
  }

  async function readArchivedLocator() {
    const runRes = await startArchive();
    expect(runRes.exitCode, runRes.stderr).toBe(0);
    const evalEvent = runRes.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event?: string; evalId?: string; locator?: string })
      .find((entry) => entry.event === "eval" && entry.evalId === "stream-280");
    expect(evalEvent?.locator).toBeDefined();
    return evalEvent!.locator!.startsWith("@") ? evalEvent!.locator! : `@${evalEvent!.locator!}`;
  }

  // @feature docs/feature/inspection/README.md#attachment-archive
  test("accepting a 160 MiB file attachment keeps live memory bounded in the child process", async () => {
    const [, sha256, byteLength, liveBytesGrowth] = (await readArchiveReceipt()).split("\n");
    expect(sha256).toBe(expectedSha);
    expect(Number(byteLength)).toBe(160 * 1024 * 1024);
    // Allow for the file stream's read-ahead, the owned 1 MiB chunk, and runtime bookkeeping.
    expect(Number(liveBytesGrowth)).toBeLessThan(16 * 1024 * 1024);
  }, 30_000);

  describe("archived file readback", () => {
    let locator: string;
    beforeAll(async () => {
      locator = await readArchivedLocator();
    }, 30_000);

    // @feature docs/feature/inspection/README.md#attachment-archive
    test("reads the original archived bytes after rewriting the source file", async () => {
      const [artifactId] = (await readFile(join(cwd, "receipt.txt"), "utf8")).split("\n");
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const outChunks: Buffer[] = [];
      stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
      const showCode = await runCliInProcess({
        argv: ["show", locator, "artifacts", artifactId, "--json"],
        cwd,
        env: { NO_COLOR: "1" },
        stdin: Readable.from([]),
        stdout,
        stderr,
      });
      stdout.end();
      stderr.end();
      expect(showCode).toBe(0);
      const doc = decodeInspectionDocument(JSON.parse(Buffer.concat(outChunks).toString("utf8").trim()));
      if (!doc.success || doc.value.outcome !== "success" || doc.value.operation !== "attempt.artifact") {
        throw new Error("Expected the archived artifact");
      }
      expect(doc.value.artifact).toMatchObject({
        state: "available",
        sha256: expectedSha,
        byteLength: 160 * 1024 * 1024,
        base64: block.toString("base64"),
      });
    }, 30_000);
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("real CLI show --record imports portable Record, propagates --record links, and renders Recorded results", async () => {
    const jsonRes = await execa(process.execPath, [...process.execArgv, cli, "show", "--record", portableRecord, "--json"], {
      cwd: recordDir,
      reject: false,
    });
    expect(jsonRes.exitCode, jsonRes.stderr).toBe(0);
    const doc = decodeInspectionDocument(JSON.parse(jsonRes.stdout.trim()));
    expect(doc.success).toBe(true);
    if (doc.success && doc.value.outcome === "success") {
      expect(doc.value.operation).toBe("overview.get");
      for (const link of doc.value.links) expect(link.command).toContain(`--record ${portableRecord}`);
    }

    const textRes = await execa(process.execPath, [...process.execArgv, cli, "show", "--all", "--record", portableRecord], {
      cwd: recordDir,
      reject: false,
    });
    expect(textRes.exitCode, textRes.stderr).toBe(0);
    expect(textRes.stdout).toContain("Recorded results");
    expect(textRes.stdout).toMatch(/Observed\s+2\/2/u);
    expect(textRes.stdout).toContain("Pass rate");
    expect(textRes.stdout).not.toContain("Score");
  }, 30_000);
});

describe("concurrent exp process lock and carried reuse boundary", () => {
  let lockDir: string;
  const startLockProcess = () =>
    execa(process.execPath, [...process.execArgv, cli, "exp", "lock", "--json"], {
      cwd: lockDir,
      reject: false,
    });
  let first: ReturnType<typeof startLockProcess> | undefined;
  let second: ReturnType<typeof startLockProcess> | undefined;

  beforeAll(async () => {
    lockDir = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-lock-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(lockDir, dir))));
    await Promise.all([
      writeFile(join(lockDir, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(lockDir, "niceeval.config.ts"), "export default {};\n"),
      writeFile(
        join(lockDir, "experiments", "lock.ts"),
        `
        import { defineExperiment } from "niceeval";
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        import { existsSync, writeFileSync } from "node:fs";
        import { resolve } from "node:path";
        const projectFile = (name: string) => resolve(import.meta.dirname, "..", name);
        const agent = defineAgent({
          name: "lock-fixture",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => {
            writeFileSync(projectFile("agent-started"), "ready");
            while (!existsSync(projectFile("release-agent"))) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            return { status: "completed", events: [{ type: "message", role: "assistant", text: "accepted" }] };
          },
        });
        export default defineExperiment({ adapter: agent, evals: ["case"], attempts: 1, timeoutMs: 30_000 });
      `,
      ),
      writeFile(
        join(lockDir, "evals", "case.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ async test(t) { const turn = await t.send("go"); t.check(turn.reply, equals("accepted")); } });`,
      ),
    ]);

    first = startLockProcess();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await readFile(join(lockDir, "agent-started"), "utf8");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    second = startLockProcess();
    const waitDeadline = Date.now() + 15_000;
    while (Date.now() < waitDeadline) {
      const listed = await Effect.runPromise(runHost.list({ cwd: lockDir })).catch(() => ({ runs: [] }));
      if (listed.runs.filter((run) => run.state === "active").length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }, 45_000);

  afterAll(async () => {
    if (lockDir !== undefined) {
      await writeFile(join(lockDir, "release-agent"), "go").catch(() => undefined);
      await Promise.all([first?.catch(() => undefined), second?.catch(() => undefined)]);
      await rm(lockDir, { recursive: true, force: true });
    }
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("real CLI show reports current pending gaps while concurrent exp processes hold the lock", async () => {
    const [pendingShow] = await Promise.all([
      execa(process.execPath, [...process.execArgv, cli, "show", "--json"], { cwd: lockDir, reject: false }),
      new Promise((resolve) => setTimeout(resolve, 2_500)),
    ]);
    expect(pendingShow.exitCode, pendingShow.stderr).toBe(0);
    const pendingDoc = decodeInspectionDocument(JSON.parse(pendingShow.stdout.trim()));
    expect(pendingDoc.success).toBe(true);
    if (pendingDoc.success && pendingDoc.value.outcome === "success" && pendingDoc.value.operation === "project.get") {
      expect(pendingDoc.value.project).toMatchObject({
        coverage: { expected: 1, covered: 0, gaps: 1 },
        plannedAttempts: [expect.objectContaining({ state: "gap", reason: "pending" })],
      });
    }
    await writeFile(join(lockDir, "release-agent"), "go");
  }, 30_000);

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("releasing concurrent exp processes completes carried reuse in show --json", async () => {
    const [firstDone, secondDone] = await Promise.all([first!, second!]);
    expect(firstDone.exitCode, String(firstDone.stderr)).toBe(0);
    expect(secondDone.exitCode, String(secondDone.stderr)).toBe(0);

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const outChunks: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
    const finalExitCode = await runCliInProcess({
      argv: ["show", "--json"],
      cwd: lockDir,
      env: { NO_COLOR: "1" },
      stdin: Readable.from([]),
      stdout,
      stderr,
    });
    stdout.end();
    stderr.end();
    expect(finalExitCode).toBe(0);
    const finalDoc = decodeInspectionDocument(JSON.parse(Buffer.concat(outChunks).toString("utf8").trim()));
    if (finalDoc.success && finalDoc.value.outcome === "success" && finalDoc.value.operation === "project.get") {
      expect(finalDoc.value.project).toMatchObject({
        coverage: { expected: 1, covered: 1, gaps: 0 },
        plannedAttempts: [expect.objectContaining({ state: "reuse", action: "carried", relation: "reference" })],
      });
    }
  }, 30_000);
});
