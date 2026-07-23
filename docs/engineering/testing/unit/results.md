# Results 怎么测

契约来源：[Results](../../../feature/results/README.md)、[Architecture](../../../feature/results/architecture.md)、[Library](../../../feature/results/library.md)、[concepts · 标注 Eval 源码 / Attempt 证据](../../../concepts.md)。Results 测试分为落盘格式、读取分类、身份与去重、Scope、artifact 懒加载、copySnapshots 几组；不用一个巨大目录 snapshot 同时承担全部责任。本篇的缝：不 fake——构造数据 + 每例独立的真实临时目录，测 writer / reader 与选择逻辑；缝的真实侧（真实运行的落盘与读回）由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## Fixture 规范

**内存结果图**用于选择、去重和聚合前身份测试。Builder 必须要求写出会影响身份与选择的字段——`startedAt` 不由全局自增器偷偷生成，因为它是去重身份的一部分；测试读者必须能从 case 看出两条记录应该相同还是不同（规则见 [Harness](harness.md)）：

```ts
interface AttemptSpec {
  readonly evalId: string
  readonly attempt: number
  readonly startedAt: string
  readonly verdict: "passed" | "failed" | "errored" | "skipped"
}
```

**临时落盘树**用于 writer/reader、版本识别、crash 残留和 artifact 懒加载。每例创建独立 `mkdtemp` 目录、收尾删除；每个 case 只写形成该分类所需的最小文件，不复制一份完整 `.niceeval` 树。

## 观察面

- **落盘面**：writer 写出的 JSON 文件内容与层级归属。断言字段**不存在**同样有效——TypeScript 保证不了 JSON 没有冗余字段。
- **读取面**：`openResults()` 句柄的分类（experiments / skipped）、Scope 与警告、artifact 方法返回值。
- **身份面**：locator、身份四元组、ref 归属。

写读两面在 round-trip 测试里互相对账：writer 写出的 reader 必须能读回，且事实位于契约声明的唯一位置。

## 覆盖规范

- **落盘格式**：`snapshot.json` 开始写入、`snap.finish()` 唯一一次补 `completedAt` 与快照级 diagnostics；`result.json` 只含 attempt 级事实（快照级字段以「不存在」断言）；不落 `runId` / `invocationId` / Run Manifest 或跨实验成员关系；目录独占创建与撞名重试；artifact 缺省不生成、`null` 与 `[]` 语义分离；截断唯一落点与 UTF-8 字符边界；源码两层落盘按内容哈希去重；locator 确定性派生与携带条目原样复制不重算；目录名只是清洗投影、权威身份在字段；轮标签在 `diff.json`/时间树/send 标注三处逐字相等。
- **读取分类**：schemaVersion 不匹配（不论新旧）、坏 JSON、缺 snapshot.json、legacy 启发式各归各的 skipped reason 且携带诊断字段；无关 JSON 静默忽略；未知可选字段与未知 artifact 被接受；未收尾快照不是 skipped、attempt 照常可读。每类坏数据用形成该分类的最小文件构造。
- **Scope（`latest()`）**：快照粒度口径——每 experiment 取最新快照、不跨快照拼 eval、不平铺 attempt；覆盖缺口以 `coverage` 数据表达（`knownEvalIds` / `missingEvalIds`，分母是并集语义）；`filter` 只删减不新增且原 Scope 不变，coverage 与 warnings 随幸存实验同步修剪；unfinished 的触发条件；警告全集只含定位不到行的 kind（unfinished-snapshot / missing-startedAt / unreadable-snapshot），必带下一步（该带 `command` 的带真实 id）。区分力要求：fixture 必须让「快照粒度 / 逐 eval 拼接 / 平铺 attempts」三种候选算法得到不同结果，否则测试通过也没有证明力。
- **现刻水位（`current()`）**：与 `latest()` 是不同口径——按 experiment × eval 取「包含该 eval 的最新快照」的整批 attempt；跨快照拼接的可比性前提（配置不一致的旧快照不贡献、编排字段不参与比较，缺口进 `coverage.missingEvalIds`）；`Scope.attempts` 按口径物化而 `Scope.snapshots` 保留贡献数据的真实 Snapshot，每条 Attempt 的 snapshot/ref 仍指向来源；来源快照的 `selectedEvalIds` 局部选择约束与第三方快照缺字段时的退化；同一个 experiment 可能有多个真实贡献 Snapshot（不同 eval 取自不同历史快照），`Scope.snapshots` 不是「每 experiment 一个」；`filter()` 按真实 Snapshot 身份 `(experimentId, startedAt)` 删除单个来源时，只有该来源覆盖的 attempts 从 `Scope.attempts` 消失、`coverage.missingEvalIds` 按幸存来源重算，同 experiment 其它来源贡献的 attempt 与 coverage 不受影响——区分力要求：fixture 必须让同一个 experiment 同时有两个仍存活的真实贡献快照，证明删除其中一个不会连带清空或保留整个 experiment；复印件不重复计票；show/view 两宿主传同形参数、反映同一批事实。
- **时效与 fresh 口径**：`attempt.carried` 是 `artifactBase` 的读取面投影；历史执行的判定（携带，或所属快照早于该实验在 Scope 中的最新快照）；`fresh: true` 在两种口径下都排除全部历史执行、被排除的题进入 `coverage.missingEvalIds` 不静默消失。区分力要求：fixture 必须同时含携带条目与跨快照拼入条目，让「只排携带 / 只排旧快照 / 两者都排」三种候选算法得到不同结果。
- **身份与去重**：reader 忠实保留重复、去重是消费方义务；同身份键取最新快照；`startedAt` 缺失时宁可不去重也不误删并出警告；「缺才补」的字段拼合优先级；`ref` 指向条目所在落盘。
- **artifact 懒加载**：七个方法（`commands` / `events` / `trace` / `o11y` / `agentSetup` / `diff` / `sources`）缺文件一律 `null` 不抛；携带条目按候选顺序回退 `artifactBase`、原快照被清理后如实 `null`；`sources()` 的解引用去向；截断是磁盘事实原样读出；同 handle 记忆化。缺失、空、有值三态不合并成同一种 fixture 默认值。
- **标注源码与证据装配**：断言/send 标注的行映射与 unmapped 桶（never silently dropped）；轮与 turn 节点的配对规则和错位保护；行切分无幻影尾空行、CRLF/LF 归一；`AttemptEvidence` 四个能力位以「数据真的存在且非空」为准、identity 与 locator 原样一致、execution 与 span 按 call id 关联不按名字猜。
- **Usage、facts 与失败命令证据落盘**：`Usage` 每个字段只在协议真实提供时写入——fixture 要区分「省略」与「写 0 / 写 1」（尤其 `requests`：无请求计数的协议不得落 `requests: 1`）；`fact()` 的作用域归属（sandbox hook / agent 上下文 → `AttemptRecord.facts`，experiment hook → `SnapshotMeta.facts`，runner 自动归属、调用方无法指定层级）、同作用域同 key 后写覆盖、key 词法（`[a-z0-9._-]{1,64}`）与非标量 value 的完整报错、experiment 级 facts 与 `completedAt` 同批封口补写、facts 不参与 verdict / 指纹 / 可比性配置；读取面把两级 facts 原样读回不合并。`commands.json` 只在有非零 Sandbox 命令时生成，`AttemptRecord.artifacts` 含 `commands` 与文件存在同值;每条 evidence 的 timingNodeId / phase / display / exitCode / stdout / stderr 原样往返，stdout/stderr 复用 256 KiB 字符串截断与结构化 `truncated` 标记；携带按 artifactBase 懒加载，`copySnapshots({ artifacts: ["commands"] })` 物化后不留回退指针。
- **copySnapshots 与 resolveLocator**：目标非空即报错不合并、预检失败不留半成品；文件大小预检的整体失败与错误明细；产物自包含（解引用复制、重新去重、补 `knownEvalIds`）；`resolveLocator` 只查内存、两类错误可分辨。

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、选择、去重和 artifact。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生或去重算法再对答案；期望值写死在 case 里。
