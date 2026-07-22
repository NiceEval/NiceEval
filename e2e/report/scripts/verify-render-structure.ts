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

/** AttemptDetail 声明的区块顺序(完整出处见 docs/feature/reports/library/attempt-detail.md):
 * Summary、Assessment(先 Error,再 Source-or-Assertions)、FixPrompt、Timeline、
 * Diagnostics、Usage、Conversation(仅当 source 尚未包含时才出现)、Trace、Diff。 */
const ATTEMPT_DETAIL_ORDER = [
  "attempt-summary",
  "attempt-error",
  "attempt-source",
  "attempt-assertions",
  "attempt-fix-prompt",
  "attempt-timeline",
  "attempt-diagnostics",
  "attempt-usage",
  "attempt-conversation",
  "attempt-trace",
  "attempt-diff",
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

function decodeHtmlEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function readSiteFile(evidence: Evidence, ...parts: string[]): string {
  return readFileSync(join(evidence.siteExportDir, ...parts), "utf8");
}

function attemptHtml(evidence: Evidence, locator: string): string {
  return readSiteFile(evidence, "attempt", `${locator}.html`);
}

/** attempt/<locator>.html 把两种 locale 作为并列的 `data-nre-locale` 包裹 div 一起携带;
 * 由于区块顺序/是否出现和 locale 无关,这里只切出 "en" 那一份副本。 */
function englishLocaleSlice(html: string): string {
  const start = html.indexOf('data-nre-locale="en"');
  const end = html.indexOf('data-nre-locale="zh-CN"');
  assert.ok(start >= 0 && end > start, "attempt HTML is missing the expected en/zh-CN locale wrapper divs");
  return html.slice(start, end);
}

function attemptBlockOrder(evidence: Evidence, locator: string): string[] {
  const en = englishLocaleSlice(attemptHtml(evidence, locator));
  const blocks: string[] = [];
  const re = /class="nre nre-(attempt-[a-z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en))) blocks.push(m[1]!);
  return blocks;
}

function assertSubsequenceOfCanonicalOrder(present: string[], context: string): void {
  let lastIdx = -1;
  for (const block of present) {
    const idx = ATTEMPT_DETAIL_ORDER.indexOf(block);
    assert.ok(idx >= 0, `${context}: rendered block "${block}" isn't in AttemptDetail's canonical block set`);
    assert.ok(idx > lastIdx, `${context}: block "${block}" rendered out of AttemptDetail's declared order (docs/feature/reports/library/attempt-detail.md), full order: ${present.join(" -> ")}`);
    lastIdx = idx;
  }
}

function extractTemplate(indexHtml: string, templateId: string): string {
  const m = indexHtml.match(new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`));
  assert.ok(m, `index.html has no <template id="${templateId}">`);
  return m![1]!;
}

/** 一份最小化的东亚宽度表——只需要覆盖本仓库内置 chrome 通过 NICEEVAL_LANG=zh-CN 实际渲染出
 * 的 CJK 文本,不追求实现通用的 Unicode EAW。这里故意重新实现一遍,而不是直接 import
 * niceeval/report 自己的 `stringWidth`:本模块坚持 CLI-black-box(README §4.2),所以从不
 * import niceeval 库代码——这是对 CLI 真实渲染输出的独立核验,而不是把同一份代码再跑一遍。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK Radicals .. Yi Radicals (covers CJK Unified Ideographs)
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
      (cp >= 0xffe0 && cp <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

// ---------------------------------------------------------------------------
// 结构 (1/3):AttemptDetail 区块的出现/顺序/零输出、默认展开的 <details>、expected/received
// 文本、locator 链接 + drill-down 命令。
// ---------------------------------------------------------------------------

async function verifyAttemptDetailStructure(evidence: Evidence): Promise<void> {
  const mainLocator = evidence.main.attempts[0]!.locator;
  const failLocator = evidence.deliberateFail.attempt.locator;
  const errorLocator = evidence.deliberateError.attempt.locator;

  // --- Passed attempt(main):source capability 为 true(真实发生过 send/tool-call)-> 会渲染
  //     Summary、Source、Timeline、Usage;其余部分没有证据可渲染。
  const mainBlocks = attemptBlockOrder(evidence, mainLocator);
  assertSubsequenceOfCanonicalOrder(mainBlocks, `attempt/${mainLocator}.html (passed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-timeline", "attempt-usage"]) {
    assert.ok(mainBlocks.includes(must), `passed attempt ${mainLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-assertions", "attempt-fix-prompt", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!mainBlocks.includes(mustNot), `passed attempt ${mainLocator} unexpectedly rendered "${mustNot}" — zero-evidence components must produce zero output, not an empty placeholder block (report.md 结构条)`);
  }

  // --- Failed attempt(deliberate-fail):有 1 条 gate assertion,且带 source capability ->
  //     由 AttemptSource 渲染它(AttemptError 是给异常用的,不是给 assertion 失败用的,
  //     所以它保持为空)。
  const failBlocks = attemptBlockOrder(evidence, failLocator);
  assertSubsequenceOfCanonicalOrder(failBlocks, `attempt/${failLocator}.html (failed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-fix-prompt", "attempt-timeline", "attempt-usage"]) {
    assert.ok(failBlocks.includes(must), `failed attempt ${failLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-assertions", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!failBlocks.includes(mustNot), `failed attempt ${failLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- Errored attempt(deliberate-error):在任何 turn 之前就抛出异常 -> 既没有 source
  //     capability,也没有 assertion(0 条),所以 AttemptAssessment 的兜底(AttemptAssertions)
  //     本身也是空的——attempt-source 和 attempt-assertions 都不会渲染;渲染的是 AttemptError
  //     (结构化的异常信息)。
  const errorBlocks = attemptBlockOrder(evidence, errorLocator);
  assertSubsequenceOfCanonicalOrder(errorBlocks, `attempt/${errorLocator}.html (errored)`);
  for (const must of ["attempt-summary", "attempt-error", "attempt-fix-prompt", "attempt-timeline", "attempt-usage"]) {
    assert.ok(errorBlocks.includes(must), `errored attempt ${errorLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-source", "attempt-assertions", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!errorBlocks.includes(mustNot), `errored attempt ${errorLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- 默认展开的 <details>、expected/received 文本、badge/name:deliberate-fail 的这一条
  //     gate assertion 是确定性的固定事实(equals(1+1, 3) 恒定以同样的方式失败)。
  const failHtml = attemptHtml(evidence, failLocator);
  assert.ok(
    /<details class="nre-source-line nre-tone-bad" open="">/.test(failHtml),
    `${failLocator}'s failing source line should default-open (docs/feature/reports/library/attempt-detail.md「AttemptSource web 面视觉规范」: 首个失败或警告行默认展开)`,
  );
  assert.ok(failHtml.includes("expected: 3") && failHtml.includes("received: 2"), `${failLocator} web face is missing the expected/received text for its equals(3) assertion`);
  assert.ok(failHtml.includes('<span class="nre-assertion-badge">failed</span>'), `${failLocator} web face is missing the failed assertion badge`);
  assert.ok(failHtml.includes('<span class="nre-assertion-name">equals(3)</span>'), `${failLocator} web face is missing the assertion name`);

  // --- errored attempt 的结构化错误字段(deliberate-error.eval.ts 固定抛出的异常)。
  const errorHtml = attemptHtml(evidence, errorLocator);
  assert.ok(errorHtml.includes("<dt>phase</dt><dd>eval.run</dd>"), `${errorLocator} web face is missing the structured error's phase field`);
  assert.ok(errorHtml.includes("<dt>code</dt><dd>unexpected-error</dd>"), `${errorLocator} web face is missing the structured error's code field`);
  assert.ok(errorHtml.includes("deliberate error for e2e contract testing"), `${errorLocator} web face is missing the error message`);

  // --- locator 链接:report 页的 ExperimentList 和 traces 页的 TraceWaterfall,都会把每一个
  //     真实 attempt 链接到它自己的详情文档。
  const indexHtml = readSiteFile(evidence, "index.html");
  for (const locator of [mainLocator, evidence.main.attempts[1]!.locator, failLocator, errorLocator]) {
    const href = `attempt/${locator.replace("@", "%40")}.html`;
    assert.ok(indexHtml.includes(`href="${href}"`), `index.html has no attempt link for ${locator} (expected href="${href}")`);
  }

  // --- drill-down 命令:show 自己的文本面,在它解释的每个事实旁边都带着可直接复制的证据
  //     命令,而不只是裸的 locator。
  const root = evidence.resultsRoot;
  const showFailBare = sh(`pnpm exec niceeval show ${failLocator} --results ${root}`);
  assert.ok(showFailBare.includes(`niceeval show ${failLocator} --source`), `show ${failLocator}'s bare overview is missing the --source drill-down command`);
  assert.ok(showFailBare.includes(`niceeval show ${failLocator} --timing`), `show ${failLocator}'s bare overview is missing the --timing drill-down command`);
  assert.ok(showFailBare.includes("expected: 3") && showFailBare.includes("received: 2"), `show ${failLocator}'s bare overview is missing expected/received text`);

  const showErrorBare = sh(`pnpm exec niceeval show ${errorLocator} --results ${root}`);
  assert.ok(showErrorBare.includes("phase: eval.run"), `show ${errorLocator}'s bare overview is missing the error's phase`);
  assert.ok(showErrorBare.includes("unexpected-error"), `show ${errorLocator}'s bare overview is missing the error's code`);

  const tracesText = sh(`pnpm exec niceeval show --results ${root} --page traces`);
  for (const locator of [mainLocator, failLocator, errorLocator]) {
    assert.ok(tracesText.includes(`niceeval show ${locator} --timing`), `traces page text is missing the --timing drill-down command for ${locator}`);
  }
}

// ---------------------------------------------------------------------------
// 结构 (2/3):ScopeWarnings 区块(计数、默认展开/收起状态)、PoweredBy/HeroCard 品牌链接,
// 以及 view 外壳导航的数据契约(这一点没覆盖到的部分见「覆盖缺口 #5」)。
// ---------------------------------------------------------------------------

async function verifyScopeWarningsBrandAndNavigation(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");

  // --- ScopeWarnings:deliberate-fail/deliberate-error 恒定是被标记的那 2 个 experiment
  //     (produceEvidence() 恒定先跑它们再跑 main,所以 main 恒定是最新的)。
  assert.ok(reportTpl.includes('<summary class="nre-warnings-summary">2 experiments flagged</summary>'), 'ScopeWarnings summary should read exactly "2 experiments flagged"');
  assert.ok(/<details class="nre-warnings">(?!\s*open)/.test(reportTpl), "ScopeWarnings' outer <details> should be collapsed by default (no open attribute)");
  const innerOpenCount = (reportTpl.match(/<details class="nre-warning-details" open="">/g) ?? []).length;
  assert.equal(innerOpenCount, 2, `both per-experiment warning groups should default-open (total warnings = 2 <= 3 threshold); found ${innerOpenCount} open inner <details>`);

  // --- CopyFixPrompt:deliberate-fail + deliberate-error 恒定是那 2 个失败(main 的两次真实
  //     网关 attempt 恒定都通过)。
  assert.ok(reportTpl.includes('<summary class="nre-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'), 'CopyFixPrompt summary should read "Fix prompt · 2 failures"');

  // --- PoweredBy/HeroCard 品牌链接:固定的 href 带 utm 参数,rel="noopener" 但不带
  //     noreferrer,出现在每个 locale 下每个可导航页面上(web 恒含)。
  const brandLinkRe = /<a href="https:\/\/niceeval\.com\/\?utm_source=report&amp;utm_medium=powered-by" target="_blank" rel="noopener">Powered by NiceEval<\/a>/;
  for (const pageId of ["report", "attempts", "traces"]) {
    for (const locale of ["en", "zh-CN"]) {
      const tpl = extractTemplate(indexHtml, `niceeval-report-${pageId}-${locale}`);
      assert.ok(brandLinkRe.test(tpl), `${pageId}/${locale} template is missing the exact PoweredBy/HeroCard brand link (href with utm_source=report&utm_medium=powered-by, rel="noopener")`);
      assert.ok(!tpl.includes("noreferrer"), `${pageId}/${locale} template's brand link rel must not include noreferrer`);
    }
  }

  // attempt detail 文档没有 Hero(standardAttemptPage 的内容就是裸的 <AttemptDetail/>)
  // -> 品牌链接实际的 <a> 标签在那里必须不存在,尽管共享样式表里那条没用到的
  // .nre-powered-by CSS 规则依然会被打包进每份文档。
  for (const locator of [evidence.main.attempts[0]!.locator, evidence.deliberateFail.attempt.locator, evidence.deliberateError.attempt.locator]) {
    const html = attemptHtml(evidence, locator);
    assert.ok(!html.includes("utm_medium=powered-by"), `attempt/${locator}.html unexpectedly contains a rendered PoweredBy link — standardAttemptPage has no Hero`);
  }

  // 文本面:PoweredBy 是 web 独有的,show 渲染的每个页面/flag 组合在文本面上都是零输出。
  const root = evidence.resultsRoot;
  const textOutputs = [
    sh(`pnpm exec niceeval show --results ${root}`),
    sh(`pnpm exec niceeval show --results ${root} --page attempts`),
    sh(`pnpm exec niceeval show --results ${root} --page traces`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --results ${root}`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --source --results ${root}`),
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
    ["report", "attempts", "traces"],
    "view data's page list should be exactly the standard report's navigation !== false pages, in declared order, excluding the attempt-input page (report.md 结构条: 导航项与顺序等于报告定义中 navigation !== false 的页,不多不少)",
  );
  assert.equal(viewData.report.initialPageId, "report", "view data's initial page should be the first navigable page");
}

// ---------------------------------------------------------------------------
// 结构 (3/3):跨组件的颜色 class 一致性(colorClassForKey / seriesClassForKey)。
// ---------------------------------------------------------------------------

function coloredKeyClass(templateHtml: string, spanClassPrefix: string, key: string): string | undefined {
  const m = templateHtml.match(new RegExp(`class="${escapeRegExp(spanClassPrefix)} nre-key (nre-c\\d)">${escapeRegExp(key)}<`));
  return m?.[1];
}

async function verifyColorConsistency(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");
  const attemptsTpl = extractTemplate(indexHtml, "niceeval-report-attempts-en");

  // ExperimentList(report 页)对比 AttemptList(attempts 页):两者都以同样的 "agent"
  // 维度作为 key,针对 scope 内全部 3 个真实 agent 都要验证。
  for (const agent of [AGENT.main, AGENT.deliberateFail, AGENT.deliberateError]) {
    const expColor = coloredKeyClass(reportTpl, "nre-experiment-agent", agent);
    const attColor = coloredKeyClass(attemptsTpl, "nre-attempt-agent", agent);
    assert.ok(expColor, `ExperimentList (report page) has no colored key for agent "${agent}"`);
    assert.ok(attColor, `AttemptList (attempts page) has no colored key for agent "${agent}"`);
    assert.equal(expColor, attColor, `agent "${agent}" gets different color classes in ExperimentList (${expColor}) vs AttemptList (${attColor}) — colorClassForKey must be stable across components regardless of which one renders it (report.md 结构条)`);
  }

  // MetricScatter 的图例:只有 "main"/results-mechanism 是可绘制的(见文件头部说明——
  // deliberate-fail/error 从不带成本数据),但这依然构成一对真实的跨组件比较。
  const scatterColor = coloredKeyClass(reportTpl, "nre-legend-key", AGENT.main);
  assert.ok(scatterColor, `MetricScatter legend has no colored key for agent "${AGENT.main}"`);
  assert.equal(scatterColor, coloredKeyClass(reportTpl, "nre-experiment-agent", AGENT.main), `agent "${AGENT.main}" gets a different color in MetricScatter's legend than in ExperimentList`);
}

// ---------------------------------------------------------------------------
// 结构 + 终端排版:MetricScatter —— 坐标轴方向(web,SVG 刻度)、connect/图例一致性
// (web),以及字符坐标图表的标记 + 图例 + 提示文本(文本面)。
// ---------------------------------------------------------------------------

function extractAxisTicks(scatterHtml: string, axisClass: "nre-scatter-axis-x" | "nre-scatter-axis-y"): Array<{ pos: number; value: number }> {
  const g = scatterHtml.match(new RegExp(`<g class="nre-scatter-axis ${axisClass}">([\\s\\S]*?)</g>`));
  assert.ok(g, `MetricScatter is missing the ${axisClass} tick group`);
  const posAttrIndex = axisClass === "nre-scatter-axis-x" ? 1 : 2;
  const tickRe = /<text class="nre-scatter-tick" x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([^<]+)<\/text>/g;
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
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");
  const figureMatch = reportTpl.match(/<figure class="nre nre-metric-scatter">([\s\S]*?)<\/figure>/);
  assert.ok(figureMatch, "report page is missing the MetricScatter figure");
  const scatter = figureMatch![1]!;

  // --- 坐标轴方向遵循 `better`(docs/feature/reports/library/metrics.md:costUSD 的
  //     better=lower,endToEndPassRate 的 better=higher)。刻度上真实的美元/百分比数值每次
  //     运行都会变化——这里断言的是方向规则,不是任何具体数字。
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "nre-scatter-axis-x"), "cost axis (better=lower, further right = cheaper)");
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "nre-scatter-axis-y"), "pass-rate axis (better=higher, SVG y grows downward, so further down = worse)");
  assert.ok(scatter.includes("better → upper right"), 'MetricScatter should show the "better -> upper right" hint (both axes declare `better`)');

  // --- 缺失数据点计数:deliberate-fail/deliberate-error 从不带成本数据(固定事实,见文件
  //     头部说明),所以不管真实的美元金额是多少,这里恒定是 2。
  assert.ok(scatter.includes("2 points missing data"), "MetricScatter should report exactly 2 points missing data");

  // --- connect/图例一致性:没有任何 experiment 声明 `line` 标签,所以
  //     ExperimentComparison 的默认 series 是 "agent",connect=false —— 不会有 <polyline>。
  assert.ok(!/<polyline/.test(scatter), "MetricScatter should draw no <polyline> when connect is off (default; report.md 结构条: connect 折线与图例的一致性)");

  // 参见文件头部覆盖缺口 #1:因为只有 1 个可绘制的点,跨多点/多 series 的标记分配顺序,
  // 以及 connect 的位移摘要,在这里都没法验证到。
}

// ---------------------------------------------------------------------------
// 终端排版:Table 折行(宽度 80,这个 CLI-black-box 脚本能够到达的唯一宽度——丢列标注
// 相关内容见覆盖缺口 #6)、CJK 显示宽度口径,以及字符坐标图表的文本面。
// ---------------------------------------------------------------------------

async function verifyTerminalTypography(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // --- Table 折行:在 CLI 的非 TTY 兜底宽度(80)下,ExperimentList 里最宽的单元格会折行到
  //     续行上,而不是被静默截断或超出宽度溢出。(只有 Table 自己的行会被这样限宽——同一份
  //     输出里其他自由格式的行,比如 ScopeWarnings 的消息或者散点图图例,打印时是不限宽的;
  //     本仓库真实的 deliberate-error/-fail 警告消息就会超过 200 列。)
  const showReport = sh(`pnpm exec niceeval show --results ${root}`);
  // 只匹配真正带填充的 Table 行:表头("Exp. ...")或者行上还带着 "results-"(Agent 列折行
  // 后的开头部分)的行。这样可以排除掉同一份输出后面那些未填充的、按 experiment 划分的
  // eval/attempt 明细标题——那些是独占一行的裸 experiment id(比如单独一行的
  // "deliberate-error")——不是 Table 的行。
  const experimentTableRows = showReport.split("\n").filter((l) => /^Exp\./.test(l) || (/^(main|delibera)/.test(l) && l.includes("results-")));
  assert.ok(experimentTableRows.length >= 4, `expected at least 4 ExperimentList table lines (header + 3 rows) in width-80 output, found ${experimentTableRows.length}`);
  for (const line of experimentTableRows) {
    assert.equal(line.length, 80, `ExperimentList table row should be padded to exactly the 80-column width, got ${line.length}: ${JSON.stringify(line)}`);
  }
  // 哪一个单元格会折行,取决于内容长度(80 列的预算由全部 8 列共享,并根据每个单元格的
  // 实际宽度重新分配,包括真实的、每次运行都会变化的 duration/tokens/cost 文本)——有时候是
  // Agent 列,有时候不是,所以在本任务开发过程中发现,断言「某个特定单元格恒定折行」是不
  // 稳定的。不受这种重新分配影响、真正确定性的是:"deliberate-error"/"deliberate-fail" 是固定
  // 17/16 字符长的 eval id,在同一个固定宽度的 Experiment 列里永远没法和 "main"(4 个字符)
  // 挤在一起,所以它们恒定会折行,让 "te-error"/"te-fail" 成为续行的第一个 token(不只是作为
  // 子串出现在某处——这个子串也会出现在未折行的 ScopeWarnings 消息文本的句子中间,那种情况
  // 完全不能作为 Table 折行的证据)。
  for (const row of experimentTableRows) {
    assert.ok(!row.includes("deliberate-error") && !row.includes("deliberate-fail"), `ExperimentList row should never fit "deliberate-error"/"deliberate-fail" contiguously in an 80-column Experiment column: ${JSON.stringify(row)}`);
  }
  assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-error")), 'expected a continuation line starting with "te-error" (deliberate-error\'s wrapped Experiment-column fragment) in width-80 output');
  assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-fail")), 'expected a continuation line starting with "te-fail" (deliberate-fail\'s wrapped Experiment-column fragment) in width-80 output');

  // --- CJK 显示宽度口径:NICEEVAL_LANG=zh-CN 会把内置 chrome 文本渲染成中文,让 "Model" 列
  //     在同一列里,既有真实的 2 列宽 CJK 内容("默认",未声明 model 时的标签),又有 ASCII
  //     的 "deepseek" 片段(deliberate-fail/error 没有显式声明 model)。如果填充逻辑对 CJK
  //     单元格用的是原始字符数而不是显示宽度,这两行第 2 列的目标显示宽度(内容显示宽度 +
  //     原始填充字符数)就会算出不一样的结果;这里断言全部 3 行的这个值都相等。
  // 各行是按位置来识别的,不是靠匹配旁边的 verdict 文本("1 错误"/"1 通过"/"1 失败"):
  // Results 单元格在某些运行里自己也可能折行到续行上(在本任务开发过程中观察到过——真实的
  // duration/token/cost 文本长度会挤占共享的 80 列预算),那样的话基于文本的匹配会悄悄地
  // 匹配不上。行的排列顺序是按通过率降序,同值时按 experiment id 升序打平(docs/feature/
  // reports/library/metric-views.md「组件级 sort 是稳定排序,同值时仍以 key 收口」)——
  // main(100%)排第一,然后是 deliberate-error 排在 deliberate-fail 前面(两者都是 0%,
  // 字典序上 "deliberate-error" < "deliberate-fail")——在开发过程中经过多次真实运行确认
  // 这个顺序是稳定的。
  const zhOutput = sh(`NICEEVAL_LANG=zh-CN pnpm exec niceeval show --results ${root}`);
  const zhLines = zhOutput.split("\n");
  const zhTableRows = zhLines.filter((l) => /^(main|delibera)/.test(l) && l.includes("results-"));
  assert.equal(zhTableRows.length, 3, `expected exactly 3 ExperimentList rows (main, deliberate-error, deliberate-fail) in zh-CN width-80 output, found ${zhTableRows.length}:\n${JSON.stringify(zhTableRows)}`);
  const [mainRow, errorRow, failRow] = zhTableRows;

  const columnTwoTargetWidth = (line: string): number => {
    const lead = /^(\S+)(\s+)/.exec(line);
    assert.ok(lead, `row has no leading Experiment-column token: ${JSON.stringify(line)}`);
    const col2Start = lead![0].length;
    const col3Start = line.indexOf("results-");
    assert.ok(col3Start > col2Start, `couldn't find the Agent column's start ("results-") in row: ${JSON.stringify(line)}`);
    const cell = line.slice(col2Start, col3Start).trimEnd();
    const paddingRawChars = col3Start - col2Start - cell.length;
    return displayWidth(cell) + paddingRawChars;
  };

  const widths = [mainRow!, errorRow!, failRow!].map(columnTwoTargetWidth);
  assert.equal(widths[0], widths[1], `zh-CN Model column's target display width should match between the ASCII "deepseek" row and the CJK "默认" row (got ${JSON.stringify(widths)}) — CJK must count as 2 display columns, not 1 (docs/feature/reports/library/layout.md「量测」)`);
  assert.equal(widths[1], widths[2], `zh-CN Model column's target display width should be consistent across both CJK rows (got ${JSON.stringify(widths)})`);

  // --- MetricScatter 字符坐标图表(文本面):标记 + 图例 + 提示 + 缺失计数。
  //     只有唯一一个可绘制的点(见文件头部说明)—— 没有东西可排序,也没有东西可连线。
  assert.ok(/results-mechanism\s+A\s+main/.test(showReport), 'MetricScatter\'s text legend should read "results-mechanism  A main" (single drawable point, marker A)');
  assert.ok(showReport.includes("better → upper right"), 'MetricScatter\'s text face should show the "better -> upper right" hint');
  assert.ok(showReport.includes("2 points missing data"), "MetricScatter's text face should report exactly 2 points missing data");
}

// ---------------------------------------------------------------------------
// 双面同源:文本面(show)和 web 面(导出的 HTML)展示的是同一份解析结果、覆盖情况、
// verdict 构成和警告——这里比较的是提取出的事实,绝不比较整行的排版字符串。
// ---------------------------------------------------------------------------

function extractWebWarningMessage(reportTpl: string, experimentId: string): string {
  const m = reportTpl.match(new RegExp(`<span class="nre-warning-title">${escapeRegExp(experimentId)}</span>[\\s\\S]*?<li class="nre-warning" data-kind="[^"]*">([^<]+)</li>`));
  assert.ok(m, `couldn't find a web ScopeWarnings message for experiment "${experimentId}"`);
  return decodeHtmlEntities(m![1]!);
}

function extractTextWarningMessage(showText: string, experimentId: string): string {
  const m = showText.match(new RegExp(`^!\\s+(verdicts for "${escapeRegExp(experimentId)}"[^\\n]*)$`, "m"));
  assert.ok(m, `couldn't find a text-face ScopeWarnings message for experiment "${experimentId}"`);
  return m![1]!;
}

function extractMainRowFromText(showText: string): { tokens: string; cost: string; passRate: string } {
  const line = showText.split("\n").find((l) => l.trimStart().startsWith("main") && l.includes("tokens"));
  assert.ok(line, "couldn't find main's ExperimentList row (line 1) in text output");
  const tokens = /(\d+(?:\.\d+)?) tokens/.exec(line!);
  const cost = /(\$\d+(?:\.\d+)?)/.exec(line!);
  const passRate = /(\d+(?:\.\d+)?)%/.exec(line!);
  assert.ok(tokens && cost && passRate, `couldn't parse main's text row: ${JSON.stringify(line)}`);
  return { tokens: tokens![1]!, cost: cost![1]!, passRate: passRate![1]! };
}

function extractMainRowFromWeb(reportTpl: string): { tokens: string; cost: string; passRate: string } {
  const entryRe = /<details class="nre-experiment-entry">([\s\S]*?)<\/details>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(reportTpl))) {
    if (!m[1]!.includes('data-sort-value="main"')) continue;
    const block = m[1]!;
    const tokens = /(\d+(?:\.\d+)?) tokens/.exec(block);
    const cost = /(\$\d+(?:\.\d+)?)/.exec(block);
    const passRate = /title="[^"]*attempts measured">(\d+(?:\.\d+)?)%</.exec(block);
    assert.ok(tokens && cost && passRate, "couldn't parse main's web ExperimentList entry");
    return { tokens: tokens![1]!, cost: cost![1]!, passRate: passRate![1]! };
  }
  throw new Error('couldn\'t find main\'s <details class="nre-experiment-entry"> block in web output');
}

async function verifyDualRenderParity(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const showText = sh(`pnpm exec niceeval show --results ${root}`);
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");

  // --- Scope 级别的通过率:两个面提取的都是同一份底层 ScopeSummaryData。
  const textPassRate = /Pass rate (\d+(?:\.\d+)?)%/.exec(showText);
  const webPassRate = /<dt>Pass rate<\/dt>\s*<dd>[\s\S]*?<span class="nre-value" title="[^"]*attempts measured">(\d+(?:\.\d+)?)%<\/span>/.exec(reportTpl);
  assert.ok(textPassRate && webPassRate, "couldn't extract the scope-level pass rate from both faces");
  assert.equal(textPassRate![1], webPassRate![1], `text pass rate (${textPassRate![1]}%) should equal web ScopeSummary pass rate (${webPassRate![1]}%)`);

  // --- 计数:experiments / evals / attempts,两个面上必须一致。文本面的 ScopeSummary 那一行
  //     会在不可预测的位置折行(取决于它前面那段真实的、每次运行都会变化的通过率/成本文本),
  //     所以包含检查要容忍折行落在任意两个词之间(looseIncludes 会把折行产生的换行符折叠成
  //     一个空格)。
  assert.ok(looseIncludes(showText, "3 experiments"), 'text is missing "3 experiments"');
  assert.ok(/<dt>Experiments<\/dt>\s*<dd>3<\/dd>/.test(reportTpl), "web ScopeSummary is missing Experiments=3");
  assert.ok(looseIncludes(showText, "3 evals"), 'text is missing "3 evals"');
  assert.ok(/<dt>Evals<\/dt>\s*<dd>3<\/dd>/.test(reportTpl), "web ScopeSummary is missing Evals=3");
  assert.ok(looseIncludes(showText, "4 attempts"), 'text is missing "4 attempts"');
  assert.ok(/<dt>Attempts<\/dt>\s*<dd>4<\/dd>/.test(reportTpl), "web ScopeSummary is missing Attempts=4");

  // --- verdict 构成:eval 级别的计数(1 passed / 1 failed / 1 errored —— main 的 2 个
  //     tool-call attempt 会折叠成 1 个 passed 的 eval),两个面上必须一致。
  for (const label of ["passed", "failed", "errored"] as const) {
    assert.ok(looseIncludes(showText, `1 ${label}`), `text is missing "1 ${label}" in the verdict tally`);
    assert.ok(reportTpl.includes(`nre-verdict-pill nre-verdict-${label}">1 ${label}<`), `web ScopeSummary is missing the "1 ${label}" verdict pill`);
  }

  // --- "main" 这个 experiment 自己的指标:tokens/cost/pass-rate 是真实的、每次运行都会变化
  //     的网关数据——从两个面各自提取出来,拿来互相比较,绝不和硬编码值比较。
  const textRow = extractMainRowFromText(showText);
  const webRow = extractMainRowFromWeb(reportTpl);
  assert.equal(textRow.tokens, webRow.tokens, `main's token count differs between text (${textRow.tokens}) and web (${webRow.tokens})`);
  assert.equal(textRow.cost, webRow.cost, `main's cost differs between text (${textRow.cost}) and web (${webRow.cost})`);
  assert.equal(textRow.passRate, webRow.passRate, `main's pass rate differs between text (${textRow.passRate}%) and web (${webRow.passRate}%)`);

  // --- ScopeWarnings 消息的一致性:完整的三段式消息文本(Results 三段式),包括它动态的
  //     "落后 N 秒" / 时间戳内容,在两个面上必须是完全相同的字符串——互相比较,不和硬编码
  //     字面量比较。
  for (const experimentId of [evidence.deliberateFail.id, evidence.deliberateError.id]) {
    const webMsg = extractWebWarningMessage(reportTpl, experimentId);
    const textMsg = extractTextWarningMessage(showText, experimentId);
    assert.equal(textMsg, webMsg, `ScopeWarnings message for "${experimentId}" differs between text and web faces`);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function verifyRenderStructure(evidence: Evidence): Promise<void> {
  await verifyAttemptDetailStructure(evidence);
  await verifyScopeWarningsBrandAndNavigation(evidence);
  await verifyColorConsistency(evidence);
  await verifyMetricScatterStructure(evidence);
  await verifyTerminalTypography(evidence);
  await verifyDualRenderParity(evidence);
}
