# 外壳与多页

`defineReport` 接受两种入参：传一棵报告树，填进宿主默认外壳的报告槽；传配置对象则在内容之外声明导航外壳——标题、GitHub 等外部链接、页脚、[主题](theme.md)、head 标签注入、自定义脚本与样式——并可把内容拆成多页、加入以 locator 为输入的参数化 page，或用 `extends` 把另一份报告整站接过来。给报告加品牌、发布 benchmark 站、把成绩单与趋势分成独立页面、定制 attempt 详情，始终只操作 pages：

```tsx
// reports/frontier.tsx —— ① 一棵树：树入参，等价于 { content: 树 }
import { ExperimentComparison, defineReport } from "niceeval/report";

export default defineReport(<ExperimentComparison />);
```

```tsx
// reports/branded.tsx —— ② 同一棵树 + 品牌外壳：配置对象，content 装树
import { ExperimentComparison, defineReport } from "niceeval/report";

export default defineReport({
  title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
  links: [{ label: "GitHub", href: "https://github.com/you/coding-agent-memory-evals" }],
  content: <ExperimentComparison />,
});
```

多页用 `pages`，每页装一棵树；可复用的页内容是组件或树的具名导出，从别的文件 import 进来即可。整站复用另一份报告不走 `pages`——用 `extends` 在那份报告上叠外壳（字段与合并语义见下），最常见的用法是给[内建视图](built-in.md)加标题、链接和 head：

```tsx
// reports/branded.tsx —— extends:内建整站 + 自己的外壳
import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";

export default defineReport({
  extends: standard,
  title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
  links: [{ label: "GitHub", href: "https://github.com/you/coding-agent-memory-evals" }],
});
```

```tsx
// reports/site.tsx —— ③ 多页：页是字面量，content 装树
import {
  ExperimentComparison, Scoreboard, defineReport, examScore,
} from "niceeval/report";
import { RecentFailures } from "./components/recent-failures.tsx";

export default defineReport({
  title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
  links: [
    { label: "GitHub", href: "https://github.com/you/coding-agent-memory-evals" },
    { label: { en: "CI", "zh-CN": "CI" }, href: "https://github.com/you/repo/actions" },
  ],
  footer: { en: "Published nightly from CI.", "zh-CN": "由 CI 每晚发布。" },
  head: [
    { tag: "script", attrs: { async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-XXXX" } },
    { tag: "script", children: "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XXXX');" },
    { tag: "link", attrs: { rel: "icon", href: "./assets/favicon.svg" } },
  ],
  scripts: [{ src: "./assets/annotate.js" }],
  styles: [{ inline: ".nre .nre-hero { letter-spacing: 0.02em; }" }],
  pages: [
    { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: <ExperimentComparison /> },
    {
      id: "exam",
      title: { en: "Exam", "zh-CN": "成绩单" },
      content: <Scoreboard rows="agent" questions={[
        "security/sql-injection",
        "security/path-traversal",
        "correctness/retry",
      ]} fullMarks={100} score={examScore} />,
    },
    { id: "failures", title: { en: "Failures", "zh-CN": "待处理失败" }, content: <RecentFailures limit={20} /> },
  ],
});
```

```sh
niceeval view --report reports/site.tsx              # 完整多页导航，首页是第一页
niceeval show --report reports/site.tsx              # 多页时输出页索引
niceeval show --report reports/site.tsx --page exam  # 渲染指定页
```

## 字段穷尽

```ts
/** locale 标签（BCP 47）。数据协议不封语言上限；官方宿主界面语言与内置文案词典当前覆盖 en、zh-CN，其它 locale 按 LocalizedText 回退规则取值。 */
type ReportLocale = string;
type LocalizedText = string | Readonly<Record<ReportLocale, string>>;

function defineReport(content: ReportNode): ReportDefinition;
function defineReport(def: ReportDef): ReportDefinition;

/**
 * defineReport 的唯一产物：作报告文件的默认导出，或 defineConfig 的 report 字段，
 * 两条路都交给宿主装载。
 * 它不是 ReportNode——不能放进任何 content 或报告树，外壳因此不可嵌套。
 */
interface ReportDefinition {
  readonly kind: "report";
}

type NonEmptyArray<T> = readonly [T, ...T[]];

interface ReportShell {
  /** 站点标题：浏览器标题、show 页索引标题行与 `ctx.report.title` 的取值源；[`Hero`](site-components.md#hero) 缺省消费它。精确回退规则见下文。 */
  title?: LocalizedText;
  /** 页头右侧的外部链接，如 GitHub、文档、CI。 */
  links?: ReportLink[];
  /** 每页页脚的一段文字；省略时不渲染页脚（品牌行归 PoweredBy 组件，不占页脚）。 */
  footer?: LocalizedText;
  /** view 整站的类型化视觉令牌；精确形状、语义与 CSS 出口见 Theme。 */
  theme?: ReportTheme;
  /**
   * 注入每页 `<head>` 的结构化标签，在官方与外壳样式之后按声明顺序渲染。
   * 第三方 snippet（分析、埋点、评论）、SEO meta、favicon、字体、JSON-LD 的家：
   * 声明什么标签就渲染什么标签，宿主只做结构校验，新的第三方接入不需要契约变更。
   */
  head?: HeadTag[];
  /** 注入每个页面的脚本，在官方增强脚本之后、按声明顺序于 </body> 前加载；宿主管线接管的增强层资产（本地文件 / 内联）。 */
  scripts?: ReportAsset[];
  /** 注入每个页面的样式表，在官方样式之后按声明顺序加载。 */
  styles?: ReportAsset[];
}

/**
 * 结构化 head 标签。tag 是白名单闭集——head 是元数据与第三方脚本的注入口，不是 HTML 后门。
 * attrs 值为 true 渲染裸布尔属性（async、defer），字符串渲染 `key="value"`（值转义后落 HTML）；
 * 属性语义与脚本内容同一约定——作者义务，宿主不校验。
 * meta / link 无子内容由类型表达；script / style 的 children 是原样文本，不转义。
 */
type HeadTag =
  | { tag: "meta" | "link"; attrs: Record<string, string | true>; children?: never }
  | { tag: "script" | "style"; attrs?: Record<string, string | true>; children?: string };

/** content / pages / extends 三选一由类型表达，不把非法状态留到运行期。 */
type ReportDef = ReportShell &
  (
    | {
        /** 单页缩写，等价于只含 id `report` 的页列表。 */
        content: ReportNode;
        pages?: never;
        extends?: never;
      }
    | {
        /** 非空 page 列表；其中 navigation !== false 的项按数组顺序显示。 */
        pages: NonEmptyArray<ReportPage>;
        content?: never;
        extends?: never;
      }
    | {
        /**
         * 在另一份报告上叠外壳：页列表取 base 的页列表；本对象声明的外壳字段
         * 整字段覆盖 base 的同名字段，未声明的沿用 base。base 是任何 `defineReport`
         * 产物——内建视图或自己别的报告文件的具名导出。合并在 `defineReport` 调用时
         * 完成，产物仍是普通 ReportDefinition，因此可以再被 extends。
         */
        extends: ReportDefinition;
        content?: never;
        pages?: never;
      }
  );

interface ReportPageBase {
  /** 页面身份：`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符，文件内唯一。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
  /** 这一页的报告树；ReportDefinition 不是 ReportNode，页装不进外壳。 */
  content: ReportNode;
}

type ReportPage =
  | (ReportPageBase & {
      /** 缺省：消费宿主选择的 Scope。 */
      input?: "scope";
      /** 缺省 true；false 可做不进导航的静态辅助页。 */
      navigation?: boolean;
    })
  | (ReportPageBase & {
      /** 按 locator 消费一份 AttemptEvidence。 */
      input: "attempt";
      /** 参数化 page 没有 locator 时不可打开，必须不进导航。 */
      navigation: false;
    });

interface ReportLink {
  label: LocalizedText;
  href: string;
  /**
   * 可选内联 SVG 字标，web 面渲染在 label 前，静态导出原样内联。
   * 不收组件：外壳声明经序列化边界进前端,ReactNode 过不去,可序列化是外壳契约的一部分。
   * 内容是作者义务,宿主不校验——与 scripts 同一约定。
   */
  icon?: { svg: string };
}

/** src 是相对顶层报告文件的路径；两种形态不可同时出现。 */
type ReportAsset =
  | { src: string; inline?: never }
  | { inline: string; src?: never };
```

## 行为约束

- **单页与多页在宿主内都规范化成 page 列表。** 树入参规范化为 `{ content: 树 }`，`content: 树` 再展开为 `pages: [{ id: "report", title: 内置页名「报告 / Report」, input: "scope", navigation: true, content: 树 }]`。缩写不是隐式默认。`show` 渲染初始 scope-input page（`--page` 指定，缺省第一张可导航 page），随后只为其它 `navigation !== false` 的 pages 附索引；参数化 page 不进索引，也不能在没有 locator 时用 `--page` 单独打开。裸 `show` / `view` 装载的[内建报告](built-in.md)走同一条装载管线。
- **`content` / `pages` / `extends` 恰好声明一个，没有隐式默认。** 多选或都省略，装载时以完整用户反馈报错，报错指出下一步：要渲染内建报告，写 `extends: standard`（`import { standard } from "niceeval/report/built-in"`）。省略不是一种有含义的取值——读报告文件的人必须能看出会渲染什么。
- **`extends` 的合并语义是「pages 归 base、外壳逐字段覆盖」，且在 `defineReport` 调用时折叠完成。** 页列表取 base 的完整 pages——包括不进导航的参数化 page；本对象声明的外壳字段（`title` / `links` / `footer` / `theme` / `head` / `scripts` / `styles`）整字段替换 base 的同名字段，未声明的沿用 base。`theme` 的内层 token 也不隐式深合并；需要局部改色时显式展开主题对象（[写法](theme.md#library-dx)）。要改任一 page 的 content，按既有规则从公开组件重新声明 pages；没有 page 之外可单独覆盖的内容槽。产物是普通 `ReportDefinition`：base 不被修改，链式 extends 天然成立，宿主装载看到的永远是已折叠的 page 列表与外壳。`extends` 只收 `defineReport` 产物，其它值（普通对象、React 组件、报告树）装载报错。
- **`defineReport` 产物只有两个去处：默认导出交宿主装载，或作 `extends` 的 base。** `ReportDefinition` 是普通值——可赋给变量、可直接断言测试、可从别的模块 re-export；「默认导出」只是宿主装载 convention，不是值本身的限制。它不在 `ReportNode` 类型里：把它放进 `content`、`pages[].content` 或任何报告树，TypeScript 在编译期拒绝，无类型 JavaScript 输入在装载期以完整用户反馈拒绝——报告级复用只有 `extends` 这一个位置。要在多个站点间复用一页内容，具名导出那棵树或那个组件；`extends` 产物是新值、base 不被修改，所以给一个报告加外壳永远不会破坏别处对 base 的引用。
- **页是宿主寻址单位，tab 是页内浏览状态。** 页有 id、路由、导航项和 `--page` 选择器；[`Tabs`](layout.md#tabs) 没有。需要单独打开、深链或在终端独立渲染的内容做成页，同页内的并列视图用 tab。
- **page 显式声明输入。** scope-input page 消费同一份收窄后的 Scope；`input: "attempt"` 的参数化 page 每次只消费 locator 对应的一份 `AttemptEvidence`。后者仍是 page，只因没有 locator 时不可打开而要求 `navigation: false`。一份报告至多一张 attempt-input page；没有时 locator 只显示为文本，宿主不追加详情（见 [Attempt 详情组件](attempt-detail.md)）。
- **规范化声明经 `ctx.report` 只读可见，当前输入经 `ctx.page` 可见。** 组合组件的 ctx 携带 [`report`](layout.md#自定义组件)——走完回退链的 `title`、`links`、`footer` 与完整 pages 元数据；`ctx.page` 是 `{ id, input: "scope" } | { id, input: "attempt", locator, evidence }`。注入资产与视觉配置（`theme` / `head` / `scripts` / `styles`）不进 `ctx.report`，组件靠稳定语义 class 和 CSS token 取色，不按主题改变数据或树。宿主 chrome 消费的每一份声明组件都能读，没有数据秘密，也没有保留内容——hero、警告区、attempt 列表、trace 瀑布与 attempt 详情区块都是 page 内的普通组件。宿主保留的是机器加一个固定品牌位：装载与 resolve 管线、page 路由与导航渲染、locator 解析与 dialog 摆放、文档单例、语言切换，以及页头左端的 NiceEval 字标（[边界清单](../architecture.md#宿主保留的只有机器)）。
- **`head` 是元数据与第三方脚本的注入口。** 标签按声明顺序渲染进每页 `<head>`，落在官方与外壳样式之后。`tag` 白名单是 `meta`、`link`、`script`、`style` 四种，白名单外装载报错；宿主自有的文档单例不接受声明——`<title>` 不在白名单里（标题走 `title` 字段的回退链），`meta charset` 与 `meta name="viewport"` 由宿主拥有，声明它们装载报错并指回对应契约。`script` / `style` 的 `children` 原样落进标签，其中出现 `</script>` / `</style>` 时装载报错（该上下文无法转义，报错给出拆分或转移建议）。GA4、data-* 驱动的 tracker、og:image、favicon、字体、JSON-LD 都是 vendor 文档的逐字段直译，不需要 DOM 自举样板。head 里的脚本与 `scripts` 同受增强层不变量约束。
- **除 `title` 外的外壳字段是 web 面属性。** `links`、`footer`、`theme`、`head`、`scripts`、`styles` 只被 `view` 与静态导出消费；`show` 读同一文件时消费 `pages`，并把 `title` 用作页索引的标题行。外壳文案是 `LocalizedText`，随外壳的语言切换取值。
- **`title` 的落点是浏览器标题、`show` 页索引标题行与 `ctx.report.title`。** 页面里的 hero 标题不是外壳渲染的——它由 [`Hero` 组件](site-components.md#hero)承担，`Hero` 缺省消费 `ctx.report.title`，同一取值链因此贯通浏览器标题与页内 hero。标题回退必须确定：取值链是 `def.title` → Scope 中唯一且相同的非空 snapshot `name` → 内置文案「Eval 运行结果 / Eval Results」。快照中没有 name 或存在多个不同 name 时都落到内置文案，不按数组顺序随机挑一个。`LocalizedText` 按字段值深相等比较，对象键顺序不影响结果。浏览器 `<title>` 与 `meta charset` / `viewport` 同族，是宿主拥有的文档单例——这是「宿主只剩机器」里机器的一部分，不是内容特权。
- **`LocalizedText` 的回退确定。** 取当前 locale；缺失时取 `en`；仍缺失时取按 locale 键字典序的第一个非空值。对象没有任何非空值时装载报错，不渲染空导航项。这条规则同时适用于外壳、page / tab / section 标题、表头和指标 label。
- **报告能声明的品牌是组件，不是外壳属性；宿主页头另有一个报告改不动的固定品牌位。** `view` 页头左端恒定渲染 NiceEval 字标（45° 方块 mark + 文字），外链官网 `https://niceeval.com/?utm_source=report&utm_medium=brand`，是产品品牌位、属宿主 chrome（[边界清单](../architecture.md#宿主保留的只有机器)），报告定义与外壳字段都不能覆盖或移除它。报告作者能声明的品牌只有一件:[`PoweredBy`](site-components.md#poweredby)——无 props、无关闭配置的双面组件，web 面渲染指向 niceeval 官网 `https://niceeval.com/?utm_source=report&utm_medium=powered-by`（`utm_medium` 区分点击来自页头字标还是页内品牌行）的一行品牌色小字，text 面零输出。链接不抑制 Referer（`rel` 只声明 `noopener`），报告站点的来源域由浏览器默认 Referer 策略带给官网统计，不进 URL 参数——静态导出在构建期不知道自己最终托管在哪个域名。`Hero` / `HeroCard` 恒含品牌行，组件本身不给拆除配置；不想要品牌的站点不用这几个组件、自己写双面组件——品牌跟着组件走，用组件就带上它的完整行为。`footer` 文案单独渲染在页面底部，省略 `footer` 时不渲染页脚，与品牌无关。
- **自定义脚本是增强层，不变量是作者义务。** 与官方增强脚本同一不变量：初始静态 HTML 无 JS 时完整可读，脚本只添加浏览行为，不改变数据、指标口径或初始 HTML 中的数值。宿主不校验也无法校验脚本内容——脚本在读者浏览器里能做任何事，这条约定靠作者履行，违反它的站点其数字可信度由作者自己负责。典型用途是站点分析与埋点——只观察浏览行为的第三方脚本天然满足不变量。要改数据口径，改的是报告树或指标定义，不是脚本。
- **本地资产按路径纪律解析，外链只住 `head`。** `scripts` / `styles` 的 `{src}` 只收本地路径——允许普通相对路径和 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`，相对顶层报告文件解析；外链声明在 `{src}` 里装载报错并指引改写成 `head` 条目。`head` 标签 `attrs` 里的 `src` / `href` 按 scheme 分流：`http(s)://` 开头视为外链，原样落进最终标签，宿主不 vendored、不校验可达性（加载失败是浏览器行为，作者义务）；protocol-relative `//` 与其它 scheme 装载报错；其余值当本地路径，走上面同一条路径纪律。本地资产在本地 `view` 与静态导出都按内容哈希物化为 `assets/<sha256><ext>` 并改写 HTML 引用，同内容去重，同名文件不冲突；文件缺失时在启动或导出时报错并给出解析后的路径。
- **校验分两期。** `defineReport({...})` 与宿主装载期校验外壳形状、非空页列表、重复 / 非法 page id、资产路径和 `head` 标签结构（白名单、宿主自有单例、children 上下文）；`content` / `pages` 互斥与外壳嵌套已由类型拒绝，运行期仍对无类型 JS 输入做同样校验。页内树在 [resolve 展开](../architecture.md#报告树与两个宿主)时逐节点校验资格；缺任一渲染面或包含任意 HTML intrinsic 时，按该页的失败规则反馈。
- **脚本随导出发布。** 静态导出会原样携带并在读者浏览器执行 `scripts` 与 `head` 里的脚本，导出不检查脚本内容，脚本里别嵌密钥。

导航的组成只有一条规则：pages 中 `navigation !== false` 的项按声明序排列，宿主不追加任何项。裸宿主导航里的报告、Attempts、Traces 与 locator 详情都是[内建报告](built-in.md)声明的 page；最后一张因为 `navigation: false` 不显示。换 `--report` 后要不要它们全部由报告文件决定。见 [View · 页面构成](../view.md#页面构成) 与 [Architecture](../architecture.md#外壳与页装载规范化)。

## 相关阅读

- [内建报告](built-in.md) —— 裸宿主装载的定义与升级路径。
- [主题与 CSS 定制](theme.md) —— 强调色、状态色、分类色板与完整 CSS 出口。
- [站点组件](site-components.md) —— hero、品牌行、警告区、快照诊断区、修复 prompt 与 trace 瀑布。
- [Attempt 详情组件](attempt-detail.md) —— attempt-input page 能用哪些公开区块组装。
- [排版原语与自定义组件](layout.md) —— 页 content 里的树怎么组织，组合组件怎么写。
- [Show](../show.md) / [View](../view.md) —— 页索引、`--page` 与静态导出。
- [Architecture](../architecture.md) —— 装载规范化与宿主机器边界。
