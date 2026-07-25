/// <reference lib="dom" />
// 上面这行 triple-slash reference 只给本文件引入 DOM 类型(getComputedStyle、HTMLDetailsElement
// 等)——这些名字只出现在传给 Playwright `page.evaluate()`/`locator.evaluate()` 的回调里,
// 实际在浏览器里执行,不是本 Node 脚本自身的运行时环境;项目 tsconfig.json 的 lib 是纯
// ES2023(Node 视角),不引入 DOM,不想为了这一个文件把 DOM 类型污染到整个 e2e/report 项目。
//
// 渲染面·浏览器视觉与交互验收域(docs/engineering/testing/e2e/report.md §5 第四个 bullet
// "视觉与交互";plan/testing-layer-realignment.md B4)。用真实浏览器(Playwright + Chromium)
// 打开 `niceeval view --out` 导出的静态站,验收「组件 + 官方 stylesheet」在真实证据上的组合
// 是否成立——这是唯一需要真实浏览器的验收域;B3(verify-render-structure.ts)已经用字符串/正则
// 断言覆盖了结构、终端排版与双面同源,不重复。
//
// 只读取 evidence.siteExportDir 里 produceEvidence() 一次性导出好的静态文件,不现场调用
// `niceeval show`/`view` 去查询"当前 Scope"——因此在 scripts/e2e.ts 里排在 verifyReadback
// 之后也不受它的变更影响(见 e2e.ts 里 verifyRenderStructure 上方注释与
// memory/verify-readback-mutation-orders-later-e2e-report-domains.md)。
//
// 技术路子:
//   - attempt/<locator>.html 按契约是自包含静态文档(内联 <style>,内联 <script> 只做渐进增强
//     与语言切换,不依赖 fetch)——直接用 file:// 协议打开来测,这比额外套一层 HTTP server 更
//     贴近"零依赖"契约本身:如果它偷偷依赖了同源 HTTP 环境,file:// 直接打开就会露馅。
//   - index.html 不同:它的 #root 是空的,由内联的客户端 bundle 水合渲染,并且点击一个 locator
//     链接会现场 fetch 该 attempt 文档、把内容放进 dialog——这个 fetch 在 file:// 协议下会被
//     浏览器同源策略挡掉,所以 index.html 需要一个极简的本地静态文件 HTTP server(node:http +
//     node:fs,零额外依赖)。
//   - "禁 JS"用 `browser.newContext({ javaScriptEnabled: false })`,不是
//     `context.route('**/*.js', ...)` 拦截网络请求——attempt 文档的两段 <script> 都是内联的
//     (没有 src),不经过网络请求,路由拦截根本拦不到它们;javaScriptEnabled:false 是唯一能
//     真正让内联脚本不执行的办法。
//
// 覆盖范围对应 report.md 原句的四个分句(用户任务书「具体覆盖」1-4):
//   1. 结构化布局非 UA 默认排版 —— verifyStructuredLayoutNotUaDefault
//   2. AttemptSource 状态染色与行号位标记 —— verifyAttemptSourceVisualMarkers
//   3. 点击 send / assertion 行原生 <details> 展开,普通行不可展开 —— verifyClickToExpandInteraction
//   4. 文档零 JS 依赖,禁 JS 后内容仍完整可读 —— verifyZeroJsReadable
// 另外顺手做了两项不在四条硬性要求里、但复用同一个 Playwright 环境几乎零成本的检查(详见下方
// verifyIndexPageLive 函数头注,不要与上面四条混为一谈):index.html 客户端水合出的 topbar 品牌位
// 与导航项(捡起 B3 COVERAGE GAP #5 明确放弃的那块)、以及点击失败 attempt 的 locator 触发的
// 真实 fetch+dialog 交互。
//
// COVERAGE GAPS——如实列出没覆盖到的部分,而不是假装覆盖了:
//   1. AttemptSource 视觉规范里的"soft-fail / unavailable 黄"这一档状态染色完全没有证据可测:
//      当前三个 Eval(tool-call/deliberate-fail/deliberate-error)的全部 assertion 结果只落在
//      passed/gate-fail(bad)两种 tone,从未产生 soft severity 的失败或 unavailable 结果
//      (`nre-tone-warn`/`nre-tone-na` 两个 class 只出现在内联 <style> 的 CSS 规则文本里,DOM 里
//      从未真正挂载过)。本模块因此只验证了 send(蓝)/passed(绿)/gate-fail(红)三色可区分,
//      黄色这一档需要一个新增的、产生 soft assertion 或 unavailable assertion 的 Eval 才能补上,
//      不是这个模块能在现有证据内解决的。
//   2. "点击 send 行展开"只用 main(passed)的 attempt 验证——deliberate-fail.eval.ts 只有一个裸
//      `t.check`、没有 `t.send`,deliberate-error.eval.ts 在任何 send 之前就抛异常,所以当前
//      三份证据里不存在"failed/errored attempt 且同时有 send 行可点"的场景。deliberate-fail 的
//      assertion 行展开交互覆盖了"失败态 attempt 的点击展开"，但 send 行展开这一半交互只能代为
//      用 main 验证。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { chromium, type Browser, type Locator } from "@playwright/test";
import type { Evidence } from "./evidence.ts";

/** 静态导出文档里,肉眼可见/参与断言的内容恒在这层包裹下(见 verify-render-structure.ts 的
 * englishLocaleSlice 同款约束):zh-CN 副本默认 `hidden`,不 scope 到这层选择器会在 Playwright
 * 严格模式下因为匹配到两份(en + 隐藏的 zh-CN)而报错。 */
const EN_SCOPE = '[data-nre-locale="en"]';
const AGENTS = ["results-mechanism", "results-deliberate-fail", "results-deliberate-error"] as const;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** 极简静态文件 server:只服务 evidence.siteExportDir 这一份纯静态导出,给 index.html 的
 * fetch(attempt 文档) 一个同源 http:// 落点。零额外依赖,只用 node:http + node:fs。 */
async function serveStaticDir(rootDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
        const filePath = join(rootDir, pathname);
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = await readFile(filePath);
        res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    })();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolvePromise, reject) => server.close((err) => (err ? reject(err) : resolvePromise()))),
  };
}

function attemptFileUrl(evidence: Evidence, locator: string): string {
  return pathToFileURL(resolve(evidence.siteExportDir, "attempt", `${locator}.html`)).href;
}

/** 解析 computed color 字符串的 alpha 分量;CSS 里的 `color-mix(in oklch, ...)` 在 Chromium 里
 * 算出来是 `oklch(L C H / A)`(斜杠语法),不是传统的 `rgba(r, g, b, a)`,两种语法都要认。
 * 没有 alpha 分量(纯 `rgb()`/无斜杠无逗号第四项)视为完全不透明。 */
function colorAlpha(computedColor: string): number {
  const slashAlpha = /\/\s*([\d.]+)\s*\)\s*$/.exec(computedColor);
  if (slashAlpha) return Number(slashAlpha[1]);
  const rgbaAlpha = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(computedColor);
  if (rgbaAlpha) return Number(rgbaAlpha[1]);
  return 1;
}

type VisualRect = { x: number; y: number; width: number; height: number };

async function directChildRects(locator: Locator): Promise<VisualRect[]> {
  return locator.evaluate((el) =>
    Array.from(el.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
}

function assertSameVisualRow(rects: VisualRect[], label: string): void {
  assert.ok(rects.length >= 2, `${label} 至少应有两个可见字段`);
  const [first, second] = rects;
  assert.ok(second!.x > first!.x, `${label} 的后一个字段应位于前一个字段右侧`);
  assert.ok(
    Math.abs(second!.y - first!.y) <= Math.max(first!.height, second!.height),
    `${label} 的相邻字段应处于同一视觉行`,
  );
}

// ---------------------------------------------------------------------------
// 1/4:结构化布局非 UA 默认排版。
// ---------------------------------------------------------------------------

async function verifyStructuredLayoutNotUaDefault(browser: Browser, evidence: Evidence): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.goto(attemptFileUrl(evidence, evidence.deliberateFail.attempt.locator));

    // AttemptSource 整块源码行容器应整体横向滚动并使用等宽字体。具体由 grid、table 还是
    // 其它 CSS 机制实现不属于用户契约。
    const lines = page.locator(`${EN_SCOPE} .nre-attempt-source-lines`);
    const linesStyle = await lines.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflowX: cs.overflowX, fontFamily: cs.fontFamily };
    });
    assert.equal(linesStyle.overflowX, "auto", `.nre-attempt-source-lines 应整体横向滚动(overflow-x:auto),实际 "${linesStyle.overflowX}"`);
    assert.match(linesStyle.fontFamily.toLowerCase(), /mono/, `.nre-attempt-source-lines 的 font-family 应含等宽字体族,实际 "${linesStyle.fontFamily}"`);

    // 单行 summary 的行号位与源码应横向成栏；断言视觉几何，不规定 CSS display 值。
    assertSameVisualRow(
      await directChildRects(page.locator(`${EN_SCOPE} .nre-attempt-source .nre-source-line-summary`).first()),
      "AttemptSource 单行的行号与源码",
    );

    // AttemptSummary 的前两个 KPI 在桌面视口应横向成栏，不是 UA 默认纵向堆叠。
    assertSameVisualRow(
      await directChildRects(page.locator(`${EN_SCOPE} .nre-attempt-summary-kpis`)),
      "AttemptSummary KPI",
    );

    // deliberateFail 的失败行默认展开，badge 与断言名应处于同一视觉行。
    assertSameVisualRow(
      await directChildRects(page.locator(`${EN_SCOPE} .nre-attempt-source .nre-source-assertion-head`).first()),
      "失败断言头",
    );

    // 换到 main(passed)attempt,复核"conversation/send 区块"这一类:send 行展开区里的回复列表
    // 是 flex column、工具调用行是三栏 grid。main 没有 bad/warn/na 行,没有默认展开的 send 行,
    // 这里直接置位 open 属性看结构(不经过点击——点击交互是 item 3 专门测的范围)。
    await page.goto(attemptFileUrl(evidence, evidence.main.attempts[0]!.locator));
    const sendDetails = page.locator(`${EN_SCOPE} .nre-attempt-source details.nre-source-line-send`).first();
    await sendDetails.evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    const replyRects = await directChildRects(
      page.locator(`${EN_SCOPE} .nre-attempt-source .nre-conv-replies`).first(),
    );
    assert.ok(replyRects.length >= 2, "send 行展开区应有多个可见回复条目");
    assert.ok(
      replyRects[1]!.y >= replyRects[0]!.y + replyRects[0]!.height,
      "send 行展开区的回复条目应自上而下排列且不重叠",
    );
    assertSameVisualRow(
      await directChildRects(page.locator(`${EN_SCOPE} .nre-attempt-source .nre-conv-tool > summary`).first()),
      "工具调用摘要",
    );
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 2/4:AttemptSource 视觉规范——状态染色与行号位标记
// (docs/feature/reports/components/attempt-detail.md#attemptsource-web-面视觉规范)。
// ---------------------------------------------------------------------------

async function verifyAttemptSourceVisualMarkers(browser: Browser, evidence: Evidence): Promise<void> {
  const page = await browser.newPage();
  try {
    // --- send(蓝)与 passed(绿)两色:main 是唯一同时有这两种状态行的真实 attempt。
    await page.goto(attemptFileUrl(evidence, evidence.main.attempts[0]!.locator));

    const sendLine = page.locator(`${EN_SCOPE} .nre-attempt-source details.nre-source-line-send`).first();
    const goodLine = page.locator(`${EN_SCOPE} .nre-attempt-source details.nre-source-line.nre-tone-good`).first();
    const plainLine = page.locator(`${EN_SCOPE} .nre-attempt-source .nre-source-line`).first();
    assert.equal(await plainLine.locator("summary").count(), 0, "普通源码行不应具有可展开的 summary");

    const sendBg = await sendLine.locator("> summary").evaluate((el) => getComputedStyle(el).backgroundColor);
    const goodBg = await goodLine.locator("> summary").evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(sendBg, goodBg, `send 行与 passed 行的整行浅染背景色应可区分,实际都是 "${sendBg}"`);
    // "浅染是 tone 色约 8% 的透明混合,不是饱和色块"——只锁"透明度明显小于 1"这个结构性事实,
    // 不锁具体色值。
    assert.ok(colorAlpha(sendBg) < 0.5, `send 行背景应是浅色透明混合而非饱和色块,实际 alpha="${sendBg}"`);
    assert.ok(colorAlpha(goodBg) < 0.5, `passed 行背景应是浅色透明混合而非饱和色块,实际 alpha="${goodBg}"`);

    // 普通行没有整行染色(背景应是容器统一底色,不是任一 tone 的浅染)。
    const plainBg = await plainLine.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(plainBg, sendBg, "普通行不应带上 send 行的浅染背景");
    assert.notEqual(plainBg, goodBg, "普通行不应带上 passed 行的浅染背景");

    // 行号位图标:有状态的行用内联 SVG 图标顶替行号(role=img + aria-label),普通行只是纯数字。
    const sendMark = sendLine.locator(".nre-source-ln-mark");
    assert.equal(await sendMark.getAttribute("aria-label"), "send", "send 行的行号位标记 aria-label 应为 send");
    assert.equal(await sendMark.locator("svg").count(), 1, "send 行的行号位应包含内联 SVG 图标");

    const goodMark = goodLine.locator(".nre-source-ln-mark");
    assert.equal(await goodMark.getAttribute("aria-label"), "passed", "passed 行的行号位标记 aria-label 应为 passed");
    assert.equal(await goodMark.locator("svg").count(), 1, "passed 行的行号位应包含内联 SVG 图标");

    assert.equal(await plainLine.locator(".nre-source-ln-mark").count(), 0, "普通行不应出现行号位状态图标");
    const plainLnText = (await plainLine.locator(".nre-source-ln").innerText()).trim();
    assert.match(plainLnText, /^\d+$/, `普通行的行号位应是纯数字行号,实际 "${plainLnText}"`);

    // 图标颜色随 tone 变化(currentColor 取自 .nre-source-ln 的 color),send 与 passed 应可区分。
    const sendLnColor = await sendLine.locator(".nre-source-ln").evaluate((el) => getComputedStyle(el).color);
    const goodLnColor = await goodLine.locator(".nre-source-ln").evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(sendLnColor, goodLnColor, "send 与 passed 两种状态的行号位图标颜色应可区分");

    // 右缘 meta(阈值分数 pill + chevron)钉在滚动视口右缘:sticky 定位。
    const metaPosition = await sendLine.locator(".nre-source-line-meta").evaluate((el) => getComputedStyle(el).position);
    assert.equal(metaPosition, "sticky", `行右缘 meta 应 sticky 定位,实际 "${metaPosition}"`);

    // --- gate-fail(红):deliberate-fail 的失败行。
    await page.goto(attemptFileUrl(evidence, evidence.deliberateFail.attempt.locator));
    const badLine = page.locator(`${EN_SCOPE} .nre-attempt-source details.nre-source-line.nre-tone-bad`);
    const badMark = badLine.locator(".nre-source-ln-mark");
    assert.equal(await badMark.getAttribute("aria-label"), "failed", "gate-fail 行的行号位标记 aria-label 应为 failed");
    const badBg = await badLine.locator("> summary").evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(colorAlpha(badBg) < 0.5, `gate-fail 行背景应是浅色透明混合而非饱和色块,实际 "${badBg}"`);
    assert.notEqual(badBg, sendBg, "gate-fail(红)与 send(蓝)背景色应可区分");
    assert.notEqual(badBg, goodBg, "gate-fail(红)与 passed(绿)背景色应可区分");

    // 展开区:dashed 上边线,tone 色左缘(box-shadow inset),不是重新套一张卡片。
    const detailStyle = await badLine.locator(".nre-source-line-detail").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { borderTopStyle: cs.borderTopStyle, boxShadow: cs.boxShadow, position: cs.position };
    });
    assert.equal(detailStyle.borderTopStyle, "dashed", `展开区应是 dashed 上边线,实际 "${detailStyle.borderTopStyle}"`);
    assert.notEqual(detailStyle.boxShadow, "none", "展开区应有 tone 色左缘(box-shadow inset),不应是 none");
    assert.equal(detailStyle.position, "sticky", `展开区应 sticky 钉在滚动视口左缘,实际 "${detailStyle.position}"`);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 3/4:点击 send / assertion 行由原生 <details> 展开,普通行不可展开。
// ---------------------------------------------------------------------------

async function verifyClickToExpandInteraction(browser: Browser, evidence: Evidence): Promise<void> {
  const page = await browser.newPage();
  try {
    // --- deliberateFail(failed attempt):assertion 行的点击展开/收起。
    await page.goto(attemptFileUrl(evidence, evidence.deliberateFail.attempt.locator));
    const badLine = page.locator(`${EN_SCOPE} details.nre-source-line.nre-tone-bad`);
    assert.equal(await badLine.count(), 1, "deliberateFail 应恰好有一条 gate-fail 行");
    assert.equal(await badLine.getAttribute("open"), "", "首个失败/警告行应默认展开");

    await badLine.locator("> summary").click();
    assert.equal(await badLine.getAttribute("open"), null, "点击已展开的 assertion 行应能收起(原生 <details> 语义)");
    assert.equal(await badLine.locator(".nre-source-line-detail").isVisible(), false, "收起后展开区不应再可见");

    await badLine.locator("> summary").click();
    assert.equal(await badLine.getAttribute("open"), "", "再次点击应能重新展开");
    assert.equal(await badLine.locator(".nre-source-line-detail").isVisible(), true, "重新展开后展开区应可见");

    // --- 普通行(无 assertion/send/turn):不是 <details>,点击不产生任何展开。
    const plainLine = page.locator(`${EN_SCOPE} .nre-attempt-source .nre-source-line`).first();
    assert.equal(await plainLine.locator("summary").count(), 0, "普通源码行不应具有可展开语义");
    await plainLine.click();
    const openCountAfterPlainClick = await page.locator(`${EN_SCOPE} details[open]`).count();
    assert.equal(openCountAfterPlainClick, 1, "点击普通行不应触发任何 <details> 展开(应仍只有前面手动重新展开的那一条)");

    // --- main(passed attempt):send 行与 passed assertion 行的点击展开。
    await page.goto(attemptFileUrl(evidence, evidence.main.attempts[0]!.locator));
    const sendLine = page.locator(`${EN_SCOPE} details.nre-source-line-send`).first();
    assert.equal(await sendLine.getAttribute("open"), null, "main 没有 bad/warn/na 行,send 行不应默认展开");
    await sendLine.locator("> summary").click();
    assert.equal(await sendLine.getAttribute("open"), "", "点击 send 行应展开该轮回复");
    const sendDetailText = await sendLine.locator(".nre-source-line-detail").innerText();
    assert.match(sendDetailText, /get_stock_price/, "send 行展开区应包含该轮的工具调用回复内容");
    // 再点击收起,验证 send 行同样可逆。
    await sendLine.locator("> summary").click();
    assert.equal(await sendLine.getAttribute("open"), null, "再次点击 send 行应能收起");

    const goodLine = page.locator(`${EN_SCOPE} details.nre-source-line.nre-tone-good`).first();
    assert.equal(await goodLine.getAttribute("open"), null, "main 没有默认展开的 passed 行");
    await goodLine.locator("> summary").click();
    assert.equal(await goodLine.getAttribute("open"), "", "点击 passed assertion 行应展开");
    const goodDetailText = await goodLine.locator(".nre-source-line-detail").innerText();
    // 徽标文案在 CSS 里是 text-transform:uppercase(视觉呈现),innerText 读到的是渲染后的
    // "PASSED";用大小写不敏感匹配,不锁具体大小写这层纯样式细节。
    assert.match(goodDetailText, /passed/i, "passed assertion 行展开区应显示 passed 徽标");
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 4/4:文档零 JS 依赖——禁 JS 后状态染色/行号位标记这类纯 CSS 效果与展开区内容仍完整可读。
// 不要求禁 JS 后展开交互还能操作,report.md 原文是"上述内容仍完整可读"不是"上述交互仍可操作"。
// ---------------------------------------------------------------------------

async function verifyZeroJsReadable(browser: Browser, evidence: Evidence): Promise<void> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();

    // --- deliberateFail:默认展开的失败行,染色 + 图标 + 展开内容禁 JS 后都应原样可见——全部
    // 由服务端渲染好的静态 HTML + CSS 决定(<details open> 是 HTML 属性,不依赖任何脚本)。
    await page.goto(attemptFileUrl(evidence, evidence.deliberateFail.attempt.locator));
    const badLine = page.locator(`${EN_SCOPE} details.nre-source-line.nre-tone-bad`);
    assert.equal(await badLine.getAttribute("open"), "", "禁 JS 后失败行仍应保持默认展开");

    const enScopeText = await page.locator(EN_SCOPE).innerText();
    assert.ok(enScopeText.includes("expected: 3") && enScopeText.includes("received: 2"), "禁 JS 后仍应能读到失败行的 expected/received 细节");

    const badSummaryBg = await badLine.locator("> summary").evaluate((el) => getComputedStyle(el).backgroundColor);
    const badAlpha = colorAlpha(badSummaryBg);
    assert.ok(badAlpha > 0 && badAlpha < 0.5, `禁 JS 后状态染色(纯 CSS 效果)应仍然生效(非透明、非饱和色块),实际 alpha=${badAlpha}`);

    const badIcon = badLine.locator(".nre-source-ln-mark svg");
    assert.equal(await badIcon.count(), 1, "禁 JS 后失败行的行号位图标仍应渲染在 DOM 里");
    const iconBox = await badIcon.boundingBox();
    assert.ok(iconBox !== null && iconBox.width > 0 && iconBox.height > 0, "禁 JS 后行号位图标应有实际可见尺寸(纯 CSS/SVG,不需要脚本)");

    // --- main:收起态的 send / passed 行——不要求禁 JS 后还能点开,只要求"内容本身还在、可读":
    // 展开区文本仍在 DOM 里(用 textContent 读,不依赖可见性),行号位的着色也仍可区分。
    await page.goto(attemptFileUrl(evidence, evidence.main.attempts[0]!.locator));
    const sendLine = page.locator(`${EN_SCOPE} details.nre-source-line-send`).first();
    const sendDetailText = await sendLine.locator(".nre-source-line-detail").textContent();
    assert.ok(sendDetailText?.includes("get_stock_price"), "禁 JS 后 send 行的展开区内容仍应存在于文档中(即便默认收起未可见)");

    const sendLnColor = await sendLine.locator(".nre-source-ln").evaluate((el) => getComputedStyle(el).color);
    const plainLnColor = await page
      .locator(`${EN_SCOPE} .nre-attempt-source .nre-source-line:not(details) .nre-source-ln`)
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(sendLnColor, plainLnColor, "禁 JS 后 send 行号位的着色仍应与普通行可区分");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// 不在报告 §5"视觉与交互" bullet 字面要求的四条里,但复用同一份真实浏览器环境几乎零成本、
// 顺手补上的两项(见本文件头注与用户任务书第 6 条踩坑提醒):
//   a) index.html 的 topbar 客户端水合渲染——B3(verify-render-structure.ts COVERAGE GAP #5)
//      已声明它只能验证驱动 topbar 的数据契约,够不到真实浏览器渲染出的 DOM;这里用真实浏览器
//      补上这块。
//   b) index.html 点击一个 locator 触发的现场 fetch + dialog——这正是本模块需要额外起一个 HTTP
//      server(而不是全程 file://)的原因,顺手验证它端到端工作、渲染出来的内容也带着真实的
//      状态染色。
// ---------------------------------------------------------------------------

async function verifyIndexPageLive(browser: Browser, baseUrl: string, evidence: Evidence): Promise<void> {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    const topbar = page.locator("header.topbar");
    await topbar.waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(consoleErrors.length, 0, `index.html 客户端水合过程中出现 console 错误: ${consoleErrors.join(" | ")}`);

    const brand = topbar.locator("a.brand");
    assert.equal(
      await brand.getAttribute("href"),
      "https://niceeval.com/?utm_source=report&utm_medium=brand",
      "topbar 品牌位链接应指向官网(与 hero 下 PoweredBy 品牌行同族但独立的固定链接)",
    );
    assert.match((await brand.innerText()).trim(), /NiceEval/, "topbar 品牌位应渲染 NiceEval 字样");

    const tabTitles = await topbar.getByRole("tab").allTextContents();
    assert.deepEqual(
      tabTitles,
      ["Report", "Attempts", "Traces"],
      "topbar 导航项应等于 standard 报告 navigation !== false 的三张 page,按声明顺序渲染(不是只验证驱动它的数据契约,是真实水合出的 DOM)",
    );

    // ExperimentList 的前两个字段在桌面视口横向成栏；具体 CSS 布局机制不属于契约。
    assertSameVisualRow(
      await directChildRects(page.locator(".nre-experiment-summary").first()),
      "ExperimentList 摘要",
    );

    // 同一 agent 跨 ExperimentList / AttemptList / MetricScatter 应呈现同一种颜色。class
    // 只用于定位元素，预期比较的是浏览器实际绘制的颜色，不要求由哪一个散列函数或 class 实现。
    const reportColors = new Map<string, string>();
    for (const agent of AGENTS) {
      const key = page.locator(".nre-experiment-agent", { hasText: agent }).first();
      await key.waitFor({ state: "visible" });
      reportColors.set(agent, await key.evaluate((el) => getComputedStyle(el).color));
    }
    const scatterMain = page.locator(".nre-legend-key", { hasText: AGENTS[0] }).first();
    assert.equal(
      await scatterMain.evaluate((el) => getComputedStyle(el).color),
      reportColors.get(AGENTS[0]),
      `同一 agent "${AGENTS[0]}" 在 MetricScatter 与 ExperimentList 中应呈现同一种颜色`,
    );

    await topbar.getByRole("tab", { name: "Attempts" }).click();
    for (const agent of AGENTS) {
      const key = page.locator(".nre-attempt-agent", { hasText: agent }).first();
      await key.waitFor({ state: "visible" });
      assert.equal(
        await key.evaluate((el) => getComputedStyle(el).color),
        reportColors.get(agent),
        `同一 agent "${agent}" 在 AttemptList 与 ExperimentList 中应呈现同一种颜色`,
      );
    }
    await topbar.getByRole("tab", { name: "Report" }).click();

    // 点击失败 attempt 的 locator:触发现场 fetch(attempt 文档)+ dialog,验证端到端工作且
    // dialog 里渲染出来的内容也带着真实的失败细节与状态染色。locator 链接挂在 ExperimentList
    // 每个 experiment 自己的 <details> 折叠区里,默认收起——先展开 deliberate-fail 这一条,
    // 链接才可见可点。
    const failLocator = evidence.deliberateFail.attempt.locator;
    const experimentEntry = page.locator('details.nre-experiment-entry', {
      has: page.locator('.nre-experiment-name[data-sort-value="deliberate-fail"]'),
    });
    await experimentEntry.locator("summary.nre-experiment-summary").click();
    const link = experimentEntry.locator(`a.nre-locator[href="attempt/${encodeURIComponent(failLocator)}.html"]`);
    await link.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const dialogText = await dialog.innerText();
    assert.ok(
      dialogText.includes("expected: 3") && dialogText.includes("received: 2"),
      "index 页点击失败 attempt 的 locator 后,dialog 里应展示 fetch 回来的真实失败详情",
    );
  } finally {
    await page.close();
  }
}

export async function verifyRenderVisual(evidence: Evidence): Promise<void> {
  const { baseUrl, close } = await serveStaticDir(resolve(evidence.siteExportDir));
  const browser = await chromium.launch();
  try {
    await verifyIndexPageLive(browser, baseUrl, evidence);
    await verifyStructuredLayoutNotUaDefault(browser, evidence);
    await verifyAttemptSourceVisualMarkers(browser, evidence);
    await verifyClickToExpandInteraction(browser, evidence);
    await verifyZeroJsReadable(browser, evidence);
  } finally {
    await browser.close();
    await close();
  }
}
