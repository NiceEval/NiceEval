# 方案 3：Use Cases

**相关文档**：[方案](../README.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md) · [共同 Cases](../../CASES.md)

本页按共同 Cases 说明声明式 Case 怎样兑现。

## C1：缓存复用

Case 顶层只出现用户 goal、带身份的 world、有序 steps 与命名 claims。
Primary Projection 和契约可以直接追踪，时钟与 barrier 留在 unit Projection。

读者能一屏看出用户修改 `rerun` 的 eval 源码、`kept` 从上一轮携带、`rerun` 被执行。
Agent 调用次数作为同仓 Supporting Projection 或原生机制测试证明，不进入用户 Case。
本方案完整满足 C1，但代价是要先理解 Case 与 Projection 的关系。

## C2：Report 多读面

Case 比较领域 claim，不比较 renderer class、任意整段文本或 JSON 缩进。
JSON、XML、ARIA、plain stdout 与 PTY screen 由各自 driver 解释。

如果三个媒介表达不同用户结果，就写三条 Case，共享同一个 evidence world。
不建立一个跨媒介巨型 Primary driver。

如果产品行为本身是 text / web parity，就让一个 Primary Projection 声明两个 surfaces，并在同一个 claim 中比较带相同身份的终值。

## C3：筛选与展开

多步任务用有序 steps 表达，Claim 指向观察时点：

```typescript
defineReportCase({
  steps: [
    step("filter", reportAction.filterExperiments(["main"])),
    step("open", reportAction.openAttempt("attempt-main-2")),
  ],
  claims: {
    filtered: after("filter",
      reportClaim.table("Comparison").showsOnly(["main"])),
    opened: after("open",
      reportClaim.dialog("attempt-main-2").describes({
        experiment: "main",
        attempt: 2,
      })),
  },
});
```

Driver 只能从真实 observation 读取这些身份。
它不能用 `count === 1` 或任意 dialog 可见替代。

## C4：并发与超时

用户结果由 Case 表达。
Supporting unit Projection 另行声明 manual clock 与 barrier，再用受控执行证明 single-flight、取消或 timeout 定律。

E2E Projection 不继承这套时钟语义。
无法合理声明成领域 Claim 的精确事件序列，继续留在原生 Effect unit test。

## C5：一次取证，多面复用

多条 Report Case 可以引用同一个 named world。
Prepare 完成模型运行、导出和 manifest 后冻结结果。

Terminal、JSON、XML 与 browser Projection 随后只读，互不依赖顺序。
测试体不能执行追加模型任务；需要变异的迁移 Case 使用隔离 world。

## C6：真实外部协议

Case 的 `proof.realProtocols` 声明真实协议要求。
Registry 拒绝用 fake SDK 或 wire fixture 充当 Primary。

确定性 transform test 可以是 Supporting Projection，也可以留成普通机制测试。
预期事实仍由 Case 独立声明，不能从候选 schema 导入。
若真实协议 proof 在另一个仓库，它必须是一条拥有完整动作、观察和期望的 native proof。
`ExternalProofLink` 只引用 Case owner、ID、digest、boundary requirement 与 native proof ID；它不携带也不执行 claim。
因此这个 Case 的语义复用只发生在同仓 Projection，跨仓仍可能重复表达。

## C7：包外消费者

Primary E2E Projection 用三个显式 step 完成 `install → run → read`。
Package driver 在仓库外 cwd 安装候选 tarball，再调用公开 import 或 CLI。
Driver 不能读取 `src/`、私有记录状态或候选内部常量。

Claim 只引用公开可观察的 experiment、attempt、exit 和结果身份。

## C8：回归证明

有公开行为后果的 bug 复用或新增 Case ID，并在 `regressions` 记录引用。
Registry 展示契约、Primary 与 Supporting Projection。

只影响内部机制的 bug 不建立 Case。
它继续使用原生 unit regression，避免声明模型扩张成源码分支目录。

## 试点退出条件

先选择三到五条已经跨两个边界重复表达的稳定行为。
出现任一情况就停止扩展并回到 [PLAN-2](../../PLAN-2/README.md)：

- Case 或 Projection 需要任意回调；
- Driver 开始按 Case ID 分支；
- 失败后仍要读 Driver 源码才知道哪个用户结果坏了；
- 声明长期长于等价原生行为规格；
- unit 与 E2E 为复用 Case 被迫共享 setup、clock 或 cleanup。
