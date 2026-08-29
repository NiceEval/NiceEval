# 约束与候选

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

本页只记载四个候选共同面对的契约、现状和历史事实。

## 共同约束

### L1：执行仍只有两层

[测试体系总纲](../../engineering/testing/README.md)把证明分成确定性 unit 与真实 E2E。
“用户任务规格”只能是作者视角，不能形成 offline integration 或伪协议第三层。

### L2：Feature 是产品语义单源

完整用户路径已经归 [`docs/feature/*/use-case/`](../../feature/README.md)。
测试作者面只能引用契约链接目标，并声明自己证明哪一个结果；不能再复述一份产品行为定义。

### L3：测试规模不适合逐条人工登记

在本次 Git 历史审计参照点 `c12aeeb27d4f`，tracked `*.test.ts(x)` 共 190 个文件、52,624 行和
2,227 个 `it` / `test`；其中 Runner 有 623 个测试，Report 有 590 个测试。数字必须与 commit 一起引用，
避免仓库继续演进后把旧读数误写成“当前规模”。
任何要求维护者为每条机制测试手填业务元数据的方案，都会把登记本身变成主要成本。

### L4：现有 registry 只有文件粒度

[`cases-registry.lint.ts`](../../../lint/docs/cases-registry.lint.ts)只检查文件前 20 行的一条 `// cases:`。
一个 5,319 行测试文件和一篇粗粒度类别文档之间，没有可执行的场景映射。

### L5：历史否决了两种重复源

`6abccb8b` 曾建立 Feature 测试场景表，`998ebeef` 又删除 1,862 行重复清单。
候选不能把场景重新手抄进 Markdown，也不能从测试输出生成一份需要签入维护的镜像清单。

### L6：E2E 仓库必须自治

[E2E 总纲](../../engineering/testing/e2e/README.md)要求候选包注入、外部 cwd、真实协议和独立预期。
不同 E2E 仓库不能依赖一个中央套件来解释相同内部模型。

自治不排斥稳定的测试工具依赖，但共享工具不能拥有具体仓库的测试语义、evidence schema 或用户预期。

### L7：昂贵证据一次生产，多面消费

一次真实模型运行可以同时支撑 CLI、JSON、HTML 与浏览器验收。
prepare 之后共享给多个测试的证据必须只读；需要迁移、修复或追加结果的场景，要使用独立结果根或隔离 Repo。
不能只靠调用顺序或 manifest 里的布尔字段保护共享状态。

当前 Report E2E 仍靠执行顺序保护共享结果根。
这属于候选都必须消除的现状约束，不能当成可复用协议。

### L8：独立 oracle 不能从候选实现派生

历史上 `5c5f5b95` 从候选包导入 schema 版本，次日 `89ba8e64` 恢复为签入测试仓库的独立预期。
结构化 parser 只改变读取方式，不自动使预期独立。
真实 provider 的 token 数也不适合成为签入常量；usage 兼容性应比较同次调用独立捕获的上游公开事件与 niceeval 公开出口之间的字段关系。

### L9：媒介契约不同

管道捕获是非 TTY；正式终端布局需要显式 PTY。
[Inspection CLI](../../feature/inspection/cli.md)规定 machine consumer 读取结构化 protocol document，不能靠框线字符理解 plain stdout。

JSON 和 JUnit 承诺字段与结果语义，不默认承诺缩进、字段顺序和 XML 空白。
HTML 的语义树、浏览器交互与 CSS 布局也是三个不同观察面。
ARIA E2E 必须说明真实浏览器引擎、隔离的 page / context 和 verifier provenance，不能让 DOM 模拟器冒充浏览器边界。

### L10：渲染所有权存在现行矛盾

测试总纲与 [Inspection 与 Insight E2E](../../engineering/testing/e2e/inspection.md)把真实 text / HTML 指定为 E2E 唯一验收面。
但 [`unit/reports.md`](../../engineering/testing/unit/reports.md)又要求若干 text 字符串与 HTML 输出断言。

候选必须明确划线：纯数据投影和无媒介语义可在 unit 证明；用户可见 text、HTML 语义、PTY 布局与交互由相应真实读面证明。

### L11：机制测试需要确定性工具

并发、重试、延迟与超时不能通过真实 sleep 证明。
Effect 路径可以采用 `@effect/vitest`、`it.effect`、`TestClock` 与 Layer，但这是机制测试卫生，不是用户行为方案成立的前提。

### L12：churn 不构成质量判断

niceeval 仍处于 beta，公开契约快速演进会让高质量测试一起变化。
候选只能分别观察契约变更、内部重构、失败诊断和维护成本，不能用总跟改次数证明方案优劣。

### L13：GitHub PR 不能安全运行带密钥的任意代码

fork PR 拿不到仓库 secrets；同仓 PR 代码同样可能读取它收到的任何密钥。
候选必须提供完整的无密钥 PR lane，把 live provider 放到可信 main、nightly、手动或 release lane。
不能用 `pull_request_target` 检出并执行 PR 代码来绕过这条安全边界。

本机与 `ubuntu-latest` 都可使用 Docker，但 Docker 可能是测试 executor，也可能只是被测 sandbox / service。
候选必须区分这两个角色，并说明没有 Docker 时哪些测试可运行。

## 候选清单

- [PLAN-1：场景元数据与媒介语义 matcher](PLAN-1/README.md)。
  保留现有测试位置和写法，用最小协议补上身份、索引与稳定观察。
- [PLAN-2：用户任务规格与类型化可观察读面](PLAN-2/README.md)。
  建立用户行为主证明视图，同时让机制证明继续靠近源码。
- [PLAN-3：声明式 Acceptance Case](PLAN-3/README.md)。
  把前置、动作和结果建模成数据，再由 unit 或 E2E driver 选择性执行。
- [PLAN-4：真实场景 Repo 与原生结果断言](PLAN-4/README.md)（推荐）。
  用原生 Vitest 保留完整用户动作与独立预期，只让 repo manifest 负责本地 / CI 编排。
