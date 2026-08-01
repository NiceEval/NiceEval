// cases: docs/engineering/testing/unit/sandbox.md
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, SandboxOperations } from "./types.ts";
import { noSandboxBackendCapabilities, type SandboxProviderBackend } from "./backend.ts";
import { registerSandboxContent } from "./content.ts";
import {
  createSandboxCommandTarget,
  SandboxCommandExitError,
  successfulCommandResult,
} from "./operations.ts";
import { normalizeSandboxPaths } from "./paths.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function commandResult(exitCode = 0): CommandResult {
  return { stdout: "out", stderr: "err", exitCode, command: "false" };
}

function fakeOperations(io: string[]): SandboxOperations {
  return {
    workdir: "/work",
    runCommand: async (command, args) => {
      io.push(`command:${command}:${args?.join(",") ?? ""}`);
      return commandResult();
    },
    runShell: async (script) => {
      io.push(`shell:${script}`);
      return commandResult();
    },
    runCommandOrThrow: async (command, args) => {
      io.push(`command!:${command}:${args?.join(",") ?? ""}`);
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    },
    runShellOrThrow: async (script) => {
      io.push(`shell!:${script}`);
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    },
    readText: async (path) => {
      io.push(`readText:${path}`);
      return "";
    },
    writeText: async (path, content) => {
      io.push(`writeText:${path}:${content}`);
    },
    readBytes: async (path) => {
      io.push(`readBytes:${path}`);
      return new Uint8Array([1, 2]);
    },
    writeBytes: async (path, content) => {
      io.push(`writeBytes:${path}:${Buffer.from(content).toString("utf8")}`);
    },
    pathExists: async (path) => {
      io.push(`pathExists:${path}`);
      return true;
    },
  };
}

describe("checked command semantics", () => {
  it("only turns nonzero results into a command-exit error carrying the complete result", () => {
    const result = commandResult(17);
    try {
      successfulCommandResult(result);
      throw new Error("expected successfulCommandResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxCommandExitError);
      expect((error as SandboxCommandExitError).code).toBe("command-exit");
      expect((error as SandboxCommandExitError).result).toBe(result);
    }
  });
});

describe("provider-neutral facade", () => {
  for (const provider of ["local", "docker", "e2b", "vercel", "custom"]) {
    it(`${provider} resolves sandbox paths and preserves Uint8Array bytes`, async () => {
      const io: string[] = [];
      const operations = fakeOperations(io);
      const raw: SandboxProviderBackend = {
        ...operations,
        sandboxId: provider,
        otlpHost: null,
        capabilities: noSandboxBackendCapabilities,
        stop: async () => {},
        uploadFile: async () => {},
        uploadDirectory: async () => {},
        downloadFile: async () => {},
        downloadDirectory: async () => {},
      };
      const sandbox = normalizeSandboxPaths(raw, provider);
      expect(await sandbox.readBytes("asset.bin")).toEqual(new Uint8Array([1, 2]));
      await sandbox.writeBytes("asset.bin", new Uint8Array([65]));
      expect(io).toEqual(["readBytes:/work/asset.bin", "writeBytes:/work/asset.bin:A"]);
    });
  }
});

describe("SandboxCommandTarget.putContent", () => {
  it("validates content drift before the first provider I/O", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-drift-"));
    roots.push(root);
    const path = join(root, "payload.txt");
    await writeFile(path, "before");
    const content = registerSandboxContent(new URL(`file://${path}`));
    await writeFile(path, "after");
    const io: string[] = [];

    await expect(createSandboxCommandTarget(fakeOperations(io)).putContent(content, "payload.txt"))
      .rejects.toThrow(/changed before transfer/);
    expect(io).toEqual([]);
  });

  it("writes registered directory entries in deterministic snapshot order", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-directory-"));
    roots.push(root);
    await mkdir(join(root, "z"));
    await writeFile(join(root, "z", "b.txt"), "b");
    await writeFile(join(root, "a.txt"), "a");
    const content = registerSandboxContent(new URL(`file://${root}/`));
    const io: string[] = [];

    await createSandboxCommandTarget(fakeOperations(io)).putContent(content, "fixture");

    expect(io).toEqual([
      "command!:mkdir:-p,fixture",
      "writeBytes:fixture/a.txt:a",
      "command!:mkdir:-p,fixture/z",
      "writeBytes:fixture/z/b.txt:b",
    ]);
  });
});
