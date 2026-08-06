# Use Case：Carried 测试组合迁移

## 目标

用 fingerprint / carried 机制验证完整测试体系的迁移规则。内部实现可以从 `deltas` 改为 `comparison`，也可以
升级 fingerprint algorithm；只要用户契约没有变化，用户主证明和无关 fixture 不应修改。

本用例设计迁移后的 portfolio，不为当前每个测试文件逐行规定实现。

## 稳定 Behavior

用户任务是“重复运行时复用输入未变的历史终态，只重跑输入变化或无法安全解释的 Attempt”：

```ts
runnerBehavior({
  id: "runner.carry-stable-results",
  task: {
    repository: "niceeval",
    path: "docs/feature/experiments/use-case/运行/复用历史结果.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/experiments/runner.md",
    anchor: "结果携带",
  },
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "cli",
      observations: ["process-result", "json"],
      boundaries: ["installed-package", "real-cli", "record-files"],
    },
    execution: {
      mode: "mutable-clone",
      evidenceRecipeId: "carry-three-step-v1",
    },
  },
});
```

Recipe 在私有 clone 中运行三步：第一次产生完整结果；第二次只选择一个 Eval；第三次恢复完整选择并只改变另一
Eval 的一个 fingerprint 输入。主证明只观察 started / carried 的 attempt 身份、最终 locator 与公开 previous-result 分类。
它不读取 `EvalManifest`、`FingerprintComparison`、planner dispatch group 或 formatter 输入对象。

`deltas` 改成 `comparison`、内部 ADT 改名或 manifest builder 换实现时，这条 Behavior 不修改。只有用户公开的
carry 决策、JSON schema 或 previous-result 分类契约改变时才版本化 Behavior 预期。

## 唯一机制矩阵

完整 fingerprint 等价类只由 `runner.fingerprint.identity-matrix` 拥有：

| 维度 | 必须区分的错误算法 |
|---|---|
| config / source / data 输入进出 | 漏掉有效输入；把调度字段等无关输入加入 fingerprint |
| algorithm / coverage 版本 | 未知版本被当作相等；已知等价迁移被全部重跑 |
| manifest comparison | fingerprint 不同且无 delta 时返回空 changed；缺 manifest 时猜出具名差异 |
| migration audit | 自动迁移伪装成人工 accept；from/to 版本未校验 |

这是一个表驱动 mechanism proof。它可以拆文件方便阅读，但 Registry 中只有一个 `matrixOwner`，不能在 human、
JSON、accept 与 run 测试里再次展开全矩阵。

取锁后重查、并发 lease 与部分 attempt 补跑有独立的可控 barrier 错误算法，保留自己的 mechanism owner；它们
不是 fingerprint identity matrix 的更多排列。

## Projection 边界

Human 与 JSON 只证明各自独有出口：

- Human：一个 `changed` 代表和一个 `unexplained` 代表可读，locator 与 accept 命令保持关联；
- JSON：判别联合 schema、非空 deltas、reason 闭集和字段省略规则；
- Record：新 manifest 版本往返、旧缺字段按 legacy 读取、迁移审计字段往返；
- Accept：一个具名差异与一个 unexplained 代表，证明授权边界和落盘重锚。

这些 proof 使用稳定 fixture builder，不手写完整 planner row 或 manifest。它们不拥有 carry 决策矩阵，不能因为
新增 fingerprint 输入而同时增加 case。

## Fixture 形状

```ts
const current = manifestFixture.current({
  config: { model: "new" },
});

const legacy = manifestFixture.legacy({
  config: { model: "old" },
});

const previousResult = dryPlanFixture.previousResult({
  locator: "@1A1B2C3D4E5F",
  comparison: comparisonFixture.changed({
    selector: "config:model",
    from: "old",
    to: "new",
  }),
});
```

`manifestFixture.current()` 拥有当前 algorithm / coverage 的机械默认值。只有版本迁移 owner 使用 `.legacy()` 或
显式版本。生产 DTO 加一个无关字段时，修改 builder 一处；record、accept、human 测试不跟改。

`dryPlanFixture.previousResult()` 接受领域 comparison，不暴露 `HumanDryPlanRow` 的其它默认字段。Human 与 JSON 可以共享
机械 comparison fixture，但不能共享期望 formatter 文案或 JSON 对象。

## Retirement 计划

迁移批次先定义目标 owner，只盘点本批触及、明显重复或将被替代的 proof，不生成全仓 100% 映射。目标分类如下：

| 当前形态 | 动作 | 迁移后 owner |
|---|---|---|
| fingerprint 输入、版本、comparison 分散 cases | 合并为一个表驱动矩阵 | `runner.fingerprint.identity-matrix` |
| human 测试复制多组 changed delta | 删除重复，只留 changed / unexplained 两个出口代表 | `runner.dry-plan.human-projection` |
| JSON 测试复制 carry 场景 | 删除决策矩阵，只留 schema 与一个接线代表 | `runner.dry-plan.json-schema` |
| results / accept 手写完整 manifest | 改用 builder；不新增 proof | 原 record / accept owner |
| 完整运行中重复验证 fingerprint 每个输入 | 删除重复，保留 started / carried identity 闭环 | `runner.carry-stable-results` |
| 锁后重查与 lease 竞态 | 保留可控 barrier 矩阵 | 独立 concurrency owner |

迁移不是把所有 unit 删掉。删除的是重复决策矩阵和 DTO 形状复检；保留的是公开 schema、持久化兼容、纯机制
错误算法与确定性竞态。

## 可判定验收

迁移完成必须同时满足：

1. 应用“`deltas` 包进 `comparison`”的纯内部重构时，主 Behavior、record、accept 和无关 fixture 测试不改；
2. 给当前 `EvalManifest` 增加一个不参与这些 case 语义的必填机械字段，只修改 `manifestFixture.current()`；
3. 删除任一 fingerprint 有效输入，唯一 mechanism matrix 失败；
4. 恢复历史 carry 遮蔽 bug，`runner.carry-stable-results` 在 outcome 阶段失败；
5. Human 或 JSON projection 断线时只由对应 projection proof 和主 Behavior 的相关观察失败，不让全矩阵重复报错；
6. Registry 报告 duplicated matrix 为 0，并列出本批实际 retired proof 与 net proof delta，不要求其它旧测试都有 disposition。

这六项是采用门槛。只把测试改用 helper、但测试数量与 owner 没有收敛，不算完成迁移。
