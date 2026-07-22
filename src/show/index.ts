// niceeval show —— 终端宿主(行为规范:docs/feature/reports/show.md 与分篇;
// 宿主组合语义:docs/feature/reports/architecture.md「Scope 是计算入口」)。
//
// 位置参数 = eval id 前缀,或 `@<locator>`(精确指名单个 attempt,见 results/locator.ts):
//   裸跑 / 多 eval 前缀  内建报告(niceeval/report/built-in 默认导出)的 text 面(单 eval 前缀仍进入详情)
//   恰好一个 eval     单 eval 详情(attempt / 断言明细,宿主本体)
//   @<locator>        精确 attempt:无证据 flag → 当前 report 的 attempt-input page(内建 standard
//                     或 --report 自定义);带 flag → 对应证据切面(宿主本体,不经报告管线)
//   --source / --execution / --diff[=路径]   证据切面(宿主本体):出现即走证据室,不渲染报告槽
//   --history        执行时间轴(逐 experimentId + evalId 分节),与 --report 互斥
//   --report <文件>  整槽换成用户报告;位置前缀 / --results / --exp 先收窄 Scope 再注入
//   --page <id>      多页报告选页;未命中列出可用页 id 按用法错误退出
//   --results <目录>  结果根换成该目录;--exp 让 Scope 只留该实验
//
// 数据全部走 niceeval/results 的读取面(openResults + 合成 Scope + loadAttemptEvidence),
// 不自己爬目录;证据可用性只由 loadAttemptEvidence 在单 Attempt 页面计算。

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
// ReportLoadError must come from the SAME module instance the report runtime is built
// against — `instanceof` is keyed by declaration site, so a raw src copy and the compiled
// dist copy of "the same" class are two different types. The package-owned report runtime
// ships as precompiled ESM (dist/report/**, built by `pnpm run build:report`); all report
// loading/rendering goes through ../report/runtime/host.ts (the shared contact surface).
import { ReportLoadError } from "../../dist/report/runtime/load.js";
import { detectLocale, t } from "../i18n/index.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { selectCurrentResults, filterExperiments } from "../results/select.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import { attemptHistory } from "./compose.ts";
import {
  buildHostReportMeta,
  HostReportError,
  loadHostReport,
  renderHostPageText,
  type HostCommandContext,
} from "../report/runtime/host.ts";
import {
  attemptArtifactsPath,
  attemptEvidenceHeader,
  attemptHistoryText,
  attemptIndexLine,
  attemptsOfEval,
  diffText,
  evalDetailText,
  evalSourceText,
  executionText,
  otherPagesText,
  timingText,
  pickDetailAttempt,
  skippedRunsText,
  verdictReasonLine,
} from "./render.ts";

export interface ShowFlags {
  /** --source:该 attempt 运行时保存的 Eval 源码,断言标回源码行(证据切面)。 */
  source?: boolean;
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
  /** --results:结果根目录(某次快照根或 `copySnapshots` 产物)。 */
  results?: string;
  report?: string;
  /** --page:多页报告选页;未命中按用法错误退出并列出可用页 id。 */
  page?: string;
  /** --fresh:只统计新执行的 attempt(排除携带条目与跨快照拼入的历史执行)。 */
  fresh?: boolean;
}

/** 注入 IO 供测试;默认写 stdout/stderr、宽度取终端列数。 */
export interface ShowIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  width?: number;
  now?: number;
  /** `Section` 的框线传输能力(docs/feature/reports/library/layout.md「区域框」);省略时按
   *  `process.stdout.isTTY` 与 `NO_COLOR` 探测——测试注入固定值,不依赖真实终端设备。 */
  panelMode?: "boxed" | "plain";
}

/** 真实 CLI 入口的框线传输能力探测:是 TTY 且没有要求朴素输出时才画框。 */
function detectPanelMode(): "boxed" | "plain" {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined ? "boxed" : "plain";
}

/** 可预期的用户错误:打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
class ShowError extends Error {}

function clampWidth(columns: number | undefined): number {
  if (!Number.isFinite(columns) || (columns ?? 0) <= 0) return 80;
  return Math.max(40, Math.min(columns as number, 160));
}

// --report 的装载住在 ../report/runtime/host.ts(两个宿主共用的中性联系面);规范化本身是
// `defineReport` 自己的职责,不在宿主层重复。
export { loadHostReport, localizeText } from "../report/runtime/host.ts";

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
      panelMode: io.panelMode ?? detectPanelMode(),
    });
    return 0;
  } catch (e) {
    if (e instanceof ShowError || e instanceof ReportLoadError || e instanceof HostReportError) {
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
  io: { out: (s: string) => void; err: (s: string) => void; width: number; now: number; panelMode: "boxed" | "plain" },
): Promise<void> {
  const evidence =
    flags.source === true ||
    flags.execution === true ||
    (flags.timing !== undefined && flags.timing !== false) ||
    flags.diff === true ||
    flags.diffPath !== undefined;

  // 组合语义矩阵(docs/feature/reports/show.md「选择结果范围」):--history 与 --report 互斥,先于任何 IO 报出来。
  if (flags.history && flags.report !== undefined) {
    throw new ShowError(t("cli.show.historyReportConflict"));
  }

  // --page 只在报告槽里有意义:证据切面 / 时间轴与它组合是用法矛盾,先于任何 IO 报出来。
  if (flags.page !== undefined && (evidence || flags.history)) {
    throw new ShowError(
      `--page selects a report page and cannot be combined with ${flags.history ? "--history" : "evidence flags"}.\n`,
    );
  }

  const root = flags.results !== undefined ? resolve(cwd, flags.results) : join(cwd, ".niceeval");
  if (flags.results !== undefined && !existsSync(root)) {
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
  // 错误。
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
      if (flags.source) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width: io.width }));
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
    // 无证据 flag:选中当前 report definition 里唯一的 attempt-input page,注入这份 evidence,
    // 走与其它 page 完全相同的 resolve → validate → render 管线(docs/feature/reports/show/attempt.md;
    // docs/feature/reports/library/attempt-detail.md「在 show 与 view 怎样渲染」)。不带 --report
    // 时装载内建 standard,其中就带这张 page;--report 指向的自定义报告没有声明 attempt-input page
    // 时报完整用户反馈,不回退到内建详情(三条解决路径都在错误文案里给出)。
    const report = await loadHostReport(cwd, flags.report);
    const attemptPage = report.pages.find((p) => p.input === "attempt");
    if (attemptPage === undefined) {
      const sourceLabel = flags.report ?? "the built-in report";
      throw new ShowError(
        `error: ${sourceLabel} has no attempt-input page — "${locatorArg}" cannot be opened without one. ` +
          `Add one: use \`extends: standard\` (inherits its attempt page), import { standardAttemptPage } from ` +
          `"niceeval/report/built-in" and add it to your pages list, or declare your own \`input: "attempt"\` page.\n`,
      );
    }
    const locale = detectLocale();
    const selection = selectCurrentResults(results, { fresh: flags.fresh });
    const meta = await buildHostReportMeta(report, selection);
    const text = await renderHostPageText(
      attemptPage,
      {
        scope: selection,
        results,
        report: meta,
        page: { id: attemptPage.id, input: "attempt", locator: attempt.locator!, evidence: attemptEvidence },
      },
      { width: io.width, locale, panelMode: io.panelMode },
    );
    io.out(text + "\n");
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

  const selection = selectCurrentResults(results, { experiment: flags.experiment, patterns, fresh: flags.fresh });
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
    if (flags.source) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width: io.width }));
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

  // --history:执行时间轴(docs/feature/reports/show.md「--history:一个 eval 的执行时间轴」)。
  // 对 Scope 中匹配的每个 experimentId + evalId 分节,逐 attempt 而非逐快照;时间轴只列
  // 真实执行 —— resume 携带的复印件按 attempt 身份键去重后不占行。
  if (flags.history) {
    const experiments = filterExperiments(results.experiments, flags.experiment);
    // eval 位置参数与 Scope 选择用同一个前缀谓词(单点在 shared/aggregate.ts),不另立口径。
    const matchesPattern = patterns.length > 0 ? evalPrefixPredicate(patterns) : () => true;
    const blocks: string[] = [];
    for (const exp of experiments) {
      const evalIds = [...exp.evalIds].filter(matchesPattern).sort();
      for (const evalId of evalIds) {
        const rows = attemptHistory(exp, evalId);
        if (rows.length === 0) continue;
        blocks.push(attemptHistoryText({ experimentId: exp.id, evalId, rows }));
      }
    }
    io.out(blocks.join("\n\n") + "\n");
    return;
  }

  // 单 eval 详情(宿主本体);--report / --page 在场时报告槽优先,前缀只用来收窄 Scope。
  // 挑哪个 attempt 展开明细不再收数字 --attempt——pickDetailAttempt 的默认启发式
  // (最新一次失败,没有失败挑最新一次)是唯一路径;精确选某一次走 `@<locator>`。
  if (flags.report === undefined && flags.page === undefined && patterns.length > 0 && matchedEvalIds.length === 1) {
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

  // 报告槽:裸 show 装载 `niceeval/report/built-in` 的默认导出,--report 整槽替换——同一条
  // 「装载 → 规范化(外壳 + 非空页列表)→ 逐页渲染」管线(docs/feature/reports/library/shell.md)。
  // locale = CLI 界面语言(NICEEVAL_LANG / LC_* / LANG 检测):报告 chrome 文案跟随终端语言。
  const report = await loadHostReport(cwd, flags.report);
  const locale = detectLocale();
  const commandContext: HostCommandContext = {
    patterns,
    ...(flags.results !== undefined ? { results: flags.results } : {}),
    ...(flags.report !== undefined ? { report: flags.report } : {}),
    ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
  };
  const sourceLabel = flags.report ?? "the built-in report";

  // 初始页 = --page 指定的页,缺省第一张可导航页(docs/feature/reports/show/reports.md
  // Case 2);本地宿主只 resolve 被打开的这一页——其余页只留 id / title,不触发取数(见
  // shell.md「行为约束」「本地宿主只 resolve 被打开的页」)。navigation:false 的页(参数化
  // attempt 详情)不参与缺省选择,也不能被 --page 直接打开——没有 locator 不能拿 Scope 强行
  // resolve(architecture.md「Attempt 详情是一张参数化 page」)。
  let page = report.pages.find((p) => p.navigation !== false) ?? report.pages[0];
  if (flags.page !== undefined) {
    const hit = report.pages.find((p) => p.id === flags.page);
    if (!hit) {
      // 用法错误:列出可用页 id(docs/feature/reports/show/reports.md Case 1/2 的报错样例)。
      throw new ShowError(
        `error: page "${flags.page}" not found in ${sourceLabel}. Available pages: ${report.pages.filter((p) => p.navigation !== false).map((p) => p.id).join(", ")}\n`,
      );
    }
    if (hit.input === "attempt") {
      throw new ShowError(
        `error: page "${hit.id}" in ${sourceLabel} is an attempt-input page and needs a locator — it cannot be opened with --page directly. Use niceeval show @<locator> instead.\n`,
      );
    }
    page = hit;
  }

  // attemptCommand 留给渲染管线的默认值:AttemptLocator 已经是可直接 `niceeval show @<locator>`
  // 的真实 CLI 语法,不需要再反查 eval id 拼一条近似命令。
  const meta = await buildHostReportMeta(report, selection);
  const text = await renderHostPageText(
    page,
    { scope: selection, results, report: meta, page: { id: page.id, input: "scope" } },
    {
      width: io.width,
      locale,
      panelMode: io.panelMode,
      commandContext: { ...commandContext, ...(flags.page !== undefined ? { page: flags.page } : {}) },
    },
  );

  // 页数大于一时尾部附「其余页」索引(只列未渲染、且可导航的页,不倾倒内容);单页定义
  // 没有这段;隐藏的 attempt page 不出现在「其余页」里。
  const remaining = report.pages.filter((p) => p.id !== page.id && p.navigation !== false);
  if (remaining.length === 0) {
    io.out(text + "\n");
    return;
  }
  const tail = otherPagesText({
    otherPages: remaining.map((p) => ({ id: p.id, title: p.title })),
    command: commandContext,
    locale,
  });
  io.out(`${text}\n\n${tail}\n`);
}
