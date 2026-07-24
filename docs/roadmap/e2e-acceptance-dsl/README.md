# E2E 验收断言 DSL 与 vitest 验收库

还没定为当前契约的候选设计,见 [Roadmap 约定](../README.md)。调研来源见 [References · Playwright ARIA Snapshot](../../references.md#playwright-aria-snapshot-与-ivya--vitest-移植)、[References · trycmd / snapbox](../../references.md#trycmd--snapboxrust)、[References · CLI / TUI 测试生态横评](../../references.md#cli--tui-测试生态横评cli-testing-librarytui-testshell-useatago-等)。库的完整断言词表——语义树快照语法、匹配语义、golden scrub 规则、点查询 API 与失败反馈——见 [Library 逐词表说明](library.md);真实验收脚本逐场景的「现行断言 → 候选写法」对照见 [Use Cases](use-cases/README.md)。

## 问题

E2E 验收脚本(约 4,200 行、近 500 条断言)的断言词表停在**字面层**:`includes()` 子串、整句正则、精确 HTML 字符串。三类症状:

- **化妆性变更打红测试。** 断言把措辞、字形、间距当成契约锁死:整句文案正则(`/Cost\(lower is better\) × Pass rate\(higher is better\)/`)、整段 HTML 字面量(`'<summary class="nre-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'`)、80 列精确 padding、`·` 分隔文案、`✓/✗/!` 字形。渲染器改一个注解措辞、换一种框线,契约没变、测试变红——直接违反[变更预算规则](../../engineering/testing/README.md#变更预算无关测试变红是缺陷):「实现重构不改契约时,任何测试都不应变红;变红说明该测试锁定了实现细节而不是契约」。
- **每个脚本手搓解析器。** `historyRows()`、`looseIncludes()`、`displayWidth()`(重造 CJK 宽度表)、`extractTemplate()`、`colorAlpha()`——同类结构提取在各 verify 模块里重复发明,没有统一的查询层。写脚本的人已经在自救(空白折叠、双面事实互提对比、颜色只比 rendered-to-rendered),但每次都是就地手工。
- **线性 fail-fast 脚本的运行学。** 第一条断言失败即停,看不到失败全貌;单条断言重跑等于整个 verify 重跑(所幸证据可复用,但流程要人肉注释代码);断言无分组命名,失败定位靠逐条手写消息。

调研结论(细节见 References 三节):现成生态没有能直接用的方案——「vitest 友好的终端结构断言库」这个生态位是空的;但两套设计值得整段照抄:**aria-snapshot 的匹配语义**(默认有序子序列、省略即不关心、`/regex/` 值、显式升级精确)和 **trycmd 的容差词表**(`[..]`/`...`/脱敏变量长在 golden 里)。

## 候选契约

### 形态:独立发布的验收库,vitest 是宿主

验收库是独立发布的 npm 包(工作名 `@niceeval/verify`),不并入 `niceeval` 包、不随候选 tarball 注入。两条理由:

- **oracle 独立。** [E2E 总则](../../engineering/testing/e2e/README.md#41-验收责任)要求预期独立于候选实现,禁止从候选包导入 renderer 或 schema 生成答案。断言库若随候选注入,解析器和渲染器出自同一份提交——两者一起错,测试照样绿。独立包按自己的节奏发版,解析的是**公开渲染输出**(终端文本、导出 HTML 的可访问性树),不 import 候选包任何代码。
- **仓库自治不破。** 测试仓库[禁止跨仓库共享运行时代码](../../engineering/testing/e2e/README.md#21-独立的含义),但公开 npm 依赖(vitest 本身就是)不在此列:各仓库 lockfile 各自锁定版本,复制到独立 checkout 行为不变。

vitest 是宿主,不是替代入口:库只提供 matcher 与查询函数,不带 runner。`scripts/e2e.ts` 仍是[仓库唯一命令](../../engineering/testing/e2e/README.md#31-唯一命令)的实现——prepare(安装核验、起服务、`--force` 跑实验、产出证据清单)→ `vitest run` 执行全部断言 → 按既有规则折叠退出码(`75` 基础设施 / 非零回归)。这改写了[验收脚本写法](../../engineering/testing/e2e/verification.md)的「不引入测试框架」条款,换来的是:失败聚合(一次看到全部断掉的契约,不是第一条)、断言分组命名、`vitest -t <名称>` 单条重跑(证据已产出,重跑零模型成本)、watch 回路。

### 证据生命周期:一次产出,只读消费

「一次真实运行、大量确定性断言」的模型不变,落成机制:

- prepare 阶段产出**证据清单**(evidence manifest,JSON):结果根路径、已提取的 locator、导出站目录、日志路径。路径经环境变量交给 vitest,测试文件从 globalSetup 拿到只读句柄。
- 测试对证据只读。任何测试不再起实验、不写 `.niceeval/`;需要额外 CLI 输出的测试自己起 `niceeval show ...` 子进程(读面命令幂等)。
- 证据存在即复用:开发回路里改断言→重跑 vitest 不花模型成本;`pnpm e2e` 全新验收总是先重新产证。

### 断言词表:三层

逐层的完整语法、匹配语义与 API 见 [Library 逐词表说明](library.md),这里只给分工:

1. **语义树快照**(核心新增)——终端输出解析成 `section` / `table` / `tree` 等排版概念的结构树,用照抄 aria-snapshot 语义的 YAML 匹配(默认有序子序列、省略即不关心、`/regex/`、`/children: equal` 显式升级)。HTML 面不发明,直接采 aria-snapshot 的现成实现(Vitest 4.1.4+ `toMatchAriaSnapshot` / ivya)对可访问性树匹配。
2. **容差 golden**(窄稳表面)——`toMatchFileSnapshot` + 比对前的声明式 scrub 归一(耗时/成本/token/路径/locator → 占位符)。只用于「每个字符都是契约」的表面:`--json` 摘要、JUnit、错误文案。
3. **点查询**(既有风格的升格)——`term(stdout).section(...).table().rows()`、`historyRows()` 等,把各脚本手搓的提取器升格为库词表,供「只断言自有事实出现」的场景使用。

解析器与渲染器的关系:结构解析器读取的排版概念以 [Library · 排版原语](../../feature/reports/library/layout.md)的**文档声明**为规范,是渲染契约的第二实现。渲染器输出解析不出文档声明的结构时,不是测试脆,是渲染器或解析器有一方违反了契约——这类失配是真发现。

### 断言分级与既有边界的对应

三层词表不改变[各域的断言边界](../../engineering/testing/e2e/README.md#43-cli-读回),只是给每层配上合适的工具;逐场景的写法对照见 [Use Cases](use-cases/README.md):

| 场景 | 既有边界 | 用哪层 | 对照 |
|---|---|---|---|
| 适配器仓库读回 | 自有事实的子串级出现,不断言布局 | 第三层点查询 | [adapter-readback](use-cases/adapter-readback.md) |
| report 仓库渲染结构 | 区块存在、相对顺序、计数、默认展开折叠 | 第一层语义树快照 | [render-structure](use-cases/render-structure.md) |
| report 仓库读面行为 | history / stats / locator / 收窄 | 第一层 + 第三层 | [readback](use-cases/readback.md) |
| report 仓库视觉与交互 | 行为与几何,不锁颜色值与 class 列表 | 现有 Playwright 写法保留 | [html-export](use-cases/html-export.md) |
| 导出 HTML 语义结构 | 语义块存在、可访问结构 | 第一层 aria 快照 | [html-export](use-cases/html-export.md) |
| 机器出口与错误文案 | 逐字段格式契约 | 第二层容差 golden | [machine-exports](use-cases/machine-exports.md) |
| 发布包消费边界 | 三种 JSX 配置下装载渲染成功 | 第一层 + 证据生命周期 | [package-consumer](use-cases/package-consumer.md) |
| CLI 仓库 PTY smoke | 有 ANSI、有面板、到达完成态 | 现状保留,粗粒度点查询 | — |

## 待裁决分歧

1. **迁移范围。** 全矩阵迁移 vitest,还是只迁 report 仓库(断言最密、脆断言最集中)、适配器仓库的 10–15 条读回断言保持线性脚本?倾向后者起步:适配器读回本来就该停在子串级,线性脚本的成本可接受;report 先迁,跑通后再决定是否推广。
2. **ivya 的离浏览器可用性。** 对 happy-dom 装载的导出 HTML 直接跑 ivya 能否产出正确的 a11y 树需要 spike;不行则 a11y 快照走 vitest browser mode,与现有 Playwright 共存的进程模型要设计。
3. **双面同源断言。** 同一份语义期望能否同时匹配 text 结构树与 web a11y 树(替代现有的两套手写提取器互比)?词表不同(终端 `section/table` vs aria `region/table`),需要节点类别映射;表达力收益明确,但可能过度设计——留待第一层落地后按实际重复度裁决。
4. **包的源码落点。** 独立包定了,但源码放 niceeval 仓库内(发布流程要支持第二个包)还是独立仓库,随发版机制一起裁决。

## 评估过、不采纳的路线

- **渲染器自吐语义树作为断言对象**(`show --machine-tree` 一类):最省解析器,但候选包自描述自己——框线全坏、语义树照样报正常,违反「预期独立于候选实现」。只可作调试辅助面,不作 oracle。
- **直接采用 cli-testing-library**:只有点查询、没有结构断言,解决不了排版级耦合;单维护者。每查询归一化选项的工效学并入第三层。
- **依赖 @microsoft/tui-test 或自建 xterm.js 网格断言层**:项目已转向 shell-use;为三条 PTY smoke 断言引入终端模拟器不成比例。网格模型(断屏幕终态,不断字节流)作为认知参照记录在 References。
- **全面 golden 文件**:锁化妆细节,每次渲染微调全矩阵变红,与变更预算规则正面冲突;golden 收窄到「每个字符都是契约」的表面。
- **Gherkin / aruba 式自然语言步骤层**:间接性没有换来表达力,断言仍要落回底层词表。

## 相关阅读

- [Library 逐词表说明](library.md) —— 三层断言词表的完整语法、匹配语义、API 与失败反馈。
- [Use Cases](use-cases/README.md) —— 真实验收脚本逐场景的「现行断言 → 候选写法」对照。
- [验收脚本写法](../../engineering/testing/e2e/verification.md) —— 现行断言约定与 `sh()` 参考实现;本设计定稿后重写的对象。
- [E2E 总则](../../engineering/testing/e2e/README.md) —— 仓库自治、候选注入、退出码折叠;本设计在其边界内运作。
- [功能域 · 报告与读面](../../engineering/testing/e2e/report.md) —— 渲染面断言计划;第一层词表的主要落点。
- [测试体系总纲 · 变更预算](../../engineering/testing/README.md#变更预算无关测试变红是缺陷) —— 「化妆性变更不打红」的裁决依据。
- [References · Playwright ARIA Snapshot](../../references.md#playwright-aria-snapshot-与-ivya--vitest-移植) / [trycmd](../../references.md#trycmd--snapboxrust) / [生态横评](../../references.md#cli--tui-测试生态横评cli-testing-librarytui-testshell-useatago-等) —— 调研原始记录:抄什么、不抄什么及理由。
- [Library · 排版原语](../../feature/reports/library/layout.md) —— 终端结构解析器的规范来源。
