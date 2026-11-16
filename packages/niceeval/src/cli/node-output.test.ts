import { Writable } from "node:stream";
import { expect, test, vi } from "vitest";
import { Effect } from "effect";
import { CliOutput } from "./application.ts";
import { NodeCliOutputLive } from "./node-application.ts";

// @feature docs/feature/experiments/README.md
test("output streams handle asynchronous EPIPE after the write returns", async () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const output = await Effect.runPromise(CliOutput.pipe(Effect.provide(NodeCliOutputLive)));
    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("closed"), { code: "EPIPE" }));
      },
    });
    const closed = new Promise<void>((resolve) => writable.once("close", resolve));
    const getter = vi.spyOn(process, stream, "get").mockReturnValue(writable as typeof process.stdout);
    try {
      (stream === "stdout" ? output.writeStdoutSync : output.writeStderrSync)("one");
    } finally {
      getter.mockRestore();
    }
    await closed;
    expect(writable.errored, stream).toMatchObject({ code: "EPIPE" });
  }
});

// @feature docs/feature/experiments/README.md
test("output streams ignore synchronous broken pipes but preserve other write failures", async () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const output = await Effect.runPromise(CliOutput.pipe(Effect.provide(NodeCliOutputLive)));
    const write = vi.spyOn(process[stream], "write");
    try {
      const sync = stream === "stdout" ? output.writeStdoutSync : output.writeStderrSync;
      const asyncWrite = stream === "stdout" ? output.writeStdout : output.writeStderr;
      write.mockImplementation(() => {
        throw Object.assign(new Error("closed"), { code: "EPIPE" });
      });
      expect(() => sync("one")).not.toThrow();
      await expect(Effect.runPromise(asyncWrite("two"))).resolves.toBeUndefined();
      const failure = Object.assign(new Error("disk failure"), { code: "EIO" });
      write.mockImplementation(() => {
        throw failure;
      });
      expect(() => sync("three")).toThrow(failure);
      expect(await Effect.runPromise(Effect.flip(asyncWrite("four")))).toMatchObject({ cause: failure });
    } finally {
      write.mockRestore();
    }
  }
});
