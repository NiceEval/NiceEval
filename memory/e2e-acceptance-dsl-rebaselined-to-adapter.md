# 裁决:E2E 验收 DSL 收敛为 Report 读面 adapter,不做全仓作者面也不发公共包

## 裁决

2026-08-01,`docs/roadmap/e2e-acceptance-dsl/` 按[测试作者面决策](../docs/design/user-readable-testing/DECISION.md)整体重定基线:
它设计的是 [PLAN-2](../docs/design/user-readable-testing/PLAN-2/README.md) 领域读面**底下**的 adapter,不是测试作者面本身。
测试正文只出现 Report 领域对象与 `Observed<T>`;`section`、`row`、`line`、YAML 结构期望、role locator 与正则全部降进 adapter 内部。

同批落定的边界(逐条对应 DECISION「现有 E2E Acceptance DSL 的处理」十项):

- **stdout 与 PTY 拆成两个读面。** stdout 解析器按 `layout.md`「量测与降级」声明的 non-TTY 形态识别结构(标题成行加两列缩进、按列对齐的纯文本),不读框线字符——那份声明自己写着「脚本不解析框字符」。折行、显示宽度与降级归 PTY 读面,证据固定为 invocation、终态 cell grid、scrollback、raw ANSI、resize 与退出信息。
- **JSON / JUnit 改结构语义比较**,`fieldNames()` 加 `toShowExactRows` 承接整段 golden 的「不多不少」职责;golden 收窄到逐字承诺的短文本。
- **evidence 清单升成冻结 world**:proof 显式绑定 `evidenceRecipeId`,冻结靠原子发布、路径守卫、权限与前后文件树 digest,要改结果的场景走私有 clone 加 `mutationActionId`。
- **验收器留在所属 E2E 仓库**,不发布 `@niceeval/verify`;两个自治仓库出现相同稳定需求后才评审公共包。

## 曾选方案

- **独立发布的 npm 包 `@niceeval/verify`**,各 E2E 仓库共用一套词表与解析器。
- **以媒介 matcher 为最终作者面**:测试正文写 `toMatchTermSnapshot` 的 YAML 结构期望、`term().section(...).table().rows()` 点查询与 `toMatchAriaSnapshot`。
- **JSON / JUnit 整段 golden**,靠 scrub 表归一易变值。
- **ivya 加 happy-dom 离浏览器产出 a11y 树**(原文记为待裁决,等 spike)。

## 否决理由

- 媒介 matcher 读起来仍是「输出长什么样」,不是「用户完成了什么任务」;这是 DECISION 否决 PLAN-1 作为作者面的同一条理由。匹配语义(有序子序列、省略即不关心、显式升级)整段保留,只是位置从测试正文移进领域 matcher,口径写在 matcher 名字上而不是期望文本的内联指令里。
- 发布形态会先于真实重复度固化词表,还给每个 E2E 仓库加一条版本协调线,与 [[e2e-repo-autonomy-replaces-shared-suite]] 的自治判据冲突。oracle 独立由「不 import 候选包任何代码」保证,不需要靠单独发包换取。
- 整段 golden 把序列化顺序与空白也写进契约,而 JSON / XML 都不承诺这两样;结构比较同样能拦住字段漂移。
- a11y 树只认真实浏览器:每例全新 BrowserContext / Page,静态 HTML 禁 JS 且只准本地网络,producer 与 verifier identity 分开记,离浏览器实现产出的树不构成同一份证据。

## 连带影响

- 七篇 use case 各补一节「回归剧本」,拿 memory 台账里的真实缺陷当回放输入,写明新写法在哪一阶段红。配对见各篇正文,包括一条按设计抓不到的([[visual-migration-silently-changed-computed-formulas]] 的公式漂移归单元层数据语义)。
- [[verify-readback-mutation-orders-later-e2e-report-domains]] 的「这一段必须排最后」从脚本头注约定变成结构约束:只读验收改不动共享 world。
- [[e2e-browser-scenario-probe-loop-brittleness]] 记的五条写法规则不变,浏览器词表补 `chartPoint` / `tooltip`,以承接 [[enhance-hooks-rot-silently-when-renderer-renames-classes]] 想要的「增强能力整页体检」。
- [[css-classname-grep-guard-retired]] 指向的 html-export「样式脱对齐类缺陷」一节保留,归属从 Playwright 改称浏览器读面,内容不变。
</content>
