// niceeval show —— 终端宿主(行为规范:docs-site/zh/guides/viewing-results.mdx;
// 宿主组合语义:docs/feature/reports/architecture.md「Selection 是计算入口」)。
//
// 位置参数 = eval id 前缀,或 `@<locator>`(精确指名单个 attempt,见 results/locator.ts):
//   裸跑 / 多 eval 前缀  默认 ExperimentComparison 的 text 面(单 eval 前缀仍进入详情)
//   恰好一个 eval     单 eval 详情(attempt / 断言明细,宿主本体)
//   @<locator>        精确 attempt:无证据 flag → 紧凑全景;带 flag → 对应证据切面
//   --eval / --execution / --diff[=路径]   证据切面(宿主本体):出现即走证据室,不渲染报告槽
//   --history        跨 run 时间轴(内置趋势视图),与 --report 互斥
//   --report <文件>  整槽换成用户报告;位置前缀 / --run / --experiment 先收窄 Selection 再注入
//   --run <目录>     结果根换成该目录;--experiment Selection 只留该实验
//
// 数据全部走 niceeval/results 的读取面(openResults + 合成 Selection + loadAttemptEvidence),
// 不自己爬目录；证据可用性只由 loadAttemptEvidence 在单 Attempt 页面计算。

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  openResults,
  resolveLocator,
  loadAttemptEvidence,
  ATTEMPT_LOCATOR_PREFIX,
  LocatorNotFoundError,
  MalformedLocatorError,
} from "../results/index.ts";
// report.ts / load.ts have no JSX of their own, but ReportDefinition / ReportLoadError must
// come from the SAME module instance ExperimentComparison (built-ins, .tsx) is built
// against — `unique symbol` branding and `instanceof` are keyed by declaration site, so a raw
// src copy and the compiled dist copy of "the same" ReportDefinition are, to TypeScript and to
// `instanceof`, two different types. The package-owned report runtime ships as precompiled
// ESM (dist/report/**, built by `pnpm run build:report`, immune to a consumer's cwd/tsconfig
// when niceeval is linked in — see tsconfig.report-build.json); show pulls all of it from
// there, not just the .tsx-touching pieces.
import { renderReportToText } from "../../dist/report/report.js";
import { ExperimentComparison } from "../../dist/report/built-ins/index.js";
import { ReportLoadError, loadReportFile } from "../../dist/report/load.js";
import { detectLocale, t } from "../i18n/index.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { selectCurrentResults, filterExperiments } from "../results/select.ts";
import { evalHistory, experimentHistory } from "./compose.ts";
import {
  attemptArtifactsPath,
  attemptEvidenceHeader,
  attemptIndexLine,
  attemptOverviewText,
  attemptsOfEval,
  diffText,
  evalDetailText,
  evalHistoryText,
  evalSourceText,
  executionText,
  experimentHistoryText,
  timingText,
  pickDetailAttempt,
  skippedRunsText,
  verdictReasonLine,
} from "./render.ts";

export interface ShowFlags {
  /** 该 attempt 运行时保存的 Eval 源码,断言标回源码行(证据切面)。 */
  eval?: boolean;
  /** 该 attempt 的标准执行事件流 + OTel enrichment(证据切面)。 */
  execution?: boolean;
  /** --timing:默认有界诊断投影；full 逐节点展开。boolean 仅供库调用兼容，等价 summary。 */
  timing?: boolean | "summary" | "full";
  /** --diff(文件级摘要)。 */
  diff?: boolean;
  /** --diff=<路径>(单个文件的完整改动;路径必须 = 连写,位置参数永远留给 eval id 前缀)。 */
  diffPath?: string;
  history?: boolean;
  experiment?: string;
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

function clampWidth(columns: number | undefined): number {
  if (!Number.isFinite(columns) || (columns ?? 0) <= 0) return 80;
  return Math.max(40, Math.min(columns as number, 160));
}

// --report 的装载移到中性模块(两个宿主共用),show 的导出面与错误行为不变。
export { loadReportFile } from "../../dist/report/load.js";

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
  const evidence =
    flags.eval === true ||
    flags.execution === true ||
    (flags.timing !== undefined && flags.timing !== false) ||
    flags.diff === true ||
    flags.diffPath !== undefined;

  // 组合语义矩阵(docs/feature/reports/show.md「选择结果范围」):--history 与 --report 互斥,先于任何 IO 报出来。
  if (flags.history && flags.report !== undefined) {
    throw new ShowError(t("cli.show.historyReportConflict"));
  }

  const root = flags.run !== undefined ? resolve(cwd, flags.run) : join(cwd, ".niceeval");
  if (flags.run !== undefined && !existsSync(root)) {
    throw new ShowError(t("cli.show.runDirMissing", { dir: root }));
  }

  const results = await openResults(root);
  if (results.experiments.length === 0) {
    const skipped = results.skipped.length > 0 ? `\n${skippedRunsText(results.skipped, root, cwd)}\n` : "";
    throw new ShowError(t("cli.show.noResults", { root }) + skipped);
  }

  // `@<locator>` 位置参数:身份直达单个 attempt,与 eval id 前缀匹配完全不同的语义
  // (`@` 打头对 eval id 天然无歧义,见 locator.ts),必须在下面的前缀匹配逻辑之前分流掉,
  // 不然 "@1x7f3q" 会被当成一个谁都匹配不到的 eval id 前缀,报「no eval match」这种文不对题的
  // 错误。这一步只解析并渲染出「当前 show 对单个已解析 attempt 能渲染的东西」(单 eval 详情 /
  // 三个证据切面)——真正的 `--eval`/`--execution`/`--diff` 统一 attempt 全景是后续阶段。
  const locatorArg = patterns.find((p) => p.startsWith(ATTEMPT_LOCATOR_PREFIX));
  if (locatorArg !== undefined) {
    if (patterns.length !== 1) {
      throw new ShowError(
        `An attempt locator ("${locatorArg}") must be the only positional argument; got ${patterns.length}: ${patterns.join(", ")}.`,
      );
    }
    let attempt;
    try {
      attempt = resolveLocator(results, locatorArg);
    } catch (e) {
      if (e instanceof MalformedLocatorError) throw new ShowError(t("cli.show.locatorMalformed", { message: e.message }));
      if (e instanceof LocatorNotFoundError) throw new ShowError(t("cli.show.locatorNotFound", { message: e.message }));
      throw e;
    }
    const attemptEvidence = await loadAttemptEvidence(attempt);
    const header = attemptEvidenceHeader(attemptEvidence);
    const artifactPath = attemptArtifactsPath(attempt, cwd);
    if (evidence) {
      const blocks: string[] = [];
      if (flags.eval) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width: io.width }));
      if (flags.execution) blocks.push(executionText(attemptEvidence, { header, artifactPath, width: io.width }));
      if (flags.timing) blocks.push(timingText(attemptEvidence, {
        header,
        artifactPath,
        width: io.width,
        mode: flags.timing === "full" ? "full" : "summary",
      }));
      if (flags.diff || flags.diffPath !== undefined) {
        blocks.push(diffText({ header, diff: attemptEvidence.diff, artifactPath, file: flags.diffPath }));
      }
      io.out(blocks.join("\n\n") + "\n");
      return;
    }
    io.out(attemptOverviewText(attemptEvidence, { header, artifactPath, width: io.width }) + "\n");
    return;
  }

  if (flags.experiment !== undefined && filterExperiments(results.experiments, flags.experiment).length === 0) {
    throw new ShowError(
      t("cli.show.noExperimentMatch", {
        arg: flags.experiment,
        experiments: results.experiments.map((e) => e.id).join(", "),
      }),
    );
  }

  const selection = selectCurrentResults(results, { experiment: flags.experiment, patterns });
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
      // 撞多个 eval 时不止说「有几个」,直接给紧凑索引(locator + 失败原因)
      // 让 agent 一步摘到 `@<locator>`,不必再跑一轮 `show <eval id>` 才知道选谁。
      const index = matchedEvalIds
        .map((evalId) => {
          const attempts = attemptsOfEval(selection.snapshots, evalId);
          const rep = pickDetailAttempt(attempts);
          const verdict = foldEvalVerdict(attempts.map((a) => a.result));
          return attemptIndexLine({
            evalId,
            verdict,
            locator: rep?.locator,
            reason: rep ? verdictReasonLine(rep.result) : undefined,
          });
        })
        .join("\n");
      throw new ShowError(t("cli.show.evidenceNeedsEval", { matched: matchedEvalIds.length, index }));
    }
    const evalId = matchedEvalIds[0];
    const attempts = attemptsOfEval(selection.snapshots, evalId);
    const picked = pickDetailAttempt(attempts);
    if (!picked) throw new Error(`internal error: eval "${evalId}" matched by selection but has no attempts`);
    const attemptEvidence = await loadAttemptEvidence(picked);
    const header = attemptEvidenceHeader(attemptEvidence);
    const artifactPath = attemptArtifactsPath(picked, cwd);
    const blocks: string[] = [];
    if (flags.eval) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width: io.width }));
    if (flags.execution) blocks.push(executionText(attemptEvidence, { header, artifactPath, width: io.width }));
    if (flags.timing) blocks.push(timingText(attemptEvidence, {
      header,
      artifactPath,
      width: io.width,
      mode: flags.timing === "full" ? "full" : "summary",
    }));
    if (flags.diff || flags.diffPath !== undefined) {
      blocks.push(diffText({ header, diff: attemptEvidence.diff, artifactPath, file: flags.diffPath }));
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

  // 单 eval 详情(宿主本体);--report 在场时报告槽优先,前缀只用来收窄 Selection。
  // 挑哪个 attempt 展开明细不再收数字 --attempt——pickDetailAttempt 的默认启发式
  // (最新一次失败,没有失败挑最新一次)是唯一路径;精确选某一次走 `@<locator>`。
  if (flags.report === undefined && patterns.length > 0 && matchedEvalIds.length === 1) {
    const evalId = matchedEvalIds[0];
    const attempts = attemptsOfEval(selection.snapshots, evalId);
    const detail = pickDetailAttempt(attempts);
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

  // 裸 show 与裸 view 选择同一个普通默认 definition,这里只是渲染 text 面。
  // --report 替换同一个报告槽。locale = CLI 界面语言(NICEEVAL_LANG / LC_* / LANG 检测):报告 chrome 文案跟随
  // 终端语言(docs/feature/reports/library.md「locale:渲染面的语言」);Locale 与 ReportLocale 同为
  // "en" | "zh-CN",直接传递。
  const definition = flags.report === undefined ? ExperimentComparison : await loadReportFile(cwd, flags.report);
  // attemptCommand 留给 renderReportToText 的默认值:AttemptLocator 已经是可直接 `niceeval show
  // @<locator>` 的真实 CLI 语法,不需要再反查 eval id 拼一条近似命令(见 tree.ts 的默认实现)。
  const text = await renderReportToText(definition, { selection, results }, { width: io.width, locale: detectLocale() });
  io.out(text + "\n");
}
