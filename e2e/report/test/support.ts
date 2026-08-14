import { createE2EContext, type ArtifactStageEntry } from "@niceeval/testkit";
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
