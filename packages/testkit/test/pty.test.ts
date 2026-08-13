import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PtyUnavailableError, runPty } from "../src/run-pty.js";

const ttyProbe = (extra: string) => [
  process.execPath,
  "-e",
  `console.log(JSON.stringify({isTTY: process.stdout.isTTY, columns: process.stdout.columns, rows: process.stdout.rows, env: {COLUMNS: process.env.COLUMNS, LINES: process.env.LINES}${extra}}))`,
] as const;

function scriptOnThisHost(): string {
  return execFileSync("sh", ["-c", "command -v script"], { encoding: "utf8" }).trim();
}

function pathContainingOnly(entries: ReadonlyArray<[name: string, target: string]>): string {
  const dir = mkdtempSync(join(tmpdir(), "pty-path-"));
  for (const [name, target] of entries) {
    symlinkSync(target, join(dir, name));
  }
  return dir;
}

describe("runPty", () => {
  it("runs the product argv on a real PTY with the requested window size", async () => {
    const receipt = await runPty(ttyProbe(""), { columns: 120, rows: 40, timeoutMs: 30_000 });
    expect(receipt.exitCode).toBe(0);
    const proof = receipt.json<{ isTTY: boolean; columns: number; rows: number }>();
    expect(proof.isTTY).toBe(true);
    expect(proof.columns).toBe(120);
    expect(proof.rows).toBe(40);
  });

  it("normalizes PTY CRLF without stripping ANSI color sequences", async () => {
    const receipt = await runPty(
      [process.execPath, "-e", `process.stdout.write("\\x1b[31mred\\x1b[0m\\n")`],
      { timeoutMs: 30_000 },
    );
    expect(receipt.exitCode).toBe(0);
    expect(receipt.stdout).toContain("\x1b[31mred\x1b[0m\n");
    expect(receipt.stdout).not.toContain("\r\n");
  });

  it("preserves the product argv in the receipt", async () => {
    const receipt = await runPty(ttyProbe(""), { timeoutMs: 30_000 });
    expect(receipt.exitCode).toBe(0);
    expect(receipt.diagnostic()).toContain("exit: 0");
    expect(receipt.argv[1]).toBe("-e");
  });

  it("reports an actionable error when util-linux script is unavailable", async () => {
    const error = await runPty([process.execPath, "-e", "1"], {
      env: { PATH: "/nonexistent" },
      timeoutMs: 30_000,
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/util-linux/);
  });

  it("rejects non-integer window sizes before spawning anything", async () => {
    const error = await runPty(ttyProbe(""), { columns: 120.5, timeoutMs: 30_000 }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(TypeError);
  });

  it("genuinely unsets an inherited env var when options.env carries undefined", async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const probe = [
        process.execPath,
        "-e",
        "console.log(JSON.stringify({noColor: process.env.NO_COLOR}))",
      ] as const;
      const receipt = await runPty(probe, {
        env: { NO_COLOR: undefined },
        timeoutMs: 30_000,
      });
      expect(receipt.exitCode).toBe(0);
      const proof = receipt.json<{ noColor: string | undefined }>();
      expect(proof.noColor).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previous;
      }
    }
  });

  it("fails actionably when stty is missing and a window size was requested — never runs the product", async () => {
    const marker = join(tmpdir(), `pty-stty-missing-${process.pid}.marker`);
    rmSync(marker, { force: true });
    const dir = pathContainingOnly([["script", scriptOnThisHost()]]);
    try {
      const error = await runPty(
        [
          process.execPath,
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
        ],
        { columns: 120, env: { PATH: dir }, timeoutMs: 30_000 },
      ).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(PtyUnavailableError);
      expect((error as Error).message).toMatch(/stty/);
      expect((error as Error).message).toMatch(/coreutils/);
      expect(() => readFileSync(marker, "utf8")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(marker, { force: true });
    }
  });

  it("fails actionably when script on PATH is not util-linux", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pty-fake-"));
    try {
      writeFileSync(join(dir, "script"), "#!/bin/sh\necho bsd-script-fake 1.0\n", {
        mode: 0o755,
      });
      const error = await runPty([process.execPath, "-e", "1"], {
        env: { PATH: dir },
        timeoutMs: 30_000,
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(PtyUnavailableError);
      expect((error as Error).message).toMatch(/not util-linux/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("timeout kills the transport and product groups and never reports a clean pass", async () => {
    const pidFile = join(tmpdir(), `pty-timeout-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      const receipt = await runPty(
        [
          "sh",
          "-c",
          `echo $$ > ${pidFile}; exec node -e 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'`,
        ],
        { timeoutMs: 250 },
      );
      expect(receipt.timedOut).toBe(true);
      expect(receipt.exitCode).toBeNull();

      const pid = Number(readFileSync(pidFile, "utf8").trim());
      let alive = true;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          alive = readFileSync(`/proc/${pid}/cmdline`, "utf8").length > 0;
        } catch {
          alive = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(alive).toBe(false);
    } finally {
      rmSync(pidFile, { force: true });
    }
  });
});
