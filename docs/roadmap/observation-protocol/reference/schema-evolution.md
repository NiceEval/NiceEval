# Schema 演进证据

本页回答两个问题：为什么现有 Record 经常升 `schemaVersion`，以及 typed-object v2 如何证明普通功能不再推动容器升版。
逐版事实来自 [`results-schema-version-history`](../../../../memory/results-schema-version-history.md)，现行格式行为来自 [Record Architecture](../../../feature/record/architecture.md#版本与升级设计)。

## 现有链路为什么变化面大

现有格式让整个 Run、`result.json` 与全部 artifact 共用一个顶层 `schemaVersion`。
新增证据还要进入 artifact registry、writer 参数、reader loader、`AttemptRecord.artifacts` 与 `publish({ artifacts })`。
任一真正破坏性字段变化都会让整份历史 Run 不可读、不可携带；实际成本见 [`schema-bump-invalidates-all-history`](../../../../memory/schema-bump-invalidates-all-history.md)。

同一个报告功能在两套设计中的修改面如下：

| 功能 | 现有链路 | typed-object v2 | 容器变化 |
|---|---|---|---|
| 增加 Agent 对话轮数 | 增加或消费 artifact、loader、measure 与发布名单 | 已有 Turn 事件时只增加 Projector 与页面 | 否 |
| 增加首 token 延迟 | 扩展 timing/result 类型、writer、reader 与报告 | 新事件 schema、timing Projector 与页面 | 否 |
| 增加 trace 瀑布图 | 接入 `trace.json`、artifact registry、loader、publish 与页面 | telemetry typed object、trace Projector 与页面 | 否 |
| trace 增加 attribute | 修改共享 `TraceSpan` 或 artifact 形状 | 新 telemetry media type 或新 Projector | 否 |
| 修改成本算法 | 处理 `result.json` 中旧成本字段的语义 | 新 evaluator/Projector identity，历史 Claim 不覆盖 | 否 |
| 增加源码或 diff 下钻 | 新 artifact、reader 方法和 publish 词干 | 新 typed object 与 Projector | 否 |
| 报告发布 trace | 调用方手工把 `trace` 放进 artifact allowlist | Export Plan 的 `basedOn` 自动形成闭包 | 否 |
| 单个 trace 超过 Git 限制 | 发布失败、排除证据或重新运行 | chunk-index 与 segment Descriptor 自动扩展 | 否 |
| 修改 Report 页面或字段 | 页面改动可能反推共享结果类型 | 只改 Report；读模型变化时升级 Projector | 否 |
| 修改 object-ID、root 或 seal | 整份格式升版 | 先过版本升级防火墙，确实无解才讨论 v3 | 可能 |

## 同一功能的代码对照

现有 writer 和 publish API 要显式认识每一种 artifact：

```ts
await run.writeAttempt(result, {
  commands,
  events,
  trace,
  o11y,
  agentSetup,
  diff,
  sources,
});

await publish(sample, target, {
  artifacts: ["commands", "events", "trace", "sources"],
});
```

增加 `httpArchive` 时，writer、registry、reader 与发布调用方都必须知道这个新词干。

v2 只增加一个 typed object，通用 writer、verifier 与 copier 不理解其业务字段：

```ts
const httpArchive = await objects.put({
  mediaType: "application/vnd.example.http-archive.v1+json",
  bytes,
});

await catalog.attach(attempt, "dev.example.evidence", httpArchive);
```

报告依赖通过 Projector 声明，不通过文件名单猜：

```ts
const plan: ReportExportPlan = {
  report: { name: "network", version: "1", parameters: {} },
  inputs: [{ recordId, root }],
  projections: [{
    id: "requests",
    attempt: { recordId, attemptId },
    projector: { name: "http-requests", version: "1" },
  }],
  pages: [{ route: "/network", projectionIds: ["requests"] }],
};
```

如果旧 Record 没有 HTTP archive，Projector 返回 `not-recorded`。
它不能把缺失解释成零请求，也不能要求给 Run manifest 补一个 `httpArchive` 字段。

## 1→15 反事实回放

下面不是迁移方案，而是检验 v2 表达力的历史测试。
如果过去的变化仍要求改 `LayoutV2`、Descriptor 或 root，v2 就没有解决原问题。

| 旧版本变化 | 在 v2 中的归属 | 是否改变容器 |
|---|---|---|
| 1→2→3 `flags` / `params` 往返改名 | 新 Provenance media type；旧 object 原样保留 | 否 |
| 4 run 聚合改成逐执行目录 | 新 Run/Attempt entity 与 relation object | 否 |
| 5 locator 与源码内容寻址 | 新 identity/source typed object 与关系 | 否 |
| 6 字符串 error 改结构化 error | 新 error Observation 或 Claim media type | 否 |
| 7 `operation` 改 `phase` | 新 lifecycle event schema 与 Projector | 否 |
| 8 Assertion、diff、coverage 大改 | 各自发布新 typed object schema | 否 |
| 9 `has*` 改 artifact registry | Catalog 原生挂载任意 typed object，不需要此轮重设 | 否 |
| 10 source role 与 caller path | 新 source Provenance media type | 否 |
| 11 snapshot 改 Run、增加 runId/locator | 新 entity/relation schema，Layout 不认识业务名 | 否 |
| 12 diff `binary` 并入 `elided` | 新 diff media type，旧 diff 不重解释 | 否 |
| 13 TimingNode 改 TimingActivity、phase 改 origin | 新 timing event schema 与 Projector | 否 |
| 14 `coverage` 改 `evidenceCoverage` | 新 Claim media type | 否 |
| 15 command 增加必填 `checked` | 新 command Observation schema | 否 |

这张表证明的是：所有已知历史变化都不需要修改 v2 容器公理。
它不证明未来不存在未知基础问题；因此还需要下面的反例防火墙。

## 版本升级防火墙

任何容器升版提案必须逐项回答：

1. 能否表示成新 Descriptor 指向的新 media type object？
2. 是否保持所有既有 media type、字段、digest 与 seal 的解释不变？
3. 旧 generic verifier 能否在不解码的情况下验证并原字节复制？
4. 新机制能否放进对象级 `requires`，而不是 Layout 全局 capability？
5. 新 reader 读取旧 v2 时，能否用 `not-recorded` 或局部 unavailable 如实表达？
6. 无界集合能否使用 catalog page 或 chunk-index tree，而不扩大 root？

六项都是“能”时，提案必须留在 v2。
只有 root 入口、Descriptor 寻址、对象图遍历、可信 object ID 或封口完整性无法继续解释时，才允许提出 v3。

## 兼容性质测试

实现不能只靠评审声称兼容，至少要持续验证以下性质：

1. 给 fixture 增加未知 typed object 后，旧 reader 的全部已知 Projection 保持相同。
2. Generic copier 往返未知对象后，原始 bytes、digest 与 size 完全相同。
3. 新 reader 读取缺少新对象的旧 fixture 时，只有对应能力是 `not-recorded`。
4. 不支持对象级 capability 时，只有依赖该对象的 Projector 是 `unsupported-capability`。
5. 改变 segment 或 chunk 边界不改变 Observation logical digest 与 Projector 结果。
6. 一个 Claim 或 Report 同时引用多个 Run 时，每个 EvidenceRef 都由 `recordId` 限定且无碰撞。
7. 任意 catalog 与 chunk index 都能继续分页，所有物理对象保持在 16 MiB 上限内。
