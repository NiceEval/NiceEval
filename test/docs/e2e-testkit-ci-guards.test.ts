// cases: docs/engineering/testing/{testkit,e2e/execution,e2e/scenario-repos}.md（双 tgz 身份、隔离安装与 CI 注入）
// 仓库级机器守护：Testkit 只能作为根 workspace 的私有包存在；E2E CI 只生产、传递并消费
// 同一对 NiceEval/Testkit tarball。守护在 CI 中直接读取 upload 前的路径，绝不重新 pack。

import { spawnSync } from "node:child_process";
import {
  createReadStream,
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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { extract } from "tar-stream";

const ROOT = resolve(import.meta.dirname, "../..");
const EXACT_TARBALLS = process.env.NICEEVAL_EXACT_E2E_TARBALLS === "true";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const PACKAGE_LOCAL_METADATA = new Set(["pnpm-workspace.yaml", "pnpm-workspace.yml"]);
const PACKAGE_LOCAL_LOCKFILE = /^(?:pnpm-lock\.ya?ml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|deno\.lock|shrinkwrap\.yaml)$/i;

interface TarballContents {
  entries: string[];
  packageJson: Record<string, unknown>;
}

interface ExactOrLocalTarball {
  path: string;
  dispose(): void;
}

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  run?: string;
}

interface WorkflowJob {
  needs?: string | string[];
  outputs?: Record<string, unknown>;
  steps?: WorkflowStep[];
  strategy?: { matrix?: { include?: unknown } };
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

function normalizeEntry(name: string): string {
  return name.replace(/^\.\//, "").replace(/^package\/?/, "").replace(/\/$/, "");
}

function readTarball(tgzPath: string): Promise<TarballContents> {
  return new Promise((resolveP, rejectP) => {
    const entries: string[] = [];
    let packageJsonSource: string | undefined;
    const gunzip = createGunzip();
    const extractor = extract();
    extractor.on("entry", (header, stream, next) => {
      entries.push(header.name);
      if (header.name !== "package/package.json") {
        stream.resume();
        stream.once("end", next);
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.once("error", rejectP);
      stream.once("end", () => {
        packageJsonSource = Buffer.concat(chunks).toString("utf8");
        next();
      });
    });
    extractor.once("error", rejectP);
    gunzip.once("error", rejectP);
    extractor.once("finish", () => {
      if (packageJsonSource === undefined) {
        rejectP(new Error(`${tgzPath} 缺少 package/package.json`));
        return;
      }
      try {
        resolveP({ entries, packageJson: JSON.parse(packageJsonSource) as Record<string, unknown> });
      } catch (error) {
        rejectP(new Error(`${tgzPath} 的 package/package.json 不是有效 JSON: ${(error as Error).message}`));
      }
    });
    createReadStream(tgzPath).pipe(gunzip).pipe(extractor);
  });
}

function runOrThrow(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 600_000,
  });
  if (result.status === 0) return;
  throw new Error(
    `${command} ${args.join(" ")} failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
  );
}

function exactOrLocalTarball(
  envName: "NICEEVAL_CANDIDATE_TGZ" | "NICEEVAL_TESTKIT_TGZ",
  prefix: string,
  produce: (dir: string) => string,
): ExactOrLocalTarball {
  const exact = process.env[envName];
  if (exact !== undefined && exact.length > 0) {
    if (!existsSync(exact)) throw new Error(`${envName} 指向的文件不存在: ${exact}`);
    return { path: exact, dispose: () => undefined };
  }
  if (EXACT_TARBALLS) {
    throw new Error(`${envName} 必须指向 package job 即将上传的精确 tgz`);
  }

  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return {
    path: produce(dir),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function localCandidateTarball(): ExactOrLocalTarball {
  return exactOrLocalTarball("NICEEVAL_CANDIDATE_TGZ", "niceeval-e2e-candidate-guard", (dir) => {
    const output = join(dir, "niceeval-candidate.tgz");
    runOrThrow("pnpm", ["e2e", "pack", "--out", output], ROOT);
    if (!existsSync(output)) throw new Error(`pnpm e2e pack 未产生 ${output}`);
    return output;
  });
}

function localTestkitTarball(): ExactOrLocalTarball {
  return exactOrLocalTarball("NICEEVAL_TESTKIT_TGZ", "niceeval-e2e-testkit-guard", (dir) => {
    runOrThrow("pnpm", ["--filter", "@niceeval/testkit", "run", "build"], ROOT);
    runOrThrow(
      "pnpm",
      ["--filter", "@niceeval/testkit", "pack", "--pack-destination", dir],
      ROOT,
      { ...process.env, PNPM_CONFIG_IGNORE_SCRIPTS: "true" },
    );
    const packed = readdirSync(dir).filter((name) => name.endsWith(".tgz"));
    if (packed.length !== 1) {
      throw new Error(`本地 Testkit pack 应只产生一个 tgz，实际为: ${JSON.stringify(packed)}`);
    }
    return join(dir, packed[0]);
  });
}

function walkPackageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if ([".git", "artifacts", "dist", "node_modules"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkPackageFiles(path, out);
    else out.push(path);
  }
  return out;
}

function packageLocalMetadataProblems(root: string): string[] {
  const packages = join(root, "packages");
  if (!existsSync(packages)) return [];
  return walkPackageFiles(packages)
    .filter((path) => {
      const name = basename(path);
      return PACKAGE_LOCAL_METADATA.has(name) || PACKAGE_LOCAL_LOCKFILE.test(name);
    })
    .map((path) => relative(root, path).replaceAll(sep, "/"));
}

function dependencyValue(pkg: Record<string, unknown>, field: (typeof DEPENDENCY_FIELDS)[number], name: string): unknown {
  const dependencies = pkg[field];
  if (dependencies === null || typeof dependencies !== "object") return undefined;
  return (dependencies as Record<string, unknown>)[name];
}

function installConsumer(
  tgzPath: string,
  root: string,
  name: string,
  type?: "module",
  additionalPackages: string[] = [],
): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({ name: `testkit-${name}`, private: true, ...(type === "module" ? { type } : {}) }, null, 2)}\n`,
  );
  runOrThrow(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", "--no-save", tgzPath, ...additionalPackages],
    project,
  );
  expect(existsSync(join(project, "package-lock.json")), `${name} 不得生成 package-lock`).toBe(false);
  return project;
}

function node18ForConsumer(): string {
  const configured = process.env.NICEEVAL_TESTKIT_NODE18;
  if (EXACT_TARBALLS && (configured === undefined || configured.length === 0)) {
    throw new Error("NICEEVAL_TESTKIT_NODE18 必须由 workflow 的 Node 18 setup 步骤传入");
  }
  const executable = configured && configured.length > 0 ? configured : process.execPath;
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) throw new Error(`无法执行 consumer Node: ${executable}`);
  if (EXACT_TARBALLS) {
    expect(version.stdout.trim(), "CI consumer 必须是 Node 18").toMatch(/^v18\./);
  }
  return executable;
}

function runNodeOrThrow(node: string, args: string[], cwd: string): void {
  runOrThrow(node, args, cwd, { ...process.env });
}

describe("E2E Testkit 双 tgz 与 workspace 机器守护", () => {
  let candidate: ExactOrLocalTarball;
  let testkit: ExactOrLocalTarball;
  let candidateContents: TarballContents;
  let testkitContents: TarballContents;
  let workflow: Workflow;

  beforeAll(async () => {
    candidate = localCandidateTarball();
    testkit = localTestkitTarball();
    try {
      [candidateContents, testkitContents] = await Promise.all([
        readTarball(candidate.path),
        readTarball(testkit.path),
      ]);
      workflow = parseYaml(readFileSync(join(ROOT, ".github/workflows/e2e.yml"), "utf8")) as Workflow;
    } catch (error) {
      candidate.dispose();
      testkit.dispose();
      throw error;
    }
  }, 600_000);

  it("Testkit tgz 只含 package.json、README 与 dist", () => {
    const invalid = testkitContents.entries.filter((entry) => {
      const normalized = normalizeEntry(entry);
      return !(
        normalized.length === 0 ||
        normalized === "package.json" ||
        normalized === "README.md" ||
        normalized === "dist" ||
        normalized.startsWith("dist/")
      );
    });
    expect(invalid, "Testkit tarball 禁止携带 src/test/scripts/node_modules/workspace/lock 等开发文件").toEqual([]);
    expect(testkitContents.packageJson.name).toBe("@niceeval/testkit");
  });

  it("NiceEval tgz 不携带也不依赖 Testkit", () => {
    const embeddedTestkit = candidateContents.entries
      .map(normalizeEntry)
      .filter((entry) => entry === "packages/testkit" || entry.startsWith("packages/testkit/"));
    expect(embeddedTestkit, "NiceEval 发布包不得包含 packages/testkit/**").toEqual([]);
    for (const field of DEPENDENCY_FIELDS) {
      expect(
        dependencyValue(candidateContents.packageJson, field, "@niceeval/testkit"),
        `NiceEval tgz package.json 的 ${field} 不得声明 @niceeval/testkit`,
      ).toBeUndefined();
    }
  });

  it("Testkit 精确 tgz 在 clean temp consumer 中以 raw Node ESM/CJS 和严格类型入口可用", () => {
    const root = mkdtempSync(join(tmpdir(), "niceeval-testkit-consumer-"));
    try {
      const esm = installConsumer(testkit.path, root, "esm", "module");
      const cjs = installConsumer(testkit.path, root, "cjs");
      const sourcePackage = JSON.parse(
        readFileSync(join(ROOT, "packages/testkit/package.json"), "utf8"),
      ) as { devDependencies?: Record<string, unknown> };
      const nodeTypes = sourcePackage.devDependencies?.["@types/node"];
      expect(typeof nodeTypes, "Testkit type consumer 需要显式 Node 声明").toBe("string");
      const types = installConsumer(
        testkit.path,
        root,
        "types",
        "module",
        [`@types/node@${nodeTypes as string}`],
      );
      const node18 = node18ForConsumer();

      runNodeOrThrow(
        node18,
        [
          "--input-type=module",
          "--eval",
          "import * as testkit from '@niceeval/testkit'; if (typeof testkit.command !== 'function') throw new Error('missing ESM command export');",
        ],
        esm,
      );
      runNodeOrThrow(
        node18,
        [
          "--eval",
          "const testkit = require('@niceeval/testkit'); if (typeof testkit.command !== 'function') throw new Error('missing CJS command export');",
        ],
        cjs,
      );

      writeFileSync(
        join(types, "consumer.mts"),
        'import { command } from "@niceeval/testkit";\nexport const esm = command(["node"] as const);\n',
      );
      writeFileSync(
        join(types, "consumer.cts"),
        'import { command } from "@niceeval/testkit";\nexport const cjs = command(["node"] as const);\n',
      );
      writeFileSync(
        join(types, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              skipLibCheck: false,
              types: ["node"],
              noEmit: true,
            },
            files: ["consumer.mts", "consumer.cts"],
          },
          null,
          2,
        )}\n`,
      );
      runOrThrow("pnpm", ["exec", "tsc", "--project", join(types, "tsconfig.json")], ROOT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("packages 下没有局部 workspace 或 lock，根 lock 有 Testkit importer", () => {
    expect(packageLocalMetadataProblems(ROOT)).toEqual([]);

    const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    expect(rootPackage.packageManager, "根 package.json 必须声明唯一 pnpm 管理器").toMatch(/^pnpm@/);

    const workspace = parseYaml(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
      packages?: unknown;
    };
    expect(workspace.packages).toEqual(expect.arrayContaining(["packages/*"]));

    const lock = parseYaml(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")) as {
      importers?: Record<string, Record<string, unknown>>;
    };
    const importer = lock.importers?.["packages/testkit"];
    expect(importer, "根 pnpm-lock.yaml 缺 packages/testkit importer").toBeTruthy();
    const testkitPackage = JSON.parse(
      readFileSync(join(ROOT, "packages/testkit/package.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const declared = testkitPackage[field];
      if (declared === null || typeof declared !== "object") continue;
      const locked = importer?.[field];
      expect(locked, `packages/testkit importer 缺 ${field}`).toBeTruthy();
      for (const name of Object.keys(declared as Record<string, unknown>)) {
        expect((locked as Record<string, unknown>)[name], `packages/testkit importer 缺 ${field}.${name}`).toBeTruthy();
      }
    }
  });

  it("E2E workflow 只生产一次双 tgz，guards 消费 upload 前的同一字节", () => {
    const packageJob = workflow.jobs?.package;
    const steps = packageJob?.steps ?? [];
    const runs = steps.map((step) => step.run ?? "");
    const packIndex = steps.findIndex((step) => step.id === "pack");
    const testIndex = steps.findIndex((step) => /@niceeval\/testkit run test\b/.test(step.run ?? ""));
    const typecheckIndex = steps.findIndex((step) => /@niceeval\/testkit run typecheck\b/.test(step.run ?? ""));
    const buildIndex = steps.findIndex((step) => /@niceeval\/testkit run build\b/.test(step.run ?? ""));
    expect(packIndex, "package job 缺唯一双 tgz pack step").toBeGreaterThan(-1);
    expect(testIndex, "pack 前必须运行 Testkit meta-test").toBeGreaterThan(-1);
    expect(typecheckIndex, "pack 前必须运行 Testkit typecheck").toBeGreaterThan(-1);
    expect(buildIndex, "pack step 必须先 clean build Testkit").toBe(packIndex);
    expect(testIndex).toBeLessThan(packIndex);
    expect(typecheckIndex).toBeLessThan(packIndex);
    expect(runs.filter((run) => /\bpnpm e2e pack --out\b/.test(run))).toHaveLength(1);
    expect(runs.filter((run) => /\bpnpm --filter @niceeval\/testkit pack\b/.test(run))).toHaveLength(1);
    const packRun = steps[packIndex].run ?? "";
    expect(packRun.indexOf("@niceeval/testkit run build")).toBeLessThan(
      packRun.indexOf("@niceeval/testkit pack"),
    );
    expect(packageJob?.outputs).toMatchObject({
      candidate_sha256: "${{ steps.pack.outputs.candidate_sha256 }}",
      candidate_tgz_name: "${{ steps.pack.outputs.candidate_tgz_name }}",
      testkit_sha256: "${{ steps.pack.outputs.testkit_sha256 }}",
      testkit_tgz_name: "${{ steps.pack.outputs.testkit_tgz_name }}",
    });

    const guard = steps.find((step) => /\bpnpm run test:docs\b/.test(step.run ?? ""));
    expect(guard, "缺少 upload 前的双 tarball docs guard").toBeTruthy();
    expect(guard?.env).toMatchObject({
      NICEEVAL_CANDIDATE_TGZ: "${{ steps.pack.outputs.candidate_path }}",
      NICEEVAL_TESTKIT_TGZ: "${{ steps.pack.outputs.testkit_path }}",
      NICEEVAL_TESTKIT_NODE18: "${{ steps.node18.outputs.path }}",
      NICEEVAL_EXACT_E2E_TARBALLS: "true",
    });
    const upload = steps.find((step) => step.uses === "actions/upload-artifact@v4");
    expect(upload?.with?.name).toBe("niceeval-e2e-tarballs");
    expect(String(upload?.with?.path)).toContain("${{ steps.pack.outputs.candidate_path }}");
    expect(String(upload?.with?.path)).toContain("${{ steps.pack.outputs.testkit_path }}");
    expect(
      steps.some(
        (step) =>
          step.uses === "actions/setup-node@v4" &&
          String(step.with?.["node-version"] ?? step.with?.nodeVersion) === "18",
      ),
      "docs guard 必须获得 raw Node 18 consumer",
    ).toBe(true);
  });

  it("每个动态 matrix cell 下载、重算并传递同一双 tgz，自己绝不 pack", () => {
    const e2e = workflow.jobs?.e2e;
    const needs = Array.isArray(e2e?.needs) ? e2e.needs : [e2e?.needs];
    expect(needs).toEqual(expect.arrayContaining(["package", "plan"]));
    expect(e2e?.strategy?.matrix?.include).toBe("${{ fromJson(needs.plan.outputs.matrix) }}");
    const steps = e2e?.steps ?? [];
    const download = steps.find((step) => step.uses === "actions/download-artifact@v4");
    expect(download?.with?.name).toBe("niceeval-e2e-tarballs");
    const verify = steps.find((step) => step.id === "tarballs");
    expect(verify?.run, "matrix cell 必须重算两份 sha256").toMatch(/sha256sum[\s\S]*sha256sum/);
    expect(verify?.env).toMatchObject({
      EXPECTED_CANDIDATE_SHA256: "${{ needs.package.outputs.candidate_sha256 }}",
      EXPECTED_TESTKIT_SHA256: "${{ needs.package.outputs.testkit_sha256 }}",
    });
    const run = steps.find((step) => /\bpnpm e2e run\b/.test(step.run ?? ""));
    expect(run?.env).toMatchObject({ REPO_ID: "${{ matrix.id }}" });
    expect(run?.run).toMatch(/--candidate "\$CANDIDATE"[\s\\]+--testkit "\$TESTKIT"/);
    expect(run?.run).toMatch(/--repo "\$REPO_ID"/);
    expect(steps.map((step) => step.run ?? "").join("\n")).not.toMatch(
      /\bpnpm (?:e2e )?pack\b|\bpnpm --filter @niceeval\/testkit pack\b/,
    );
  });
});
