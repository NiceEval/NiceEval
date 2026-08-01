// cases: docs/engineering/testing/unit/sandbox.md

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  defineSandboxCommand,
  sandboxCommandIdentityJson,
  sandboxCommandIdentityOf,
  shell,
  type StableSandboxCommand,
} from "./commands.ts";
import {
  isRegisteredSandboxContent,
  registerSandboxContent,
  registeredSandboxContentSourceOf,
} from "./content.ts";
import {
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
  e2bSandbox,
  localSandbox,
  sandboxLayer,
  sandboxLayerStateOf,
  vercelSandbox,
  type SandboxLayer,
} from "./layer.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function typeContracts(): void {
  const commandOnly = sandboxLayer();
  const stillCommandOnly: SandboxLayer<"command-only"> = commandOnly.prepare(shell("true"));
  const template = dockerImageSandbox({ image: "node:24" });
  const stillTemplate: SandboxLayer<"template-bearing"> = template.prepare(shell("true"));
  const stable: StableSandboxCommand = command("echo", ["ok"]);
  void stillCommandOnly;
  void stillTemplate;
  void stable;

  // @ts-expect-error SandboxLayer 的 module-private brand 不能由对象字面量伪造。
  const forged: SandboxLayer = { prepare: () => sandboxLayer() };
  // @ts-expect-error StableSandboxCommand 同样只能由稳定命令 factory 构造。
  const forgedCommand: StableSandboxCommand = async () => {};
  // @ts-expect-error Compose template 的完整起点必须包含 file。
  dockerComposeSandbox({ workspaceService: "app" });
  // @ts-expect-error E2B template 是必填原生起点参数。
  e2bSandbox({});
  void forged;
  void forgedCommand;
}
void typeContracts;

describe("SandboxLayer 声明与 command identity", () => {
  it("prepare 不改变原 layer，并按追加顺序保留 kind 与 stable/opaque 声明", () => {
    const base = sandboxLayer();
    const stable = command("printf", ["%s", "$HOME;literal"]);
    const opaque = async (): Promise<void> => {};
    const one = base.prepare(stable);
    const two = one.prepare(opaque);

    expect(sandboxLayerStateOf(base)).toMatchObject({ kind: "command-only", commands: [] });
    expect(sandboxLayerStateOf(one).commands).toEqual([
      expect.objectContaining({ kind: "stable", command: stable }),
    ]);
    expect(sandboxLayerStateOf(two).commands).toEqual([
      expect.objectContaining({ kind: "stable", command: stable }),
      { kind: "opaque", command: opaque },
    ]);
    expect(Object.isFrozen(two)).toBe(true);
    expect(Object.isFrozen(sandboxLayerStateOf(two).commands)).toBe(true);

    const template = dockerImageSandbox({ image: "node:24" }).prepare(opaque);
    expect(sandboxLayerStateOf(template)).toMatchObject({
      kind: "template-bearing",
      template: { provider: "docker", kind: "image", image: "node:24" },
      commands: [{ kind: "opaque", command: opaque }],
    });
  });

  it("六类 template factory 只产出完整、不可变的纯数据起点", () => {
    const compose = dockerComposeSandbox({
      file: new URL("file:///fixtures/compose.yaml"),
      workspaceService: "client",
      build: "on-demand",
      executionUser: "node",
      env: { NODE_ENV: "test" },
    });
    const dockerfile = dockerfileSandbox({
      context: ".",
      dockerfile: "Dockerfile.eval",
      buildArgs: { NODE_VERSION: "24" },
    });

    expect(sandboxLayerStateOf(compose).template).toEqual({
      provider: "docker",
      kind: "compose",
      file: { kind: "url", value: "file:///fixtures/compose.yaml" },
      workspaceService: "client",
      build: "on-demand",
      executionUser: "node",
      env: { NODE_ENV: "test" },
    });
    expect(sandboxLayerStateOf(dockerfile).template).toEqual({
      provider: "docker",
      kind: "dockerfile",
      context: { kind: "path", value: "." },
      dockerfile: "Dockerfile.eval",
      buildArgs: { NODE_VERSION: "24" },
    });
    expect(sandboxLayerStateOf(dockerImageSandbox({ image: "node:24" })).template).toMatchObject({
      provider: "docker",
      kind: "image",
    });
    expect(sandboxLayerStateOf(e2bSandbox({ template: "niceeval-codex", lifetimeMs: 60_000 })).template).toEqual({
      provider: "e2b",
      kind: "template",
      template: "niceeval-codex",
      lifetimeMs: 60_000,
    });
    expect(sandboxLayerStateOf(vercelSandbox({ snapshotId: "snap_123", lifetimeMs: 30_000 })).template).toEqual({
      provider: "vercel",
      kind: "snapshot",
      snapshotId: "snap_123",
      lifetimeMs: 30_000,
    });
    expect(sandboxLayerStateOf(localSandbox({ dir: "/workspace" })).template).toEqual({
      provider: "local",
      kind: "directory",
      dir: "/workspace",
    });
    expect(Object.isFrozen(sandboxLayerStateOf(compose).template)).toBe(true);
  });

  it("factory 的运行时入口拒绝缺失、空值、额外字段和无效寿命", () => {
    expect(() => e2bSandbox({} as never)).toThrow(/template must be a non-empty string/);
    expect(() => dockerImageSandbox({ image: "" })).toThrow(/image must be a non-empty string/);
    expect(() => dockerComposeSandbox({ file: "compose.yaml", workspaceService: "" })).toThrow(
      /workspaceService must be a non-empty string/,
    );
    expect(() => vercelSandbox({ snapshotId: "snap", lifetimeMs: Number.POSITIVE_INFINITY })).toThrow(
      /positive finite number/,
    );
    expect(() => e2bSandbox({ template: "base", provider: "e2b" } as never)).toThrow(
      /provider is not supported/,
    );
    expect(() => sandboxLayer().prepare(null as never)).toThrow(/requires a command function/);
  });

  it("command/shell/defineSandboxCommand 快照全部输入，且直接 callback 保持 opaque", () => {
    const args = ["--flag", "$HOME;literal"];
    const env = { MODE: "before" };
    const stable = command("tool", args, {
      cwd: "workspace",
      env,
      root: true,
      timeoutMs: 500,
      stdin: "payload",
    });
    args[0] = "--mutated";
    env.MODE = "after";

    const identity = sandboxCommandIdentityOf(stable);
    expect(identity).toEqual({
      id: "niceeval.sandbox.command",
      revision: "1",
      inputs: {
        executable: "tool",
        args: ["--flag", "$HOME;literal"],
        options: {
          cwd: "workspace",
          env: { MODE: "before" },
          root: true,
          timeoutMs: 500,
          stdin: "payload",
        },
      },
    });
    expect(Object.isFrozen(identity)).toBe(true);

    const custom = defineSandboxCommand(
      { id: "fixture.prepare", revision: "3", inputs: { z: 1, a: [true, null] } },
      async () => {},
    );
    expect(sandboxCommandIdentityJson(sandboxCommandIdentityOf(custom)!.inputs)).toEqual({
      z: 1,
      a: [true, null],
    });
    expect(sandboxCommandIdentityOf(async () => {})).toBeUndefined();

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      defineSandboxCommand({ id: "fixture", revision: "1", inputs: cyclic as never }, async () => {}),
    ).toThrow(/must not contain a cycle/);
    expect(() =>
      defineSandboxCommand({ id: "fixture", revision: "1", inputs: { now: new Date() } as never }, async () => {}),
    ).toThrow(/plain objects/);
  });

  it("registerSandboxContent 按项目根或 file URL 解析，并让文件/目录内容决定 digest", async () => {
    const projectRelative = registerSandboxContent("package.json");
    const projectUrl = registerSandboxContent(new URL("../../package.json", import.meta.url));
    expect(projectRelative).toEqual(projectUrl);
    expect(projectRelative.kind).toBe("file");
    expect(projectRelative.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(registeredSandboxContentSourceOf(projectRelative).path).toBe(realpathSync("package.json"));
    expect(Object.isFrozen(projectRelative)).toBe(true);
    expect(isRegisteredSandboxContent({ kind: "file", digest: projectRelative.digest })).toBe(false);

    const root = await mkdtemp(join(tmpdir(), "niceeval-sandbox-content-"));
    temporaryDirectories.push(root);
    const file = join(root, "fixture.txt");
    await writeFile(file, "one\n");
    const before = registerSandboxContent(new URL(`file://${file}`));
    await writeFile(file, "two\n");
    const after = registerSandboxContent(file);
    expect(after.digest).not.toBe(before.digest);

    const directory = join(root, "tree");
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "b.txt"), "b\n");
    await writeFile(join(directory, "nested", "a.txt"), "a\n");
    const treeBefore = registerSandboxContent(directory);
    await writeFile(join(directory, "nested", "a.txt"), "changed\n");
    const treeAfter = registerSandboxContent(directory);
    expect(treeBefore.kind).toBe("directory");
    expect(treeAfter.digest).not.toBe(treeBefore.digest);

    await symlink(file, join(directory, "fixture-link"));
    expect(() => registerSandboxContent(directory)).toThrow(
      /directory contains symbolic link.*replace it with regular content or register the resolved target explicitly/,
    );

    const contentCommand = defineSandboxCommand(
      { id: "fixture.content", revision: "1", inputs: { content: treeAfter } },
      async () => {},
    );
    expect(sandboxCommandIdentityJson(sandboxCommandIdentityOf(contentCommand)!.inputs)).toEqual({
      content: { kind: "directory", digest: treeAfter.digest },
    });
    expect(() => registerSandboxContent(new URL("https://example.com/fixture"))).toThrow(/must use file:/);
  });
});
