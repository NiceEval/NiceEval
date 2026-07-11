// SandboxSpec 链式钩子(.setup()/.teardown())的构造期契约:不可变、多次追加按顺序累加。
// 执行顺序(setup 正序 / teardown 逆序 / LIFO cleanup)是 runner 的事,见
// test/e2e-sandbox-hooks.test.ts;这里只测 dockerSandbox()/vercelSandbox()/e2bSandbox()/
// defineSandbox() 这四个工厂产出的 spec 对象本身的构造行为。
import { describe, expect, it } from "vitest";
import { dockerSandbox, e2bSandbox, vercelSandbox, defineSandbox } from "./define.ts";
import type { AgentSetup, AgentTeardown } from "./types.ts";

const noopSetup: AgentSetup = () => {};
const noopTeardown: AgentTeardown = () => {};

describe("sandbox factories: .setup()/.teardown() chain", () => {
  it("dockerSandbox() starts with empty hook arrays", () => {
    const spec = dockerSandbox({ image: "custom:latest" });
    expect(spec.provider).toBe("docker");
    expect(spec.image).toBe("custom:latest");
    expect(spec.setupHooks).toEqual([]);
    expect(spec.teardownHooks).toEqual([]);
  });

  it(".setup() returns a new spec and does not mutate the original", () => {
    const base = dockerSandbox();
    const withSetup = base.setup(noopSetup);
    expect(withSetup).not.toBe(base);
    expect(base.setupHooks).toEqual([]);
    expect(withSetup.setupHooks).toEqual([noopSetup]);
  });

  it("multiple .setup() calls accumulate in append order", () => {
    const a: AgentSetup = () => {};
    const b: AgentSetup = () => {};
    const spec = dockerSandbox().setup(a).setup(b);
    expect(spec.setupHooks).toEqual([a, b]);
  });

  it("multiple .teardown() calls accumulate in append order (execution order is the runner's job)", () => {
    const x: AgentTeardown = () => {};
    const y: AgentTeardown = () => {};
    const spec = dockerSandbox().teardown(x).teardown(y);
    expect(spec.teardownHooks).toEqual([x, y]);
  });

  it("chaining preserves provider-specific fields and stacks across calls", () => {
    const spec = dockerSandbox({ image: "img" }).setup(noopSetup).teardown(noopTeardown).setup(noopSetup);
    expect(spec.provider).toBe("docker");
    expect(spec.image).toBe("img");
    expect(spec.setupHooks).toHaveLength(2);
    expect(spec.teardownHooks).toHaveLength(1);
  });

  it("vercelSandbox() / e2bSandbox() chain the same way and keep their own fields", () => {
    const vercel = vercelSandbox({ snapshotId: "snap-1" }).setup(noopSetup);
    expect(vercel.provider).toBe("vercel");
    expect(vercel.snapshotId).toBe("snap-1");
    expect(vercel.setupHooks).toEqual([noopSetup]);

    const e2b = e2bSandbox({ template: "niceeval-agents" }).teardown(noopTeardown);
    expect(e2b.provider).toBe("e2b");
    expect(e2b.template).toBe("niceeval-agents");
    expect(e2b.teardownHooks).toEqual([noopTeardown]);
  });

  it("defineSandbox() (custom provider) chains too and keeps create()/name", async () => {
    const create = async () => {
      throw new Error("not called in this test");
    };
    const spec = defineSandbox({ name: "my-provider", create }).setup(noopSetup).setup(noopSetup);
    expect(spec.provider).toBe("my-provider");
    expect(spec.create).toBe(create);
    expect(spec.setupHooks).toHaveLength(2);
  });

  it("each chain call produces an independent object (no shared mutable state)", () => {
    const base = dockerSandbox();
    const other: AgentSetup = () => {};
    const branchA = base.setup(noopSetup);
    const branchB = base.setup(other);
    expect(branchA.setupHooks).toEqual([noopSetup]);
    expect(branchB.setupHooks).toEqual([other]);
    expect(branchA.setupHooks).not.toBe(branchB.setupHooks);
  });
});
