# 外壳与多页

`defineReport` 接受两种入参：传一棵报告树，填进宿主默认外壳的报告槽；传配置对象则在内容之外声明导航外壳——标题、GitHub 等外部链接、页脚、自定义脚本与样式——并可把内容拆成多页。给报告加品牌、发布 benchmark 站、把成绩单与趋势分成独立页面，是同一个 API 的递进用法，形状不换轨：

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

多页用 `pages`，每页装一棵树；可复用的页内容是组件或树的具名导出，从别的文件 import 进来即可：

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
type ReportLocale = "en" | "zh-CN";
type LocalizedText = string | Partial<Record<ReportLocale, string>>;

function defineReport(content: ReportNode): ReportDefinition;
function defineReport(def: ReportDef): ReportDefinition;

/**
 * defineReport 的唯一产物：只作 --report 文件的默认导出，交给宿主装载。
 * 它不是 ReportNode——不能放进任何 content 或报告树，外壳因此不可嵌套。
 */
interface ReportDefinition {
  readonly kind: "report";
}

type NonEmptyArray<T> = readonly [T, ...T[]];

interface ReportShell {
  /** 标题：浏览器标题、页头品牌与首页 hero。精确回退规则见下文。 */
  title?: LocalizedText;
  /** 页头右侧的外部链接，如 GitHub、文档、CI。 */
  links?: ReportLink[];
  /** 每页页脚的一段文字；省略时页脚只有 Powered by 行。 */
  footer?: LocalizedText;
  /** 注入每个页面的脚本，在官方增强脚本之后、按声明顺序于 </body> 前加载；给站点分析与埋点（GA4、react-grab 一类第三方注入）留的口子。 */
  scripts?: ReportAsset[];
  /** 注入每个页面的样式表，在官方样式之后按声明顺序加载。 */
  styles?: ReportAsset[];
}

/** content / pages 互斥由类型表达，不把非法状态留到运行期。 */
type ReportDef = ReportShell &
  (
    | {
        /** 单页缩写，等价于只含 id `report` 的页列表。 */
        content: ReportNode;
        pages?: never;
      }
    | {
        /** 非空页列表；导航按数组顺序显示。 */
        pages: NonEmptyArray<ReportPage>;
        content?: never;
      }
  );

interface ReportPage {
  /** 页面身份：`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符，文件内唯一。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
  /** 这一页的报告树；ReportDefinition 不是 ReportNode，页装不进外壳。 */
  content: ReportNode;
}

interface ReportLink {
  label: LocalizedText;
  href: string;
}

/** src 是相对顶层报告文件的路径；两种形态不可同时出现。 */
type ReportAsset =
  | { src: string; inline?: never }
  | { inline: string; src?: never };
```

## 行为约束

- **单页与多页在宿主内都规范化成页列表。** 树入参规范化为 `{ content: 树 }`，`content: 树` 再展开为 `pages: [{ id: "report", title: 内置页名「报告 / Report」, content: 树 }]`。缩写不是隐式默认——展开完全由写下的值决定。因此单页文件同样有页身份：路由 `#/page/report` 与 `--page report` 都成立，导航项显示内置页名；`show` 只在页数大于一时输出页索引，单页直接渲染。裸 `show` / `view` 装载的[内建报告](built-in.md)走同一条装载管线。
- **`content` 与 `pages` 恰好声明一个，没有隐式默认。** 同时声明或都省略，装载时以完整用户反馈报错，报错指出下一步：要渲染内建报告的内容，写 `content: <ExperimentComparison />`。省略不是一种有含义的取值——读报告文件的人必须能看出会渲染什么。
- **`defineReport` 产物只作默认导出，页内复用具名导出。** `ReportDefinition` 不在 `ReportNode` 类型里：把它放进 `content`、`pages[].content` 或任何报告树，TypeScript 在编译期拒绝，无类型 JavaScript 输入在装载期以完整用户反馈拒绝。要在多个站点间复用一页内容，具名导出那棵树或那个组件——复用从不消费默认导出，所以给一个报告文件加外壳永远不会破坏别处对它内容的 import。
- **页是宿主寻址单位，tab 是页内浏览状态。** 页有 id、路由、导航项和 `--page` 选择器；[`Tabs`](layout.md#tabs) 没有。需要单独打开、深链或在终端独立渲染的内容做成页，同页内的并列视图用 tab。
- **所有页共享同一份 Scope。** 位置参数与 `--experiment` 收窄对全部页生效；页是对同一批数据的不同看法，不承担数据过滤职责。要看不同数据范围，用命令行收窄或在页内组件上显式传 `input`。
- **规范化声明经 `ctx.report` 只读可见，外壳渲染仍归宿主。** 组合组件的 ctx 携带 [`report`](layout.md#自定义组件)——规范化后的报告声明：走完回退链的 `title`、`links`、`footer`、页列表与当前页 id。宿主 chrome 消费的每一份声明组件都能读，特权只剩「渲染位置」（导航、证据页、警告仍由宿主渲染），没有数据秘密。它只进组合组件：解析面与渲染面不依赖站点声明——数据不依赖声明才可序列化、跨站复用，渲染面只吃 props 才保证两面同源；`scripts` / `styles` 是注入资产而非展示声明，不进 `ctx.report`。读 `ctx.report` 的组件是在声明「输出跟随站点」；要站点无关的组件就不读它。`defineReport` 不收自定义参数字段：宿主不消费的值不属于声明，自定义值走语言自带的类型通道——同文件用变量、跨文件用模块导入或装配处的 props；报告树只有两三层，不存在需要 context 兜底的深透传。
- **除 `title` 外的外壳字段是 web 面属性。** `links`、`footer`、`scripts`、`styles` 只被 `view` 与静态导出消费；`show` 读同一文件时消费 `pages`，并把 `title` 用作页索引的标题行。外壳文案是 `LocalizedText`，随外壳的语言切换取值。
- **标题回退必须确定。** 取值链是 `def.title` → Scope 中唯一且相同的非空 snapshot `name` → `"NiceEval"`。快照中没有 name 或存在多个不同 name 时都使用 `NiceEval`，不按数组顺序随机挑一个。`LocalizedText` 按字段值深相等比较，对象键顺序不影响结果。
- **`LocalizedText` 的回退确定。** 取当前 locale；缺失时取 `en`；仍缺失时取按 locale 键字典序的第一个非空值。对象没有任何非空值时装载报错，不渲染空导航项。这条规则同时适用于外壳、page / tab / section 标题、表头和指标 label。
- **web 面页脚恒含 `Powered by niceeval`。** 外壳页脚末行是指向 niceeval 官网的一行小字，自定义 `footer` 文案排在它前面。它是外壳自带的品牌行：不占 `footer` 的语义位、没有关闭配置、不改变任何数据。text 面与 `niceeval/report/react` 嵌入组件都不带它——品牌跟着官方 web 外壳走，不跟着组件走。
- **自定义脚本是增强层。** 与官方增强脚本同一不变量：初始静态 HTML 无 JS 时完整可读，脚本只添加浏览行为，不改变数据、指标口径或初始 HTML 中的数值。典型用途是站点分析与埋点——GA4、react-grab 一类第三方注入观察浏览行为，天然满足不变量。要改数据口径，改的是报告树或指标定义，不是脚本。
- **`{src}` 资产按路径纪律解析。** 允许普通相对路径和 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`；本地 `view` 用虚拟资产 URL 提供文件，静态导出按内容哈希写入 `assets/<sha256><ext>` 并改写 HTML 引用。同内容去重，同名文件不冲突；文件缺失时在启动或导出时报错并给出解析后的路径。
- **校验分两期。** `defineReport({...})` 与宿主装载期校验外壳形状、非空页列表、重复 / 非法 page id 和资产路径；`content` / `pages` 互斥与外壳嵌套已由类型拒绝，运行期仍对无类型 JS 输入做同样校验。页内树在 [resolve 展开](../architecture.md#报告树与两个宿主)时逐节点校验资格；缺任一渲染面或包含任意 HTML intrinsic 时，按该页的失败规则反馈。
- **脚本随导出发布。** 静态导出会原样携带并在读者浏览器执行 `scripts`；[`--out` 的发布防呆](../view.md#静态导出)只检查证据文件的脱敏标记，不检查脚本内容，脚本里别嵌密钥。

导航的完整组成规则——报告页按声明序在前，内置 Runs、Traces 证据页恒排其后、由宿主拥有——见 [View · 页面构成](../view.md#页面构成) 与 [Architecture](../architecture.md#外壳与页装载规范化)。

## 相关阅读

- [内建报告](built-in.md) —— 裸宿主装载的定义与升级路径。
- [排版原语与自定义组件](layout.md) —— 页 content 里的树怎么组织，组合组件怎么写。
- [Show](../show.md) / [View](../view.md) —— 页索引、`--page` 与静态导出。
- [Architecture](../architecture.md) —— 装载规范化与证据页边界。
