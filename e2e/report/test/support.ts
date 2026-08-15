import {
  ProcessReceipt,
  createE2EContext,
  runProcess,
  type Argv,
  type ArtifactStageEntry,
} from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

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

/**
 * Run one Report CLI command on util-linux's real PTY. This stays local until
 * a second scenario Repo establishes the same transport contract; terminal
 * dimensions are mechanics, while every Report expected remains in its owner.
 */
export async function runReportPty(
  argv: Argv,
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
  const probe = await runProcess(["script", "--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: 5_000,
  });
  if (probe.exitCode !== 0 || !probe.stdout.includes("util-linux")) {
    throw new Error(`Report PTY requires util-linux script(1)\n\n${probe.diagnostic()}`);
  }

  const session = `stty cols ${options.columns} rows ${options.rows} || exit 201; exec ${
    argv.map(shellQuote).join(" ")
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

/**
 * Parse every outer terminal frame and reject open, ragged, or malformed
 * geometry. Business labels stay in the owner; this helper only knows box
 * drawing structure.
 */
export function closedTerminalBoxes(output: string): readonly string[] {
  const lines = stripVTControlCharacters(output).replace(/\r\n/g, "\n").split("\n");
  const boxes: string[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const top = lines[start]!;
    if (!top.startsWith("╭") || !top.endsWith("╮")) continue;
    const end = lines.findIndex(
      (line, index) => index > start && line.startsWith("╰") && line.endsWith("╯"),
    );
    if (end < 0) throw new Error(`terminal frame at line ${start + 1} has no closing border`);
    const frame = lines.slice(start, end + 1);
    const width = top.length;
    for (const [offset, line] of frame.entries()) {
      const lineNumber = start + offset + 1;
      if (line.length !== width) {
        throw new Error(
          `terminal frame line ${lineNumber} has width ${line.length}; expected ${width}\n${frame.join("\n")}`,
        );
      }
      const first = line[0];
      const last = line.at(-1);
      const closed = (first === "╭" && last === "╮")
        || (first === "│" && last === "│")
        || (first === "├" && last === "┤")
        || (first === "╰" && last === "╯");
      if (!closed) {
        throw new Error(`terminal frame line ${lineNumber} has open sides\n${frame.join("\n")}`);
      }
    }
    boxes.push(frame.join("\n"));
    start = end;
  }
  return Object.freeze(boxes);
}

/** Select one already geometry-checked frame; expected business labels remain at the call site. */
export function terminalBoxContaining(
  boxes: readonly string[],
  expectedText: readonly string[],
): string {
  const matches = boxes.filter((box) => expectedText.every((text) => box.includes(text)));
  if (matches.length !== 1) {
    throw new Error(
      `expected one terminal frame containing ${JSON.stringify(expectedText)}, found ${matches.length}\n${
        boxes.map((box, index) => `[${index}] ${box.split("\n", 2)[0] ?? "(empty)"}`).join("\n")
      }`,
    );
  }
  return matches[0]!;
}

/** Parse visible data rows without owning their labels, values, or Report meaning. */
export function terminalBoxRows(box: string): readonly (readonly string[])[] {
  return Object.freeze(box.split("\n").flatMap((line) => {
    if (!line.startsWith("│") || !line.endsWith("│")) return [];
    return [Object.freeze(line.slice(1, -1).split("│").map((cell) => cell.trim()))];
  }));
}

/**
 * Select one adjacent sequence of visible terminal lines. Blank layout rows,
 * indentation, CRLF, and ANSI styling are mechanics; the owner supplies every
 * business label. Matching a sequence avoids false positives from an earlier
 * dynamic value such as a timestamp that happens to contain the same text.
 */
export function terminalTextSequence(
  output: string,
  expectedLines: readonly string[],
): readonly string[] {
  if (expectedLines.length === 0 || expectedLines.some((line) => line.length === 0 || line.trim() !== line)) {
    throw new TypeError("terminal text sequence requires non-empty, trimmed expected lines");
  }
  const lines = stripVTControlCharacters(output)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let start = 0; start <= lines.length - expectedLines.length; start += 1) {
    if (expectedLines.every((line, offset) => lines[start + offset] === line)) {
      return Object.freeze(lines.slice(start, start + expectedLines.length));
    }
  }
  throw new Error(
    `expected adjacent visible terminal lines ${JSON.stringify(expectedLines)}\n${
      lines.map((line, index) => `${index + 1}: ${line}`).join("\n")
    }`,
  );
}
