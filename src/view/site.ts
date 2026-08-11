// 站点管线:本地 server 与 `--out` 的唯一联系面(docs/feature/reports/README.md 开篇)。
// planSite 把结果根物化成一份站点产物清单(index.html + artifact 证据树),writeSite 把清单
// 写盘,server 按路径服务同一份清单——布局与取数知识(artifact 相对路径、sources.json 解引用)
// 只住在这里,两个宿主都是哑消费者,同一路径两边逐字节一致(site-parity 测试守护)。

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { loadViewScan, type ResolvedHeadTag, type ViewScan, type ViewScanOptions } from "./data.ts";
import { localizeText, type ReportPage } from "../report/runtime/host.ts";
import type { ReportLocale } from "../report/model/locale.ts";
import type { PageRendererAssets } from "../report/extension/types.ts";
import { hashEvalSource, normalizeEvalSource } from "../record/source-hash.ts";

/**
 * 站点产物清单里的一个文件:现算内容(content)、指向结果根内的原文件(file),或延迟到
 * 真正被请求 / 导出时才求值的产出器(lazy)。lazy 专为 `attempt/<locator>.html` 准备——
 * 每个可达 locator 一份,数量可能很大,不能像 index.html 那样在建清单时就全部渲染
 * (architecture.md「管线以 page 实例为单位执行」:本地 server 按请求求值并缓存进当前
 * plan,`writeSite` 在写任何文件前对全部产出器求值一次)。
 */
export interface SiteFile {
  /** 站点相对路径(posix),如 `index.html`、`artifact/<base>/events.json`。 */
  path: string;
  contentType: string;
  source: { kind: "content"; body: string } | { kind: "file"; abs: string } | { kind: "lazy"; produce: () => Promise<string> };
}

export interface SitePlan {
  /** path → SiteFile;写盘按它遍历,server 按它查表(查不到即 404,不存在旁路取数)。 */
  files: Map<string, SiteFile>;
  /** 构建这份产物用的扫描结果(宿主前置校验与调试用;不进产物)。 */
  scan: ViewScan;
  /**
   * 外壳(styles / scripts / head 资产)的内容指纹。本地模式据此决定重建后是就地换报告块还是
   * 整页重载(docs/feature/reports/README.md「页面就地换内容」)——外壳住在 `<head>` 里,
   * 就地替换要重放整套加载顺序,比重载一次更难解释。
   */
  shellFingerprint: string;
}

const JSON_TYPE = "application/json; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";

/** 站点烘焙的界面语言全集(前端的语言切换在这两者之间)。 */
export const SITE_LOCALES: readonly ReportLocale[] = ["en", "zh-CN"];

/** 一块报告 HTML 在站点里的路径(本地模式的按需渲染入口)。 */
export function reportBlockPath(pageId: string, locale: ReportLocale): string {
  return `report/${pageId}.${locale}.html`;
}

export interface SitePlanOptions {
  /**
   * `index.html` 预烘哪些报告块(docs/feature/reports/README.md「本地看到的就是发出去的」)。
   *
   * - `"all"`(缺省):全部页 × 全部语言在建清单时就渲染并烘进 `index.html`。导出产物脱离
   *   server 也能读,`file://` 直接打开同样不缺块。
   * - `"on-demand"`:本地模式。`index.html` 本身延迟到被请求时才渲染,那时只烘初始页的两种
   *   语言(首屏因此不必再取一次);其余块登记成 `report/<pageId>.<locale>.html` 的按需入口。
   *   一次重建于是一块都不渲染,渲染发生在真的有人要看的时候。
   */
  prebake?: "all" | "on-demand";
}

// 前端会 fetch 的原字节证据文件(docs/feature/reports/README.md「静态导出」:有就带,缺时前端
// 在证据位置如实显示缺失;o11y.json 永不进产物——报告数字已烘进 HTML,浏览器不读它)。
const RAW_COPY_ARTIFACTS = ["commands.json", "events.json", "trace.json", "diff.json"];

function registerRendererAssets(assets: PageRendererAssets, files: Map<string, SiteFile>): void {
  const decoder = new TextDecoder();
  for (const asset of [...assets.styles, ...assets.scripts]) {
    if (files.has(asset.path)) continue;
    files.set(asset.path, {
      path: asset.path,
      contentType: asset.kind === "style" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
      source: { kind: "content", body: decoder.decode(asset.content) },
    });
  }
}

function rendererAssetTags(assets: PageRendererAssets, prefix = ""): string {
  const styles = assets.styles.map(
    (asset) =>
      `<link rel="stylesheet" data-niceeval-renderer-asset="style:${asset.hash}" href="${prefix}${asset.path}">`,
  );
  const scripts = assets.scripts.map(
    (asset) =>
      `<script data-niceeval-renderer-asset="script:${asset.hash}" src="${prefix}${asset.path}"></script>`,
  );
  return [...styles, ...scripts].join("");
}

async function renderReportBlock(
  scan: ViewScan,
  files: Map<string, SiteFile>,
  pageId: string,
  locale: ReportLocale,
): Promise<string> {
  const [html, assets] = await Promise.all([
    scan.reportPages.render(pageId, locale),
    scan.reportPages.assets(pageId),
  ]);
  registerRendererAssets(assets, files);
  return `${rendererAssetTags(assets)}${html}`;
}

/** 本地重建推送与站点文件入口共用：先登记当前 page 的资产，再返回同一份报告块字节。 */
export async function renderSiteReportBlock(
  plan: SitePlan,
  pageId: string,
  locale: ReportLocale,
): Promise<string> {
  return renderReportBlock(plan.scan, plan.files, pageId, locale);
}

/**
 * 把结果根物化成站点产物清单。sources.json 是唯一的格式例外——盘上是去重后的引用
 * (`{path, sha256}[]`),必须经 `AttemptHandle.sources()` 解引用出完整内容(`{path, content}[]`)
 * 才能给浏览器用,解引用只发生在这里这一处。
 */
export async function planSite(input?: string, opts: ViewScanOptions = {}, site: SitePlanOptions = {}): Promise<SitePlan> {
  const scan = await loadViewScan(input, opts);
  const files = new Map<string, SiteFile>();
  // head 标签的本地 src/href 资产按内容哈希物化进 assets/(同内容同扩展名去重,
  // 同名文件不冲突;shell.md「行为约束」),回填后的标签渲染进 <head>。
  const headHtml = await materializeHeadAssets(scan.shellAssets.head, files);

  // 预烘哪些块由宿主决定,渲染的是同一个 scan.reportPages.render——两个宿主在同一条
  // (pageId, locale) 上产出同一份字节(view.md「本地看到的就是发出去的」)。
  const prebake = site.prebake ?? "all";
  const blocks: { id: string; locale: ReportLocale }[] = scan.reportPages.ids.flatMap((id) =>
    SITE_LOCALES.map((locale) => ({ id, locale })),
  );
  const renderBlocks = async (
    wanted: readonly { id: string; locale: ReportLocale }[],
  ): Promise<{ id: string; locale: ReportLocale; html: string }[]> =>
    Promise.all(wanted.map(async (b) => ({ ...b, html: await renderReportBlock(scan, files, b.id, b.locale) })));

  if (prebake === "all") {
    files.set("index.html", {
      path: "index.html",
      contentType: HTML_TYPE,
      source: { kind: "content", body: await renderHtml(scan, headHtml, await renderBlocks(blocks), false) },
    });
  } else {
    // 初始页两种语言随 index.html 一起下发:首屏不必再取一次,切语言也不必。
    const initial = blocks.filter((b) => b.id === scan.viewData.report?.initialPageId);
    files.set("index.html", {
      path: "index.html",
      contentType: HTML_TYPE,
      source: { kind: "lazy", produce: async () => renderHtml(scan, headHtml, await renderBlocks(initial), true) },
    });
    for (const block of blocks) {
      const path = reportBlockPath(block.id, block.locale);
      files.set(path, {
        path,
        contentType: HTML_TYPE,
        source: { kind: "lazy", produce: () => renderReportBlock(scan, files, block.id, block.locale) },
      });
    }
  }

  for (const [base, srcDir] of scan.artifactDirs) {
    for (const name of RAW_COPY_ARTIFACTS) {
      const abs = join(srcDir, name);
      if (!existsSync(abs)) continue;
      const path = `artifact/${base}/${name}`;
      files.set(path, { path, contentType: JSON_TYPE, source: { kind: "file", abs } });
    }
    if (existsSync(join(srcDir, "sources.json"))) {
      const attempt = scan.attemptsByBase.get(base);
      const sources = attempt ? await attempt.sources() : null;
      const path = `artifact/${base}/sources.json`;
      const refs: { path: string; sha256: string }[] = [];
      for (const source of sources ?? []) {
        const sha256 = hashEvalSource(normalizeEvalSource(source.content));
        refs.push({ path: source.path, sha256 });
        // 携带 attempt 的正文已由读取面归拢；静态站沿用 Record 的 Run 级去重布局。
        const runBase = base.split("/").slice(0, 2).join("/");
        const sourcePath = `artifact/${runBase}/sources/${sha256}.json`;
        if (!files.has(sourcePath)) {
          files.set(sourcePath, {
            path: sourcePath,
            contentType: JSON_TYPE,
            source: { kind: "content", body: JSON.stringify({ content: source.content }) },
          });
        }
      }
      files.set(path, { path, contentType: JSON_TYPE, source: { kind: "content", body: JSON.stringify(refs) } });
    }
  }

  // `<pageId>/<key>.html`:每一张参数化页(显式声明或标准库补位,attempt、experiment……
  // 核心不区分)按 `params.enumerate()` 给出的实例各一份(view.md「静态导出」)。头资产的
  // 相对路径要从 `<pageId>/` 子目录回退一层,因此单独物化一份 `../` 前缀版本(与 index.html
  // 的根相对版本共用同一份 files 内容寻址,同一份资产只按内容哈希写一次)。每份文档的
  // IO/resolve 延迟到真正被请求或导出时才发生——实例数量可能很大,不能像 index.html 一样
  // 在建清单时就全部渲染(architecture.md「管线以 page 实例为单位执行」)。
  if (scan.paramPages.size > 0) {
    const nestedHeadHtml = await materializeHeadAssets(scan.shellAssets.head, files, "../");
    for (const [pageId, entry] of scan.paramPages) {
      for (const key of entry.instances.keys()) {
        const path = `${pageId}/${encodeURIComponent(key)}.html`;
        files.set(path, {
          path,
          contentType: HTML_TYPE,
          source: {
            kind: "lazy",
            produce: () => renderParamDocument(scan, entry.page, key, () => entry.render(key), nestedHeadHtml, files),
          },
        });
      }
    }
  }

  return {
    files,
    scan,
    shellFingerprint: createHash("sha256")
      .update(JSON.stringify([scan.shellAssets.styles, scan.shellAssets.scripts, headHtml]))
      .digest("hex"),
  };
}

/**
 * 把站点产物清单写盘(`--out`)。输入本身已是导出布局(对上次导出的目录重新生成)时原文件不自拷。
 * 先对全部 lazy 产出器求值(任一份 attempt page resolve 失败就在这一步整体抛出,不写入任何
 * 文件——architecture.md「写 writeSite 的整体失败语义」:静态导出不留半套目录),求值期间
 * 头资产可能按内容哈希追加注册进 plan.files(见 planSite 的 `../` 前缀变体),因此写盘前
 * 重新遍历一次清单,不用求值前的快照。
 */
export async function writeSite(plan: SitePlan, outDir: string): Promise<void> {
  const lazyBodies = new Map<string, string>();
  await Promise.all(
    [...plan.files.values()]
      .filter((file): file is SiteFile & { source: { kind: "lazy"; produce: () => Promise<string> } } => file.source.kind === "lazy")
      .map(async (file) => {
        lazyBodies.set(file.path, await file.source.produce());
      }),
  );
  for (const file of plan.files.values()) {
    const dest = join(outDir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    if (file.source.kind === "lazy") {
      await writeFile(dest, lazyBodies.get(file.path)!, "utf-8");
    } else if (file.source.kind === "content") {
      await writeFile(dest, file.source.body, "utf-8");
    } else if (resolve(file.source.abs) !== resolve(dest)) {
      await copyFile(file.source.abs, dest);
    }
  }
}

/**
 * 取清单中一个文件的字节(server 响应体与写盘内容同源;file 类缺失时返回 undefined,由宿主 404)。
 * lazy 类每次调用都重新求值(不在这里缓存)——server.ts 按「同一路径同一 plan 生命周期内
 * 不重复计算」的语义自行把求值结果写回 plan.files,这里保持纯函数,不持有 plan 状态。
 */
export async function readSiteFile(file: SiteFile): Promise<string | Buffer | undefined> {
  if (file.source.kind === "content") return file.source.body;
  if (file.source.kind === "lazy") return file.source.produce();
  try {
    // 原字节读取:assets/ 里的 head 资产可以是二进制(favicon、字体),不能按 utf-8 解码。
    return await readFile(file.source.abs);
  } catch {
    return undefined;
  }
}

/** head 资产的响应 content-type;命不中的按二进制下发(写盘路径不受影响)。 */
const ASSET_CONTENT_TYPES: globalThis.Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": JSON_TYPE,
};

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** 单个 head 标签 → HTML:attrs 值 true 渲染裸布尔属性,字符串转义后渲染 `key="value"`;script/style 的 children 原样落进标签(闭合序列已在装载期拒绝)。 */
function renderHeadTagHtml(tag: ResolvedHeadTag, attrs: globalThis.Record<string, string | true>): string {
  const attrHtml = Object.entries(attrs)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttrValue(value)}"`))
    .join("");
  if (tag.tag === "meta" || tag.tag === "link") return `<${tag.tag}${attrHtml}>`;
  return `<${tag.tag}${attrHtml}>${tag.children ?? ""}</${tag.tag}>`;
}

/**
 * head 标签落成 HTML,本地 src/href 资产进站点清单:`assets/<sha256><ext>`(与调用方无关,
 * 同内容同扩展名跨全部文档去重),source 指向原文件(写盘 copyFile、server 原字节下发都
 * 二进制安全)。标签属性回填的路径按 `prefix` 相对当前文档:index.html 在站点根,
 * `prefix` 为空;`attempt/<locator>.html` 低一级,`prefix` 是 `"../"`(view.md「静态导出」
 * 「所有 HTML 都按自身相对位置生成 assets/ / artifact/ 引用」)。外链(http(s)://)原样透传,
 * 不进 assets/,prefix 对它们不生效。
 */
async function materializeHeadAssets(head: ResolvedHeadTag[], files: Map<string, SiteFile>, prefix = ""): Promise<string> {
  const rendered: string[] = [];
  for (const tag of head) {
    const attrs = { ...tag.attrs };
    if (tag.localAsset) {
      const bytes = await readFile(tag.localAsset.abs);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const path = `assets/${sha256}${tag.localAsset.ext}`;
      files.set(path, {
        path,
        contentType: ASSET_CONTENT_TYPES[tag.localAsset.ext.toLowerCase()] ?? "application/octet-stream",
        source: { kind: "file", abs: tag.localAsset.abs },
      });
      attrs[tag.localAsset.attr] = `${prefix}${path}`;
    }
    rendered.push(renderHeadTagHtml(tag, attrs));
  }
  return rendered.join("\n");
}

/**
 * 站点根归一:托管方可以把站点根暴露成无尾斜杠路径(cleanUrls 用 `/showcase/memory` 直接服务
 * `index.html`,并把带斜杠形态 308 回无斜杠),而浏览器按文档 URL 的**目录**解析相对引用——
 * 那时 `attempt/<locator>.html`、`assets/`、`artifact/` 全部少一层,链接、证据 fetch 与 head
 * 资产一起断。`index.html` 按构造恒是站点根,所以这段引导脚本在任何相对引用被解析之前
 * 落一个 `<base>` 把根写成目录形态(view.md「静态导出」)。判定只看 pathname:已是目录形态
 * 不插入,末段带扩展名(`/out/index.html`、`file://` 直接打开)取其目录,其余补一层斜杠。
 * 独立 attempt 文档住在真实的 `attempt/` 目录下,相对引用天然对齐,不带这段脚本。
 * 写成 `location` / `document` 两个自由变量的形式:测试直接把这段源码原样喂给假的宿主执行,
 * 断言的是导出产物里的同一份字节,不复制第二份判定逻辑。
 */
export const SITE_BASE_SCRIPT = `(function(){try{var p=location.pathname;if(p.charAt(p.length-1)==="/")return;var i=p.lastIndexOf("/");var root=/\\.[A-Za-z0-9]+$/.test(p.slice(i+1))?p.slice(0,i+1):p+"/";var b=document.createElement("base");b.href=root;document.head.appendChild(b);}catch(e){}})();`;

const TEMPLATE_PLACEHOLDERS = {
  siteBase: "__NICEEVAL_SITE_BASE_SCRIPT__",
  styles: "<!-- __NICEEVAL_STYLES__ -->",
  appCode: "__NICEEVAL_APP_CODE__",
  viewData: "__NICEEVAL_VIEW_DATA_JSON__",
  liveFlag: "__NICEEVAL_VIEW_LIVE_SCRIPT__",
  reportSlot: "<!-- __NICEEVAL_REPORT_SLOT__ -->",
} as const;
/**
 * 本地模式的活壳开关。订阅、按需取块与就地换块都由前端应用做(app/main.tsx),这里只立一个
 * 标记——静态产物不带它,同一份前端产物在导出站里就是一个普通 SPA,不去连不存在的 server。
 */
const VIEW_LIVE_FLAG_SCRIPT = `<script>window.__NICEEVAL_VIEW_LIVE__=true;</script>`;

/**
 * 把 viewData(只含原始值与相对路径,不含宿主机绝对路径)和前端产物烘焙进单个 HTML。
 * `<head>` 最前面是站点根归一的引导脚本(SITE_BASE_SCRIPT),排在任何相对引用之前。
 * 报告槽恒在:每页报告 HTML 作为 <template id="niceeval-report-<pageId>-<locale>"> 静态块
 * 烘在 __NICEEVAL_VIEW_DATA__ 旁(不 hydrate,自定义组件的 <Style> 产物已内联其中),
 * 并恒内联官方组件样式(report/react/styles.css)与渐进增强 runtime(report/react/enhance.js,
 * 内联 <script>:排序 / 过滤 / tooltip,document 级事件委托,报告块被前端搬进槽位也无需重绑;
 * 无 JS 时报告内容依旧完整);外壳声明的 styles 注入在官方样式之后、head 标签(headHtml,
 * 由站点管线物化本地资产后渲染)在外壳 styles 之后、scripts 注入在官方增强脚本之后
 * </body> 前,均按声明顺序(docs/feature/reports/README.md)。
 * 前端只把当前页 / 当前界面语言对应的块摆进报告槽位置,不解析。
 */
export async function renderHtml(
  scan: ViewScan,
  headHtml = "",
  prebaked?: readonly { id: string; locale: ReportLocale; html: string }[],
  localHost = false,
): Promise<string> {
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");
  const [reportStyles, reportEnhance] = await Promise.all([
    readFile(new URL("../report/assets/styles.css", import.meta.url), "utf-8"),
    readFile(new URL("../report/assets/enhance.js", import.meta.url), "utf-8"),
  ]);

  const shellStyles = scan.shellAssets.styles.map((css) => `\n<style>\n${css}\n</style>`).join("");
  const shellScripts = scan.shellAssets.scripts.map((js) => `<script>\n${js}\n</script>\n`).join("");

  // 调用方没给预烘清单时(直接调 renderHtml 的场景)按全渲处理,与 `--out` 同义。
  const blocks =
    prebaked ??
    (await Promise.all(
      scan.reportPages.ids.flatMap((id) =>
        SITE_LOCALES.map(async (locale) => ({ id, locale, html: await scan.reportPages.render(id, locale) })),
      ),
    ));
  const pageTemplates = blocks
    .map((block) => `<template id="niceeval-report-${block.id}-${block.locale}">${block.html}</template>`)
    .join("\n");

  // 初始 <title> 与 hero 同源:走完回退链的报告标题(viewData.report.title;终点是内置文案
  // 「Eval 运行结果 / Eval Record」)。模板 lang="en",初始按 en 解析;前端按界面语言更新。
  const title = localizeText(scan.viewData.report?.title, "en") ?? "Eval Record";

  return template
    .replace(TEMPLATE_PLACEHOLDERS.siteBase, () => SITE_BASE_SCRIPT)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(title)}</title>`)
    .replace(
      TEMPLATE_PLACEHOLDERS.styles,
      () =>
        `<style>\n${styles}\n</style>\n<style>\n${reportStyles}\n</style>\n<script>\n${reportEnhance}\n</script>` +
        shellStyles +
        (headHtml ? `\n${headHtml}` : ""),
    )
    .replace(TEMPLATE_PLACEHOLDERS.reportSlot, () => pageTemplates)
    .replace(TEMPLATE_PLACEHOLDERS.viewData, () => JSON.stringify(scan.viewData).replace(/</g, "\\u003c"))
    .replace(TEMPLATE_PLACEHOLDERS.liveFlag, () => (localHost ? VIEW_LIVE_FLAG_SCRIPT : ""))
    .replace(TEMPLATE_PLACEHOLDERS.appCode, () => JSON.stringify(app).replace(/</g, "\\u003c"))
    .replace("</body>", () => `${shellScripts}</body>`);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * localStorage 里存的界面语言优先,否则按 navigator 语言猜(与 app/i18n.ts 的 detectLocale()
 * 同一套判定规则,故意在这里用一份独立的极小 vanilla 版本——standalone 文档不拉入
 * react/react-dom,不需要为了一次语言判定背上整个 SPA 打包产物)。
 */
const ATTEMPT_LOCALE_SWAP_SCRIPT = `(function(){try{var s=localStorage.getItem("niceeval:view:locale");var l=s==="zh-CN"||s==="en"?s:((navigator.languages||[navigator.language]).some(function(v){return /^zh/i.test(String(v||"").trim())})?"zh-CN":"en");if(l==="zh-CN"){var en=document.querySelector('[data-niceeval-locale="en"]');var zh=document.querySelector('[data-niceeval-locale="zh-CN"]');if(en)en.hidden=true;if(zh){zh.hidden=false;}document.documentElement.lang="zh-CN";}}catch(e){}})();`;

/**
 * 一个参数化页实例(attempt、experiment……核心不区分)的独立文档:与 index.html 是「文档」
 * 而非「App」——en 内容直接可见(无 JavaScript 时浏览器正常渲染这个 div),zh-CN 变体带
 * `hidden` 属性(同样不需要 JS 就能被浏览器正确隐藏,只是不显示,不是不存在),一段极小内联
 * 脚本按检测到的界面语言在两者间切换(docs/feature/reports/README.md「静态导出」:基线链接
 * 直接指向这份文档,保证无 JavaScript 也能读完整详情)。不复用 renderHtml/template.html 的
 * SPA 外壳——那条路径的 #root 要等 React 挂载才有内容,不满足这里「无 JS 仍完整可读」的要求。
 * 增强脚本(index.html 里的渐进增强,拦截目标链接后 fetch 这份文档、按同一
 * `[data-niceeval-locale]` 选择器取出对应语言的内容塞进 dialog)与这里的选择器保持同一套
 * 约定,不维护第二份提取逻辑。
 */
async function renderParamDocument(
  scan: ViewScan,
  page: Pick<ReportPage, "id" | "title">,
  key: string,
  render: () => Promise<{ en: string; "zh-CN": string; assets: PageRendererAssets }>,
  headHtml: string,
  files: Map<string, SiteFile>,
): Promise<string> {
  const content = await render();
  registerRendererAssets(content.assets, files);
  const [reportStyles, reportEnhance] = await Promise.all([
    readFile(new URL("../report/assets/styles.css", import.meta.url), "utf-8"),
    readFile(new URL("../report/assets/enhance.js", import.meta.url), "utf-8"),
  ]);
  const shellStyles = scan.shellAssets.styles.map((css) => `\n<style>\n${css}\n</style>`).join("");
  const shellScripts = scan.shellAssets.scripts.map((js) => `<script>\n${js}\n</script>\n`).join("");
  const title = `${localizeText(page.title, "en") ?? page.id} · ${key}`;

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(title)}</title>`,
    `<style>\n${reportStyles}\n</style>`,
    `<script>\n${reportEnhance}\n</script>`,
    rendererAssetTags(content.assets, "../"),
    shellStyles,
    headHtml ? `\n${headHtml}` : "",
    "</head>",
    "<body>",
    `<div data-niceeval-locale="en">${content.en}</div>`,
    `<div data-niceeval-locale="zh-CN" hidden>${content["zh-CN"]}</div>`,
    `<script>${ATTEMPT_LOCALE_SWAP_SCRIPT}</script>`,
    shellScripts,
    "</body>",
    "</html>",
  ].join("\n");
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
}
