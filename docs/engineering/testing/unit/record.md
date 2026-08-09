# Record 怎么测

契约出处：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [标注 Eval 源码 / Attempt 证据](../../../concepts.md)

Record 测试分为提交与读取、身份与 locator、闭包与完整性、receipt 与 live records、mirror / export。
不要用一个巨大目录同时承担这些责任。
选择口径、样本命中范围与时效归 [Sample 功能契约](../../../feature/sample/README.md)。

本篇不 fake：构造数据，并为每例创建独立的真实临时目录，测试提交、读取与选择逻辑。
真实运行的提交与读回由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收。

## Fixture 规范

**内存 Record 图**用于身份、revision 与闭包对账。
Builder 必须要求写出会影响身份与选择的字段；`attemptId`、origin Run、ordinal 与 adopted revision 不由全局自增器偷偷生成，测试读者必须能从 case 看出两条数据是否属于同一实体（规则见 [Harness](harness.md)）：

```ts
interface AttemptSpec {
  readonly attemptId: string;
  readonly originRunId: string;
  readonly evalId: string;
  readonly ordinal: number;
  readonly revision: number;
  readonly state: "active" | "completed" | "abandoned";
}
```

**临时事实根**用于提交 / 读取、身份识别、crash 残留与闭包检查。
每例创建独立 `mkdtemp` 目录、收尾删除；每个 case 只写形成该分类所需的最小对象，不复制一份完整 `.niceeval` 树。

## 观察面

- **提交面**：每次提交后 head 与 append-only committedRoots 的原子变化，以及 committed Graph root 的不可变性。
- **读取面**：`await using store = await openRecordStore(root)` 绑定并打开 Store。
  `await using record = await openRecord(store)` 打开当下 head；`openRecordGraph(store, ref)` 重开固定 revision。
  Record handle 提供原始事实读取与 `EvidenceValue` 两轴状态。
- **身份面**：完整 128-bit `attemptId`、locator 编码、origin Run 归属。

写读两面在 round-trip 测试里互相对账：提交的事实必须能读回，且事实位于契约声明的唯一位置。

## 证明范围规范

- **提交**：
  - 每次提交产生新的不可变 Graph root；已提交 root 的原始字节永不修改。
  - mutable 元数据只有 head 与 append-only committedRoots，二者与提交原子更新；无条件 last-write-wins 是协议错误。
  - 未知 typed payload 保留完整原始字节，reader 不解码也不丢弃。
  - `RecordCommit` 三态（`not-recorded` / `partial` / `complete`）各自可达；Attempt 提交未确认时不算完整结果。
- **身份与 locator**（[Attempt 定位符](../../../feature/record/architecture.md)）：
  - `attemptId` 是完整 128-bit 身份，在一个 Attempt 的全部 revision 中恒定；同一 experimentId、evalId 与 ordinal 的重新执行得到**不同**的 attemptId。
  - locator 是完整 128-bit `attemptId` 的 26 字符规范大写 Crockford 编码；CLI 形态是 `@` 加 26 字符，与 `attemptId` 一一对应、确定性派生。
  - **碰撞两侧**：identity reservation 尚未对外可见时，locator 已由另一身份占用才允许重新生成 attemptId；一旦可见就不得换值。
    单一 Record 内 locator index 必须唯一。
    只有调用方显式同时打开多个 Record 且同 locator 多命中时，CLI 才返回 `ambiguous-locator` 并要求 `recordId:@locator`。
- **Attempt 归属**：Attempt 永属 origin Run；carry / accept / rename 经 Claim 与 RunContribution 表达，不复制也不 reparent 执行事实。
  - 携带条目保留 origin Run 身份，不按当前 invocation 重算。
  - rename 产生 rename Claim，原 Run 的 Attempt 事实不动。
- **闭包与完整性**：从 committed Graph root 出发的强闭包遍历必须包含全部被引用对象。
  - 缺失对象返回 `missing-object`，不能折叠成 `not-recorded` 或 `corrupt`。
  - 完整性的表达单位是 stream、Attempt、Run 与 receipt；未封口的 stream 保留为 incomplete evidence，reader 不补造缺失事实。
- **receipt 与 live records**：
  - `AttemptReceiptSnapshot` 是唯一的 Attempt receipt 形状。
    它含 Invocation、origin Run、Experiment、Attempt、locator、Eval、ordinal、执行终态与 `RecordCommit`，不携带 Verdict、断言、agent、model 或配置明细。
  - `InvocationReceipt` 不聚合逐条结果，逐 attempt 事实经 `onRecord` 与 `onAttemptReceipt` 到达。
  - LiveRecord NDJSON 是穷尽联合（snapshot / observation / claim / heartbeat）；snapshot 是 live 传输数据，不是 Record 真源。
  - `Json(path)` 保存同一份 live records 加最终 `InvocationReceipt`，不聚合逐条结果数组。
- **Projector**：
  - 追踪式 ProjectionReadContext 自动形成 `basedOn`，组合 Projector 必须合并依据。
  - `EvidenceValue` 保持 value 与 verification 两轴；truncated / redacted / missing / corrupt 不折叠成 null。
  - 同一 Projector 版本对相同输入返回相同结果；Projection 不进入 Record，关闭句柄后可丢弃。
- **mirror / export**：
  - 先 `captureRecordMirrorSnapshot(source)`，再以 `mirrorRecord(source, target, { snapshot })` 复制完整 Record committed root 历史；没有隐式 snapshot 重载。
  - `materializeSample(recordHandle, selection)` 生成 Sample，不能传未经 handle 包装的 `record.ref`。
    `exportSample(sample, { sources, target })` 生成独立 `SampleBundle`。
    `exportReport(definition, { sample, sources, parameters, target })` 是呈现交付，可删除、可重新生成。
  - event、object、claim 与 absence proof 共用分页 `RecordEvidenceProofIndexV1` / `evidenceProofs`；不得恢复 `EventProofV1` / `eventProofs`。
- **开放 activity key 的往返与未知 key 读取**（[两层时间模型](../../../feature/record/architecture.md)）：
  - writer 接受第三方未知 `ActivityKey` 原样提交；`openRecord` 读回同一棵树，不因 key 不在官方词表而拒绝。
  - 官方 reader 不依赖任何 registry 才能展示未知节点。
- **Run / attempt 双时钟域**：
  - Run 侧计时相对该 Run 单调时钟起点；attempt 侧相对该 attempt 起点。
  - 两域 offset 不得混算，也不得拿远端 OTel 绝对时间硬对齐。
  - 共享构建只出现在 Run 域，不复制进任何 attempt 的 `executionMs`。
- **`TimingOrigin` 的 attempt / run 两支**：
  - attempt 支必带 Runner 打开的 `LifecyclePhase`，可选 `timingNodeId` 指向该参照点下 activity。
  - run 支必带指向 Run 侧时间树的 `timingNodeId`，不伪造 attempt 参照点。
  - 缺失 timing 时允许只写 attempt 参照点，或写无 `origin` 的 Run diagnostic；三态不合并。
- **`sandboxBuilds` 与 `timingNodeId` 引用完整性**：
  - 每个实际查询或构建过的 BuildKey 一条 provenance，多 attempt 引用同一条。
  - `status` 四值（`hit` / `built` / `failed` / `cancelled`）各要区分力格。
  - cache hit 也留下有界查询 activity；完全携带、无需查询的 BuildKey 不造假条目。

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录同时承担版本、身份与闭包三类分类。
- 不把 `null`、空数组、零和缺失折叠成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生算法再对答案；期望值写死在 case 里。
