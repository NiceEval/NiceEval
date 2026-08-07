import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface Problem {
  file: string;
  rule: string;
  evidence: string;
}

function walk(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "artifacts"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function isResultTest(path: string, e2eRoot: string): boolean {
  const rel = relative(e2eRoot, path).split(sep);
  const name = rel.at(-1) ?? "";
  return (
    /\.(?:ts|tsx)$/.test(name) &&
    (rel.includes("test") || /\.(?:test|spec)\.(?:ts|tsx)$/.test(name))
  );
}

function add(problems: Problem[], root: string, file: string, rule: string, evidence: string): void {
  problems.push({ file: relative(root, file).replaceAll(sep, "/"), rule, evidence });
}

function inspectImports(problems: Problem[], root: string, file: string, source: string): void {
  const importPattern = /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    if (specifier.startsWith("@niceeval/testkit/") || specifier.includes("packages/testkit")) {
      add(problems, root, file, "testkit-root-export-only", specifier);
      continue;
    }
    if (/^niceeval\/(?:src|dist|internal)(?:\/|$)/.test(specifier)) {
      add(problems, root, file, "candidate-internal-import", specifier);
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const target = resolve(dirname(file), specifier);
    const sourceRoot = join(root, "src") + sep;
    if (target === join(root, "src") || target.startsWith(sourceRoot)) {
      add(problems, root, file, "root-src-import", specifier);
    }
  }
}

function inspectOutcomeSource(problems: Problem[], root: string, file: string, source: string): void {
  const rules: Array<[string, RegExp]> = [
    ["private-record-path", /["'`]\.niceeval(?:\/|\\)/],
    ["private-hydration-global", /window\.__NICEEVAL_VIEW_DATA__/],
    ["private-template-id", /(?:__NICEEVAL_[A-Z_]*TEMPLATE|templateId)/],
    ["dom-class-or-id-oracle", /(?:locator|querySelector|querySelectorAll)\(\s*["'`][.#][A-Za-z_-]/],
    ["constructed-attempt-path", /attempt\/\s*(?:\$\{|["'`]\s*\+)/],
    ["testkit-private-layout", /(?:dist\/(?:esm|cjs)|receipt\.json)/],
  ];
  for (const [rule, pattern] of rules) {
    const match = source.match(pattern);
    if (match) add(problems, root, file, rule, match[0]);
  }
  const relativeFile = relative(root, file).replaceAll(sep, "/");
  if (relativeFile.startsWith("e2e/adapter/") && /\b(?:describe|it|test)\.(?:skip|skipIf)\b/.test(source)) {
    add(problems, root, file, "live-adapter-must-not-skip", source.match(/\b(?:describe|it|test)\.(?:skip|skipIf)\b/)?.[0] ?? "skip");
  }
}

function inspectTestkitDependency(problems: Problem[], root: string, file: string): void {
  const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = pkg[field];
    if (typeof dependencies !== "object" || dependencies === null) continue;
    const specifier = (dependencies as Record<string, unknown>)["@niceeval/testkit"];
    if (specifier === undefined) continue;
    if (typeof specifier !== "string" || !EXACT_SEMVER.test(specifier)) {
      add(problems, root, file, "testkit-registry-exact-version", `${field}: ${String(specifier)}`);
    }
  }
}

export function collectE2EBoundaryProblems(root: string): Problem[] {
  const e2eRoot = join(root, "e2e");
  const problems: Problem[] = [];
  if (!isAbsolute(root)) throw new Error("root must be absolute");
  for (const file of walk(e2eRoot)) {
    if (file.endsWith(`${sep}package.json`)) inspectTestkitDependency(problems, root, file);
    if (!isResultTest(file, e2eRoot)) continue;
    const source = readFileSync(file, "utf8");
    inspectImports(problems, root, file, source);
    inspectOutcomeSource(problems, root, file, source);
  }
  return problems;
}

function withFixture(files: Record<string, string>, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "niceeval-e2e-boundary-"));
  try {
    mkdirSync(join(root, "e2e"), { recursive: true });
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("E2E 公开结果边界守护", () => {
  it("当前场景测试不依赖候选源码或私有观察面", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    expect(collectE2EBoundaryProblems(root)).toEqual([]);
  });

  it("拒绝源码 import、私有 Record、hydration、DOM class 与拼接路径", () => {
    withFixture(
      {
        "e2e/report/test/private.spec.ts": `
          import { render } from "../../../src/report/render.ts";
          const data = window.__NICEEVAL_VIEW_DATA__;
          readFile(".niceeval/run.json");
          page.locator(".private-row");
          const href = "attempt/" + locator + ".html";
        `,
      },
      (root) => {
        expect(collectE2EBoundaryProblems(root).map((problem) => problem.rule)).toEqual(
          expect.arrayContaining([
            "root-src-import",
            "private-record-path",
            "private-hydration-global",
            "dom-class-or-id-oracle",
            "constructed-attempt-path",
          ]),
        );
      },
    );
  });

  it("拒绝 Testkit 子路径、源码路径与私有产物布局", () => {
    withFixture(
      {
        "e2e/cli/test/private.spec.ts": `
          import { command } from "@niceeval/testkit/process";
          import { hidden } from "../../../packages/testkit/src/process.ts";
          readFile("receipt.json");
        `,
      },
      (root) => {
        expect(collectE2EBoundaryProblems(root).map((problem) => problem.rule)).toEqual(
          expect.arrayContaining(["testkit-root-export-only", "testkit-private-layout"]),
        );
      },
    );
  });

  it("拒绝 live Adapter 在测试内把缺能力跳过成绿色", () => {
    withFixture(
      {
        "e2e/adapter/ai-sdk/test/live.test.ts": `
          import { test } from "vitest";
          test.skipIf(!process.env.OPENAI_API_KEY)("live", () => {});
        `,
      },
      (root) => {
        expect(collectE2EBoundaryProblems(root)).toEqual([
          expect.objectContaining({ rule: "live-adapter-must-not-skip" }),
        ]);
      },
    );
  });

  it("允许公开 CLI、HTTP、真实 href、role 与 Record API", () => {
    withFixture(
      {
        "e2e/report/test/public.spec.ts": `
          import { openRecord } from "niceeval/record";
          const receipt = await runProcess(["pnpm", "exec", "niceeval", "show", "--json"]);
          const href = await page.getByRole("link", { name: "Attempt" }).getAttribute("href");
          const response = await fetch(new URL(href, origin));
          expect(receipt.exitCode).toBe(0);
          expect(response.status).toBe(200);
        `,
      },
      (root) => expect(collectE2EBoundaryProblems(root)).toEqual([]),
    );
  });

  it("Testkit 只接受 registry 精确 semver", () => {
    withFixture(
      {
        "e2e/cli/package.json": JSON.stringify({ devDependencies: { "@niceeval/testkit": "workspace:*" } }),
        "e2e/report/package.json": JSON.stringify({ devDependencies: { "@niceeval/testkit": "0.1.0" } }),
      },
      (root) => {
        expect(collectE2EBoundaryProblems(root)).toEqual([
          expect.objectContaining({ file: "e2e/cli/package.json", rule: "testkit-registry-exact-version" }),
        ]);
      },
    );
  });
});
