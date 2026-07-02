import { describe, expect, it } from "vitest";
import { normalizeSandboxPaths, resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import type { Sandbox } from "../types.ts";

function fakeSandbox(): Sandbox & { calls: string[] } {
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
    readFile: async (path) => {
      calls.push(`read:${path}`);
      return "";
    },
    fileExists: async (path) => {
      calls.push(`exists:${path}`);
      return true;
    },
    readSourceFiles: async () => Object.assign([], {
      text: () => "",
      code: () => "",
      fileMatching: () => undefined,
      fileMatchingAll: () => undefined,
      hasPath: () => false,
    }),
    writeFiles: async (_files, targetDir) => {
      calls.push(`write:${targetDir}`);
    },
    uploadFiles: async (_files, targetDir) => {
      calls.push(`upload:${targetDir}`);
    },
    uploadDirectory: async (_localDir, targetDir) => {
      calls.push(`upload-dir:${targetDir}`);
    },
    stop: async () => {},
    downloadFile: async (path) => {
      calls.push(`download:${path}`);
      return Buffer.from("");
    },
    uploadFile: async (path) => {
      calls.push(`upload-file:${path}`);
    },
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
    const normalized = normalizeSandboxPaths(sandbox);

    await normalized.runCommand("npm", ["test"], { cwd: "packages/api" });
    await normalized.readFile("src/app.ts");
    await normalized.uploadFiles([], "fixtures");
    await normalized.uploadDirectory("/host/app");
    await normalized.downloadFile("dist/out.txt");

    expect(sandbox.calls).toEqual([
      "cwd:/work/packages/api",
      "read:/work/src/app.ts",
      "upload:/work/fixtures",
      "upload-dir:/work",
      "download:/work/dist/out.txt",
    ]);
  });
});
