// cases: docs/engineering/testing/unit/experiments-runner.md
// 「Testkit 自动打包与内容寻址」类别：本地默认入口对当前 workspace Testkit
// 每 invocation 恰好 clean build + pack 一次；显式 run --testkit 绝不 repack
// （只消费给定字节）；tgz 重命名为内容寻址文件名；durable artifact 物化幂等；
// 声明但未注入的 harness consumer 在 test 前失败。断言面是文件字节、调用次数
// 与收据字段，不读 Testkit 内部源码来判断场景。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { DiscoveredRepo } from "../../../e2e/scripts/discovery.ts";
import { readTestkitTarball } from "../../../e2e/scripts/injection.ts";
import {
  buildTestkitTarball,
  ensureTestkitForHarnessConsumers,
  materializeTestkitArtifact,
  testkitTarballFileName,
} from "../../../e2e/scripts/testkit.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "e2e-testkit-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fake Testkit package dir: package.json with the required identity. */
function writeFakeTestkitPkg(repoRoot: string, name = "@niceeval/testkit"): string {
  const pkgDir = join(repoRoot, "packages", "testkit");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "0.1.0-test", type: "module" }, null, 2) + "\n",
  );
  writeFileSync(join(pkgDir, "dist", "index.js"), "export {};\n");
  return pkgDir;
}

/** Create a real npm tgz so identity verification exercises the actual format. */
function packFakeTestkit(pkgDir: string, destDir: string): string {
  mkdirSync(destDir, { recursive: true });
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", destDir], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
  const result = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
  const fileName = result[0]?.filename;
  if (!fileName) throw new Error("npm pack produced no .tgz filename");
  return join(destDir, fileName);
}

describe("Testkit clean build + pack once", () => {
  it("每 invocation 恰好 build 一次、pack 一次,dist 在 build 前被删除", async () => {
    await withTempDir(async (dir) => {
      const repoRoot = join(dir, "root");
      const pkgDir = writeFakeTestkitPkg(repoRoot);
      const destDir = join(dir, "packed");
      const build = vi.fn(async (pkg: string): Promise<number> => {
        // dist 必须先被删除:build 观察到的 pkgDir 没有 dist 残留。
        expect(existsSync(join(pkg, "dist"))).toBe(false);
        mkdirSync(join(pkg, "dist"), { recursive: true });
        writeFileSync(join(pkg, "dist", "index.js"), "export {};\n");
        return 0;
      });
      const pack = vi.fn(async (pkg: string, dest: string): Promise<number> => {
        packFakeTestkit(pkg, dest);
        return 0;
      });

      const testkit = await buildTestkitTarball(repoRoot, destDir, { buildTestkit: build, packTestkit: pack });
      const bytes = readFileSync(testkit.path);

      expect(build).toHaveBeenCalledTimes(1);
      expect(build).toHaveBeenCalledWith(pkgDir);
      expect(pack).toHaveBeenCalledTimes(1);
      expect(pack).toHaveBeenCalledWith(pkgDir, destDir);
      expect(testkit.name).toBe("@niceeval/testkit");
      expect(testkit.version).toBe("0.1.0-test");
      expect(testkit.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      // 内容寻址文件名 == tgz 自身字节的 sha256。
      expect(testkit.path).toBe(join(destDir, testkitTarballFileName(testkit.sha256)));
      expect(existsSync(testkit.path)).toBe(true);
      expect(readFileSync(testkit.path)).toEqual(bytes);
    });
  });

  it("build 或 pack 非零退出时抛错,不产出收据", async () => {
    await withTempDir(async (dir) => {
      const repoRoot = join(dir, "root");
      writeFakeTestkitPkg(repoRoot);
      const destDir = join(dir, "packed");

      await expect(
        buildTestkitTarball(repoRoot, destDir, {
          buildTestkit: async () => 1,
          packTestkit: async () => 0,
        }),
      ).rejects.toThrow(/clean build failed \(exit 1\)/);

      await expect(
        buildTestkitTarball(repoRoot, destDir, {
          buildTestkit: async () => 0,
          packTestkit: async () => 7,
        }),
      ).rejects.toThrow(/pack failed \(exit 7\)/);
    });
  });

  it("pack 产出超过一个 tgz 时拒绝(只能 pack 一次、只认一个产物)", async () => {
    await withTempDir(async (dir) => {
      const repoRoot = join(dir, "root");
      writeFakeTestkitPkg(repoRoot);
      const destDir = join(dir, "packed");

      await expect(
        buildTestkitTarball(repoRoot, destDir, {
          buildTestkit: async () => 0,
          packTestkit: async (_pkg, dest) => {
            writeFileSync(join(dest, "a.tgz"), "a");
            writeFileSync(join(dest, "b.tgz"), "b");
            return 0;
          },
        }),
      ).rejects.toThrow(/expected exactly one \.tgz/);
    });
  });

  it("packages/testkit/package.json 的 name 不是 @niceeval/testkit 时按身份拒绝", async () => {
    await withTempDir(async (dir) => {
      const repoRoot = join(dir, "root");
      writeFakeTestkitPkg(repoRoot);
      const destDir = join(dir, "packed");
      const testkit = await buildTestkitTarball(repoRoot, destDir, {
        buildTestkit: async () => 0,
        packTestkit: async (pkg, dest) => {
          packFakeTestkit(pkg, dest);
          return 0;
        },
      });
      expect(testkit.name).toBe("@niceeval/testkit");

      // 包名与目录名不符 → 身份错误,绝不静默接受(整包非 testkit 身份由
      // readTestkitTarball 的 package/package.json 校验覆盖,见 run-repo 测试)。
      const badRoot = join(dir, "bad-root");
      writeFakeTestkitPkg(badRoot, "some-other-package");
      await expect(buildTestkitTarball(badRoot, join(dir, "packed2"))).rejects.toThrow(
        /name must be "@niceeval\/testkit"/,
      );
    });
  });
});

describe("durable testkit artifact 物化", () => {
  it("按内容寻址名复制进 artifactRoot/testkit/ 并重算 sha256", async () => {
    await withTempDir(async (dir) => {
      const pkgDir = writeFakeTestkitPkg(join(dir, "source-root"));
      const source = packFakeTestkit(pkgDir, join(dir, "source-pack"));
      const bytes = readFileSync(source);
      const testkit = await readTestkitTarball(source);

      const artifactRoot = join(dir, "artifacts");
      const durable = await materializeTestkitArtifact(artifactRoot, testkit);

      expect(durable.path).toBe(join(artifactRoot, "testkit", testkitTarballFileName(testkit.sha256)));
      expect(durable.sha256).toBe(testkit.sha256);
      expect(readFileSync(durable.path)).toEqual(bytes);
    });
  });

  it("同一 digest 幂等复用,不重复拷贝;不同 digest 则覆盖", async () => {
    await withTempDir(async (dir) => {
      const artifactRoot = join(dir, "artifacts");
      const source = packFakeTestkit(writeFakeTestkitPkg(join(dir, "v1-root")), join(dir, "v1-pack"));
      const bytes = readFileSync(source);
      const first = await materializeTestkitArtifact(artifactRoot, await readTestkitTarball(source));
      const target = first.path;
      const mtime = existsSync(target) ? readFileSync(target) : null;

      // 同一 tgz 再物化一次:文件被复用(内容不变)。
      const second = await materializeTestkitArtifact(artifactRoot, await readTestkitTarball(source));
      expect(second.path).toBe(target);
      expect(readFileSync(target)).toEqual(bytes);
      expect(mtime).toEqual(readFileSync(target));

      // 不同 digest 的内容寻址文件互不干扰。
      const otherPkg = writeFakeTestkitPkg(join(dir, "v2-root"));
      writeFileSync(join(otherPkg, "dist", "index.js"), "export const second = true;\n");
      const otherSource = packFakeTestkit(otherPkg, join(dir, "v2-pack"));
      const otherBytes = readFileSync(otherSource);
      const other = await materializeTestkitArtifact(
        artifactRoot,
        await readTestkitTarball(otherSource),
      );
      expect(other.path).not.toBe(target);
      expect(readFileSync(other.path)).toEqual(otherBytes);
    });
  });

  it("已存在但 digest 不符的文件被覆盖重写", async () => {
    await withTempDir(async (dir) => {
      const artifactRoot = join(dir, "artifacts");
      const source = packFakeTestkit(writeFakeTestkitPkg(join(dir, "real-root")), join(dir, "real-pack"));
      const bytes = readFileSync(source);
      const testkit = await readTestkitTarball(source);

      const corrupt = join(artifactRoot, "testkit", testkitTarballFileName(testkit.sha256));
      mkdirSync(join(artifactRoot, "testkit"), { recursive: true });
      writeFileSync(corrupt, "corrupted bytes");

      const durable = await materializeTestkitArtifact(artifactRoot, testkit);
      expect(durable.sha256).toBe(testkit.sha256);
      expect(readFileSync(durable.path)).toEqual(bytes);
    });
  });
});

describe("harness consumer pre-flight guard", () => {
  function repo(id: string, harnessTestkit: boolean): DiscoveredRepo {
    return {
      dir: `/checkout/e2e/${id}`,
      manifest: {
        schemaVersion: 1,
        id,
        areas: ["runner"],
        lanes: ["pr"],
        executor: { kind: "host" },
        command: ["pnpm", "e2e"],
        timeoutMinutes: 10,
        secrets: [],
        paths: [],
        artifacts: [],
        ...(harnessTestkit ? { harness: { testkit: true } } : {}),
      },
    };
  }

  it("选中 harness.testkit: true 的 repo 却没有 tgz 时,test 前整批失败", () => {
    const errors = ensureTestkitForHarnessConsumers(
      [repo("plain", false), repo("consumer", true)],
      undefined,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("consumer");
    expect(errors[0]).toContain("--testkit");
  });

  it("有 tgz 或没有 consumer 时不做任何拦截", () => {
    const testkit = {
      path: "/tmp/niceeval-testkit-abc.tgz",
      integrity: "sha512-abc",
      shortHash: "abc",
      sha256: "abc",
      name: "@niceeval/testkit",
      version: "0.1.0",
    };
    expect(ensureTestkitForHarnessConsumers([repo("consumer", true)], testkit)).toEqual([]);
    expect(ensureTestkitForHarnessConsumers([repo("plain", false)], undefined)).toEqual([]);
    expect(ensureTestkitForHarnessConsumers([], undefined)).toEqual([]);
  });
});
