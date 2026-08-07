// cases: docs/engineering/testing/unit/experiments-runner.md
// 「E2E candidate 与入口」类别：证明 pack 输出精确文件与双 digest、显式
// run 只消费已有 candidate、原生参数透传一次，以及默认 plan→pack→run 顺序。

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildDefaultRunArgs,
  executeDefault,
  splitNativeArgs,
} from "../../../e2e/scripts/cli.ts";
import { packCandidate, parsePackCli } from "../../../e2e/scripts/pack.ts";
import { appendNativeArgs, parseRunCli } from "../../../e2e/scripts/run.ts";
import {
  readCandidateTarball,
  type CandidateTarball,
} from "../../../e2e/scripts/injection.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "e2e-pack-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("E2E candidate and command entry contracts", () => {
  it("pack requires an exact .tgz output path", () => {
    expect(parsePackCli(["--out", "artifacts/candidate.tgz"])).toEqual({ out: "artifacts/candidate.tgz" });
    expect(() => parsePackCli([])).toThrow(/requires --out/);
    expect(() => parsePackCli(["--out", "artifacts/candidate.zip"])).toThrow(/must end with \.tgz/);
  });

  it("explicit run requires candidate and recomputes sha512/sha256 from that file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "candidate.tgz");
      const bytes = Buffer.from("candidate bytes");
      writeFileSync(path, bytes);
      const candidate = readCandidateTarball(path);

      expect(candidate.path).toBe(resolve(path));
      expect(candidate.integrity).toBe(`sha512-${createHash("sha512").update(bytes).digest("base64")}`);
      expect(candidate.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    });
    expect(() => parseRunCli(["--repo", "cli"])).toThrow(/requires --candidate/);
    expect(parseRunCli(["--candidate", "candidate.tgz", "--artifact-root", "out/e2e"]).artifactRoot)
      .toBe(resolve("out/e2e"));
  });

  it("显式 run 接受可选 --testkit 精确 tgz；不传时保持 undefined", () => {
    expect(parseRunCli(["--candidate", "candidate.tgz"]).testkitPath).toBeUndefined();
    expect(
      parseRunCli(["--candidate", "candidate.tgz", "--testkit", "packages/testkit/artifacts/testkit.tgz"])
        .testkitPath,
    ).toBe("packages/testkit/artifacts/testkit.tgz");
    expect(parseRunCli(["--candidate", "candidate.tgz", "--testkit", ""]).testkitPath).toBeUndefined();
  });

  it("-- 后的原生参数保持顺序，并只追加一次到 manifest command", () => {
    const parsed = parseRunCli([
      "--candidate",
      "candidate.tgz",
      "--repo",
      "cli",
      "--",
      "--run",
      "test/file.test.ts",
      "-t",
      "title",
    ]);
    expect(parsed.nativeArgs).toEqual(["--run", "test/file.test.ts", "-t", "title"]);
    expect(appendNativeArgs(["pnpm", "e2e"], parsed.nativeArgs)).toEqual([
      "pnpm",
      "e2e",
      "--run",
      "test/file.test.ts",
      "-t",
      "title",
    ]);
  });

  it("默认入口先 plan，成功后只 pack 一次，再用同一 candidate run", async () => {
    const stages: string[] = [];
    const plannedArgs: string[][] = [];
    const runArgs: string[][] = [];
    const result = await executeDefault(["--lane", "pr", "--repo", "cli", "--", "--run", "file"], {
      candidatePath: "/tmp/default-candidate.tgz",
      plan: async (args) => {
        stages.push("plan");
        plannedArgs.push([...args]);
        return true;
      },
      pack: async (out) => {
        stages.push("pack");
        expect(out).toBe("/tmp/default-candidate.tgz");
        return { path: out };
      },
      run: async (args) => {
        stages.push("run");
        runArgs.push([...args]);
      },
    });

    expect(result).toBe(true);
    expect(stages).toEqual(["plan", "pack", "run"]);
    expect(plannedArgs).toEqual([["--lane", "pr", "--repo", "cli"]]);
    expect(runArgs).toEqual([["--candidate", "/tmp/default-candidate.tgz", "--lane", "pr", "--repo", "cli", "--", "--run", "file"]]);
  });

  it("plan 失败时默认入口不 pack/run", async () => {
    const pack = vi.fn(async (_out: string) => ({ path: _out }));
    const run = vi.fn(async (_args: readonly string[]) => undefined);
    const result = await executeDefault(["--lane", "pr"], {
      candidatePath: "/tmp/default-candidate.tgz",
      plan: async () => false,
      pack,
      run,
    });
    expect(result).toBe(false);
    expect(pack).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("packCandidate 只调用一次 pack，并把唯一产物移动到 exact out", async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, "exact-candidate.tgz");
      const bytes = Buffer.from("packed candidate");
      const build = vi.fn(
        async (_root: string, destination: string, _options?: { quiet?: boolean }): Promise<CandidateTarball> => {
          const generated = join(destination, "generated.tgz");
          writeFileSync(generated, bytes);
          return {
            path: generated,
            integrity: "unused",
            shortHash: "unused",
            sha256: "unused",
            name: "niceeval",
            version: "0.0.0",
          };
        },
      );
      const read = vi.fn((path: string) => readCandidateTarball(path));

      const candidate = await packCandidate(dir, output, {
        buildCandidateTarball: build,
        readCandidateTarball: read,
      });

      expect(build).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(resolve(output));
      expect(existsSync(output)).toBe(true);
      expect(readFileSync(output)).toEqual(bytes);
      expect(candidate.path).toBe(resolve(output));
    });
  });

  it("默认参数拆分不会把原生参数交给 plan", () => {
    expect(splitNativeArgs(["--lane", "pr", "--", "--run", "file"])).toEqual({
      selectionArgs: ["--lane", "pr"],
      nativeArgs: ["--run", "file"],
    });
    expect(buildDefaultRunArgs("candidate.tgz", ["--lane", "pr"], [])).toEqual([
      "--candidate",
      "candidate.tgz",
      "--lane",
      "pr",
    ]);
  });
});
