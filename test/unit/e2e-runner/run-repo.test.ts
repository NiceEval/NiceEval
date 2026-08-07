// Runner receipt / cleanup contracts: external temp copy, artifacts outside
// the source repo, staged receipts, cleanup even on failure. Real temp dirs
// and small fixtures — not call-order spies.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  collectArtifacts,
  repoArtifactDir,
  repoReceiptPath,
} from "../../../e2e/scripts/artifacts.ts";
import {
  extractTestkitIntegrity,
  readCandidateTarball,
  readTestkitTarball,
  verifyTestkitLockResolution,
} from "../../../e2e/scripts/injection.ts";
import {
  checkTestkitSourceClean,
  injectTestkitTarball,
  scanForTestkitImports,
} from "../../../e2e/scripts/testkit.ts";
import { classifyFromReceipt, type StageReceipt } from "../../../e2e/scripts/receipt.ts";
import { buildSummary } from "../../../e2e/scripts/run.ts";
import {
  appendNativeArgs,
  copyRepoIsolated,
  pointAtCandidateTarball,
  runCommand,
  runRepo,
  type RepoRunResult,
} from "../../../e2e/scripts/run-repo.ts";
import type { DiscoveredRepo } from "../../../e2e/scripts/discovery.ts";
import type { E2ERepoManifest } from "../../../e2e/scripts/manifest.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "e2e-run-repo-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fingerprintTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full, rel);
      else {
        const st = statSync(full);
        out.set(rel, `${st.size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(root, "");
  return out;
}

/** Minimal installable niceeval tarball (real file on disk). */
function writeMinimalCandidate(dir: string): string {
  const pkgDir = join(dir, "niceeval-pkg");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "niceeval", version: "0.0.0-test", type: "module" }, null, 2) + "\n",
  );
  writeFileSync(join(pkgDir, "index.js"), "export default {};\n");
  const packed = spawnSync("npm", ["pack", "--pack-destination", dir], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
  }
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack produced no .tgz");
  return join(dir, tgz);
}

/** Minimal installable @niceeval/testkit tarball (real file on disk). */
function writeMinimalTestkit(
  dir: string,
  opts: { name?: string; internalFiles?: Record<string, string> } = {},
): string {
  const pkgDir = join(dir, "testkit-pkg");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: opts.name ?? "@niceeval/testkit",
        version: "0.0.0-test",
        type: "module",
        main: "./dist/index.js",
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(pkgDir, "dist", "index.js"), "export {};\n");
  for (const [rel, content] of Object.entries(opts.internalFiles ?? {})) {
    const p = join(pkgDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", dir], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
  }
  const results = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
  const filename = results[0]?.filename;
  if (!filename) throw new Error("npm pack produced no .tgz filename");
  return join(dir, filename);
}

function writeFixtureRepo(
  root: string,
  opts: {
    id: string;
    command: readonly [string, ...string[]];
    artifacts?: readonly string[];
    executor?: E2ERepoManifest["executor"];
    timeoutMinutes?: number;
    /** e2e.json declares harness.testkit: true (injection intent). */
    harnessTestkit?: boolean;
  },
): DiscoveredRepo {
  mkdirSync(root, { recursive: true });
  const pkg: Record<string, unknown> = {
    name: `fixture-${opts.id}`,
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { niceeval: "0.0.0-test" },
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  // Seed a pre-existing marker that must never be modified by the runner.
  writeFileSync(join(root, "SOURCE_MARKER.txt"), "source-unchanged\n");
  const manifest: E2ERepoManifest = {
    schemaVersion: 1,
    id: opts.id,
    areas: ["cli"],
    lanes: ["pr"],
    executor: opts.executor ?? { kind: "host" },
    command: opts.command,
    timeoutMinutes: opts.timeoutMinutes ?? 2,
    secrets: [],
    paths: ["**"],
    artifacts: opts.artifacts ?? ["logs/**", ".niceeval/**"],
    ...(opts.harnessTestkit === undefined ? {} : { harness: { testkit: opts.harnessTestkit } }),
  };
  writeFileSync(join(root, "e2e.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { dir: root, manifest };
}

describe("external artifacts and zero source writes", () => {
  it("collectArtifacts writes only under the external dest, never the source tree", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const copy = join(dir, "copy");
      const external = join(dir, "artifacts", "fixture-a");
      mkdirSync(join(copy, "logs"), { recursive: true });
      mkdirSync(join(copy, ".niceeval"), { recursive: true });
      writeFileSync(join(copy, "logs", "run.log"), "log-body\n");
      writeFileSync(join(copy, ".niceeval", "trace.json"), "{\"diagnostic\":true}\n");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SOURCE_MARKER.txt"), "source-unchanged\n");
      const before = fingerprintTree(source);

      const result = await collectArtifacts(copy, external, ["logs/**", ".niceeval/**"]);

      expect(result.collected.sort()).toEqual([".niceeval", "logs"]);
      expect(existsSync(join(external, "logs", "run.log"))).toBe(true);
      expect(existsSync(join(external, ".niceeval", "trace.json"))).toBe(true);
      expect(existsSync(join(source, "logs"))).toBe(false);
      expect(existsSync(join(source, ".niceeval"))).toBe(false);
      expect(fingerprintTree(source)).toEqual(before);
      // diagnostic copy is bytes only — runner never reads it for verdict
      expect(readFileSync(join(external, ".niceeval", "trace.json"), "utf8")).toContain("diagnostic");
    });
  });

  it("isolated copy mutates package.json only inside the copy", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const copy = join(dir, "copy");
      const tarball = writeMinimalCandidate(dir);
      writeFixtureRepo(source, { id: "pkg-mut", command: ["node", "-e", "process.exit(0)"] });
      const before = fingerprintTree(source);

      await copyRepoIsolated(source, copy);
      await pointAtCandidateTarball(copy, tarball);

      const copyPkg = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")) as {
        dependencies: { niceeval: string };
      };
      expect(copyPkg.dependencies.niceeval).toBe(`file:${tarball}`);
      expect(fingerprintTree(source)).toEqual(before);
    });
  });
});

describe("local Testkit tarball injection", () => {
  it("injectTestkitTarball 只在隔离副本新增 file: devDependency 与内容寻址 tgz", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const copy = join(dir, "copy");
      const tarball = await readTestkitTarball(writeMinimalTestkit(dir));
      writeFixtureRepo(source, { id: "tk-mut", command: ["node", "-e", "process.exit(0)"] });
      const before = fingerprintTree(source);

      await copyRepoIsolated(source, copy);
      await injectTestkitTarball(copy, tarball);

      const copyPkg = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")) as {
        devDependencies: { "@niceeval/testkit": string };
      };
      const fileName = `niceeval-testkit-${tarball.sha256}.tgz`;
      expect(copyPkg.devDependencies["@niceeval/testkit"]).toBe(`file:./${fileName}`);
      expect(existsSync(join(copy, fileName))).toBe(true);
      expect(readFileSync(join(copy, fileName))).toEqual(readFileSync(tarball.path));
      expect(fingerprintTree(source)).toEqual(before);
    });
  });

  it("checkTestkitSourceClean 拒绝源 package.json 声明 Testkit 与源 lock 的 Testkit/workspace:/file:", async () => {
    await withTempDir(async (dir) => {
      const dirty = join(dir, "dirty");
      writeFixtureRepo(dirty, { id: "dirty", command: ["node", "-e", "process.exit(0)"] });
      const pkg = JSON.parse(readFileSync(join(dirty, "package.json"), "utf8")) as Record<string, unknown>;
      pkg.devDependencies = { "@niceeval/testkit": "0.1.0" };
      writeFileSync(join(dirty, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
      const lock = join(dirty, "pnpm-lock.yaml");
      writeFileSync(
        lock,
        [
          "lockfileVersion: '9.0'",
          "  '@niceeval/testkit@0.1.0':",
          "    resolution: {integrity: sha512-ABC==}",
          "  x@1.0.0:",
          "    resolution: {integrity: sha512-XYZ==}",
        ].join("\n") + "\n",
      );

      const violations = checkTestkitSourceClean(dirty);
      expect(violations.some((v) => v.includes('"@niceeval/testkit"'))).toBe(true);
      expect(violations.some((v) => v.includes("pnpm-lock.yaml") && v.includes("testkit"))).toBe(true);

      const workspaceOnly = join(dir, "workspace-only");
      writeFixtureRepo(workspaceOnly, { id: "ws-only", command: ["node", "-e", "process.exit(0)"] });
      writeFileSync(
        join(workspaceOnly, "pnpm-lock.yaml"),
        ["lockfileVersion: '9.0'", "  foo@workspace:*:", "    resolution: {directory: foo, type: directory}"].join("\n") + "\n",
      );
      const wsViolations = checkTestkitSourceClean(workspaceOnly);
      expect(wsViolations.some((v) => v.includes("workspace:"))).toBe(true);

      const fileOnly = join(dir, "file-only");
      writeFixtureRepo(fileOnly, { id: "file-only", command: ["node", "-e", "process.exit(0)"] });
      writeFileSync(
        join(fileOnly, "pnpm-lock.yaml"),
        ["lockfileVersion: '9.0'", "  bar@file:../vendor/bar:", "    resolution: {directory: ../vendor/bar, type: directory}"].join("\n") + "\n",
      );
      const fileViolations = checkTestkitSourceClean(fileOnly);
      expect(fileViolations.some((v) => v.includes("file:"))).toBe(true);

      const clean = join(dir, "clean");
      writeFixtureRepo(clean, { id: "clean", command: ["node", "-e", "process.exit(0)"] });
      expect(checkTestkitSourceClean(clean)).toEqual([]);
    });
  });

  it("scanForTestkitImports 只命中 import 形态,跳过 package.json/lock 与排除目录", async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, "repo");
      writeFixtureRepo(root, { id: "scan", command: ["node", "-e", "process.exit(0)"] });
      mkdirSync(join(root, "test"), { recursive: true });
      writeFileSync(
        join(root, "test", "uses.test.ts"),
        'import { runProcess } from "@niceeval/testkit";\n',
      );
      mkdirSync(join(root, "test", "nested"), { recursive: true });
      writeFileSync(
        join(root, "test", "nested", "dyn.mts"),
        'const tk = await import("@niceeval/testkit");\n',
      );
      writeFileSync(join(root, "README.md"), "from \"@niceeval/testkit\" 只是一段说明文字\n");
      writeFileSync(join(root, "package.json"), '{"dependencies":{"@niceeval/testkit":"0.1.0"}}\n');
      mkdirSync(join(root, "node_modules", "@niceeval", "testkit"), { recursive: true });
      writeFileSync(join(root, "node_modules", "@niceeval", "testkit", "index.js"), 'from "@niceeval/testkit"\n');

      const matches = scanForTestkitImports(root);
      expect(matches).toEqual(["test/nested/dyn.mts", "test/uses.test.ts"]);
    });
  });

  it("readTestkitTarball verifies npm identity and sha256 without reading Testkit internals", async () => {
    await withTempDir(async (dir) => {
      const tarball = writeMinimalTestkit(dir, {
        internalFiles: {
          "src/internal.ts": "// arbitrary internal layout\n",
          "dist/esm/index.js": "export {};\n",
        },
      });
      const bytes = readFileSync(tarball);
      const testkit = await readTestkitTarball(tarball);

      expect(testkit.path).toBe(resolve(tarball));
      expect(testkit.name).toBe("@niceeval/testkit");
      expect(testkit.version).toBe("0.0.0-test");
      expect(testkit.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(testkit.integrity).toBe(`sha512-${createHash("sha512").update(bytes).digest("base64")}`);

      // A completely different internal layout must not change identity: the
      // runner only reads the npm identity, never Testkit source files.
      const relaidDir = join(dir, "relaid");
      const relaid = writeMinimalTestkit(relaidDir, {
        internalFiles: { "lib/other/index.mjs": "export {};\n" },
      });
      const relaidBytes = readFileSync(relaid);
      const again = await readTestkitTarball(relaid);
      expect(again.name).toBe("@niceeval/testkit");
      expect(again.sha256).toBe(createHash("sha256").update(relaidBytes).digest("hex"));
    });
  });

  it("a tarball that is not @niceeval/testkit is rejected by identity", async () => {
    await withTempDir(async (dir) => {
      const wrong = writeMinimalTestkit(dir, { name: "some-other-package" });
      await expect(readTestkitTarball(wrong)).rejects.toThrow(/@niceeval\/testkit/);
    });
  });

  it("extractTestkitIntegrity requires exactly one injected testkit lockfile entry", () => {
    const ok =
      "  @niceeval/testkit@file:/tmp/tk.tgz:\n    resolution: {integrity: sha512-ABC==}\n";
    expect(extractTestkitIntegrity(ok)).toBe("sha512-ABC==");
    expect(() =>
      extractTestkitIntegrity("  other-pkg@1.0.0:\n    resolution: {integrity: sha512-XYZ==}\n"),
    ).toThrow(/@niceeval\/testkit/);
    const two =
      ok +
      "  @niceeval/testkit@file:/tmp/tk2.tgz:\n    resolution: {integrity: sha512-DEF==}\n";
    expect(() => extractTestkitIntegrity(two)).toThrow(/expected exactly one/);
  });

  it("verifyTestkitLockResolution 校验唯一 resolution、包名与 SRI 一致", () => {
    const ok =
      "  '@niceeval/testkit@file:./niceeval-testkit-abc.tgz':\n    resolution: {integrity: sha512-ABC==}\n";
    expect(verifyTestkitLockResolution(ok, "sha512-ABC==")).toEqual({
      ok: true,
      key: "@niceeval/testkit@file:./niceeval-testkit-abc.tgz",
      integrity: "sha512-ABC==",
    });
    // SRI 与注入字节不一致 → harness failure。
    expect(verifyTestkitLockResolution(ok, "sha512-XYZ==")).toMatchObject({ ok: false });
    // 零 entry / 多个 entry / 非 testkit key 都拒绝。
    expect(verifyTestkitLockResolution("  other@1.0.0:\n    resolution: {integrity: sha512-XYZ==}\n", "sha512-ABC==")).toMatchObject({ ok: false });
    const two = ok + "  '@niceeval/testkit@file:./tk2.tgz':\n    resolution: {integrity: sha512-DEF==}\n";
    expect(verifyTestkitLockResolution(two, "sha512-ABC==")).toMatchObject({ ok: false });
  });
});

describe("runRepo receipts, external artifacts, cleanup", () => {
  it("passing command: source zero writes, artifacts outside scratch, copy removed, receipt durable", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const tarball = writeMinimalCandidate(dir);
      const candidate = readCandidateTarball(tarball);

      const repo = writeFixtureRepo(source, {
        id: "pass-repo",
        command: [
          "node",
          "-e",
          "const fs=require('fs');fs.mkdirSync('logs',{recursive:true});fs.writeFileSync('logs/out.txt','ok');fs.mkdirSync('.niceeval',{recursive:true});fs.writeFileSync('.niceeval/d.json','{}');",
        ],
        artifacts: ["logs/**", ".niceeval/**"],
      });
      const before = fingerprintTree(source);

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), []);

      expect(fingerprintTree(source)).toEqual(before);
      expect(existsSync(join(scratch, "runs", "pass-repo"))).toBe(false);
      expect(result.artifactDir).toBe(repoArtifactDir(artifactRoot, "pass-repo"));
      expect(result.receiptPath).toBe(repoReceiptPath(artifactRoot, "pass-repo"));
      // Artifacts live only under independent artifactRoot — not under scratch.
      expect(result.artifactDir.startsWith(artifactRoot)).toBe(true);
      expect(result.artifactDir.startsWith(scratch)).toBe(false);
      expect(existsSync(join(scratch, "artifacts"))).toBe(false);
      expect(existsSync(join(result.artifactDir, "logs", "out.txt"))).toBe(true);
      expect(existsSync(join(result.artifactDir, ".niceeval", "d.json"))).toBe(true);
      expect(existsSync(join(source, "logs"))).toBe(false);
      expect(existsSync(join(source, ".niceeval"))).toBe(false);

      // Simulating main's finally: wipe scratch; durable artifactRoot must remain.
      rmSync(scratch, { recursive: true, force: true });
      expect(existsSync(join(result.artifactDir, "logs", "out.txt"))).toBe(true);
      expect(existsSync(result.receiptPath)).toBe(true);
      const written = JSON.parse(readFileSync(result.receiptPath, "utf8")) as {
        repoId: string;
        artifactDir: string;
        receiptPath: string;
        category: string;
        stages: Array<{ stage: string; ok: boolean }>;
      };
      expect(written.repoId).toBe("pass-repo");
      expect(written.artifactDir).toBe(result.artifactDir);
      expect(written.receiptPath).toBe(result.receiptPath);
      expect(written.category).toBe("pass");
      // ① Final on-disk receipt must include cleanup after working-copy removal.
      const writtenStages = written.stages.map((s) => s.stage);
      expect(writtenStages).toEqual(["prepare", "install", "injection", "test", "collect", "cleanup"]);
      expect(written.stages.find((s) => s.stage === "cleanup")?.ok).toBe(true);

      const stageNames = result.receipt.stages.map((s) => s.stage);
      expect(stageNames).toEqual(writtenStages);
      expect(result.category).toBe("pass");
      expect(result.exitCode).toBe(0);

      // Summary surfaces absolute receipt paths for workflow upload.
      const summary = buildSummary(artifactRoot, [result]);
      expect(summary.results[0]?.receiptPath).toBe(result.receiptPath);
      expect(summary.results[0]?.artifactDir).toBe(result.artifactDir);
      expect(summary.artifactRoot).toBe(artifactRoot);
    });
  }, 120_000);

  it("failing command: still cleans the copy, keeps failure capture, source untouched", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const tarball = writeMinimalCandidate(dir);
      const candidate = readCandidateTarball(tarball);

      const repo = writeFixtureRepo(source, {
        id: "fail-repo",
        command: [
          "node",
          "-e",
          "const fs=require('fs');fs.mkdirSync('logs',{recursive:true});fs.writeFileSync('logs/fail.txt','boom');console.error('FAIL_LINE');process.exit(7);",
        ],
        artifacts: ["logs/**"],
      });
      const before = fingerprintTree(source);

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), []);

      expect(fingerprintTree(source)).toEqual(before);
      expect(existsSync(join(scratch, "runs", "fail-repo"))).toBe(false);
      expect(existsSync(join(result.artifactDir, "logs", "fail.txt"))).toBe(true);
      expect(existsSync(join(source, "logs"))).toBe(false);
      expect(result.artifactDir.startsWith(scratch)).toBe(false);
      expect(existsSync(result.receiptPath)).toBe(true);

      expect(result.category).toBe("regression");
      expect(result.exitCode).toBe(7);
      const testStage = result.receipt.stages.find((s) => s.stage === "test");
      expect(testStage?.ok).toBe(false);
      expect(testStage?.capture?.exitCode).toBe(7);
      expect(testStage?.capture?.stderr).toContain("FAIL_LINE");
      expect(result.receipt.stages.find((s) => s.stage === "cleanup")?.ok).toBe(true);
    });
  }, 120_000);

  it("non-host executor is unsupported without touching the source", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const tarball = writeMinimalCandidate(dir);
      const candidate = readCandidateTarball(tarball);
      const repo = writeFixtureRepo(source, {
        id: "docker-repo",
        command: ["node", "-e", "process.exit(0)"],
        executor: { kind: "docker", image: "node:22" },
      });
      const before = fingerprintTree(source);

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), []);

      expect(fingerprintTree(source)).toEqual(before);
      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/unsupported/i);
      expect(existsSync(join(scratch, "runs", "docker-repo"))).toBe(false);
      expect(existsSync(result.receiptPath)).toBe(true);
      expect(result.receiptPath.startsWith(artifactRoot)).toBe(true);
      const written = JSON.parse(readFileSync(result.receiptPath, "utf8")) as {
        stages: Array<{ stage: string }>;
      };
      expect(written.stages.map((s) => s.stage)).toContain("install");
    });
  });

  it("③ injection failure skips test; still writes final receipt with cleanup", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const tarball = writeMinimalCandidate(dir);
      const good = readCandidateTarball(tarball);
      // Integrity mismatch → injection fails; candidate is unproven.
      const badCandidate = {
        ...good,
        integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      };

      const marker = join(dir, "test-ran.marker");
      const repo = writeFixtureRepo(source, {
        id: "inj-fail",
        command: [
          "node",
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(0)`,
        ],
        artifacts: ["logs/**"],
      });

      const result = await runRepo(repo, badCandidate, scratch, artifactRoot, new Set(), []);

      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/injection/i);
      expect(existsSync(marker)).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "test")).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "collect")).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "injection")?.ok).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "cleanup")?.ok).toBe(true);
      expect(existsSync(result.receiptPath)).toBe(true);
      const onDisk = JSON.parse(readFileSync(result.receiptPath, "utf8")) as {
        stages: Array<{ stage: string; ok: boolean }>;
        category: string;
      };
      expect(onDisk.category).toBe("infra");
      expect(onDisk.stages.map((s) => s.stage)).toEqual(["prepare", "install", "injection", "cleanup"]);
      expect(existsSync(join(scratch, "runs", "inj-fail"))).toBe(false);
    });
  }, 120_000);

  it("显式注入 testkit 通过:prepare 声明、注入、唯一 resolution、安装路径与收据齐全", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(
        writeMinimalTestkit(dir, { internalFiles: { "src/any-layout.ts": "// refactorable internals\n" } }),
      );
      const repo = writeFixtureRepo(source, {
        id: "tk-pass",
        command: ["node", "-e", "process.exit(0)"],
        harnessTestkit: true,
      });
      const before = fingerprintTree(source);

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], testkit);

      expect(fingerprintTree(source)).toEqual(before);
      expect(result.category).toBe("pass");
      expect(result.exitCode).toBe(0);
      const prepare = result.receipt.stages.find((s) => s.stage === "prepare");
      expect(prepare?.ok).toBe(true);
      expect(prepare?.detail).toContain("harness.testkit declared");
      const injection = result.receipt.stages.find((s) => s.stage === "injection");
      expect(injection?.ok).toBe(true);
      expect(injection?.detail).toContain("testkit tarball");
      expect(injection?.detail).toContain(testkit.sha256);
      expect(injection?.detail).toContain("@niceeval/testkit");
      expect(result.receipt.stages.find((s) => s.stage === "test")?.ok).toBe(true);

      // Receipt 保存 version(诊断)/sha256/SRI/resolved path/durable artifact 相对路径/复现命令。
      const tk = result.receipt.testkit;
      expect(tk).toBeDefined();
      expect(tk?.version).toBe("0.0.0-test");
      expect(tk?.sha256).toBe(testkit.sha256);
      expect(tk?.integrity).toBe(testkit.integrity);
      expect(tk?.resolvedPath).toBe(join(scratch, "runs", "tk-pass", "node_modules", "@niceeval", "testkit"));
      const candidateArtifact = join(artifactRoot, "candidate", `niceeval-candidate-${candidate.sha256}.tgz`);
      const testkitArtifact = join(artifactRoot, "testkit", `niceeval-testkit-${testkit.sha256}.tgz`);
      expect(tk?.artifactPath).toBe(relative(artifactRoot, testkitArtifact));
      expect(tk?.candidateArtifactPath).toBe(relative(artifactRoot, candidateArtifact));
      expect(tk?.reproduce).toContain("--testkit");
      expect(tk?.reproduce).toContain(candidateArtifact);
      expect(tk?.reproduce).toContain(testkitArtifact);
      expect(tk?.reproduce).toContain("--repo tk-pass");
      expect(tk?.exactReplay).toBe(true);
      expect(existsSync(candidateArtifact)).toBe(true);
      expect(existsSync(testkitArtifact)).toBe(true);

      const onDisk = JSON.parse(readFileSync(result.receiptPath, "utf8")) as {
        stages: Array<{ stage: string }>;
        testkit: { sha256: string; artifactPath: string };
      };
      expect(onDisk.stages.map((s) => s.stage)).toEqual([
        "prepare",
        "install",
        "injection",
        "test",
        "collect",
        "cleanup",
      ]);
      expect(onDisk.testkit.sha256).toBe(testkit.sha256);
    });
  }, 120_000);

  it("testkit integrity mismatch fails injection → infra, test never runs", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(writeMinimalTestkit(dir));
      const badTestkit = {
        ...testkit,
        integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      };
      const marker = join(dir, "tk-test-ran.marker");
      const repo = writeFixtureRepo(source, {
        id: "tk-mismatch",
        command: [
          "node",
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(0)`,
        ],
        harnessTestkit: true,
      });

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], badTestkit);

      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/injection/i);
      expect(existsSync(marker)).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "test")).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "injection")?.ok).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "cleanup")?.ok).toBe(true);
    });
  }, 120_000);

  it("candidate 或 Testkit 不再位于 durable artifact root 时绝不声称 exact replay", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(writeMinimalTestkit(dir));
      const candidateArtifact = join(artifactRoot, "candidate", `niceeval-candidate-${candidate.sha256}.tgz`);
      const testkitArtifact = join(artifactRoot, "testkit", `niceeval-testkit-${testkit.sha256}.tgz`);
      const repo = writeFixtureRepo(source, {
        id: "tk-no-replay",
        command: [
          "node",
          "-e",
          `require('fs').rmSync(${JSON.stringify(candidateArtifact)}); process.exit(0)`,
        ],
        harnessTestkit: true,
      });

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], testkit);

      expect(result.category).toBe("pass");
      expect(existsSync(candidateArtifact)).toBe(false);
      expect(existsSync(testkitArtifact)).toBe(true);
      expect(result.receipt.testkit?.reproduce).toContain(candidateArtifact);
      expect(result.receipt.testkit?.reproduce).toContain(testkitArtifact);
      expect(result.receipt.testkit?.exactReplay).toBe(false);
    });
  }, 120_000);

  it("声明了 harness.testkit 却没注入 tgz → prepare 失败,install/test 都不发生", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const marker = join(dir, "tk-declared-ran.marker");
      const repo = writeFixtureRepo(source, {
        id: "tk-declared",
        command: [
          "node",
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(0)`,
        ],
        harnessTestkit: true,
      });

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), []);

      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/declared/i);
      expect(result.detail).toMatch(/testkit/i);
      expect(existsSync(marker)).toBe(false);
      expect(result.receipt.stages.map((s) => s.stage)).toEqual(["prepare", "cleanup"]);
      expect(result.receipt.stages.find((s) => s.stage === "prepare")?.ok).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "install")).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "test")).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "cleanup")?.ok).toBe(true);
      expect(result.receipt.testkit).toBeUndefined();
    });
  }, 120_000);

  it("未声明 harness.testkit 却 import Testkit → prepare 失败,test 前停住", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(writeMinimalTestkit(dir));
      const marker = join(dir, "tk-import-ran.marker");
      const repo = writeFixtureRepo(source, {
        id: "tk-import",
        command: [
          "node",
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(0)`,
        ],
      });
      mkdirSync(join(source, "test"), { recursive: true });
      writeFileSync(join(source, "test", "uses.test.ts"), 'import { runProcess } from "@niceeval/testkit";\n');

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], testkit);

      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/without declaring harness\.testkit/i);
      expect(existsSync(marker)).toBe(false);
      expect(result.receipt.stages.find((s) => s.stage === "prepare")?.ok).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "install")).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "test")).toBe(false);
      expect(result.receipt.testkit).toBeUndefined();
    });
  }, 120_000);

  it("不消费 Testkit 的 repo 即使显式传了 tgz 也不注入、照常通过", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(writeMinimalTestkit(dir));
      const repo = writeFixtureRepo(source, {
        id: "tk-nonconsumer",
        command: ["node", "-e", "process.exit(0)"],
      });

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], testkit);

      expect(result.category).toBe("pass");
      expect(existsSync(join(scratch, "runs", "tk-nonconsumer"))).toBe(false);
      expect(result.receipt.testkit).toBeUndefined();
      expect(result.receipt.stages.find((s) => s.stage === "prepare")?.detail).toContain("no testkit declared");
    });
  }, 120_000);

  it("源 package.json 声明 @niceeval/testkit → prepare 失败(源污染)", async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, "source");
      const scratch = join(dir, "scratch");
      const artifactRoot = join(dir, "artifact-root");
      mkdirSync(scratch, { recursive: true });
      mkdirSync(artifactRoot, { recursive: true });
      const candidate = readCandidateTarball(writeMinimalCandidate(dir));
      const testkit = await readTestkitTarball(writeMinimalTestkit(dir));
      const repo = writeFixtureRepo(source, {
        id: "tk-src-dirty",
        command: ["node", "-e", "process.exit(0)"],
        harnessTestkit: true,
      });
      const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as Record<string, unknown>;
      pkg.devDependencies = { "@niceeval/testkit": "0.1.0" };
      writeFileSync(join(source, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

      const result = await runRepo(repo, candidate, scratch, artifactRoot, new Set(), [], testkit);

      expect(result.category).toBe("infra");
      expect(result.detail).toMatch(/source package\.json declares/i);
      expect(result.receipt.stages.find((s) => s.stage === "prepare")?.ok).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "install")).toBe(false);
      expect(result.receipt.stages.some((s) => s.stage === "test")).toBe(false);
    });
  }, 120_000);
});

describe("classifyFromReceipt: collect/cleanup affect pass", () => {
  function stages(partial: StageReceipt[]): StageReceipt[] {
    return partial;
  }

  const okTest: StageReceipt = {
    stage: "test",
    ok: true,
    capture: { exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "" },
    detail: "command exited 0",
  };
  const failTest: StageReceipt = {
    stage: "test",
    ok: false,
    capture: { exitCode: 7, signal: null, timedOut: false, stdout: "", stderr: "FAIL" },
    detail: "exit 7",
  };
  const okInstall: StageReceipt = { stage: "install", ok: true, detail: "pnpm install ok" };
  const okInjection: StageReceipt = { stage: "injection", ok: true, detail: "ok" };
  const okCollect: StageReceipt = { stage: "collect", ok: true, collected: [], detail: "none" };
  const failCollect: StageReceipt = { stage: "collect", ok: false, detail: "collect failed: EACCES" };
  const okCleanup: StageReceipt = { stage: "cleanup", ok: true, path: "/tmp/x", detail: "removed" };
  const failCleanup: StageReceipt = {
    stage: "cleanup",
    ok: false,
    path: "/tmp/x",
    detail: "cleanup failed for /tmp/x: EBUSY",
  };

  it("② test pass + cleanup fail → infra (not pass)", () => {
    const result = classifyFromReceipt({
      stages: stages([okInstall, okInjection, okTest, okCollect, failCleanup]),
      detail: "",
    });
    expect(result.category).toBe("infra");
    expect(result.detail).toMatch(/cleanup failed/);
  });

  it("② test pass + collect fail → infra (not pass)", () => {
    const result = classifyFromReceipt({
      stages: stages([okInstall, okInjection, okTest, failCollect, okCleanup]),
      detail: "",
    });
    expect(result.category).toBe("infra");
    expect(result.detail).toMatch(/collect failed/);
  });

  it("② test regression + cleanup fail keeps regression and attaches cleanup", () => {
    const result = classifyFromReceipt({
      stages: stages([okInstall, okInjection, failTest, okCollect, failCleanup]),
      detail: "",
    });
    expect(result.category).toBe("regression");
    expect(result.detail).toMatch(/exit 7/);
    expect(result.detail).toMatch(/cleanup failed/);
  });

  it("② test regression + collect fail keeps regression and attaches collect", () => {
    const result = classifyFromReceipt({
      stages: stages([okInstall, okInjection, failTest, failCollect, okCleanup]),
      detail: "",
    });
    expect(result.category).toBe("regression");
    expect(result.detail).toMatch(/exit 7/);
    expect(result.detail).toMatch(/collect failed/);
  });

  it("clean pass only when test+collect+cleanup all ok", () => {
    const result = classifyFromReceipt({
      stages: stages([okInstall, okInjection, okTest, okCollect, okCleanup]),
      detail: "",
    });
    expect(result).toEqual({ category: "pass", detail: "clean pass" });
  });

  it("injection failure alone is infra without needing test stage", () => {
    const result = classifyFromReceipt({
      stages: stages([
        okInstall,
        { stage: "injection", ok: false, detail: "injection verification failed: mismatch" },
        okCleanup,
      ]),
      detail: "",
    });
    expect(result.category).toBe("infra");
    expect(result.detail).toMatch(/injection verification failed/);
  });
});

describe("buildSummary surfaces receipt paths", () => {
  it("includes absolute artifactDir and receiptPath per repo", () => {
    const fake: RepoRunResult = {
      id: "cli",
      exitCode: 0,
      category: "pass",
      detail: "clean pass",
      attempts: 1,
      artifactDir: "/tmp/artifacts/cli",
      receiptPath: "/tmp/artifacts/cli/receipt.json",
      receipt: {
        repoId: "cli",
        artifactDir: "/tmp/artifacts/cli",
        receiptPath: "/tmp/artifacts/cli/receipt.json",
        stages: [],
        exitCode: 0,
        category: "pass",
        detail: "clean pass",
      },
    };
    const summary = buildSummary("/tmp/artifacts", [fake]);
    expect(summary.summaryPath).toBe("/tmp/artifacts/summary.json");
    expect(summary.results[0]).toMatchObject({
      id: "cli",
      artifactDir: "/tmp/artifacts/cli",
      receiptPath: "/tmp/artifacts/cli/receipt.json",
    });
  });
});

describe("native args and command capture helpers", () => {
  it("appendNativeArgs appends -- args once", () => {
    expect(appendNativeArgs(["pnpm", "e2e"], ["--run", "a.test.ts"])).toEqual([
      "pnpm",
      "e2e",
      "--run",
      "a.test.ts",
    ]);
  });

  it("runCommand retains stdout/stderr and timeout flag", async () => {
    await withTempDir(async (dir) => {
      const ok = await runCommand(["node", "-e", "console.log('OUT');console.error('ERR')"], dir, process.env, 10_000);
      expect(ok.exitCode).toBe(0);
      expect(ok.stdout).toContain("OUT");
      expect(ok.stderr).toContain("ERR");
      expect(ok.timedOut).toBe(false);

      const timed = await runCommand(
        ["node", "-e", "setTimeout(()=>{}, 60_000)"],
        dir,
        process.env,
        200,
      );
      expect(timed.timedOut).toBe(true);
      expect(timed.exitCode === null || timed.exitCode !== 0 || timed.signal !== null).toBe(true);
    });
  });
});
