import { getEventListeners } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pauseOnFailure } from "../../../packages/niceeval/src/runner/pause-on-failure.ts";

// Resolve the runtime from its owning workspace; the root has no Effect dependency.
const require = createRequire(new URL("../../../packages/niceeval/package.json", import.meta.url));
const { Effect }: typeof import("../../../packages/niceeval/node_modules/effect") = require("effect");
const nativeCommand = "instabox ssh niceeval-debug";

// Serial: these cases temporarily replace process-wide stdin and stderr.
describe("pause on failure", () => {
  let input: PassThrough & { isTTY?: boolean };
  let controller: AbortController;
  let pending: Promise<void> | undefined;
  let output: string;

  beforeEach(() => {
    input = new PassThrough();
    input.isTTY = true;
    controller = new AbortController();
    pending = undefined;
    output = "";
    vi.spyOn(process, "stdin", "get").mockReturnValue(input as NodeJS.ReadStream);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      output += chunk.toString();
      return true;
    });
  });

  afterEach(async () => {
    // Release the semaphore even when a waiting/completion assertion fails.
    controller.abort();
    input.destroy();
    try {
      await pending;
    } finally {
      vi.restoreAllMocks();
    }
  });

  function start(options: { nonInteractive?: boolean } = {}) {
    pending = Effect.runPromise(pauseOnFailure(nativeCommand, controller.signal, options));
    return pending;
  }

  function expectReleased() {
    for (const event of ["data", "end", "close", "error"]) {
      expect(input.listenerCount(event), `${event} listeners`).toBe(0);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.isPaused()).toBe(true);
  }

  // @use-case docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
  it.each([
    { name: "non-TTY stdin", isTTY: false, nonInteractive: false },
    { name: "piped stdin without a TTY flag", isTTY: undefined, nonInteractive: false },
    { name: "explicit nonInteractive mode on a TTY", isTTY: true, nonInteractive: true },
  ])("prints debug instructions and completes without reading $name", async ({ isTTY, nonInteractive }) => {
    input.isTTY = isTTY;
    const resume = vi.spyOn(input, "resume");
    const on = vi.spyOn(input, "on");
    let completed = false;
    const result = start({ nonInteractive }).then(() => { completed = true; });

    // An event-loop checkpoint, not a wall-clock race; no input/EOF/abort is sent.
    await setImmediate();
    expect(output).toContain("Sandbox retained for debugging");
    expect(output).toContain(nativeCommand);
    expect(output).not.toContain("Press [Enter]");
    expect(completed).toBe(true);
    expect(resume).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
    await result;
  });

  // @use-case docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
  it("waits for a newline before resuming interactive cleanup", async () => {
    let completed = false;
    const result = start().then(() => { completed = true; });
    await setImmediate();
    expect(output).toContain(nativeCommand);
    expect(output).toContain("Press [Enter]");
    expect(completed).toBe(false);

    input.write("still debugging");
    await setImmediate();
    expect(completed).toBe(false);
    input.write("\n");
    await result;
    expect(completed).toBe(true);
    expectReleased();
  });

  // @use-case docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
  it("exits cleanly when the invocation is aborted while waiting", async () => {
    let completed = false;
    const result = start().then(() => { completed = true; });
    await setImmediate();
    expect(output).toContain("Press [Enter]");
    expect(completed).toBe(false);

    controller.abort();
    await expect(result).resolves.toBeUndefined();
    expectReleased();
  });

  // @use-case docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
  it("does not start waiting when the invocation was already aborted", async () => {
    controller.abort();
    const resume = vi.spyOn(input, "resume");
    await expect(start()).resolves.toBeUndefined();
    expect(output).toBe("");
    expect(resume).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
  });
});
