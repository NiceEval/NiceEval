import { describe, expect, it } from "vitest";
import { runPty } from "../src/run-pty.js";

const ttyProbe = (extra: string) => [
  process.execPath,
  "-e",
  `console.log(JSON.stringify({isTTY: process.stdout.isTTY, columns: process.stdout.columns, rows: process.stdout.rows, env: {COLUMNS: process.env.COLUMNS, LINES: process.env.LINES}${extra}}))`,
] as const;

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

  it("preserves the product argv and records the pty transport in diagnostics", async () => {
    const receipt = await runPty(ttyProbe(""), { timeoutMs: 30_000 });
    expect(receipt.transport).toBe("pty");
    expect(receipt.diagnostic()).toContain("transport: pty");
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
});
