// cases: docs/engineering/testing/unit/sandbox.md
// define.ts 只保留定义入口；provider factory 的链式契约在 sandbox/layer.test.ts。
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { defineSandbox } from "./define.ts";
import { defineSandboxCommand } from "./sandbox/commands.ts";

describe("defineSandbox", () => {
  it("defineSandbox() creates a template-bearing layer whose prepare chain is immutable", async () => {
    const create = () => Effect.dieMessage("not called in this test");
    const command = defineSandboxCommand(
      { id: "test.custom.prepare", revision: "1", inputs: {} },
      async () => {},
    );
    const layer = defineSandbox({
      name: "my-provider",
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      create,
    });
    const prepared = layer.prepare(command);
    expect(prepared).not.toBe(layer);
    expect(typeof layer.prepare).toBe("function");
    expect(typeof prepared.prepare).toBe("function");
  });
});
