# Use Case：Runner carry 的测试职责

## 目标

这个例子说明同一项 carry 能力怎样在 Unit 与 E2E 之间分工，而不把 `Behavior`、`Proof`、`Registry` 或
`mechanism owner` 变成新的测试类型。

用户契约是：重复运行时复用输入未变的历史终态，只重跑输入变化或无法安全解释的 Attempt。内部实现可以把
`deltas` 改成 `comparison`，也可以重构 planner；只要用户契约没变，E2E 正文就不应跟着修改。

## 用户结果由 Runner 场景 Repo 证明

Owner 是
[`example/repos/runner/test/carry-reuse.test.ts`](example/repos/runner/test/carry-reuse.test.ts)。它在隔离的真实
Repo 中运行安装后的 `pnpm exec niceeval exp`，从公开 `--dry --json` 与 `--json` 事件流观察结果：

1. 强制完整运行时没有携入；
2. 下一次 dry plan 报告全部可携入；
3. 正常运行的实际携入数与计划一致；
4. 修改 config 后所有 Attempt 失去携入资格；
5. `full → partial → full` 后，未变化 Eval 仍能从更早运行携入（`regression: 85cafd7d`）。

这组测试不读取 `EvalManifest`、`FingerprintComparison`、planner dispatch group 或 `.niceeval/` 私有布局。它只在公开边界
上证明“用户最终复用了什么”，并在 dry、run、partial-run 三个接缝分别失败，而不是把所有错误折叠成最后一个计数。

## 等价类由一个 Unit 矩阵证明

完整 fingerprint 输入矩阵只在一个 Unit owner 中展开；当前实现位置是 `src/runner/fingerprint.test.ts`。它需要区分：

| 维度 | 必须拦住的错误实现 |
|---|---|
| config / source / data 输入 | 漏掉有效输入；把调度字段等无关输入加入 fingerprint |
| algorithm / coverage 版本 | 未知版本被当成相等；已知等价迁移被全部重跑 |
| manifest comparison | fingerprint 不同且无 delta 时仍返回 unchanged；缺 manifest 时猜出具名差异 |
| migration audit | 自动迁移伪装成人工 accept；from / to 版本未校验 |

真实 Repo 不重复这张表，只选择能证明 CLI 接线与历史 bug 的代表。反过来，Unit 不模拟安装后的 CLI、外部 cwd、持久化结果根
或三次用户运行来冒充 E2E。

取锁后重查、并发 lease 与 retry 时序不是 fingerprint 输入矩阵的更多 case。它们各自在带 barrier / fake clock 的 Unit 文件里
拥有自己的标题，因为它们排除的是不同错误实现。

## 其它出口只测自己的差异

| 出口 | 保留的断言 | 不再复制 |
|---|---|---|
| Human dry plan | 一个 `changed` 与一个 `unexplained` 代表可读，locator 和 accept 命令关联 | fingerprint 全矩阵 |
| JSON dry plan | schema、非空 deltas、reason 闭集与字段省略规则 | carry 决策全矩阵 |
| Record | 新版本往返、旧缺字段读取、迁移审计字段 | CLI 文案与调度步骤 |
| Accept | 一个具名差异与一个 unexplained 代表，证明授权和重锚 | 所有 fingerprint 输入排列 |

这些 Unit 可以共享只负责造输入的 fixture builder；不能共享会计算 delta、verdict 或 expected 的函数。

## Fixture 的变化预算

```ts
const current = manifestFixture.current({ config: { model: "new" } });
const legacy = manifestFixture.legacy({ config: { model: "old" } });

const previousResult = dryPlanFixture.previousResult({
  locator: "@1A1B2C3D4E5F",
  comparison: comparisonFixture.changed({
    selector: "config:model",
    from: "old",
    to: "new",
  }),
});
```

`current()` 只补当前合法输入的机械默认值；只有兼容性测试使用 `legacy()` 或显式版本。给生产 DTO 增加无关字段时，只修改
builder；需要 fixture 自己计算预期才能继续通过时，应先停下来修 oracle 边界。

## 迁移与验收

| 旧测试形态 | 动作 | 新 owner |
|---|---|---|
| fingerprint 输入、版本、comparison 分散 case | 合并为一个表驱动矩阵 | `src/runner/fingerprint.test.ts` |
| Human / JSON 各自复制 carry 矩阵 | 删除矩阵，只留各自输出差异 | 对应 formatter / schema Unit |
| results / accept 手写完整 manifest | 改用最小 builder，不新增重复测试 | 原 Record / Accept Unit |
| 完整运行中重复穷举 fingerprint 输入 | 只留计划与实际携入闭环 | Runner carry 场景 Repo |
| 共享结果根中的 full / partial 顺序测试 | 移入隔离副本 | `runner/carry-reuse.test.ts` 单边界 E2E |

迁移完成必须满足：

1. `deltas` 包进 `comparison` 时，Runner carry E2E 不改；
2. `EvalManifest` 增加无关字段时，只修改 builder，不批量修改 case；
3. 删除任一有效 fingerprint 输入时，唯一 Unit 矩阵失败；
4. 恢复 `85cafd7d` 前的 carry 遮蔽错误时，`full → partial → full` E2E 失败；
5. Human 或 JSON 接线断开时，只有对应出口测试和必要的公开 E2E 代表失败；
6. 同一 fingerprint 等价类不在 Unit、Human、JSON 与 E2E 中重复展开。

这里不需要 Registry 统计“proof 数量”。评审直接从 owner 表、测试文件名、标题和历史 bug kill 收据判断职责是否唯一。
