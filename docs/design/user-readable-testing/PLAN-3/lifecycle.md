# 方案 3：Lifecycle

**相关文档**：[README](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## Owner

| Owner | 拥有 |
|---|---|
| Case owner | Case ID、World / Action / Claim 联合、Case digest |
| 同仓 Projection owner | driver、执行层、claim 覆盖与 evidence |
| 外仓 native proof owner | 自己的动作、观察、期望与执行器 |
| 根 Registry | Case / Projection / ExternalProofLink 的只读连接 |
| E2E 仓库 | prepare、frozen world、verify 与 cleanup |

`ExternalCaseRef` 不含 claim 内容，不能执行。
跨仓 `ExternalProofLink` 只把 boundary requirement 连到一条完整 native proof；它不复用 Case expectation。

## 声明与注册

```text
同仓 AcceptanceCase
  → 校验 World、Step、Claim、after 与 digest
  → 校验恰有一个 Primary Projection
  → 校验本仓 Projection 能解释全部联合成员
  → 分别注册原生 unit / E2E 测试

跨仓 ExternalProofLink
  → 本仓只校验引用形状与 native proof 存在
  → 根聚合时解析 Case owner、digest 与 boundary requirement
```

Case 目录只作为不签入的 CI artifact。
目标仓库缺少根聚合器时仍完整运行自己的 native proof。

## Unit Projection

```text
每例创建 fresh fixture
  → 安装 TestClock / barrier / Layer
  → 按 step 顺序执行 Action
  → 在声明的 after 点读取 observation
  → 逐 Claim 比较
  → 销毁 fixture
```

精确机制事件表达不了时留在原生 unit test，不扩张 Claim 联合。

## E2E Projection

```text
prepare named world
  → 安装候选并完成全部副作用
  → 保存 evidence 与 identity
  → 原子冻结
  → 同仓 Projection 只读执行可观察 step
  → 逐 Claim 比较
  → 校验 world 未变化
```

一份 world 可以支持多条 Case。
浏览器 page 状态每例 fresh；会修改结果的 Case 使用单例私有 clone。

## Fresh / Reuse

| 动作 | fresh | reuse |
|---|---:|---:|
| Case / Projection 静态校验 | 1 | 1 |
| 安装候选与昂贵取证 | 每个 world 1 | 0 |
| world identity 校验 | 1 | 1 |
| unit fixture | 每个 Projection 1 | 每个 Projection 1 |
| E2E observation | 每个选中 Projection 1 | 每个选中 Projection 1 |
| 外仓 native proof | 由外仓自己执行 | 由外仓自己执行 |

Reuse 只有在 Case semantic digest、candidate、producer、fixture、外部依赖、prepare config 和适用环境 identity 全部相同时成立。
任何不匹配都拒绝旧 world，不静默 prepare。

## Cases

- C1–C4：同仓 Case / Projection 共享声明；机制控制仍只在 unit。
- C5：多个同仓 Projection 只读同一 world。
- C6：若真实协议在外仓，它是 native proof + ExternalProofLink，不共享 claim。
- C7：包外安装、运行、读回在 E2E prepare 完成。
- C8：公开回归进入 Case；机制回归保持原生测试。

跨仓不能复用 claim 是本方案的结构性代价，也是当前不推荐它的原因之一。
