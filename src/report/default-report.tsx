// DefaultReport:官方水位整块 —— 官方两扇门裸跑时渲染的就是它,零 props、纯声明。
// 「渲染面纯同步」与它不冲突,靠的是一个数据事实:官方水位(overview、榜单、失败清单)
// 只读瘦身条目、不碰任何懒加载 artifact,宿主对着已挑好的 Selection 总是把这份数据备好、经上下文
// 注入(renderReportToText / renderReportToStaticHtml 里 prepareDefaultReportData)。
// 它渲染的口径钉死为宿主注入的那份 Selection —— 零 props 意味着没有跟随的通道,这是锚点语义:
// 官方口径与自定义口径并排对照。默认无特权:数据全部来自公开计算函数。
//
// text 面即 `niceeval show` 的榜单(docs-site/zh/guides/viewing-results.mdx 的示例块是
// 行为规范):`Current verdicts` 头标注合成自几个 run、experiment 表带 eval 级折叠的
// evals 列、Failing 清单每条带判定时间与下钻命令。

import { basename } from "node:path";
import type { Selection } from "../results/index.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { defineComponent } from "./tree.ts";
import type { CaseListData, OverviewData, TableData } from "./types.ts";
import { caseListData, overviewData, tableData } from "./compute.ts";
import { attemptCostUSD, costUSD, durationMs, passRate } from "./metrics.ts";
import { RunOverview, MetricTable, CaseList } from "./components.tsx";
import { cellText } from "./text/faces.ts";
import { renderAlignedRows } from "./text/layout.ts";

/** 榜单的合成标注与 eval 级折叠(text 面用;与 verdicts/cases 出自同一 Selection)。 */
export interface VerdictBoardData {
  /** 判定合成自几个物理 run。 */
  composedFromRuns: number;
  /** 参与合成的最新 run(目录名,即时间戳)。 */
  latestRun?: string;
  /** experiment → eval 级折叠计票(evals 列的 13/15)。 */
  tallies: Record<string, { passedEvals: number; totalEvals: number }>;
  /** eval 级折叠后失败/出错的题,带判定时间;新失败在前。 */
  failing: {
    evalId: string;
    experimentId: string;
    verdict: "failed" | "errored";
    /** 最新 attempt 的第一条失败断言("gate calledTool(...)")或错误摘要。 */
    reason?: string;
    /** 判定产生的时刻(最新 attempt 的 startedAt,缺失退快照时刻)。 */
    verdictAt?: string;
  }[];
  /** limit 之外还有几条,如实报。 */
  failingTruncated: number;
}

export interface DefaultReportData {
  overview: OverviewData;
  /** 现刻榜单:experiment × (passRate, costUSD, durationMs)。 */
  verdicts: TableData;
  cases: CaseListData;
  board: VerdictBoardData;
}

/** 失败清单的出厂截断;完整清单自己摆 <CaseList>(截断如实报剩余)。 */
const DEFAULT_CASE_LIMIT = 10;

function buildBoard(selection: Selection): VerdictBoardData {
  const tallies: VerdictBoardData["tallies"] = {};
  const failing: VerdictBoardData["failing"] = [];
  const runs = new Set<string>();
  let latestRunDir = "";

  for (const snapshot of selection.snapshots) {
    let passedEvals = 0;
    for (const ev of snapshot.evals) {
      for (const attempt of ev.attempts) {
        runs.add(attempt.runDir.dir);
        if (attempt.runDir.dir > latestRunDir) latestRunDir = attempt.runDir.dir;
      }
      const verdict = foldEvalVerdict(ev.attempts.map((a) => a.result));
      if (verdict === "passed") {
        passedEvals += 1;
        continue;
      }
      if (verdict !== "failed" && verdict !== "errored") continue;
      const latest = ev.attempts.reduce((a, b) => (b.result.attempt >= a.result.attempt ? b : a));
      const failedAssertion = latest.result.assertions.find((a) => !a.passed);
      const reason = failedAssertion
        ? `${failedAssertion.severity} ${failedAssertion.name}`
        : latest.result.error !== undefined
          ? `error: ${latest.result.error}`
          : undefined;
      failing.push({
        evalId: ev.id,
        experimentId: snapshot.experimentId,
        verdict,
        ...(reason !== undefined ? { reason } : {}),
        ...(latest.result.startedAt !== undefined || snapshot.startedAt
          ? { verdictAt: latest.result.startedAt ?? snapshot.startedAt }
          : {}),
      });
    }
    tallies[snapshot.experimentId] = { passedEvals, totalEvals: snapshot.evals.length };
  }

  failing.sort((a, b) => (b.verdictAt ?? "").localeCompare(a.verdictAt ?? ""));
  const shown = failing.slice(0, DEFAULT_CASE_LIMIT);
  return {
    composedFromRuns: runs.size,
    ...(latestRunDir ? { latestRun: basename(latestRunDir) } : {}),
    tallies,
    failing: shown,
    failingTruncated: failing.length - shown.length,
  };
}

/** 宿主渲染前备好官方水位:只读瘦身条目,代价可忽略。 */
export async function prepareDefaultReportData(selection: Selection): Promise<DefaultReportData> {
  return {
    overview: await overviewData(selection),
    verdicts: await tableData(selection, {
      rows: "experiment",
      columns: [passRate, costUSD, durationMs],
      sort: passRate,
    }),
    cases: await caseListData(selection, { limit: DEFAULT_CASE_LIMIT }),
    board: buildBoard(selection),
  };
}

let activeData: DefaultReportData | null = null;

/** 宿主(与渲染入口)用:在注入好的官方水位下同步渲染。 */
export function runWithDefaultReportData<T>(data: DefaultReportData, fn: () => T): T {
  const prev = activeData;
  activeData = data;
  try {
    return fn();
  } finally {
    activeData = prev;
  }
}

function requireData(): DefaultReportData {
  if (!activeData) {
    throw new Error(
      "<DefaultReport /> renders the host-injected selection; render the report via " +
        "`niceeval show --report` / `niceeval view --report` (or renderReportToText / renderReportToStaticHtml). " +
        "Outside a host, compose the same blocks yourself: RunOverview, MetricTable, CaseList.",
    );
  }
  return activeData;
}

/** 判定时间的相对标注(text 面的 "41s ago";渲染面纯同步,Date.now 不算 IO)。 */
function agoText(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 10_000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** show 榜单(viewing-results.mdx「榜单」块):头 + experiment 表 + Failing 清单。 */
function boardText(data: DefaultReportData): string {
  const { verdicts, board, overview } = data;
  const experiments = verdicts.rows.length;
  const head = [
    "Current verdicts",
    `${experiments} ${experiments === 1 ? "experiment" : "experiments"}`,
    `composed from ${board.composedFromRuns} ${board.composedFromRuns === 1 ? "run" : "runs"}`,
    ...(board.latestRun ? [`latest ${board.latestRun}`] : []),
  ].join(" · ");
  const headBlock = [head, ...overview.warnings.map((w) => `! ${w.message}`)].join("\n");

  // 表:experiment | evals(eval 级折叠计票)| pass | cost | duration(顺序随 verdicts 预排)
  const header = [verdicts.dimension, "evals", "pass", "cost", "duration"];
  const rows = verdicts.rows.map((row) => {
    const tally = board.tallies[row.key];
    const cells = row.cells as Record<string, TableData["rows"][number]["cells"][string]>;
    return [
      row.key,
      tally ? `${tally.passedEvals}/${tally.totalEvals}` : "—",
      cells[passRate.name] ? cellText(cells[passRate.name]) : "—",
      cells[costUSD.name] ? cellText(cells[costUSD.name]) : "—",
      cells[durationMs.name] ? cellText(cells[durationMs.name]) : "—",
    ];
  });
  const table = renderAlignedRows([header, ...rows]);

  const blocks = [headBlock, table];
  if (board.failing.length > 0) {
    const now = Date.now();
    const aligned = renderAlignedRows(
      board.failing.map((f) => [
        `✗ ${f.evalId}`,
        f.experimentId,
        f.reason ?? f.verdict,
        agoText(f.verdictAt, now),
      ]),
    ).split("\n");
    const lines: string[] = ["Failing:"];
    board.failing.forEach((f, i) => {
      lines.push(`  ${aligned[i]}`);
      lines.push(`      → niceeval show ${f.evalId}`);
    });
    if (board.failingTruncated > 0) lines.push(`  (${board.failingTruncated} more not shown)`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export const DefaultReport = defineComponent<Record<string, never>>({
  web() {
    const data = requireData();
    return (
      <div className="nre nre-default-report">
        <RunOverview data={data.overview} />
        <MetricTable data={data.verdicts} />
        {data.cases.rows.length > 0 && <CaseList data={data.cases} />}
      </div>
    );
  },
  text() {
    return boardText(requireData());
  },
});
DefaultReport.displayName = "DefaultReport";
