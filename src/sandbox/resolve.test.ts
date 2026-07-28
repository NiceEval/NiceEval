// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖 provisioning「对外的空间轴映射」的调度端接线(见
// docs/feature/sandbox/architecture.md#provisioning-失败与重试):`withDeterministicProvisionScope`
// 只在 provider 自身分类判定为 "unknown"(确定性)时才把可证明死因浮出为 FailureClass.scope;
// 瞬时失败(拒绝类/歧义类)重试耗尽后原样抛出,不附带 scope。这里直接注入 `work`/`classify`
// 闭包(与 retry.test.ts 对 withProvisionRetry 的做法同形),不需要经过真实 provider SDK
// ——provider 专属的错误形状已在 errors.test.ts 覆盖。
import { describe, expect, it } from "vitest";
import type { SandboxProvisionErrorKind } from "./errors.ts";
import { type ResolvedSandbox, withDeterministicProvisionScope } from "./resolve.ts";

function resolvedSandbox(environments?: globalThis.Record<string, unknown>): ResolvedSandbox {
  return {
    provider: "docker",
    exclusive: false,
    ...(environments !== undefined ? { environments } : {}),
  } as ResolvedSandbox;
}

function alwaysThrows(error: unknown): () => Promise<never> {
  return async () => {
    throw error;
  };
}

describe("withDeterministicProvisionScope", () => {
  it("attaches eval scope for template-not-found when the spec carries an environments table", async () => {
    const error = new Error("template not found");
    const r = resolvedSandbox({ "python-3.9": { image: "acme/py39" } });

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "unknown" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { _tag?: string })._tag).toBe("NiceevalClassifiedError");
    expect((error as unknown as { class?: unknown }).class).toEqual({ retryable: false, scope: "eval" });
  });

  it("attaches experiment scope for template-not-found when the spec has no environments table", async () => {
    const error = new Error("no such image: acme/missing:latest");
    const r = resolvedSandbox(undefined);

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "unknown" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { class?: unknown }).class).toEqual({ retryable: false, scope: "experiment" });
  });

  it("attaches experiment scope for credentials-missing regardless of the environments table", async () => {
    const error = Object.assign(new Error("Unauthorized, please check your credentials."), { name: "AuthenticationError" });
    const r = resolvedSandbox({ "python-3.9": { image: "acme/py39" } });

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "unknown" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { class?: unknown }).class).toEqual({ retryable: false, scope: "experiment" });
  });

  it("attaches experiment scope for permission-denied", async () => {
    const error = new Error("pull access denied for acme/private-image");
    const r = resolvedSandbox(undefined);

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "unknown" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { class?: unknown }).class).toEqual({ retryable: false, scope: "experiment" });
  });

  it("does not attach a scope for transient failures even after retries are exhausted", async () => {
    const error = new Error("too many requests");
    const r = resolvedSandbox({ "python-3.9": { image: "acme/py39" } });

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "rate_limit" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { _tag?: string })._tag).toBeUndefined();
    expect((error as unknown as { class?: unknown }).class).toBeUndefined();
  });

  it("does not attach a scope for a deterministic error that matches none of the three provable causes", async () => {
    const error = new Error("invalid argument: timeout must be positive");
    const r = resolvedSandbox(undefined);

    await expect(
      withDeterministicProvisionScope(alwaysThrows(error), () => "unknown" as SandboxProvisionErrorKind, r),
    ).rejects.toBe(error);

    expect((error as unknown as { _tag?: string })._tag).toBeUndefined();
  });

  it("passes through a successful work() untouched", async () => {
    const r = resolvedSandbox(undefined);
    const result = await withDeterministicProvisionScope(async () => "sandbox", () => "unknown" as SandboxProvisionErrorKind, r);
    expect(result).toBe("sandbox");
  });
});
