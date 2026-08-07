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
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  collectArtifacts,
  repoArtifactDir,
  repoReceiptPath,
} from "../../../e2e/scripts/artifacts.ts";
import { readCandidateTarball } from "../../../e2e/scripts/injection.ts";
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

function writeFixtureRepo(
  root: string,
  opts: {
    id: string;
    command: readonly [string, ...string[]];
    artifacts?: readonly string[];
    executor?: E2ERepoManifest["executor"];
    timeoutMinutes?: number;
  },
): DiscoveredRepo {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: `fixture-${opts.id}`,
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: { niceeval: "0.0.0-test" },
      },
      null,
      2,
    ) + "\n",
  );
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
      expect(writtenStages).toEqual(["install", "injection", "test", "collect", "cleanup"]);
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
      expect(onDisk.stages.map((s) => s.stage)).toEqual(["install", "injection", "cleanup"]);
      expect(existsSync(join(scratch, "runs", "inj-fail"))).toBe(false);
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
