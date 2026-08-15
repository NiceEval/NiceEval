import {
  ProcessReceipt,
  createE2EContext,
  runProcess,
  type Argv,
  type ArtifactStageEntry,
} from "@niceeval/testkit";
import { join, resolve } from "node:path";

/**
 * 每个 owner 自己在这个副本内写入 `.niceeval`；这里仅声明副本生命周期和
 * 已安装 candidate 的 node_modules 链接，不封装任何产品 argv 或 expected。
 */
export const reportProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-report-",
  omitTopLevel: [".e2e-artifacts", ".niceeval", "evidence", "node_modules", "site-export", "test", "test-results"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/**
 * Report Repo 共享的 E2E context：所有 case 共用一个 context 实例，
 * 各自通过 reportE2E.case 声明 artifact entry 与完整 argv/readiness/expected。
 */
export const reportE2E = createE2EContext({
  repoId: "report",
  project: reportProjectCopy,
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/**
 * report 特有 artifact entry：固定收集 `.niceeval`，附加目录由各 case owner
 * 显式声明（例如静态导出或 JUnit 输出）。target 相对 case namespace，由
 * createE2EContext 统一铺到 `.e2e-artifacts/<invocation>/<case>/` 下。
 */
export function reportCaseArtifacts(extraDirectories: readonly string[] = []): readonly ArtifactStageEntry[] {
  return [
    { source: ".niceeval", target: ".niceeval", optional: true },
    ...extraDirectories.map((directory) => ({
      source: directory,
      target: directory,
      optional: true,
    })),
  ];
}

export interface AuthorExportManifest {
  readonly subpaths: readonly string[];
  readonly report: readonly string[];
  readonly builtIn: readonly string[];
  readonly react: readonly string[];
  readonly extension: readonly string[];
  readonly host: readonly string[];
}

/**
 * Read only the installed candidate's public package exports, then ask Node to
 * resolve the author entry points from the consumer cwd. This deliberately
 * avoids reaching into the checkout or a package-private build path.
 */
export async function installedAuthorExportManifest(cwd: string): Promise<AuthorExportManifest> {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    'const pkg = JSON.parse(await readFile(join(process.cwd(), "node_modules", "niceeval", "package.json"), "utf8"));',
    'const report = await import("niceeval/report");',
    'const builtIn = await import("niceeval/report/built-in");',
    'const react = await import("niceeval/report/react");',
    'const extension = await import("niceeval/report/extension");',
    'const host = await import("niceeval/report/host");',
    'process.stdout.write(JSON.stringify({',
    '  subpaths: Object.keys(pkg.exports ?? {}).sort(),',
    '  report: Object.keys(report).sort(),',
    '  builtIn: Object.keys(builtIn).sort(),',
    '  react: Object.keys(react).sort(),',
    '  extension: Object.keys(extension).sort(),',
    '  host: Object.keys(host).sort(),',
    '}));',
  ].join("\n");
  const receipt = await runProcess([process.execPath, "--input-type=module", "--eval", source], {
    cwd,
    timeoutMs: 30_000,
  });
  if (receipt.exitCode !== 0) {
    throw new Error(`installed author export manifest failed\n\n${receipt.diagnostic()}`);
  }
  return JSON.parse(receipt.stdout) as AuthorExportManifest;
}

/**
 * Compile the copied consumer against the installed candidate declarations.
 * Runtime-only E2E execution deliberately transpiles TypeScript, so it cannot
 * otherwise detect a public author signature that rejects the fixture.
 */
export async function typecheckInstalledReportConsumer(cwd: string): Promise<void> {
  const receipt = await runProcess(
    [join(cwd, "node_modules", ".bin", "tsc"), "--noEmit"],
    { cwd, timeoutMs: 60_000 },
  );
  if (receipt.exitCode !== 0) {
    throw new Error(`installed Report consumer typecheck failed\n\n${receipt.diagnostic()}`);
  }
}

/**
 * Exercise the installed CLI through a real PTY without coupling Report owners
 * to box geometry, ANSI colors, or the terminal implementation.
 */
export async function runReportPty(
  args: readonly string[],
  options: {
    readonly columns: number;
    readonly rows: number;
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
): Promise<ProcessReceipt> {
  for (const [name, value] of [["columns", options.columns], ["rows", options.rows]] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }

  const candidateCommand: Argv = [join(options.cwd, "node_modules", ".bin", "niceeval")];
  const session = `stty cols ${options.columns} rows ${options.rows} || exit 201; exec ${
    [...candidateCommand, ...args].map(shellQuote).join(" ")
  }`;
  const receipt = await runProcess(
    ["script", "-q", "-f", "-e", "-c", session, "/dev/null"],
    {
      cwd: options.cwd,
      env: {
        ...options.env,
        COLUMNS: String(options.columns),
        LINES: String(options.rows),
      },
      timeoutMs: options.timeoutMs,
    },
  );
  if (receipt.exitCode === 201) {
    throw new Error(`Report PTY could not set its kernel window size\n\n${receipt.diagnostic()}`);
  }
  return new ProcessReceipt({
    argv: receipt.argv,
    cwd: receipt.cwd,
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    stdout: receipt.stdout.replace(/\r\n/g, "\n"),
    stderr: receipt.stderr.replace(/\r\n/g, "\n"),
    durationMs: receipt.durationMs,
    timedOut: receipt.timedOut,
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
