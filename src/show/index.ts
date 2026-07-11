// niceeval show —— 终端宿主(行为规范:docs-site/zh/guides/viewing-results.mdx;
// 宿主组合语义:docs/reports.md「宿主输入的组合语义」)。
//
// 位置参数 = eval id 前缀(选「看哪些 eval」),flag 选「看哪个切面」:
//   裸跑 / 前缀       报告槽 —— 内置默认报告的 text 面(show ≡ show --report <内置默认报告>)
//   恰好一个 eval     单 eval 详情(attempt / 断言明细,宿主本体)
//   --transcript / --trace / --diff[=路径]   证据切面(宿主本体):出现即走证据室,不渲染报告槽
//   --history        跨 run 时间轴(内置趋势视图),与 --report 互斥
//   --report <文件>  整槽换成用户报告;位置前缀 / --run / --experiment 先收窄选集再注入
//   --run <目录>     结果根换成该目录;--experiment 选集只留该实验;--attempt 指定详情/证据的 attempt
//
// 数据全部走 niceeval/results 的读取面(openResults + 合成选集),不自己爬目录。

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openResults, type AttemptRef, type Results } from "../results/index.ts";
import { defineReport, renderReportToText, type ReportDefinition } from "../report/report.ts";
import { ReportLoadError, loadReportFile } from "../report/load.ts";
import { DefaultReport } from "../report/default-report.tsx";
import { t } from "../i18n/index.ts";
import {
  composeShowSelection,
  evalHistory,
  experimentHistory,
  filterExperiments,
} from "./compose.ts";
import {
  attemptArtifactsPath,
  attemptsOfEval,
  diffText,
  displayAttemptNumber,
  evalDetailText,
  evalHistoryText,
  experimentHistoryText,
  pickDetailAttempt,
  traceText,
  transcriptText,
} from "./render.ts";

export interface ShowFlags {
  transcript?: boolean;
  trace?: boolean;
  /** --diff(文件级摘要)。 */
  diff?: boolean;
  /** --diff=<路径>(单个文件的完整改动;路径必须 = 连写,位置参数永远留给 eval id 前缀)。 */
  diffPath?: string;
  history?: boolean;
  experiment?: string;
  /** 人看的 1 计序号(详情块显示的 attempt 3 就传 3)。 */
  attempt?: number;
  run?: string;
  report?: string;
}

/** 注入 IO 供测试;默认写 stdout/stderr、宽度取终端列数。 */
export interface ShowIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  width?: number;
  now?: number;
}

/** 可预期的用户错误:打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
class ShowError extends Error {}

/** 内置默认报告:报告槽的出厂填充 —— `niceeval show` ≡ `show --report <这一份>`。 */
const builtinDefaultReport: ReportDefinition = defineReport(() => ({
  type: DefaultReport,
  props: {},
}));

function clampWidth(columns: number | undefined): number {
  if (!Number.isFinite(columns) || (columns ?? 0) <= 0) return 80;
  return Math.max(40, Math.min(columns as number, 160));
}

// --report 的装载移到中性模块(两个宿主共用),show 的导出面与错误行为不变。
export { loadReportFile } from "../report/load.ts";

/** 报告里的下钻命令:AttemptRef → `niceeval show <eval id>`(查不到时退 view 深链)。 */
function makeAttemptCommand(results: Results): (ref: AttemptRef) => string {
  const byRef = new Map<string, string>();
  for (const run of results.runDirs) {
    for (const attempt of run.attempts) {
      byRef.set(`${attempt.ref.run}/${attempt.ref.result}`, attempt.evalId);
    }
  }
  return (ref) => {
    const id = byRef.get(`${ref.run}/${ref.result}`);
    return id !== undefined ? `niceeval show ${id}` : `niceeval view "#/attempt/${ref.run}/${ref.result}"`;
  };
}

export async function runShow(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: ShowIO = {},
): Promise<number> {
  const out = io.out ?? ((text: string) => void process.stdout.write(text));
  const err = io.err ?? ((text: string) => void process.stderr.write(text));
  try {
    await show(cwd, patterns, flags, {
      out,
      err,
      width: clampWidth(io.width ?? process.stdout.columns),
      now: io.now ?? Date.now(),
    });
    return 0;
  } catch (e) {
    if (e instanceof ShowError || e instanceof ReportLoadError) {
      err(e.message.endsWith("\n") ? e.message : `${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function show(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: { out: (s: string) => void; err: (s: string) => void; width: number; now: number },
): Promise<void> {
  const evidence = flags.transcript === true || flags.trace === true || flags.diff === true || flags.diffPath !== undefined;

  // 组合语义矩阵(docs/reports.md):--history 与 --report 互斥,先于任何 IO 报出来。
  if (flags.history && flags.report !== undefined) {
    throw new ShowError(t("cli.show.historyReportConflict"));
  }

  const root = flags.run !== undefined ? resolve(cwd, flags.run) : join(cwd, ".niceeval");
  if (flags.run !== undefined && !existsSync(root)) {
    throw new ShowError(t("cli.show.runDirMissing", { dir: root }));
  }

  const results = await openResults(root);
  if (results.experiments.length === 0) {
    const skipped =
      results.skipped.length > 0
        ? `\n${results.skipped.map((s) => `  skipped ${s.dir} (${s.reason})`).join("\n")}\n`
        : "";
    throw new ShowError(t("cli.show.noResults", { root }) + skipped);
  }

  if (flags.experiment !== undefined && filterExperiments(results.experiments, flags.experiment).length === 0) {
    throw new ShowError(
      t("cli.show.noExperimentMatch", {
        arg: flags.experiment,
        experiments: results.experiments.map((e) => e.id).join(", "),
      }),
    );
  }

  const selection = composeShowSelection(results, { experiment: flags.experiment, patterns });
  const matchedEvalIds = [
    ...new Set(selection.snapshots.flatMap((s) => s.evals.map((e) => e.id))),
  ].sort();

  if (patterns.length > 0 && matchedEvalIds.length === 0) {
    const known = [
      ...new Set(filterExperiments(results.experiments, flags.experiment).flatMap((e) => e.evalIds)),
    ].sort();
    throw new ShowError(
      t("cli.show.noEvalMatch", { patterns: patterns.join(", "), evals: known.join(", ") || "(none)" }),
    );
  }

  // 证据切面是宿主本体:出现即走证据室,不渲染报告槽(与默认报告同规则)。
  if (evidence) {
    if (matchedEvalIds.length !== 1) {
      throw new ShowError(t("cli.show.evidenceNeedsEval", { matched: matchedEvalIds.length }));
    }
    const evalId = matchedEvalIds[0];
    const attempts = attemptsOfEval(selection.snapshots, evalId);
    const picked = pickDetailAttempt(attempts, flags.attempt);
    if (!picked) {
      throw new ShowError(
        t("cli.show.attemptNotFound", {
          attempt: flags.attempt ?? "?",
          evalId,
          available: attempts.map((a) => displayAttemptNumber(a)).join(", ") || "(none)",
        }),
      );
    }
    const header = `attempt ${displayAttemptNumber(picked)} · ${picked.experimentId} · ${picked.result.verdict}`;
    const artifactPath = attemptArtifactsPath(picked, cwd);
    const blocks: string[] = [];
    if (flags.transcript) {
      blocks.push(transcriptText({ header, events: await picked.events(), artifactPath, width: io.width }));
    }
    if (flags.trace) {
      blocks.push(traceText({ header, spans: await picked.trace(), artifactPath, width: io.width }));
    }
    if (flags.diff || flags.diffPath !== undefined) {
      blocks.push(diffText({ header, diff: await picked.diff(), artifactPath, file: flags.diffPath }));
    }
    io.out(blocks.join("\n\n") + "\n");
    return;
  }

  // --history:内置趋势视图。时间轴只列真实执行 —— resume 携带的复印件不占行。
  if (flags.history) {
    const experiments = filterExperiments(results.experiments, flags.experiment);
    const blocks: string[] = [];
    if (patterns.length === 0) {
      for (const exp of experiments) blocks.push(experimentHistoryText(exp.id, experimentHistory(exp)));
    } else {
      const multi = matchedEvalIds.length > 1;
      for (const evalId of matchedEvalIds) {
        for (const exp of experiments) {
          const rows = evalHistory(exp, evalId);
          if (rows.length === 0) continue;
          blocks.push(evalHistoryText({ experimentId: exp.id, ...(multi ? { evalId } : {}), rows }));
        }
      }
    }
    io.out(blocks.join("\n\n") + "\n");
    return;
  }

  // 单 eval 详情(宿主本体);--report 在场时报告槽优先,前缀只用来收窄选集。
  if (flags.report === undefined && patterns.length > 0 && matchedEvalIds.length === 1) {
    const evalId = matchedEvalIds[0];
    const attempts = attemptsOfEval(selection.snapshots, evalId);
    const detail = pickDetailAttempt(attempts, flags.attempt);
    if (flags.attempt !== undefined && !detail) {
      throw new ShowError(
        t("cli.show.attemptNotFound", {
          attempt: flags.attempt,
          evalId,
          available: attempts.map((a) => displayAttemptNumber(a)).join(", ") || "(none)",
        }),
      );
    }
    io.out(
      evalDetailText({
        evalId,
        snapshots: selection.snapshots,
        ...(detail ? { detail } : {}),
        cwd,
        now: io.now,
        width: io.width,
      }) + "\n",
    );
    return;
  }

  if (flags.attempt !== undefined) {
    // --attempt 只对单 eval 的详情/证据生效;报告槽/榜单下无从对位。
    throw new ShowError(t("cli.show.attemptNeedsEval"));
  }

  // 报告槽:--report 整槽替换,否则内置默认报告(同一条渲染路径)。
  const definition =
    flags.report !== undefined ? await loadReportFile(cwd, flags.report) : builtinDefaultReport;
  const text = await renderReportToText(
    definition,
    { selection, results },
    { width: io.width, attemptCommand: makeAttemptCommand(results) },
  );
  io.out(text + "\n");
}
