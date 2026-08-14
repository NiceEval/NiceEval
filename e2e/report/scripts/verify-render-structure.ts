// Render-structure 与终端排版 domain(docs/engineering/testing/e2e/report.md §5 的前三条要点——
// 结构 / 终端排版 / 双面同源;plan/testing-layer-realignment.md B3)。
// 消费 scripts/evidence.ts 产出的 Evidence 对象;自己从不运行任何 Experiment。
//
// 遵循 CLI-black-box 约定(README §4.2):下面每一条事实都只来自 `pnpm exec niceeval show ...`
// 的 stdout,或者对 evidence.siteExportDir 已经产出的某个文件的普通 fs 读取
// (`niceeval view --out` 的静态导出——一份有文档记录的 CLI 输出契约,不是 `.niceeval/` 内部
// 结构)。不 import niceeval 库代码,不扫描 `.niceeval/`。
//
// 断言都停留在字符串/正则这个层级,针对真实渲染出的输出——report.md 说渲染类断言"不锁完整
// class 列表",不需要 HTML parser。这里没有任何一处锁定颜色的具体值、像素位置,或者完整的
// class 属性快照;对于那些每次运行都会变化的事实(真实的美元成本、token 数、"落后 N 秒"的
// 过期时间窗口),本模块会从文本面和 web 面各提取出同一个事实,拿两者互相比较,而不是和一个
// 硬编码的字面量比较。
//
// 关于本仓库这 3 个 Eval 的已知固定事实,下文当作既定事实使用(和 scripts/verify-format.ts
// 硬编码 "get_stock_price" 是同一套约定):
//   - deliberate-fail.eval.ts 恒定失败于 `t.check(1 + 1, equals(3))`——expected 3,received 2。
//   - deliberate-error.eval.ts 恒定在任何 t.send/t.check 之前就抛出异常(phase 是 eval.run,
//     code 是 unexpected-error)——没有 source capability,0 条 assertion。
//   - main 的 agent 是 "results-mechanism"(experiments/main.ts 里 aiSdkAgent 的名字);
//     deliberate-fail 的是 "results-deliberate-fail";deliberate-error 的是
//     "results-deliberate-error"。
//   - produceEvidence() 恒定在 main 之前先跑 deliberate-fail/deliberate-error,所以 main 的
//     快照恒定是最新的——deliberate-fail/deliberate-error 恒定是 ScopeWarnings 标记为过期的
//     那两个(恒定是 2 个被标记的 experiment)。
//   - deliberate-fail/deliberate-error 从不调用真实网关,所以它们恒定没有成本数据——
//     MetricScatter 的 points="experiment" 散点图恒定只有 1 个可绘制的点(main),并报告恒定
//     有 2 个点缺失数据。
//
// 覆盖缺口——在这里明确声明,而不是悄悄假装覆盖到了(任务要求:列出没覆盖到的部分,而不是
// 假装覆盖了)。以下缺口都没有通过改动 scripts/evidence.ts 或共享的 `.niceeval/` 树来绕过;
// 每一条要么需要更丰富的证据(新增 Experiment/Eval,这个决定应该由人来做,不是本模块自己
// 做),要么需要一个真实浏览器(B4):
//
//   1. MetricScatter 字符标记的分配顺序(图例 key 顺序、同一 series 内部按 x 升序排列的顺序)
//      以及 `connect` 的连线/位移摘要契约,都无法被验证到:本仓库的散点图恒定只有 1 个可绘制
//      的点(见上文),所以没有东西可排序,也没有东西可连线。需要第二个真实网关 Experiment
//      (或者一条 `labels: { line }` 声明让 2 个以上 experiment 连起来),产出一个同时带成本
//      和通过率数据的第 2 个点。
//   2. `Section` 的方框绘制边框(嵌套子标题的横条、窄宽度下退化为纯文本)和 `Grid` 的列数规划,
//      在内置的 `standard` 报告里哪里都不会渲染出来(已核实:<Section> 和 <Grid> 都不出现在
//      standard 的页面树里,`show` 的各种 flag 驱动视图——裸命令、--page attempts/traces、
//      --execution/--timing/--diff——也都不会用到它们)。要验证它们需要一份用到这些原语的
//      自定义 --report 文件——这正是 B5 声明要交付的东西("签入代表性 --report 文件"),
//      不是本模块的职责。
//   3. `MetricTable` / `MetricMatrix` / `Scoreboard` 同样不出现在内置的 `standard` 报告里,
//      所以本模块的跨组件颜色一致性检查(要点 1)只覆盖到了确实出现在那里的 3 个组件:
//      `ExperimentList`、`AttemptList`、`MetricScatter` 的图例(针对全部 3 个真实 agent
//      key 都已验证一致)——没有覆盖 report.md 提到的完整组件列表。和 #2 一样,同样是需要
//      「自定义 --report 文件」的缺口。
//   4. `ReportLink.icon` 那种「内联 SVG 出现在标签前面」的渲染无法测试:当前证据的报告根本
//      没有声明任何 `links`(`niceeval.config.ts` 没有 `--report`,
//      `window.__NICEEVAL_VIEW_DATA__.report.links` 是 `[]`)——scope 里任何地方都没有带
//      icon 的 ReportLink。需要一份声明了带 `icon` 的 `links` 条目的自定义 --report 文件。
//   5. `view` 外壳的顶部导航栏(NiceEval 品牌标志、它精确的 DOM 位置,以及实际渲染出来的
//      导航项元素本身)无法用字符串/正则断言来验证:静态导出的 `index.html` 里只有一个空的
//      `<div id="root"></div>`——顶部导航栏完全是客户端 JS 在 hydration 之后根据
//      `window.__NICEEVAL_VIEW_DATA__` 构建出来的(已通过检查打包产物核实:品牌链接、
//      `.topbar`/`.brand`/`.mark` 这些 class 以及导航本身,只存在于压缩后的 JS 里,从来不是
//      静态标记)。本模块转而验证驱动顶部导航栏的那份数据契约(`report.pages` 恰好等于
//      navigation !== false 的那些页,按声明顺序排列,不含 attempt-input 页)——不验证顶部
//      导航栏实际渲染出来的 DOM。那需要一个真实浏览器:B4。
//   6. Table 的"丢列标注"(显式的被丢弃列数提示,例如 "(4 more columns not shown)")是真实、
//      已确认存在的行为(在本任务开发过程中用真实 pty 强制宽度为 40 手工核实过),但从这个
//      CLI-black-box 脚本里够不着:`niceeval show` 没有 `--width`/环境变量覆盖项,`sh()` 的
//      spawnSync 也不提供 pty,所以这里每一次调用都跑在 CLI 的非 TTY 兜底宽度(80)下——对于
//      本证据里这些表格的形状来说,80 这个宽度还不足以触发丢列(只会触发折行,已验证并覆盖在
//      下文)。宽度 80 本身就是一个合法的真实场景(任何管道/非交互式的 `show` 调用都会落在
//      这个宽度),所以本模块覆盖了宽度 80 下的折行(折行),但没有覆盖更窄宽度下的丢列(丢列)。
//   7. `ScopeWarnings` 与 `SnapshotDiagnostics` 的非空渲染(计数汇总行、按实验/kind 聚合分组、
//      折叠阈值、徽标)、以及 ScopeWarnings 消息的双面一致性,都无法用这份证据验证:警告 kind
//      全集(docs/feature/sample/library.md#警告-kind-全集)现在只剩 unfinished-snapshot /
//      missing-startedAt / unreadable-snapshot 三种,produceEvidence() 的 main /
//      deliberate-fail / deliberate-error 都是正常收尾、schema 合规、带 startedAt 的完整快照,
//      不触发任何一种——warnings 与 diagnostics 恒为空集,两个组件两面都零输出(本模块只断言
//      「不渲染」,见 verifyScopeWarningsBrandAndNavigation)。要覆盖非空路径需要一份专门构造
//      不完整/不可读快照或强杀中断的 fixture,这个决定应该由人来做,不是本模块自己造假快照
//      绕过。同一份证据里 `GroupMatrix`(内建 standard 报告首页新接线的组件,紧跟在
//      `ExperimentComparison` 后面)同样是零输出——本仓库的 3 个 Eval 都没有用 `t.group`
//      产生分组证据(docs/feature/reports/library/built-in.md:「没有分组证据时后者零输出」),
//      所以它不出现在渲染出的 HTML 里,本模块也没有断言它的非空路径。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { sh } from "./sh.ts";
import type { Evidence } from "./evidence.ts";

const AGENT = {
  main: "results-mechanism",
  deliberateFail: "results-deliberate-fail",
  deliberateError: "results-deliberate-error",
} as const;

/** AttemptDetails 声明的区块顺序(完整出处见 docs/feature/reports/components/attempt-detail/attempt-detail.md):
 * Summary、Assessment(先 Error,再 Source-or-Assertions)、FixPrompt、Timeline、
 * Diagnostics、Usage、Conversation、Trace、Diff；events artifact 缺失时在对话位置显示
 * execution evidence unavailable warning。 */
const ATTEMPT_DETAIL_ORDER = [
  "attempt-summary",
  "attempt-error",
  "attempt-source",
  "attempt-fix-prompt",
  "attempt-conversation",
  "attempt-timeline",
  "usage-table",
  "attempt-diagnostics",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `show` 的 ScopeSummary 那一行,会在 CLI 的非 TTY 兜底宽度(80)下,在某个取决于它前面那段
 * 真实(每次运行都会变化)通过率/成本文本的位置发生折行——例如 "...· 1 failed · 1\nerrored ·
 * Total cost..."——所以对原始文本做简单的多词子串检查,会因为折行具体落在哪里而出现假失败。
 * 这个函数在做包含检查之前,先把所有连续空白(包括折行产生的换行符)折叠成单个空格。 */
function looseIncludes(text: string, phrase: string): boolean {
  return text.replace(/\s+/g, " ").includes(phrase);
}

function extractTextStatValue(text: string, label: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const labels of [["Pass rate", "Experiments", "Evals"], ["Attempts", "Eval results", "Total cost"]]) {
    const column = labels.indexOf(label);
    if (column < 0) continue;
    const header = lines.findIndex((line) => labels.every((candidate) => line.includes(candidate)));
    if (header < 0) return null;
    const starts = labels.map((candidate) => lines[header]!.indexOf(candidate));
    const end = starts[column + 1];
    return lines[header + 1]!.slice(starts[column], end).trim();
  }
  return null;
}

function readSiteFile(evidence: Evidence, ...parts: string[]): string {
  return readFileSync(join(evidence.siteExportDir, ...parts), "utf8");
}

function attemptHtml(evidence: Evidence, locator: string): string {
  return readSiteFile(evidence, "attempt", `${encodeURIComponent(locator)}.html`);
}

/** attempt/<locator>.html 把两种 locale 作为并列的 `data-niceeval-locale` 包裹 div 一起携带;
 * 由于区块顺序/是否出现和 locale 无关,这里只切出 "en" 那一份副本。 */
function englishLocaleSlice(html: string): string {
  const start = html.indexOf('data-niceeval-locale="en"');
  const end = html.indexOf('data-niceeval-locale="zh-CN"');
  assert.ok(start >= 0 && end > start, "attempt HTML is missing the expected en/zh-CN locale wrapper divs");
  return html.slice(start, end);
}

function attemptBlockOrder(evidence: Evidence, locator: string): string[] {
  const en = englishLocaleSlice(attemptHtml(evidence, locator));
  const blocks: string[] = [];
  const re = /<[a-z]+ class="niceeval-report ([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en))) {
    const classes = m[1]!.split(" ");
    if (classes.includes("niceeval-attempt-summary")) blocks.push("attempt-summary");
    else if (classes.includes("niceeval-source-view")) blocks.push("attempt-source");
    else if (classes.includes("niceeval-copy-block")) blocks.push("attempt-fix-prompt");
    else if (classes.includes("niceeval-conversation")) blocks.push("attempt-conversation");
    else if (classes.includes("niceeval-waterfall")) blocks.push("attempt-timeline");
    else if (classes.includes("niceeval-usage-table")) blocks.push("usage-table");
    else if (classes.includes("niceeval-callouts")) {
      blocks.push(blocks.includes("attempt-source") ? "attempt-diagnostics" : "attempt-error");
    }
  }
  return blocks;
}

function assertSubsequenceOfCanonicalOrder(present: string[], context: string): void {
  let lastIdx = -1;
  for (const block of present) {
    const idx = ATTEMPT_DETAIL_ORDER.indexOf(block);
    assert.ok(idx >= 0, `${context}: rendered block "${block}" isn't in AttemptDetails's canonical block set`);
    assert.ok(idx > lastIdx, `${context}: block "${block}" rendered out of AttemptDetails's declared order (docs/feature/reports/components/attempt-detail/attempt-detail.md), full order: ${present.join(" -> ")}`);
    lastIdx = idx;
  }
}

function extractTemplate(indexHtml: string, templateId: string): string {
  const m = indexHtml.match(new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`));
  assert.ok(m, `index.html has no <template id="${templateId}">`);
  return m![1]!;
}

// ---------------------------------------------------------------------------
// 结构 (1/3):AttemptDetails 区块的出现/顺序/零输出、默认展开的 <details>、expected/received
// 文本、locator 链接 + drill-down 命令。
// ---------------------------------------------------------------------------

async function verifyAttemptDetailStructure(evidence: Evidence): Promise<void> {
  const mainLocator = evidence.main.attempts[0]!.locator;
  const failLocator = evidence.deliberateFail.attempt.locator;
  const errorLocator = evidence.deliberateError.attempt.locator;

  // --- Passed attempt(main):source capability 为 true(真实发生过 send/tool-call)-> 会渲染
  //     Summary、Source、Timeline、Usage、Conversation;其余部分没有证据可渲染。
  const mainBlocks = attemptBlockOrder(evidence, mainLocator);
  assertSubsequenceOfCanonicalOrder(mainBlocks, `attempt/${mainLocator}.html (passed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-conversation", "attempt-timeline", "usage-table"]) {
    assert.ok(mainBlocks.includes(must), `passed attempt ${mainLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-fix-prompt", "attempt-diagnostics"]) {
    assert.ok(!mainBlocks.includes(mustNot), `passed attempt ${mainLocator} unexpectedly rendered "${mustNot}" — zero-evidence components must produce zero output, not an empty placeholder block (report.md 结构条)`);
  }

  // main 的真实事件流同时包含 assistant 回复与 get_stock_price 工具往返；源码区块存在
  // 不能把这份 Conversation 隐藏掉。断言静态 attempt HTML 的语义条目与工具内容都存在。
  const mainHtml = attemptHtml(evidence, mainLocator);
  assert.ok(
    mainHtml.includes('class="niceeval-conversation-entry-kind" data-kind="assistant"'),
    `${mainLocator} web face is missing the assistant conversation entry`,
  );
  assert.ok(
    mainHtml.includes('class="niceeval-conversation-entry-kind" data-kind="tool"'),
    `${mainLocator} web face is missing the tool conversation entry`,
  );
  assert.ok(
    mainHtml.includes("get_stock_price"),
    `${mainLocator} web face is missing the get_stock_price tool content`,
  );

  // --- Failed attempt(deliberate-fail):有 1 条 gate assertion,且带 source capability ->
  //     由 AttemptSource 渲染它(AttemptError 是给异常用的,不是给 assertion 失败用的,
  //     所以它保持为空)。
  const failBlocks = attemptBlockOrder(evidence, failLocator);
  assertSubsequenceOfCanonicalOrder(failBlocks, `attempt/${failLocator}.html (failed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-fix-prompt", "attempt-timeline", "attempt-diagnostics"]) {
    assert.ok(failBlocks.includes(must), `failed attempt ${failLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-conversation", "usage-table"]) {
    assert.ok(!failBlocks.includes(mustNot), `failed attempt ${failLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- Errored attempt(deliberate-error):在任何 turn 之前就抛出异常。源码快照仍然存在，
  //     但没有 conversation / usage；错误与执行证据缺失分别由前后两个 Callouts 表达。
  const errorBlocks = attemptBlockOrder(evidence, errorLocator);
  assertSubsequenceOfCanonicalOrder(errorBlocks, `attempt/${errorLocator}.html (errored)`);
  for (const must of ["attempt-summary", "attempt-error", "attempt-source", "attempt-fix-prompt", "attempt-timeline", "attempt-diagnostics"]) {
    assert.ok(errorBlocks.includes(must), `errored attempt ${errorLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-conversation", "usage-table"]) {
    assert.ok(!errorBlocks.includes(mustNot), `errored attempt ${errorLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- 默认展开的 <details>、expected/received 文本、badge/name:deliberate-fail 的这一条
  //     gate assertion 是确定性的固定事实(equals(1+1, 3) 恒定以同样的方式失败)。
  const failHtml = attemptHtml(evidence, failLocator);
  assert.ok(
    /<details class="niceeval-source-line niceeval-source-line--gate-fail" open="">/.test(failHtml),
    `${failLocator}'s failing source line should default-open (docs/feature/reports/components/primitives/source-view.md「web 面视觉规范」: 首个失败或警告行默认展开)`,
  );
  assert.ok(failHtml.includes("expected: 3") && failHtml.includes("received: 2"), `${failLocator} web face is missing the expected/received text for its equals(3) assertion`);
  assert.ok(failHtml.includes("equals(3) · gate failed"), `${failLocator} web face is missing the failed assertion identity and verdict`);

  // --- errored attempt 的结构化错误字段(deliberate-error.eval.ts 固定抛出的异常)。
  const errorHtml = attemptHtml(evidence, errorLocator);
  assert.ok(errorHtml.includes('class="niceeval-callout-title">eval.run</span>'), `${errorLocator} web face is missing the structured error's phase field`);
  assert.ok(errorHtml.includes("unexpected-error: deliberate error for e2e contract testing"), `${errorLocator} web face is missing the structured error's code and message`);
  assert.ok(errorHtml.includes("deliberate error for e2e contract testing"), `${errorLocator} web face is missing the error message`);

  // --- locator 链接:report 页的 ExperimentList 和 traces 页的 TraceWaterfall,都会把每一个
  //     真实 attempt 链接到它自己的详情文档。
  const indexHtml = readSiteFile(evidence, "index.html");
  for (const locator of [mainLocator, evidence.main.attempts[1]!.locator, failLocator, errorLocator]) {
    const href = `attempt/${encodeURIComponent(locator)}.html`;
    assert.ok(indexHtml.includes(`href="${href}"`), `index.html has no attempt link for ${locator} (expected href="${href}")`);
  }

  // --- show 的官方 attempt 首页直接组合摘要、源码身份、时间轴和诊断；详细断言文本
  //     仍由显式 --source 切片验收。traces 页链接回同一个官方详情入口。
  const root = evidence.resultsRoot;
  const showFailBare = sh(`pnpm exec niceeval show ${failLocator} --record ${root}`);
  assert.ok(showFailBare.includes(`${failLocator} · failed`), `show ${failLocator}'s official attempt page is missing its identity and verdict`);
  assert.ok(showFailBare.includes("evals/deliberate-fail.eval.ts:13 [gate-fail]"), `show ${failLocator}'s official attempt page is missing its failed source identity`);
  assert.ok(showFailBare.includes("Execution timeline"), `show ${failLocator}'s official attempt page is missing its timeline`);
  const showFailSource = sh(`pnpm exec niceeval show ${failLocator} --source --record ${root}`);
  assert.ok(showFailSource.includes("gate · equals(3) · expected 3 · received 2"), `show ${failLocator} --source is missing expected/received text`);

  const showErrorBare = sh(`pnpm exec niceeval show ${errorLocator} --record ${root}`);
  assert.ok(showErrorBare.includes("eval.run · 1 errors"), `show ${errorLocator}'s bare overview is missing the error's phase and count`);
  assert.ok(showErrorBare.includes("unexpected-error"), `show ${errorLocator}'s bare overview is missing the error's code`);

  const tracesText = sh(`pnpm exec niceeval show --record ${root} --page traces`);
  for (const locator of [mainLocator, failLocator, errorLocator]) {
    assert.ok(tracesText.includes(`niceeval show ${locator}`), `traces page text is missing the attempt-detail command for ${locator}`);
  }
}

// ---------------------------------------------------------------------------
// 结构 (2/3):ScopeWarnings 区块(计数、默认展开/收起状态)、PoweredBy/HeroCard 品牌链接,
// 以及 view 外壳导航的数据契约(这一点没覆盖到的部分见「覆盖缺口 #5」)。
// ---------------------------------------------------------------------------

async function verifyScopeWarningsBrandAndNavigation(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-overview-en");
  const attemptsTpl = extractTemplate(indexHtml, "niceeval-report-attempts-en");

  // --- ScopeWarnings:警告 kind 全集现在只有 unfinished-snapshot / missing-startedAt /
  //     unreadable-snapshot 三种(docs/feature/sample/library.md#警告-kind-全集)——旧的
  //     stale-snapshot(deliberate-fail/deliberate-error 比 main 旧)与 partial-coverage 已经
  //     从警告全集里删除,时效改成行级 ↩ 标注、覆盖缺口改成覆盖占位行,两者都不再是页面级警告
  //     (裁决见 memory/staleness-demoted-from-warning-to-provenance.md)。produceEvidence() 的 3 个
  //     Experiment 都是正常收尾的完整快照,不触发这三种 kind 中的任何一种,所以这份证据里
  //     warnings 恒为空集——ScopeWarnings 两面零输出、不渲染空容器
  //     (docs/feature/reports/components/summaries/sample-notices.md「空警告集两面零输出,不渲染空容器」)。
  //     断言的是「不存在」,不是某个具体计数;折叠/展开阈值、徽标聚合这些行为需要一份真正触发
  //     警告的 fixture(比如强杀中断产生 unfinished-snapshot)才能验证,不属于本仓库现有证据的
  //     覆盖范围(见文件头覆盖缺口 #7)。
  assert.ok(!reportTpl.includes("niceeval-warnings-summary"), "ScopeWarnings should render zero output for this evidence's 3 clean completed snapshots — none of them trigger unfinished-snapshot/missing-startedAt/unreadable-snapshot");
  assert.ok(!reportTpl.includes('class="niceeval-warnings"'), "ScopeWarnings' outer <details> should not render at all when the warning set is empty");

  // --- CopyFixPrompt:deliberate-fail + deliberate-error 恒定是那 2 个失败(main 的两次真实
  //     网关 attempt 恒定都通过)。
  assert.ok(attemptsTpl.includes('<summary class="niceeval-copy-block-summary">Fix prompt · 2 failures</summary>'), 'Attempts page CopyBlock fix-prompt summary should read "Fix prompt · 2 failures"');

  // --- PoweredBy/HeroCard 品牌链接:固定的 href 带 utm 参数,rel="noopener" 但不带
  //     noreferrer,出现在每个 locale 下每个可导航页面上(web 恒含)。
  const brandLinkRe = /<a href="https:\/\/niceeval\.com\/\?utm_source=report&amp;utm_medium=powered-by" target="_blank" rel="noopener">Powered by NiceEval<\/a>/;
  for (const pageId of ["overview", "attempts", "traces"]) {
    for (const locale of ["en", "zh-CN"]) {
      const tpl = extractTemplate(indexHtml, `niceeval-report-${pageId}-${locale}`);
      assert.ok(brandLinkRe.test(tpl), `${pageId}/${locale} template is missing the exact PoweredBy/HeroCard brand link (href with utm_source=report&utm_medium=powered-by, rel="noopener")`);
      assert.ok(!tpl.includes("noreferrer"), `${pageId}/${locale} template's brand link rel must not include noreferrer`);
    }
  }

  // attempt detail 文档没有 Hero(standardAttemptPage 的内容就是裸的 <AttemptDetails/>)
  // -> 品牌链接实际的 <a> 标签在那里必须不存在,尽管共享样式表里那条没用到的
  // .niceeval-powered-by CSS 规则依然会被打包进每份文档。
  for (const locator of [evidence.main.attempts[0]!.locator, evidence.deliberateFail.attempt.locator, evidence.deliberateError.attempt.locator]) {
    const html = attemptHtml(evidence, locator);
    assert.ok(!html.includes("utm_medium=powered-by"), `attempt/${locator}.html unexpectedly contains a rendered PoweredBy link — standardAttemptPage has no Hero`);
  }

  // 文本面:PoweredBy 是 web 独有的,show 渲染的每个页面/flag 组合在文本面上都是零输出。
  const root = evidence.resultsRoot;
  const textOutputs = [
    sh(`pnpm exec niceeval show --record ${root}`),
    sh(`pnpm exec niceeval show --record ${root} --page attempts`),
    sh(`pnpm exec niceeval show --record ${root} --page traces`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --record ${root}`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --source --record ${root}`),
  ];
  for (const text of textOutputs) {
    assert.ok(!text.includes("Powered by") && !text.includes("niceeval.com"), "show's text face must never render the PoweredBy brand line (report.md: web 恒含、text 零输出)");
  }

  // --- 导航数据契约(见覆盖缺口 #5:这里检查的是喂给顶部导航栏的数据,不是顶部导航栏自己
  //     渲染出的 DOM——那个 DOM 只在客户端 hydration 之后才存在)。
  const dataMatch = indexHtml.match(/window\.__NICEEVAL_VIEW_DATA__ = (\{[\s\S]*?\});\s*<\/script>/);
  assert.ok(dataMatch, "index.html is missing the window.__NICEEVAL_VIEW_DATA__ script the client shell hydrates navigation from");
  const viewData = JSON.parse(dataMatch![1]!) as { report: { pages: Array<{ id: string }>; initialPageId: string } };
  assert.deepEqual(
    viewData.report.pages.map((p) => p.id),
    ["overview", "attempts", "traces"],
    "view data's page list should be exactly the standard report's navigation !== false pages, in declared order, excluding the attempt-input page (report.md 结构条: 导航项与顺序等于报告定义中 navigation !== false 的页,不多不少)",
  );
  assert.equal(viewData.report.initialPageId, "overview", "view data's initial page should be the first navigable page");
}

// ---------------------------------------------------------------------------
// 结构 + 终端排版:MetricScatter —— 坐标轴方向(web,SVG 刻度)、connect/图例一致性
// (web),以及字符坐标图表的标记 + 图例 + 提示文本(文本面)。
// ---------------------------------------------------------------------------

function extractAxisTicks(scatterHtml: string, axisClass: "niceeval-chart-axis-x" | "niceeval-chart-axis-y"): Array<{ pos: number; value: number }> {
  const g = scatterHtml.match(new RegExp(`<g class="niceeval-chart-axis ${axisClass}">([\\s\\S]*?)</g>`));
  assert.ok(g, `MetricScatter is missing the ${axisClass} tick group`);
  const posAttrIndex = axisClass === "niceeval-chart-axis-x" ? 1 : 2;
  const tickRe = /<text class="niceeval-chart-tick" x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([^<]+)<\/text>/g;
  const ticks: Array<{ pos: number; value: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(g![1]!))) {
    const pos = Number(m[posAttrIndex]);
    const value = Number(m[3]!.replace(/[^0-9.-]/g, ""));
    assert.ok(Number.isFinite(pos) && Number.isFinite(value), `couldn't parse scatter tick: ${m[0]}`);
    ticks.push({ pos, value });
  }
  assert.ok(ticks.length >= 2, `${axisClass} should have at least 2 ticks, found ${ticks.length}`);
  return ticks;
}

function assertValueDecreasesAsPositionIncreases(ticks: Array<{ pos: number; value: number }>, context: string): void {
  const sorted = [...ticks].sort((a, b) => a.pos - b.pos);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i]!.value < sorted[i - 1]!.value, `${context}: tick values should strictly decrease as pixel position increases, got ${JSON.stringify(sorted)}`);
  }
}

async function verifyMetricScatterStructure(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-overview-en");
  const figureMatch = reportTpl.match(/<figure class="niceeval-report niceeval-chart niceeval-chart--scatter">([\s\S]*?)<\/figure>/);
  assert.ok(figureMatch, "report page is missing the Scatter chart figure");
  const scatter = figureMatch![1]!;

  // --- 坐标轴方向遵循 `better`(docs/feature/reports/library/measures.md:costUSD 的
  //     better=lower,endToEndPassRate 的 better=higher)。刻度上真实的美元/百分比数值每次
  //     运行都会变化——这里断言的是方向规则,不是任何具体数字。
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "niceeval-chart-axis-x"), "cost axis (better=lower, further right = cheaper)");
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "niceeval-chart-axis-y"), "pass-rate axis (better=higher, SVG y grows downward, so further down = worse)");
  assert.ok(scatter.includes("better → upper right"), 'MetricScatter should show the "better -> upper right" hint (both axes declare `better`)');

  // --- 缺失数据点计数:deliberate-fail/deliberate-error 从不带成本数据(固定事实,见文件
  //     头部说明),所以不管真实的美元金额是多少,这里恒定是 2。
  assert.ok(reportTpl.includes('<p class="niceeval-chart-missing" title="2">2 points missing data</p>'), "MetricScatter should report exactly 2 points missing data");

  // --- connect/图例一致性:没有任何 experiment 声明 `line` 标签,所以
  //     ExperimentComparison 的默认 series 是 "agent",connect=false —— 不会有 <polyline>。
  assert.ok(!/niceeval-chart-line/.test(scatter), "Scatter should draw no series line when connect is off (default)");

  // 参见文件头部覆盖缺口 #1:因为只有 1 个可绘制的点,跨多点/多 series 的标记分配顺序,
  // 以及 connect 的位移摘要,在这里都没法验证到。
}

// ---------------------------------------------------------------------------
// 终端排版:Table 折行(宽度 80,这个 CLI-black-box 脚本能够到达的唯一宽度——丢列标注
// 相关内容见覆盖缺口 #6)、CJK 显示宽度口径,以及字符坐标图表的文本面。
// ---------------------------------------------------------------------------

async function verifyTerminalTypography(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const showReport = sh(`pnpm exec niceeval show --record ${root}`);

  // 内建 standard 现以 SampleSummary(Stat 分行) + Scatter/Table 对比块呈现;
  // 旧 ExperimentList 80 列折行 / CJK Model 列对齐迁到自定义 site 报告场景验收。
  assert.equal(extractTextStatValue(showReport, "Pass rate"), "33.3%", "text face should bind Pass rate=33.3% to its SampleSummary column");
  assert.equal(extractTextStatValue(showReport, "Experiments"), "3", "text face should bind Experiments=3 to its SampleSummary column");
  assert.equal(extractTextStatValue(showReport, "Evals"), "3", "text face should bind Evals=3 to its SampleSummary column");
  assert.equal(extractTextStatValue(showReport, "Attempts"), "4", "text face should bind Attempts=4 to its SampleSummary column");
  assert.ok(showReport.includes("better → upper right"), 'Scatter text face should show the "better -> upper right" hint');
  assert.ok(showReport.includes("2 points missing data"), "Scatter text face should report exactly 2 points missing data");

  const zhOutput = sh(`LC_ALL=zh_CN.UTF-8 pnpm exec niceeval show --record ${root}`);
  assert.ok(zhOutput.includes("通过率") || zhOutput.includes("实验"), "zh-CN locale should render Chinese SampleSummary chrome");
}

// ---------------------------------------------------------------------------
// 双面同源:文本面(show)和 web 面(导出的 HTML)展示的是同一份 SampleSummary 事实。
// ---------------------------------------------------------------------------

function extractStatValue(html: string, label: string): string | null {
  const re = new RegExp(
    `<div class="niceeval-stat-label">${label}</div>\\s*<div class="niceeval-stat-value">([\\s\\S]*?)</div>`,
  );
  const m = re.exec(html);
  if (!m) return null;
  return m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function verifyDualRenderParity(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const showText = sh(`pnpm exec niceeval show --record ${root}`);
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-overview-en");

  const textPassRaw = extractTextStatValue(showText, "Pass rate");
  const textPass = textPassRaw ? /(\d+(?:\.\d+)?)%/.exec(textPassRaw) : null;
  const webPassRaw = extractStatValue(reportTpl, "Pass rate");
  const webPass = webPassRaw ? /(\d+(?:\.\d+)?)%/.exec(webPassRaw) : null;
  assert.ok(textPass && webPass, "couldn't extract Pass rate from both faces");
  assert.equal(textPass![1], webPass![1], `text pass rate (${textPass![1]}%) should equal web SampleSummary (${webPass![1]}%)`);

  assert.equal(extractTextStatValue(showText, "Experiments"), "3", "text SampleSummary Experiments should be 3");
  assert.equal(extractStatValue(reportTpl, "Experiments")?.replace(/\D/g, ""), "3", "web SampleSummary Experiments should be 3");
  assert.equal(extractTextStatValue(showText, "Evals"), "3", "text SampleSummary Evals should be 3");
  assert.equal(extractStatValue(reportTpl, "Evals")?.replace(/\D/g, ""), "3", "web SampleSummary Evals should be 3");
  assert.equal(extractTextStatValue(showText, "Attempts"), "4", "text SampleSummary Attempts should be 4");
  assert.equal(extractStatValue(reportTpl, "Attempts")?.replace(/\D/g, ""), "4", "web SampleSummary Attempts should be 4");

  for (const label of ["passed", "failed", "errored"] as const) {
    assert.ok(looseIncludes(showText, label), `text is missing verdict token "${label}"`);
    assert.ok(reportTpl.includes(label), `web SampleSummary is missing verdict token "${label}"`);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function verifyRenderStructure(evidence: Evidence): Promise<void> {
  await verifyAttemptDetailStructure(evidence);
  await verifyScopeWarningsBrandAndNavigation(evidence);
  await verifyMetricScatterStructure(evidence);
  await verifyTerminalTypography(evidence);
  await verifyDualRenderParity(evidence);
}
