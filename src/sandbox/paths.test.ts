// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, it } from "vitest";
import { normalizeSandboxPaths, resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import {
  noSandboxBackendCapabilities,
  supportedBackendCapability,
  type SandboxBackendCapabilities,
  type SandboxProviderBackend,
} from "./backend.ts";
import { suspendSandbox } from "./keep.ts";
import { sandboxReuseCapability } from "./resolve.ts";

function fakeSandbox(
  capabilities: SandboxBackendCapabilities = noSandboxBackendCapabilities,
): SandboxProviderBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: async (_cmd, _args, opts) => {
      calls.push(`cwd:${opts?.cwd ?? ""}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    runShell: async (_script, opts) => {
      calls.push(`shell-cwd:${opts?.cwd ?? ""}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    readText: async (path) => {
      calls.push(`read:${path}`);
      return "";
    },
    readBytes: async (path) => {
      calls.push(`read-bytes:${path}`);
      return new Uint8Array();
    },
    writeText: async (path) => {
      calls.push(`write-text:${path}`);
    },
    writeBytes: async (path) => {
      calls.push(`write-bytes:${path}`);
    },
    pathExists: async (path) => {
      calls.push(`exists:${path}`);
      return true;
    },
    uploadDirectory: async (sourceDir, targetDir) => {
      calls.push(`upload-dir:${sourceDir.toString()}:${targetDir}`);
    },
    stop: async () => {},
    downloadFile: async (path, target) => {
      calls.push(`download:${path}:${target.toString()}`);
    },
    uploadFile: async (source, path) => {
      calls.push(`upload-file:${source.toString()}:${path}`);
    },
    downloadDirectory: async (sourceDir, targetDir) => {
      calls.push(`download-dir:${sourceDir}:${targetDir.toString()}`);
    },
    capabilities,
    calls,
  };
}

describe("sandbox path helpers", () => {
  it("resolves sandbox paths relative to workdir", () => {
    expect(resolveSandboxPath("/work", undefined)).toBe("/work");
    expect(resolveSandboxPath("/work", "src/app.ts")).toBe("/work/src/app.ts");
    expect(resolveSandboxPath("/work", "/tmp/out")).toBe("/tmp/out");
  });

  it("resolves local paths relative to eval directories", () => {
    expect(resolveLocalPath("/repo/evals/auth", "../fixtures/app")).toBe("/repo/evals/fixtures/app");
    expect(resolveLocalPath("/repo/evals/auth", "/tmp/app")).toBe("/tmp/app");
  });

  it("normalizes paths for custom sandbox implementations", async () => {
    const sandbox = fakeSandbox();
    const normalized = normalizeSandboxPaths(sandbox, "custom");

    await normalized.runCommand("npm", ["test"], { cwd: "packages/api" });
    await normalized.readText("src/app.ts");
    await normalized.writeBytes("fixtures/a.bin", new Uint8Array([1]));
    await normalized.uploadDirectory("/host/app");
    await normalized.downloadFile("dist/out.txt", "/host/out.txt");
    await normalized.downloadDirectory("dist", "/host/out");

    expect(sandbox.calls).toEqual([
      "cwd:/work/packages/api",
      "read:/work/src/app.ts",
      "write-bytes:/work/fixtures/a.bin",
      "upload-dir:/host/app:/work",
      "download:/work/dist/out.txt:/host/out.txt",
      "download-dir:/work/dist:/host/out",
    ]);
  });

  it("forwards the non-interface suspend() capability when the underlying provider implements it", async () => {
    const calls: string[] = [];
    const sandbox = fakeSandbox({
      ...noSandboxBackendCapabilities,
      suspend: supportedBackendCapability(async () => {
        calls.push("suspend");
      }),
    });
    const normalized = normalizeSandboxPaths(sandbox, "custom");

    await suspendSandbox(normalized);
    sandbox.calls.push(...calls);
    expect(sandbox.calls).toEqual(["suspend"]);
  });

  it("omits suspend entirely when the underlying provider does not implement it (no fake capability appears)", () => {
    const sandbox = fakeSandbox(); // no .suspend on this fixture
    const normalized = normalizeSandboxPaths(sandbox, "custom");
    return expect(suspendSandbox(normalized)).rejects.toThrow(/no suspend capability/);
  });

  // cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」——能力归属。
  it("forwards the non-interface ensureLifetime() capability when the underlying provider implements it", async () => {
    const calls: string[] = [];
    const sandbox = fakeSandbox({
      ...noSandboxBackendCapabilities,
      ensureLifetime: supportedBackendCapability(async (ms: number) => {
        calls.push(`ensureLifetime:${ms}`);
        return { ready: true as const };
      }),
    });
    const normalized = normalizeSandboxPaths(sandbox, "custom");
    const forwarded = sandboxReuseCapability(normalized);
    if (forwarded === undefined) throw new Error("expected reusable capability");
    await expect(forwarded.ensureLifetime(90_000)).resolves.toEqual({ ready: true });
    sandbox.calls.push(...calls);
    expect(sandbox.calls).toEqual(["ensureLifetime:90000"]);
  });

  it("omits ensureLifetime entirely when the underlying provider does not implement it", () => {
    const normalized = normalizeSandboxPaths(fakeSandbox(), "custom");
    expect(sandboxReuseCapability(normalized)).toBeUndefined();
  });
});
