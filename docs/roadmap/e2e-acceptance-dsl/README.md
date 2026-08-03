# E2E 验收 DSL：Report 读面 adapter 与 vitest 装配

还没定为当前契约的候选设计,见 [Roadmap 约定](../README.md)。

## 定位

[测试作者面决策](../../design/user-readable-testing/DECISION.md)采纳 [PLAN-2](../../design/user-readable-testing/PLAN-2/README.md):测试正文以 Report 领域对象为入口,断言消费带 evidence、提取路径与对象身份的 `Observed<T>`。
本目录设计那层领域对象**底下**的 adapter——把 plain stdout、PTY 屏幕、JSON、JUnit、导出 HTML 与浏览器页面变成可观察值,再把它们装配进 vitest。

分工一句话：Behavior、evidence recipe、unit / E2E 组合、运行频率、并发与准入门槛归
[NiceEval 测试体系重构](../e2e-acceptance-testing/README.md)；媒介怎么解析、领域对象怎么寻址、动作怎么执行归这里。
判据落在词表上——测试正文只出现领域词,`section`、`row`、`line`、正则与 DOM locator 只出现在 adapter 内部。

本目录不维护历史 bug 题库，不决定某个 Feature 必须有几条 E2E，也不拥有 `scripts/e2e.ts` 的 prepare / cleanup 流程。
它只给已经选定的 proof 提供稳定表达能力；没有测试方案绑定的 DSL 词不构成覆盖。

完整词表见 [Library 逐词表说明](library.md)。
模块边界、Observation 数据流和失败传播见 [Architecture](architecture.md)。
完整测试文件见 [Use Cases](use-case/README.md)。
调研来源见 [References · Playwright ARIA 结构期望](../../references.md#playwright-aria-snapshot-与-ivya--vitest-移植)、[References · trycmd / snapbox](../../references.md#trycmd--snapboxrust)、[References · CLI / TUI 测试生态横评](../../references.md#cli--tui-测试生态横评cli-testing-librarytui-testshell-useatago-等)。

## 问题

E2E 验收脚本(约 4,200 行、近 500 条断言)的断言词表停在**字面层**:`includes()` 子串、整句正则、精确 HTML 字符串。
两类 DSL 症状:

- **化妆性变更打红测试。**
  断言把措辞、字形、间距当成契约锁定:整句文案正则(`/Cost\(lower is better\) × Pass rate\(higher is better\)/`)、80 列精确 padding、`·` 分隔文案与 `✓/✗/!` 字形。
  HTML 面连 class 名一起进预期:`'<summary class="niceeval-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'`。
  渲染器改一个注解措辞、换一种框线,契约没变、测试却变红。
  这违反[变更预算规则](../../engineering/testing/README.md#变更预算无关测试变红是缺陷):「实现重构不改契约时,任何测试都不应变红」。
- **每个脚本手搓解析器。**
  `historyRows()`、`looseIncludes()`、`displayWidth()`(重造 CJK 宽度表)、`extractTemplate()`、`colorAlpha()`——同类结构提取在各 verify 模块里重复发明,没有统一的查询层。
  写脚本的人已经在自救(空白折叠、双面事实互提对比、颜色只比 rendered-to-rendered),但每次都是就地手工。

fail-fast、单例重跑、共享 evidence 被改写和“必须排最后”等运行问题由
[测试方案 Architecture](../e2e-acceptance-testing/architecture.md)解决，不再作为 DSL 自己的职责。

调研结论(细节见 References 三节):现成生态没有能直接用的方案——「vitest 友好的终端结构断言库」这个生态位是空的。
两套设计值得整段照抄:**aria 结构期望的匹配语义**(默认有序子序列、省略即不关心、显式升级精确)和 **trycmd 的容差词表**(脱敏变量长在 golden 里)。

## 候选契约

### 作者面:领域对象,adapter 在下面

测试正文从公开入口进入,把媒介原文交给读面构造函数,之后只写领域词:

```ts
const { stdout } = await cli("pnpm exec niceeval show --report scatter.tsx");
const report = reportView(stdout);

expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds())
  .toHaveSeries(["codex", "claude"]);
expectObserved(report.table("Experiments").rowIds())
  .toShowRows(["main", "rag"]);
```

CLI 命令保留可复制的 shell 原文,读面只类型化返回结果,不把命令藏进场景 helper。
`report` 背后是哪个 adapter 由 Behavior 的 `observations` 声明——stdout、导出 HTML 与浏览器页面各有一个实现,领域词的名字与语义不随媒介变。

adapter 负责三件事:把媒介原文解析成结构、按领域身份寻址、把命中结果包成 `Observed<T>`。
它不持有预期:对象身份、状态与期望值由测试侧独立声明,不从候选 renderer 或 schema 导入。

寻址失败不退化成 `undefined`。
找不到表就报错并列出实际存在的表标题,找不到行就给最近似候选,形状沿用[错误反馈原则](../../error-feedback.md)。
不支持的观察显式报错,不回退成文本包含或正则。

### World 读取接口：消费，不编排

DSL 提供 `world()`、`w.locator()`、`w.target()`、`w.exportDir()`、`w.consumerDir()` 与私有 clone 的类型化读取接口。
manifest 如何产生、何时冻结、哪些 Behavior 有写权限以及 clone 能否并发，由
[测试方案 Architecture](../e2e-acceptance-testing/architecture.md#recipe-与-world)决定。

DSL 只执行两条边界：身份或 digest 不匹配时拒绝读取；未授权能力调用时显式失败。它不静默重跑 producer，也不靠进程全局 cwd 猜结果根。

### 读面按媒介分工

[渲染边界裁决](../../design/user-readable-testing/DECISION.md#渲染边界裁决)已经定死每类事实归哪个读面,这里只补每个读面的实现形态与对照场景:

| 读面 | 观察对象 | 实现形态 | 对照 |
|---|---|---|---|
| process-result | argv、退出码与信号 | `cli()` 的返回值 | [adapter-readback](use-case/adapter-readback.md) |
| stdout | non-TTY 语义输出的公开文字与结构 | 结构解析器加领域寻址 | [render-structure](use-case/render-structure.md) |
| pty-screen | 宽度、折行、降级与 CJK 显示宽度 | 显式 PTY 会话,断终态 cell grid | [render-structure](use-case/render-structure.md) |
| ndjson-events | `exp --json` 生命周期事件 | 逐行按事件身份解析 | [machine-exports](use-case/machine-exports.md) |
| json / junit | 字段、身份与结果语义 | parse 后按结构语义比较 | [machine-exports](use-case/machine-exports.md) |
| html | 导出 HTML 的可访问语义 | Playwright 加真实 Chromium,禁用 JS | [html-export](use-case/html-export.md) |
| browser-a11y | 浏览器交互、CSS 布局与可见状态 | Playwright 浏览器会话,启用 JS | [browser-interaction](use-case/browser-interaction.md) |

两条边界要点:

- **stdout 与 pty-screen 是两个读面,不互相推断。**
  [排版原语的降级声明](../../feature/reports/library/layout.md#量测与降级)写明 non-TTY 下三种线一起消失、字段与数值逐字相同、脚本不解析框字符。
  stdout 解析器因此只按语义形态识别结构;框线、折行与显示宽度归 PTY 读面,证据固定为 invocation、终态 cell grid、scrollback、raw ANSI、resize 与退出信息。
- **HTML 的可访问语义只由真实 Chromium 产生。**
  每例全新 BrowserContext 与 Page;静态 HTML 读面禁用 JS 且只准本地网络,交互 proof 才启用 JS。
  producer identity 与 verifier identity 分开记录,`verify` 因此能分辨「导出站是旧的」与「浏览器版本变了」。

结构解析器读取的排版概念以 [Library · 排版原语](../../feature/reports/library/layout.md)的**文档声明**为规范,是渲染契约的第二实现。
渲染器输出解析不出文档声明的结构时,不是测试脆,是渲染器或解析器有一方违反了契约——这类失配是真发现。

### 逐字比对的适用面

golden 只留给**逐字承诺的短文本**:`--grep` 空结果文案、错误与用法文案、品牌链接这类每个字符都写进公开文档的输出。
比对前先过 scrub 归一(耗时、成本、token、路径、locator 换成占位符),归一在传入 matcher 前完成。

JSON 与 JUnit 不走 golden。
它们 parse 之后按结构语义比较:字段身份、折叠规则(`failed` 对应 `<failure>`、`errored` 对应 `<error>`)、计数与集合关系逐条声明,序列化顺序与空白不进契约。

判据是「多一个字符算不算违约」。
算,才上 golden;不算,说明这个表面不够窄稳,回到对应读面的结构断言。

### 浏览器交互:现成词表加领域词

视觉与交互断言保留 Playwright 宿主。
生态调研结论(见 [References · 浏览器交互 DSL 生态](../../references.md#浏览器交互-dsl-生态playwright-原生词表screenplaycodeceptjs)):引擎全部现成,不自建——寻址用 `getByRole` 与可见文本的官方优先序,等待用 web-first assertion 自动重试。
adapter 只补两样:按公开组件契约立词的领域寻址,与步骤轨迹。
词表见 [Library · 浏览器交互词表](library.md#浏览器交互词表)。

场景写法五条规则:

- **步骤确定,不探测。**
  每一步指名要操作的语义元素(role、可见文本、公开 locator 文本),交互路径确定;不写「逐层点开任何可展开行、直到目标出现」的探测循环。
  探测循环把宿主缺页、层级未渲染、链接不可点折叠成同一种失败,回归发生时测试红在离病因最远的那条断言上。
- **前置条件先行断言。**
  交互开始前先验收宿主报告的页面集合与目标详情页存在;宿主报告文件被改坏时,失败落在前置断言,不落在交互深处。
- **断言可见效果,不断言实现机制。**
  行的显隐用可见性查询与几何框证明,不读实现隐藏用的 class;class selector 只作寻址手段,寻址优先 role 与可见文本。
- **等待只等状态,不等毫秒。**
  「为验证而等」用自动重试断言,「为下一步动作而等」等具体状态;不写固定时长 sleep,不带重试的即时读数(`count()`)不做断言对象。
- **选择器方言收敛进 adapter。**
  场景文件不出现 CSS / class 选择器与 `:visible` 一类方言;可见性判定由领域词(如 `table.visibleRows()`)单点实现。

逐场景的写法对照见 [browser-interaction](use-case/browser-interaction.md)。

### 落点：dialect 留在所属 E2E 仓库

NiceEval 解析器与领域 dialect 签入所属 E2E 仓库，由测试体系选出的 Behavior 消费，不作为通用公共包发布。
两条理由：

- **仓库自治优先。**
  [E2E 总则](../../engineering/testing/e2e/README.md#21-独立的含义)要求把任一 E2E 仓库复制到独立 checkout 后仍能只靠自己的 `pnpm e2e` 完成验收。
  公共包让「用哪个版本」成为跨仓协调项,而各仓库要观察的读面本来就不同:适配器仓库只读 CLI 事实,report 仓库才需要结构与浏览器。
- **重复量还没有证明抽象成本。**
  至少两个自治仓库出现相同且稳定的 kernel / medium protocol 需求后，才评审共享包。
  评审对象是 BrowserContext 生命周期、ActionTrace、Observed 与 evidence capture，不包含 Attempt、`t.send`
  等 NiceEval dialect。

oracle 独立不靠发布形态保证,靠**不 import 候选包任何代码**:解析对象是公开渲染输出,预期由测试侧独立声明。
vitest 是宿主,不是替代入口:验收器只提供函数与 matcher,不带 runner。
`scripts/e2e.ts` 仍是[仓库唯一命令](../../engineering/testing/e2e/README.md#31-唯一命令)的实现，具体 prepare / verify / cleanup 与退出码折叠见[测试方案](../e2e-acceptance-testing/README.md)。

## 待裁决分歧

1. **Playwright `expect` 的 vitest 宿主行为。**
   `@playwright/test` 的 web-first `expect` 脱离自家 runner 后的重试与超时配置需要 spike;不成立则交互等待退回 `locator.waitFor()` 加领域词内轮询,词表形状不变。
2. **PTY 读面的落地批次。**
   PTY 会话与 stdout 解析器能共用多少归一逻辑(显示宽度、折行并回),要等第一批 stdout 断言落地后按真实重复度定。
   在此之前 PTY 只保留「有 ANSI、有面板、到达完成态」这类粗粒度断言。

## 评估过、不采纳的路线

- **以媒介 matcher 为最终作者面**:测试正文写 `toMatchTermSnapshot` 这类媒介期望,读起来仍然是「输出长什么样」,不是「用户完成了什么任务」;[决策](../../design/user-readable-testing/DECISION.md#结论)把它降为 adapter 内部实现。
  匹配语义(有序子序列、省略即不关心、显式升级精确)整段保留,位置从测试正文移进领域 matcher。
- **独立发布的验收包**(工作名 `@niceeval/verify`):公开 npm 依赖确实不破仓库自治,但发布形态会先于真实重复度固化词表,并给每个 E2E 仓库加一条版本协调线。
  oracle 独立由「不 import 候选包」保证,不需要靠单独发包换取;公共包评审推迟到两个自治仓库出现相同稳定需求之后。
- **渲染器自吐语义树作为断言对象**(`show --machine-tree` 一类):最省解析器,但候选包自描述自己——框线全坏、语义树照样报正常,违反「预期独立于候选实现」。
  只可作调试辅助面,不作 oracle。
- **直接采用 cli-testing-library**:只有点查询、没有结构断言,解决不了排版级耦合;单维护者。
  每查询归一化选项的工效学并入领域读面。
- **依赖 @microsoft/tui-test 或自建 xterm.js 网格断言层**:项目已转向 shell-use;为三条 PTY smoke 断言引入终端模拟器不成比例。
  网格模型(断屏幕终态,不断字节流)作为 PTY 读面的认知参照记录在 References。
- **全面 golden 文件**:锁化妆细节,每次渲染微调全矩阵变红,与变更预算规则正面冲突;golden 收窄到逐字承诺的短文本。
- **Gherkin / aruba 式自然语言步骤层**:间接性没有换来表达力,断言仍要落回底层词表。
  playwright-bdd 一族同此否决。
- **CodeceptJS / Serenity-JS 整栈**:前者自带 runner 与 vitest 宿主互斥,启发式寻址(找不到就按 label / name 猜)让失败不可诊断;后者的 Actor / Ability 抽象对「单用户读报告」场景无增益。
  Screenplay 只取「领域词加活动轨迹」之形,见 [References · 浏览器交互 DSL 生态](../../references.md#浏览器交互-dsl-生态playwright-原生词表screenplaycodeceptjs)。

## 相关阅读

- [Library 逐词表说明](library.md) —— 领域词与读面内部两组词的完整语法、匹配语义、API 与失败反馈。
- [Architecture](architecture.md) —— World reader、媒介 adapter、Domain View、`Observed<T>` 与失败传播。
- [Use Cases](use-case/README.md) —— 各种公开媒介的完整目标测试文件。
- [NiceEval 测试体系重构](../e2e-acceptance-testing/README.md) —— Proof Portfolio、Behavior、机制 unit、evidence world、退役与门禁。
- [测试作者面决策](../../design/user-readable-testing/DECISION.md) —— 作者轴、渲染边界与本目录必须满足的十项边界。
- [PLAN-2 · 用户任务规格与类型化可观察读面](../../design/user-readable-testing/PLAN-2/README.md) —— Behavior 声明、User View 规则与失败格式;本目录是它的 adapter 层。
- [验收脚本写法](../../engineering/testing/e2e/verification.md) —— 现行断言约定与 `sh()` 参考实现;本设计定稿后重写的对象。
- [E2E 总则](../../engineering/testing/e2e/README.md) —— 仓库自治、候选注入、退出码折叠;本设计在其边界内运作。
- [功能域 · 报告与读面](../../engineering/testing/e2e/report.md) —— 渲染面断言计划;领域读面的主要落点。
- [测试体系总纲 · 变更预算](../../engineering/testing/README.md#变更预算无关测试变红是缺陷) —— 「化妆性变更不打红」的裁决依据。
- [References · Playwright ARIA 结构期望](../../references.md#playwright-aria-snapshot-与-ivya--vitest-移植) / [trycmd](../../references.md#trycmd--snapboxrust) / [生态横评](../../references.md#cli--tui-测试生态横评cli-testing-librarytui-testshell-useatago-等) —— 调研原始记录:抄什么、不抄什么及理由。
- [Library · 排版原语](../../feature/reports/library/layout.md) —— 终端结构解析器的规范来源。
</invoke>
