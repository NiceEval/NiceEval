import { describe, expect, it } from "vitest";
import type { Sandbox } from "../types.ts";
import { withEvalLocalPaths } from "./remote-sandbox.ts";

describe("withEvalLocalPaths", () => {
  it("anchors relative host strings at the eval directory and preserves URL objects exactly", async () => {
    type TransferCall = readonly [string | URL, string | URL | undefined];
    const calls: TransferCall[] = [];
    const notUsed = async (): Promise<never> => {
      throw new Error("not used");
    };
    const sandbox: Sandbox = {
      workdir: "/work",
      sandboxId: "fake",
      otlpHost: null,
      runCommand: notUsed,
      runShell: notUsed,
      runCommandOrThrow: notUsed,
      runShellOrThrow: notUsed,
      readText: notUsed,
      writeText: notUsed,
      readBytes: notUsed,
      writeBytes: notUsed,
      pathExists: notUsed,
      uploadFile: async (source, targetPath) => { calls.push([source, targetPath]); },
      uploadDirectory: async (sourceDir, targetDir) => { calls.push([sourceDir, targetDir]); },
      downloadFile: async (sourcePath, target) => { calls.push([sourcePath, target]); },
      downloadDirectory: async (sourceDir, targetDir) => { calls.push([sourceDir, targetDir]); },
      stop: async () => {},
    };
    const view = withEvalLocalPaths(sandbox, "/repo/evals/nested");
    const sourceUrl = new URL("file:///fixtures/source.txt");
    const targetUrl = new URL("file:///out/result.txt");

    await view.uploadFile("../fixtures/source.txt", "source.txt");
    await view.uploadDirectory(sourceUrl, "fixtures");
    await view.downloadFile("result.txt", "../out/result.txt");
    await view.downloadDirectory("dist", targetUrl);

    expect(calls[0]).toEqual(["/repo/evals/fixtures/source.txt", "source.txt"]);
    expect(calls[1]?.[0]).toBe(sourceUrl);
    expect(calls[1]?.[1]).toBe("fixtures");
    expect(calls[2]).toEqual(["result.txt", "/repo/evals/out/result.txt"]);
    expect(calls[3]?.[0]).toBe("dist");
    expect(calls[3]?.[1]).toBe(targetUrl);
  });
});
