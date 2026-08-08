# 有序 Eval 序列 —— Architecture

## 数据建模

Sequence 是发现期定义，Sequence Invocation 是一次 CLI 调用中把一个 Sequence 与一个 Experiment 配对后的执行实体：

```text
SequenceDefinition ──引用──▶ EvalDefinition × N
        │
        └──配对一个 Experiment──▶ Sequence Invocation
                                      └── Sequence Step × N
                                              └── Attempt
```

Sequence Step 不是新的评分实体。
每一步仍产生普通 Attempt、Assertion 与 Verdict；步骤只补充它在本轮有序历史中的位置和出处。

Record 增加下面两处形状：

```ts
interface SequenceRunInfo {
  readonly id: string;
  readonly definitionHash: string;
  readonly replay: "full";
  readonly evalIds: readonly string[];
  readonly throughEvalId?: string;
}

interface AttemptSequenceInfo {
  readonly id: string;
  readonly definitionHash: string;
  readonly index: number;
  readonly prefixHash: string;
}

interface Run {
  readonly sequence?: SequenceRunInfo;
}

interface EvalResult {
  readonly sequence?: AttemptSequenceInfo;
}
```

普通 Experiment Run 省略 `Run.sequence`，普通 Attempt 省略 `EvalResult.sequence`。
读取面只凭这些落盘事实识别 Sequence 结果，不读取 evalId 的数字前缀，也不重新读取当前 Sequence 源码猜测旧数据。

## 规划与派发

规划按以下顺序完成：

1. 发现并校验 Sequence Definition；
2. 读取唯一 Experiment，并取得它实际选择的 Eval；
3. 校验所有 Sequence 成员都在选择结果中；
4. 应用 `--through`，得到从第一步开始的连续前缀；
5. 对该前缀做普通 Eval × Experiment link 与 physical planning；
6. 把全部步骤标为 fresh dispatch，不进入结果沿用规划；
7. 依次派发，每一步封口后才允许下一步取得全局并发位。

Sequence Invocation 的有效宽度恒为 1，不改写 Experiment 文件中的 `maxConcurrency`。
同一 Invocation 的其它普通 Experiment 不受影响；本命令只允许一个 Experiment，因此不存在同一 Sequence 内外任务交错。

`passed` 或 `failed` 封口后继续。
`errored`、`skipped` 或中断使 lineage 不完整，后续成员不进入 Agent、Sandbox 或 Judge 生命周期。

## 身份与结果沿用

`definitionHash` 哈希完整有序 Eval ID 数组；Sequence ID 单独保存，不用哈希代替人读身份。
`prefixHash` 哈希 Sequence ID、definitionHash、当前 index 与从第一步到当前步的 Eval ID 前缀。

Sequence 上下文进入每条 Attempt fingerprint。
同一道 Eval 脱离 Sequence 单独运行、处于另一条 Sequence、或处于同一 Sequence 的不同定义版本时，都不是同一个可比较输入。

Sequence Invocation 不消费历史结果沿用。
这不是给普通 Experiment 增加第六道携带门，而是选择了一条每步都要求真实派发的执行模式。
结果仍正常落盘，可被读取、比较和发布；以后再次运行同一 Sequence 时仍产生新的 fresh Attempt。

## 并发 Invocation 与外部状态

Sequence 不创建第二套状态锁。
Experiment 声明 `sharedState.key` 时，现有共享状态租约涵盖整个 Sequence Invocation，从 lifecycle setup 前持有到最后一次 teardown 与 finalizer 后。

没有 `sharedState` 时，并行 Invocation 可以各自运行同一 Sequence。
这只在它们使用独立状态或完全无状态时安全；共享外部状态却不声明 key 仍是 Experiment 作者错误。

完整重新执行只证明 NiceEval 本轮依次执行了完整前缀。
外部系统若不能在开始前恢复固定 revision、分配新 cohort，或回滚中断步骤，当前状态就不能称为干净轨迹。
Sequence 不通过成功文案掩盖这个边界。

## 不变量

- Eval ID 与 Sequence ID 都只来自各自文件路径，定义对象不接受手写 `id` 或 `name`。
- Sequence 的声明顺序是唯一执行顺序，不读取文件名字典序补充或改写它。
- 一条 Sequence 中每个 Eval ID 至多出现一次。
- 任一步派发前，它的全部前序步骤都已在本轮封口为 `passed` 或 `failed`。
- Sequence Attempt 从不由 carried 结果替代。
- Sequence 结果始终携带 Sequence ID、定义摘要、index 与前缀摘要。
- 不根据 tags、metadata、description 或 Assertion 文案推断步骤的业务作用。
