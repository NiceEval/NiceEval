// cases: docs/engineering/testing/unit/sandbox.md
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
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

  it("summarizes a bounded, redacted stderr tail without truncating the carried result", () => {
    const secret = "synthetic-e2b-secret";
    const stderr = `HEAD-ONLY-${"x".repeat(500)}\n${secret}\n\u001b[31mfinal stderr tail\u001b[0m\n`;
    const result: CommandResult = {
      stdout: "stdout is not selected when stderr is present",
      stderr,
      exitCode: 17,
      command: `install-tool --token=${secret}`,
    };

    try {
      successfulCommandResult(result, [secret]);
      throw new Error("expected successfulCommandResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxCommandExitError);
      const message = (error as SandboxCommandExitError).message;
      expect(message).toContain("stderr tail:");
      expect(message).toContain("final stderr tail");
      expect(message).toContain("<redacted>");
      expect(message).not.toContain(secret);
      expect(message).not.toContain("\u001b");
      expect(message).not.toContain("HEAD-ONLY-");
      expect(result.stderr).toBe(stderr);
      expect((error as SandboxCommandExitError).result).toBe(result);
    }
  });

  it("stderr 为空时用完整 stdout 的尾部作为 checked error 摘要", () => {
    const result: CommandResult = {
      stdout: "stdout root cause\n",
      stderr: "",
      exitCode: 2,
    };

    expect(() => successfulCommandResult(result)).toThrow(/stdout tail: stdout root cause/);
  });

  it("将多行 stderr tail 收口到同一行并保留最后的 pack-objects/fatal 根因", () => {
    const result: CommandResult = {
      stdout: "",
      stderr: [
        "debconf: delaying package configuration, since apt-utils is not installed",
        "pack-objects: unexpected disconnect while reading sideband packet",
        "fatal: the remote end hung up unexpectedly",
        "fatal: unable to write new object",
      ].join("\n"),
      exitCode: 128,
    };

    try {
      successfulCommandResult(result);
      throw new Error("expected successfulCommandResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxCommandExitError);
      const message = (error as SandboxCommandExitError).message;
      expect(message).not.toMatch(/[\r\n]/);
      expect(message).toContain("pack-objects: unexpected disconnect while reading sideband packet");
      expect(message).toContain("fatal: the remote end hung up unexpectedly");
      expect(message).toContain("fatal: unable to write new object");
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

  // bug: memory/e2b-putcontent-root-owned-nested-directory.md
  it("recursively realizes registered paths and bytes below a root-owned target", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-root-owned-"));
    roots.push(root);
    await mkdir(join(root, "setup_files", "deeper"), { recursive: true });
    await writeFile(join(root, "install.sh"), "#!/bin/sh\n");
    await writeFile(join(root, "setup_files", "Y3JlZGVudGlhbHM=.b64_content"), "credentials\n");
    await writeFile(join(root, "setup_files", "deeper", "payload.txt"), "nested payload\n");
    const content = registerSandboxContent(new URL(`file://${root}/`));
    const target = "/tmp/niceeval-install-fixture";
    const directories = new Set([target]);
    const rootOwned = new Set([target]);
    const files = new Map<string, string>();
    const io: string[] = [];
    const operations = fakeOperations(io);

    operations.runCommandOrThrow = async (command, args, options) => {
      const path = args?.[1];
      if (command !== "mkdir" || args?.[0] !== "-p" || path === undefined) {
        throw new Error(`unexpected command: ${command} ${args?.join(" ") ?? ""}`);
      }
      const asRoot = options?.root === true;
      io.push(`mkdir:${asRoot ? "root" : "user"}:${path}`);
      if (directories.has(path)) return commandResult() as ReturnType<typeof successfulCommandResult>;
      if (!asRoot && rootOwned.has(posix.dirname(path))) {
        throw new SandboxCommandExitError({
          stdout: "",
          stderr: `mkdir: cannot create directory '${path}': Permission denied`,
          exitCode: 1,
          command: `mkdir -p ${path}`,
        });
      }
      directories.add(path);
      if (asRoot) rootOwned.add(path);
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    };
    operations.writeBytes = async (path, bytes) => {
      if (!directories.has(posix.dirname(path))) {
        throw new Error(`missing parent directory for ${path}`);
      }
      files.set(path, Buffer.from(bytes).toString("utf8"));
    };

    await createSandboxCommandTarget(operations).putContent(content, target);

    expect(directories).toEqual(new Set([
      target,
      `${target}/setup_files`,
      `${target}/setup_files/deeper`,
    ]));
    expect(files).toEqual(new Map([
      [`${target}/install.sh`, "#!/bin/sh\n"],
      [`${target}/setup_files/deeper/payload.txt`, "nested payload\n"],
      [`${target}/setup_files/Y3JlZGVudGlhbHM=.b64_content`, "credentials\n"],
    ]));
    expect(io).toContain(`mkdir:user:${target}/setup_files`);
    expect(io).toContain(`mkdir:root:${target}/setup_files`);
    expect(io).toContain(`mkdir:root:${target}/setup_files/deeper`);
  });

  it("splits large registered files into bounded writes and atomically replaces the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-large-"));
    roots.push(root);
    const path = join(root, "payload.bin");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 3, 0x61));
    const content = registerSandboxContent(new URL(`file://${path}`));
    const io: string[] = [];
    const operations = fakeOperations(io);
    const writes: Array<{ path: string; bytes: number }> = [];
    operations.writeBytes = async (target, bytes) => {
      writes.push({ path: target, bytes: bytes.byteLength });
    };

    await createSandboxCommandTarget(operations).putContent(content, "payload.bin");

    expect(writes).toHaveLength(2);
    expect(writes.map((write) => write.bytes)).toEqual([8 * 1024 * 1024, 3]);
    expect(writes.every((write) => write.path.includes("payload.bin.niceeval-parts-"))).toBe(true);
    expect(io).toEqual([
      expect.stringMatching(/^command!:rm:-rf,payload\.bin\.niceeval-parts-[a-f0-9]{16},payload\.bin\.niceeval-merge-[a-f0-9]{16}$/),
      expect.stringMatching(/^command!:mkdir:-p,payload\.bin\.niceeval-parts-[a-f0-9]{16}$/),
      expect.stringMatching(/^command!:sh:-c,cat \"\$1\"\/part-\* > \"\$2\",niceeval-put-content,payload\.bin\.niceeval-parts-[a-f0-9]{16},payload\.bin\.niceeval-merge-[a-f0-9]{16}$/),
      expect.stringMatching(/^command!:mv:-f,payload\.bin\.niceeval-merge-[a-f0-9]{16},payload\.bin$/),
      expect.stringMatching(/^command!:rm:-rf,payload\.bin\.niceeval-parts-[a-f0-9]{16}$/),
    ]);
  });

  it("large content keeps staging, merge, replace, and cleanup under the controlled root fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-large-root-owned-"));
    roots.push(root);
    const path = join(root, "payload.bin");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    const content = registerSandboxContent(new URL(`file://${path}`));
    const operations = fakeOperations([]);
    const commands: Array<{ command: string; args: readonly string[]; root: boolean }> = [];
    const writes: number[] = [];

    operations.runCommandOrThrow = async (command, args, options) => {
      const asRoot = options?.root === true;
      commands.push({ command, args: args ?? [], root: asRoot });
      if (command === "mkdir" && !asRoot) {
        throw new SandboxCommandExitError({
          stdout: "",
          stderr: `mkdir: cannot create directory '${args?.[1]}': Permission denied`,
          exitCode: 1,
          command: `mkdir -p ${args?.[1]}`,
        });
      }
      if (["sh", "mv"].includes(command) && !asRoot) {
        throw new Error(`${command} unexpectedly lost the root transfer identity`);
      }
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    };
    operations.writeBytes = async (_target, bytes) => {
      writes.push(bytes.byteLength);
    };

    await createSandboxCommandTarget(operations).putContent(content, "/root-owned/payload.bin");

    expect(writes).toEqual([8 * 1024 * 1024, 1]);
    expect(commands.map(({ command, root }) => `${command}:${root ? "root" : "user"}`)).toEqual([
      "rm:user",
      "mkdir:user",
      "rm:root",
      "mkdir:root",
      "sh:root",
      "mv:root",
      "rm:root",
    ]);
    expect(commands.some(({ command }) => command === "chmod" || command === "chown")).toBe(false);
  });

  it("sticky parent with an existing root-owned target escalates only the denied final replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-large-sticky-target-"));
    roots.push(root);
    const path = join(root, "payload.bin");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    const content = registerSandboxContent(new URL(`file://${path}`));
    const operations = fakeOperations([]);
    const commands: Array<{ command: string; root: boolean }> = [];

    operations.runCommandOrThrow = async (command, _args, options) => {
      const asRoot = options?.root === true;
      commands.push({ command, root: asRoot });
      if (command === "mv" && !asRoot) {
        throw new SandboxCommandExitError({
          stdout: "",
          stderr: "mv: cannot move merge to target: Operation not permitted",
          exitCode: 1,
          command: "mv -f merge target",
        });
      }
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    };
    operations.writeBytes = async () => {};

    await createSandboxCommandTarget(operations).putContent(content, "/tmp/payload.bin");

    expect(commands.map(({ command, root }) => `${command}:${root ? "root" : "user"}`)).toEqual([
      "rm:user",
      "mkdir:user",
      "sh:user",
      "mv:user",
      "mv:root",
      "rm:root",
    ]);
  });

  it("large content never escalates a non-permission final replacement failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-content-large-no-escalation-"));
    roots.push(root);
    const path = join(root, "payload.bin");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    const content = registerSandboxContent(new URL(`file://${path}`));
    const operations = fakeOperations([]);
    const rootsUsed: boolean[] = [];
    const failure = new SandboxCommandExitError({
      stdout: "",
      stderr: "mkdir: No space left on device",
      exitCode: 1,
      command: "mkdir -p parts",
    });

    operations.runCommandOrThrow = async (command, _args, options) => {
      rootsUsed.push(options?.root === true);
      if (command === "mv") throw failure;
      return commandResult() as ReturnType<typeof successfulCommandResult>;
    };

    await expect(createSandboxCommandTarget(operations).putContent(content, "payload.bin")).rejects.toBe(failure);
    expect(rootsUsed).toEqual([false, false, false, false]);
  });
});
