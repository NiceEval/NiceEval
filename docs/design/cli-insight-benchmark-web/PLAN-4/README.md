# PLAN-4：BenchmarkBundle + 有界 React adapter（推荐）

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md) · [CLI](cli.md) · [Library](library.md) · [Architecture](architecture.md)

## 解决的问题

本方案把数据契约与网页便利层分开。Framework-neutral Bundle 是稳定产品面；React adapter 只减少安全消费闭合值的重复代码。

CLI、Insight 和用户网站分别拥有呈现。它们只共享 AnalysisMaterializer、descriptor catalog 与 closed codec。

## 核心心智

```text
Record → AnalysisMaterializer
           ├─ niceeval query / show
           ├─ niceeval insight → private InsightRevision UI
           └─ materializeBenchmarkBundle()
                    ↓
              BenchmarkBundle
                 ├─ any framework / chart / server
                 └─ niceeval/benchmark/react
                        ↓
                   user-owned page
```

## 公共层次

| 层 | 稳定责任 | 明确不拥有 |
|---|---|---|
| AnalysisMaterializer | descriptor、query、alignment、closed codec、provenance | 页面、route、CSS、HTTP。 |
| BenchmarkBundle | versioned transport、resource、identity、budget、Evidence state | Record reader、Sample、callback、部署 URL。 |
| Bundle reader | digest 验证、resource coherence、用户注入的 byte reader | 网络策略、鉴权、页面。 |
| React adapter | Provider、同 BundleIdentity hooks、有限 render-prop / ARIA 状态投影 | fetch、聚合、排序、图表、router、theme。 |
| 用户网站 | route、style、chart、interaction、auth、cache、deploy | Record schema 与 Analysis 口径。 |

## 静态优先

静态流程先完整 materialize Bundle，再让 Astro、React 或任意构建工具读取它。发布目录内容寻址，不需要 NiceEval server。

动态流程只在用户私有服务器调用同一个 materializer。每次调用仍形成完整 immutable Bundle；浏览器只读取用户交付的 Bundle bytes。

## Insight

`niceeval insight` 是第一方动态 debug UI。它固定一个 InsightRevision，按需读取 trace、diff 与 artifact，并在 Record 改变时提示新 revision。

Insight 不接受用户 component、Page、route、theme 或 export。它的前端实现不拥有公共 React adapter 的 ABI。

## CLI

`niceeval query` 提供 AI-native discover/query/explain。`niceeval show` 只保留 exact Run / Attempt 与预置摘要的人读快速路径。

两者不经过 React 或 Bundle UI。完整协议见 [CLI](cli.md)。

## 网页作者面

用户可以直接读取 Bundle，把 frame 交给任何图表库。需要 React 便利时，用户另行 import `niceeval/benchmark/react`。

Astro 页面直接 import 用户自己的 `.tsx` wrapper，并由用户选择 `client:load`、`client:visible` 或无 hydration。NiceEval 不发布 Astro integration。

## Cases

本方案完整兑现 [C1–C12](../CASES.md)。关键门如下：

- C2 / C3 由穷尽 alignment union 与 comparability 字段守住；
- C5 由 InsightRevision 守住；
- C6 / C7 共用同一 Bundle materializer；
- C8 的 BundleHandle 在客户端 wrapper 构造，不作为 hydration prop；
- C9 / C10 由 Bundle budget、digest 与 schema 状态守住；
- C11 的参数只能填已声明 slot，不能改变 resource graph；
- C12 直接消费 framework-neutral resource。

## 代价与重新裁决触发器

Bundle transport、canonical bytes 与 materialization budget 成为长期公共承诺。React adapter 也有一个小而真实的 ABI。

以下任一要求出现时必须重新做架构裁决：

- React adapter 要拥有 Table、Chart、fetch、URL、router、CSS 或数据选择；
- Astro integration 要接管 route、build 或 server adapter；
- 浏览器要提交任意 query 或在旧 Bundle 上懒补资源；
- Bundle 要分页、透明分块或原地迁移；
- Insight 私有查询开始产生不同的分母、missing 或 Evidence 语义。

## 入口

- [CLI](cli.md)：AI-native machine protocol、Human show 与 Insight 命令。
- [Library](library.md)：Definition、manifest、resource 与 React ABI。
- [Architecture](architecture.md)：materialization、identity、budget、static/dynamic 与 migration gate。
