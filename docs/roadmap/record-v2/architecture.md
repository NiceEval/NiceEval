# Record v2 —— 架构候选

## 信息模型先于文件模型

Writer 写入任何字段前必须回答两个问题：这个值属于哪类信息；删除它后能否只用同一份 Record 中的其它内容确定性恢复。

能恢复的值是 Projection。
不能恢复的运行观测是 Observation；解释观测所需的输入是 Provenance；根据二者作出的结论是 Claim。

文件拆分和 schema 版本只服务这套分类，不能代替分类本身。

## Observation：不可重建的运行观测

Observation 保存执行结束后无法重新取得的内容：

- Agent 消息、工具调用与 adapter 事件。
- Sandbox 命令、退出状态、stdout 与 stderr。
- Workspace 实际变化和导出时发生的省略。
- Runner 单调时钟采集的阶段与 activity 时间。
- 外部 trace、实际 token usage 与 provider 返回的账单。
- 运行错误的原始结构化描述和资源清理结果。

Observation 只陈述发生了什么，不保存通过率、聚合覆盖状态或 UI 摘要。
未知事件种类原样保留；已知事件字段改变时只影响该事件流的 decoder。

```ts
interface ObservationRef {
  key: string;
  schema: string;
  path: string;
  mediaType: "application/json" | "application/x-ndjson";
  sha256: string;
  bytes: number;
}
```

摘要和字节数用于完整性验证，不表达业务结论。

## Provenance：复核结论所需的上下文

Provenance 保存“为什么这次运行是这次运行”：

- Run、Attempt、Experiment 与 Eval 的稳定身份。
- 实际选择的 Eval 集和运行配置。
- Agent、model、reasoning effort、Adapter 与 provider 身份。
- 源码、判据文件、Sandbox Plan 与安装清单。
- strict、judge 配置、价格表快照和各算法版本。
- 证据通道在每个 Turn 的采集能力与降级原因。

`knownEvalIds` 属于 Provenance，不是从已有 Attempt 推导的集合。
没有 Attempt 的 Eval 正是覆盖缺口，不能通过扫描结果恢复。

`configHash` 与 fingerprint 不属于 Provenance 权威值。
它们是这组输入在某个哈希算法下的 Projection；权威内容是参与计算的完整输入清单。

```ts
interface ProvenanceDocument {
  schema: "niceeval.provenance/1";
  identity: {
    runId: string;
    attemptId?: string;
    experimentId: string;
    evalId?: string;
  };
  inputs: Record<string, JsonValue>;
  algorithms: Record<string, { name: string; version: string }>;
}
```

## Claim：保存当时结论，不冒充原始事实

Assertion、judge、verdict、证据覆盖聚合和估算成本都是 Claim。
它们应当持久化，因为这些结论影响运行控制、结果携带和用户决策；但每条 Claim 必须说明依据和求值者。

```ts
interface Claim<T = JsonValue> {
  claimId: string;
  kind: string;
  schema: string;
  value: T;
  evaluator: {
    name: string;
    version: string;
    model?: string;
  };
  basedOn: Array<{
    document: string;
    selector?: string;
    sha256: string;
  }>;
  producedAt: string;
}
```

确定性断言也用 Claim 表达。
它记录运行当时实际采用的规则，reader 可以用相同 evaluator 复核，但不能用当前规则静默改写历史结论。

Judge Claim 保存模型返回与 judge 配置身份，不在读取时重新调用模型。
Verdict Claim 引用 assertion、judge、致命错误和 strict 输入；它不复制这些内容。

证据覆盖不再只保存 attempt 级 `evidenceCoverage`。
各 Turn、各通道的采集状态属于 Provenance 或 Observation，attempt 聚合是带算法版本的 Claim。
更改聚合字段名或展示等级不会使原始证据失效。

成本分两种：provider 返回的实际账单是 Observation；NiceEval 根据 usage 与价格表计算的成本是 Claim。
估算 Claim 必须引用 usage、价格表快照和计价算法，不能只保存一个无法解释的数字。

## Projection：可删除的索引与聚合

Projection 只加速读取或方便消费：

- locator 和路径索引。
- `artifacts` 存在性列表。
- configHash、fingerprint 与 manifest 差异索引。
- o11y 行为计数与总 usage。
- 通过数、失败数、成本合计和覆盖摘要。
- Reports 需要的行、分组与图表数据。

Projection 必须声明生成器和输入摘要。
任一输入摘要变化、生成器版本不匹配或缓存损坏时，reader 删除或忽略缓存并重算。

```ts
interface ProjectionRef extends ObservationRef {
  generatedBy: { name: string; version: string };
  basedOn: Array<{ document: string; sha256: string }>;
}
```

Projection 不进入 `publish()` 的默认事实集。
发布端可以重新生成需要的索引，也可以携带缓存，但缓存缺失不能让记录不可读。

## 稳定容器

`run.json` 和 `attempt.json` 只负责稳定身份、父子关系和文档目录。
它们不再承载 Experiment 宽配置、verdict、usage 或报告摘要。

```ts
interface RunManifest {
  format: "niceeval.record";
  schemaVersion: 2;
  producer: { name: string; version?: string; commit?: string };
  runId: string;
  experimentId: string;
  attempts: Array<{
    attemptId: string;
    evalId: string;
    attempt: number;
    path: string;
  }>;
  observations: Record<string, ObservationRef>;
  provenance: Record<string, ObservationRef>;
  claims: Record<string, ObservationRef>;
  projections?: Record<string, ProjectionRef>;
}
```

Attempt manifest 使用同一四分类目录，并通过 `runId` 建立父关系。
携带结果引用来源 `(runId, attemptId)`；路径只是本地查找索引，不是权威身份。

容器版本只在身份、父子关系或文档引用无法继续解析时改变。
Observation、Provenance 与 Claim 各自演进，不共享一个 Run 级语义版本。

## 读取模型与层间边界

`openRecord()` 返回审计模型，不返回持久化版 `EvalResult`：

```ts
interface AttemptRecord {
  identity: AttemptIdentity;
  observations: ObservationSet;
  provenance: ProvenanceSet;
  claims: ClaimSet;
  availability: CapabilityState;
}
```

Record decoder 只做三件事：验证原始文档、把已知 schema 转成中性类型、报告不知道或损坏的切面。
它不选择最新 Run，不聚合总体，也不按当前算法覆盖历史 Claim。

Sample 消费 `AttemptRecord`，负责跨 Run 选择、覆盖与比较。
Reports 消费 Sample 和可用 Claim，所有行、表、总计都是内存 Projection。

结果携带不是 Record 的基础读取能力。
携带规划检查所需 Observation、Provenance 和 Claim 是否齐全，并用当前规则从 Provenance 重算 fingerprint；diff 或报告缓存不参与携带资格。

## 兼容与过渡

新 writer 只写四分类格式。
新 reader 为当前 v14 提供隔离的 legacy decoder，把旧字段显式归入四类；无法指出依据的历史结论转成 `opaque-claim`，不能伪造 `basedOn`。

v1–v13 继续提供对应 producer 版本的读取提示。
若增加离线转换命令，它只能写入新目录并保留原字节；转换生成的 Claim 必须标记 legacy 来源，不能把推测补成事实。

每次新增持久化字段都要通过四问审查：

1. 它是不可重建的观测、复核所需输入、当时裁决，还是便利投影。
2. 如果是 Claim，它引用了哪些输入，由哪个 evaluator 产生。
3. 如果是 Projection，删除它能否只靠同一份 Record 确定性恢复。
4. 它的变化会影响哪些消费能力，为什么需要扩大到其它文档。

答不出分类的字段不得进入 Record schema。
