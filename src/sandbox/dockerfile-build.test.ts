// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - builder CLI 的 stdout 反压与失败诊断上限
// - managed Docker profile 的 daemon socket 贯穿 cache lookup 与真实 build
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDockerfileBuildFromIdentity,
  dockerfileBuildProvider,
  runBuildCommand,
} from "./dockerfile-build.ts";
import { resolveDockerfileBuildIdentity } from "./dockerfile-identity.ts";

describe("Dockerfile builder 子进程输出", () => {
  it("持续 drain 大量 stdout，不因 pipe buffer 写满而挂起", async () => {
    await expect(
      runBuildCommand(
        process.execPath,
        ["-e", "for (let i = 0; i < 2048; i += 1) process.stdout.write('x'.repeat(1024))"],
        AbortSignal.timeout(5_000),
      ),
    ).resolves.toBeUndefined();
  });

  it("失败只携带有界 stderr 尾部", async () => {
    await expect(
      runBuildCommand(
        process.execPath,
        ["-e", "process.stderr.write('a'.repeat(128 * 1024) + 'TAIL'); process.exit(7)"],
        new AbortController().signal,
      ),
    ).rejects.toThrow(/failed \(7\): a+TAIL$/);
  });
});

describe("Dockerfile managed profile 路由", () => {
  it("cache lookup 与 build 都使用 profile descriptor 指定的 Docker socket", async () => {
    const contextDir = await mkdtemp(join(tmpdir(), "niceeval-profile-build-"));
    try {
      await writeFile(join(contextDir, "Dockerfile"), "FROM scratch\n");
      const expected = await resolveDockerfileBuildIdentity({
        provider: "docker",
        context: contextDir,
        platform: "linux/amd64",
      });
      const socket = "/run/user/1000/niceeval/default/docker.sock";
      const collection = await collectDockerfileBuildFromIdentity({
        provider: "docker",
        profile: "default",
        context: { _tag: "Path", value: contextDir },
        dockerfile: "Dockerfile",
        buildArgs: {},
        platform: "linux/amd64",
        expected,
        dockerSocketPath: socket,
      });
      const observed: string[] = [];
      const provider = dockerfileBuildProvider([collection], {
        dockerImageExists: async (_tag, dockerSocketPath) => {
          observed.push(`lookup:${dockerSocketPath}`);
          return false;
        },
        runDockerBuild: async (details) => {
          observed.push(`build:${details.dockerSocketPath}`);
        },
      });

      await expect(provider.lookup(collection.work, new AbortController().signal)).resolves.toBeUndefined();
      await provider.build(collection.work, {} as Parameters<typeof provider.build>[1]);

      expect(observed).toEqual([`lookup:${socket}`, `build:${socket}`]);
    } finally {
      await rm(contextDir, { recursive: true, force: true });
    }
  });
});
