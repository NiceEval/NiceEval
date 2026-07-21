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

- **落盘格式**：`snapshot.json` 一次写入、`finish()` 只补 `completedAt`；`result.json` 只含 attempt 级事实（快照级字段以「不存在」断言）；目录独占创建与撞名重试；artifact 缺省不生成、`null` 与 `[]` 语义分离；截断唯一落点与 UTF-8 字符边界；源码两层落盘按内容哈希去重；locator 确定性派生与携带条目原样复制不重算；目录名只是清洗投影、权威身份在字段；轮标签在 `diff.json`/时间树/send 标注三处逐字相等。
- **读取分类**：schemaVersion 不匹配（不论新旧）、坏 JSON、缺 snapshot.json、legacy 启发式各归各的 skipped reason 且携带诊断字段；无关 JSON 静默忽略；未知可选字段与未知 artifact 被接受；未收尾快照不是 skipped、attempt 照常可读。每类坏数据用形成该分类的最小文件构造。
- **Scope（`latest()`）**：快照粒度口径——每 experiment 取最新快照、不跨快照拼 eval、不平铺 attempt；覆盖缺口以 `partial-coverage` 结构化警告表达（分母是并集语义）；`filter` 只删减不新增且原 Scope 不变；stale/unfinished 的触发条件；警告必带下一步（该带 `command` 的带真实 id）。区分力要求：fixture 必须让「快照粒度 / 逐 eval 拼接 / 平铺 attempts」三种候选算法得到不同结果，否则测试通过也没有证明力。
- **现刻水位（`current()`）**：与 `latest()` 是不同口径——按 experiment × eval 取「包含该 eval 的最新快照」的整批 attempt；跨快照拼接的可比性前提（配置不一致的旧快照不贡献、编排字段不参与比较）；合成快照的 `selectedEvalIds` 重建语义与来源快照的局部选择约束；第三方快照缺字段时的退化；复印件不重复计票；show/view 两宿主传同形参数、反映同一批事实。
- **身份与去重**：reader 忠实保留重复、去重是消费方义务；同身份键取最新快照；`startedAt` 缺失时宁可不去重也不误删并出警告；「缺才补」的字段拼合优先级；`ref` 指向条目所在落盘。
- **artifact 懒加载**：六个方法缺文件一律 `null` 不抛；携带条目按候选顺序回退 `artifactBase`、原快照被清理后如实 `null`；`sources()` 的解引用去向；截断是磁盘事实原样读出；同 handle 记忆化。缺失、空、有值三态不合并成同一种 fixture 默认值。
- **标注源码与证据装配**：断言/send 标注的行映射与 unmapped 桶（never silently dropped）；轮与 turn 节点的配对规则和错位保护；行切分无幻影尾空行、CRLF/LF 归一；`AttemptEvidence` 四个能力位以「数据真的存在且非空」为准、identity 与 locator 原样一致、execution 与 span 按 call id 关联不按名字猜。
- **copySnapshots 与 resolveLocator**：目标非空即报错不合并、预检失败不留半成品；文件大小预检的整体失败与错误明细；产物自包含（解引用复制、重新去重、补 `knownEvalIds`）；`resolveLocator` 只查内存、两类错误可分辨。

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、选择、去重和 artifact。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生或去重算法再对答案；期望值写死在 case 里。
